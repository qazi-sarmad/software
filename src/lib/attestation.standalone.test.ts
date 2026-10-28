/**
 * T4 — the in-product verifier and the STANDALONE third-party verifier must agree.
 *
 * The whole point of T4 is that an outsider can re-derive the root WITHOUT our code. That only holds
 * if the two implementations of the procedure are the same procedure. This test builds a package with
 * the in-product pure layer, runs `scripts/verify-attestation.mjs` as a separate Node process with
 * nothing but Node built-ins, and requires the two to reach the same verdict: a good package passes
 * both, and a tampered package fails both.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  buildAttestationPackage,
  merkleRootOfLeafHashes,
  verifyAttestationPackage,
  type AttestationInput,
} from './attestation';
import { signSubject, toHex, type CryptoLike, type SignatureSubject } from './anchoring';
import { merkleLeafHash } from './writing/merkle';

const crypto = webcrypto as unknown as CryptoLike;
const VERIFIER = resolve(process.cwd(), 'scripts/verify-attestation.mjs');

async function buildPackage() {
  const pair = (await webcrypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  )) as CryptoKeyPair;
  const raw = (await webcrypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const priv = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pubHex = toHex(new Uint8Array(raw));

  const leaves = [
    { claimId: 'c1', leafHash: await merkleLeafHash('one') },
    { claimId: 'c2', leafHash: await merkleLeafHash('two') },
  ];
  const graphRoot = await merkleRootOfLeafHashes(crypto, leaves.map((l) => l.leafHash));
  const subject: SignatureSubject = {
    kind: 'report_graph_root', subjectId: 'r-1', rootHash: graphRoot,
    signedAt: '2026-10-27T00:00:00Z', keyId: 'key-1',
  };
  const signature = await signSubject(crypto, subject, priv);
  const input: AttestationInput = {
    generatedAt: '2026-10-27T09:00:00Z',
    subject: { kind: 'report_graph_root', id: 'r-1', label: 'Report' },
    roots: [{ name: 'graph_root', hash: graphRoot }],
    versions: { engine: '1.0.0', template: 'M1@1', phraseLibrary: '1.0.0', rulePacks: [] },
    leaves,
    keys: [{ keyId: 'key-1', algorithm: 'Ed25519', publicKey: pubHex }],
    signatures: [{
      kind: 'report_graph_root', subjectId: 'r-1', rootHash: graphRoot, keyId: 'key-1',
      algorithm: 'Ed25519', signature, signedAt: subject.signedAt,
    }],
    timestamps: [],
    ledgerSeq: '1',
  };
  return buildAttestationPackage(crypto, input);
}

function runVerifier(file: string): { code: number; stdout: string; output: string } {
  try {
    const stdout = execFileSync('node', [VERIFIER, file], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { code: e.status ?? 1, stdout: e.stdout ?? '', output };
  }
}

describe('the standalone verifier agrees with the in-product verifier', () => {
  it('passes a good package under both, and both derive the same root', async () => {
    const pkg = await buildPackage();
    const dir = mkdtempSync(join(tmpdir(), 'attest-'));
    const file = join(dir, 'pkg.json');
    try {
      writeFileSync(file, JSON.stringify(pkg, null, 2));
      const inProduct = await verifyAttestationPackage(crypto, pkg);
      const standalone = runVerifier(file);
      expect(inProduct.ok).toBe(true);
      expect(standalone.code).toBe(0);
      expect(standalone.stdout).toContain('VERIFICATION PASSED');
      expect(standalone.stdout).toContain(pkg.packageRoot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a tampered package under both', async () => {
    const pkg = await buildPackage();
    const tampered = { ...pkg, ledgerSeq: '999' };
    const dir = mkdtempSync(join(tmpdir(), 'attest-'));
    const file = join(dir, 'pkg.json');
    try {
      writeFileSync(file, JSON.stringify(tampered, null, 2));
      const inProduct = await verifyAttestationPackage(crypto, tampered);
      const standalone = runVerifier(file);
      expect(inProduct.ok).toBe(false);
      expect(standalone.code).toBe(1);
      expect(standalone.output).toContain('VERIFICATION FAILED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('checks the expected root when one is supplied', async () => {
    const pkg = await buildPackage();
    const dir = mkdtempSync(join(tmpdir(), 'attest-'));
    const file = join(dir, 'pkg.json');
    try {
      writeFileSync(file, JSON.stringify(pkg, null, 2));
      const good = execFileSync('node',
        [VERIFIER, file, '--expect-root', pkg.roots[0].hash], { encoding: 'utf8', stdio: 'pipe' });
      expect(good).toContain('step 5  expected root       OK');
      let failed = false;
      try {
        execFileSync('node', [VERIFIER, file, '--expect-root', 'f'.repeat(64)],
          { encoding: 'utf8', stdio: 'pipe' });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

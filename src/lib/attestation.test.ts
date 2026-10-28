/**
 * T3/T4 — the portable attestation package. Direct unit tests for the pure layer.
 *
 * Every test injects the time and the crypto. The Ed25519 tests use Node's own WebCrypto, which is
 * the same primitive the Edge Function and the standalone verifier use, so the tests exercise the
 * real code path. The critical property is that the standalone Node verifier
 * (scripts/verify-attestation.mjs) and the in-product verifier (this module) agree: a package built
 * here verifies under both, and a tampered package fails under both.
 */
import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  ATTESTATION_FORMAT,
  ATTESTATION_INSTRUCTIONS,
  AttestationError,
  buildAttestationPackage,
  merkleRootOfLeafHashes,
  packageRoot,
  parseAttestationPackage,
  verifyAttestationPackage,
  type AttestationInput,
  type AttestationPackage,
} from './attestation';
import {
  canonicalSigningInput, signSubject, toHex, type CryptoLike, type SignatureSubject,
} from './anchoring';
import { buildMerkleTree, merkleLeafHash } from './writing/merkle';

const crypto = webcrypto as unknown as CryptoLike;
const ROOT = 'a'.repeat(64);
const ROOT_B = 'b'.repeat(64);

async function keypair(): Promise<{ priv: JsonWebKey; pubHex: string }> {
  const pair = (await webcrypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  )) as CryptoKeyPair;
  const raw = (await webcrypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { priv: jwk, pubHex: toHex(new Uint8Array(raw)) };
}

async function buildSigned(): Promise<AttestationPackage> {
  const { priv, pubHex } = await keypair();
  const leaves = [
    { claimId: 'c1', leafHash: await merkleLeafHash('canonical-1') },
    { claimId: 'c2', leafHash: await merkleLeafHash('canonical-2') },
  ];
  const graphRoot = await merkleRootOfLeafHashes(crypto, leaves.map((l) => l.leafHash));
  const subject: SignatureSubject = {
    kind: 'report_graph_root',
    subjectId: '60000000-0000-0000-0000-0000000000a1',
    rootHash: graphRoot,
    signedAt: '2026-10-27T00:00:00Z',
    keyId: 'key-1',
  };
  const signature = await signSubject(crypto, subject, priv);
  const input: AttestationInput = {
    generatedAt: '2026-10-27T09:00:00Z',
    subject: { kind: 'report_graph_root', id: subject.subjectId, label: 'Report v1' },
    roots: [{ name: 'graph_root', hash: graphRoot }],
    versions: {
      engine: '1.0.0', template: 'M1@1', phraseLibrary: '1.0.0',
      rulePacks: [{ id: 'benford.first_digit', version: 3 }],
    },
    leaves,
    keys: [{ keyId: 'key-1', algorithm: 'Ed25519', publicKey: pubHex }],
    signatures: [{
      kind: 'report_graph_root', subjectId: subject.subjectId, rootHash: graphRoot, keyId: 'key-1',
      algorithm: 'Ed25519', signature, signedAt: subject.signedAt,
    }],
    timestamps: [{ authority: 'FreeTSA', genTime: '2026-10-27T00:00:01Z', tokenDer: 'T0k3n' }],
    ledgerSeq: '42',
  };
  return buildAttestationPackage(crypto, input);
}

describe('the package root', () => {
  it('is deterministic for the same contents', async () => {
    const a = await buildSigned();
    const b = await buildSigned();
    // Different keys/signatures give different roots; the same package re-hashes identically.
    expect(await packageRoot(crypto, a)).toBe(a.packageRoot);
    expect(a.packageRoot).toMatch(/^[0-9a-f]{64}$/);
    void b;
  });

  it('changes when any field changes', async () => {
    const pkg = await buildSigned();
    const before = await packageRoot(crypto, pkg);
    expect(await packageRoot(crypto, { ...pkg, ledgerSeq: '43' })).not.toBe(before);
    expect(await packageRoot(crypto, { ...pkg, generatedAt: '2026-10-27T09:00:01Z' })).not.toBe(before);
  });

  it('carries the format tag and the instructions', async () => {
    const pkg = await buildSigned();
    expect(pkg.format).toBe(ATTESTATION_FORMAT);
    expect(pkg.instructions).toBe(ATTESTATION_INSTRUCTIONS);
    expect(pkg.instructions.length).toBeGreaterThan(0);
  });
});

describe('the Merkle fold', () => {
  it('matches the writing engine over the same leaves', async () => {
    const leaves = ['canonical-1', 'canonical-2', 'canonical-3'];
    const hashes = await Promise.all(leaves.map((l) => merkleLeafHash(l)));
    const tree = await buildMerkleTree(leaves);
    expect(await merkleRootOfLeafHashes(crypto, hashes)).toBe(tree.root);
  });

  it('promotes an odd node rather than duplicating it', async () => {
    const a = await merkleLeafHash('a');
    const b = await merkleLeafHash('b');
    const c = await merkleLeafHash('c');
    const promoted = await merkleRootOfLeafHashes(crypto, [a, b, c]);
    // Duplicating c would give a different (and wrong) root.
    const duplicated = await merkleRootOfLeafHashes(crypto, [a, b, c, c]);
    expect(promoted).not.toBe(duplicated);
  });

  it('is the zero hash for no leaves', async () => {
    expect(await merkleRootOfLeafHashes(crypto, [])).toBe('0'.repeat(64));
  });
});

describe('verification', () => {
  it('accepts a package it just built', async () => {
    const pkg = await buildSigned();
    const verdict = await verifyAttestationPackage(crypto, pkg);
    expect(verdict.ok).toBe(true);
    expect(verdict.rootMatches).toBe(true);
    expect(verdict.merkleMatches).toBe(true);
    expect(verdict.signatures[0].status).toBe('valid');
    expect(verdict.problems).toEqual([]);
  });

  it('rejects a package whose contents were changed after sealing', async () => {
    const pkg = await buildSigned();
    const tampered: AttestationPackage = { ...pkg, ledgerSeq: '99' };
    const verdict = await verifyAttestationPackage(crypto, tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.rootMatches).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/package root does not match/i);
  });

  it('rejects a package whose leaf set was changed', async () => {
    const pkg = await buildSigned();
    const tampered: AttestationPackage = {
      ...pkg,
      leaves: [...pkg.leaves, { claimId: 'c3', leafHash: await merkleLeafHash('canonical-3') }],
    };
    const verdict = await verifyAttestationPackage(crypto, tampered);
    expect(verdict.merkleMatches).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/do not fold/i);
  });

  it('rejects a package whose signature does not verify', async () => {
    const pkg = await buildSigned();
    const bad = { ...pkg.signatures[0], signature: 'f'.repeat(128) };
    const verdict = await verifyAttestationPackage(crypto, { ...pkg, signatures: [bad] });
    expect(verdict.signatures[0].status).toBe('invalid');
    expect(verdict.ok).toBe(false);
  });

  it('reports an unknown key rather than claiming success', async () => {
    const pkg = await buildSigned();
    const verdict = await verifyAttestationPackage(crypto, { ...pkg, keys: [] });
    expect(verdict.signatures[0].status).toBe('unknown_key');
    expect(verdict.ok).toBe(false);
  });
});

describe('shape validation and parsing', () => {
  it('refuses a malformed root', async () => {
    const pkg = await buildSigned();
    await expect(
      buildAttestationPackage(crypto, {
        ...pkg, roots: [{ name: 'graph_root', hash: 'short' }],
      } as unknown as AttestationInput)
    ).rejects.toBeInstanceOf(AttestationError);
  });

  it('parses a package and refuses anything else', async () => {
    const pkg = await buildSigned();
    expect(parseAttestationPackage(JSON.stringify(pkg))?.packageRoot).toBe(pkg.packageRoot);
    expect(parseAttestationPackage('{"format":"other"}')).toBeNull();
    expect(parseAttestationPackage('not json')).toBeNull();
    expect(parseAttestationPackage('')).toBeNull();
  });

  it('the canonical signing input is the shape the standalone verifier rebuilds', async () => {
    const subject: SignatureSubject = {
      kind: 'report_graph_root', subjectId: 's', rootHash: ROOT, signedAt: 'T', keyId: 'k',
    };
    expect(canonicalSigningInput(subject)).toBe(
      `{"key_id":"k","kind":"report_graph_root","root_hash":"${ROOT}","signed_at":"T","subject_id":"s"}`
    );
  });

  it('the two-root package folds to the first root only', async () => {
    const pkg = await buildSigned();
    const withRender = {
      ...pkg,
      roots: [...pkg.roots, { name: 'render_hash', hash: ROOT_B }],
    };
    const verdict = await verifyAttestationPackage(crypto, withRender);
    expect(verdict.recordedMerkleRoot).toBe(pkg.roots[0].hash);
  });
});

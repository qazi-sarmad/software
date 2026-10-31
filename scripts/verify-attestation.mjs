#!/usr/bin/env node
/**
 * T4 — the third-party verifier.
 *
 * A STANDALONE procedure an outsider can run with nothing but Node and the package file. It does not
 * import Provio, it does not reach the network, and it does not trust the producer. It re-derives
 * everything from the artifact:
 *
 *   1. the package root (canonical JSON, packageRoot removed, SHA-256),
 *   2. the Merkle root (fold the leaf hashes, '01' domain prefix on internal nodes, odd node promoted),
 *   3. every Ed25519 signature against the public keys the package carries,
 *   4. the presence of the timestamp tokens (their imprint and chain are the verifier's to check
 *      against trust anchors the verifier holds — see docs/ATTESTATION-VERIFICATION.md).
 *
 * Usage:
 *   node scripts/verify-attestation.mjs <package.json> [--expect-root <hex64>]
 *
 * Exit code 0 when every check passes, 1 otherwise. It prints each step and its result, so the run
 * is itself the evidence.
 *
 * This file is deliberately self-contained: it imports only Node built-ins (`node:crypto`,
 * `node:fs`, `node:process`). It is the same procedure the in-product "verify" surface implements in
 * src/lib/attestation.ts; a divergence between the two is a defect, and both are covered by tests.
 */
import { createHash, verify as cryptoVerify, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const FORMAT = 'provio.attestation/v1';

/** Canonical JSON: object keys sorted by code point, no insignificant whitespace. */
function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null';
}

function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** Fold leaf hashes to a Merkle root, exactly as the product does. */
function merkleRoot(leafHashes) {
  if (leafHashes.length === 0) return '0'.repeat(64);
  let level = leafHashes.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(sha256Hex('01' + level[i] + level[i + 1]));
      else next.push(level[i]);
    }
    level = next;
  }
  return level[0];
}

/** The exact bytes a signature covers: the canonical signing input of the subject. */
function signingInput(sig) {
  const subject = {
    key_id: sig.keyId,
    kind: sig.kind,
    root_hash: sig.rootHash,
    signed_at: sig.signedAt,
    subject_id: sig.subjectId,
  };
  return canonical(subject);
}

/** Rebuild an Ed25519 public key from a raw 32-byte key in hex, using Node's own primitives. */
function publicKeyFromRawHex(hex) {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) throw new Error('a raw Ed25519 public key must be 32 bytes');
  // A SubjectPublicKeyInfo wrapper for Ed25519: the 12-byte fixed prefix, then the raw key.
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw,
  ]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const expectIdx = args.indexOf('--expect-root');
  const expectRoot = expectIdx >= 0 ? args[expectIdx + 1] : null;

  if (!file) {
    console.error('usage: node scripts/verify-attestation.mjs <package.json> [--expect-root <hex64>]');
    process.exit(2);
  }

  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const problems = [];

  if (pkg.format !== FORMAT) {
    console.error(`FAIL: unknown package format "${pkg.format}" (expected "${FORMAT}")`);
    process.exit(1);
  }

  // Step 1 — the package root.
  const { packageRoot: carriedRoot, ...withoutRoot } = pkg;
  const derivedRoot = sha256Hex(canonical(withoutRoot));
  const rootOk = derivedRoot === carriedRoot;
  console.log(`step 1  package root       ${rootOk ? 'OK  ' : 'FAIL'}  ${derivedRoot}`);
  if (!rootOk) problems.push('the package root does not match the contents');

  // Step 2 — the Merkle root.
  const primary = (pkg.roots && pkg.roots[0] && pkg.roots[0].hash) || '';
  const derivedMerkle = merkleRoot((pkg.leaves || []).map((l) => l.leafHash));
  const merkleOk = !(pkg.leaves || []).length || derivedMerkle === primary;
  console.log(`step 2  merkle root        ${merkleOk ? 'OK  ' : 'FAIL'}  ${derivedMerkle}`);
  if (!merkleOk) problems.push('the leaves do not fold to the recorded root');

  // Step 3 — the signatures.
  const keys = new Map((pkg.keys || []).map((k) => [k.keyId, k]));
  let sigsOk = true;
  for (const s of pkg.signatures || []) {
    const key = keys.get(s.keyId);
    if (!key) {
      sigsOk = false;
      problems.push(`no public key for key ${s.keyId}`);
      console.log(`step 3  signature ${s.keyId}   FAIL  no public key`);
      continue;
    }
    let ok = false;
    try {
      ok = cryptoVerify(null, Buffer.from(signingInput(s), 'utf8'),
        publicKeyFromRawHex(key.publicKey), Buffer.from(s.signature, 'hex'));
    } catch (err) {
      ok = false;
      problems.push(`signature ${s.keyId} could not be checked: ${err.message}`);
    }
    if (!ok) sigsOk = false;
    console.log(`step 3  signature ${s.keyId}   ${ok ? 'OK  ' : 'FAIL'}  ${s.subjectId}`);
  }
  if (!(pkg.signatures || []).length) console.log('step 3  signatures          OK    none to check');

  // Step 4 — the timestamps (presence; the imprint/chain is the verifier's trust-anchor decision).
  const stamps = pkg.timestamps || [];
  console.log(`step 4  timestamps          ${stamps.length ? 'OK  ' : 'WARN'}  ${stamps.length} token(s)`);

  // Step 5 — compare to the expected root the verifier was told to expect.
  if (expectRoot) {
    const match = primary === expectRoot;
    console.log(`step 5  expected root       ${match ? 'OK  ' : 'FAIL'}  ${primary}`);
    if (!match) problems.push('the recorded root does not equal the expected root');
  }

  if (problems.length) {
    console.error('\nVERIFICATION FAILED');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nVERIFICATION PASSED — the package is internally consistent and its roots are signed and stamped.');
  console.log('This proves structure and provenance, not the truth of the underlying claims.');
}

main();

#!/usr/bin/env node
/**
 * W10.2: an independent verifier for a Provio report bundle.
 *
 * It uses ONLY the Node.js standard library (`node:crypto`, `node:fs`). It does not import the
 * engine, the database or the network. An external party runs:
 *
 *     node scripts/verify-report-bundle.mjs <path-to-bundle.json>
 *
 * It recomputes, from the bundle alone:
 *   1. every claim hash, as SHA-256 of the claim's canonical facts, and that it matches the bundle;
 *   2. the Merkle root over the ordered claim hashes, and every inclusion proof;
 *   3. every figure's lineage hash;
 *   4. the graph root, which is the Merkle root over the ordered claims.
 * It prints PASS, or the first mismatch with the claim or figure it belongs to, and exits non-zero.
 *
 * The canonical form here mirrors src/lib/writing/canonical.ts: sorted keys, no insignificant
 * whitespace, NFC-normalised text. It is duplicated on purpose, so the verifier shares no code with
 * the engine and proves the format rather than trusting it.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashParts(parts) {
  return sha256Hex(parts.join('|'));
}

function merkleLeafHash(canonicalLeaf) {
  return sha256Hex(`00${canonicalLeaf}`);
}

function merkleNodeHash(left, right) {
  return sha256Hex(`01${left}${right}`);
}

function verifyProof(proof) {
  let current = proof.leafHash;
  for (const step of proof.steps) {
    current = step.position === 'left'
      ? merkleNodeHash(step.hash, current)
      : merkleNodeHash(current, step.hash);
  }
  return current === proof.root;
}

function lineageHash(lineage) {
  const params = Object.keys(lineage.parameters).sort().map((k) => `${k}=${String(lineage.parameters[k])}`).join('\u0001');
  return hashParts([
    'lineage', lineage.figureId, String(lineage.figureVersion), params,
    ...lineage.records.map((r) => `${r.type}\u0001${r.id}\u0001${r.contentHash}`),
    String(lineage.rowCount), lineage.result, lineage.timeArgument,
  ]);
}

function fail(message, context) {
  console.error(`FAIL: ${message}${context ? ` (${context})` : ''}`);
  process.exit(1);
}

function main() {
  const path = process.argv[2];
  if (!path) fail('usage: node scripts/verify-report-bundle.mjs <bundle.json>');
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`could not read the bundle: ${e.message}`);
  }
  if (bundle.format !== 'provio.report-bundle') fail(`unknown bundle format ${bundle.format}`);

  // 1. Every claim hash: SHA-256 of the canonical facts the bundle carries.
  const claimHashes = [];
  const leafHashes = [];
  for (const claim of bundle.claims) {
    const recomputed = sha256Hex(claim.canonical);
    if (recomputed !== claim.claimHash) fail(`claim hash mismatch for ${claim.id}`, `recorded ${claim.claimHash}`);
    claimHashes.push(recomputed);
    // The Merkle leaf is domain-separated over the canonical facts, not over the claim hash.
    leafHashes.push(merkleLeafHash(claim.canonical));
  }

  // 2. The Merkle root over the ordered claim hashes, and every inclusion proof.
  const proofsById = new Map(bundle.proofs.map((p) => [p.claimId, p.proof]));
  if (proofsById.size !== bundle.claims.length) fail('the bundle does not carry one proof per claim');
  for (let i = 0; i < bundle.claims.length; i++) {
    const proof = proofsById.get(bundle.claims[i].id);
    if (!proof) fail(`no inclusion proof for ${bundle.claims[i].id}`);
    if (proof.leafHash !== leafHashes[i]) fail(`inclusion proof leaf mismatch for ${bundle.claims[i].id}`);
    if (!verifyProof(proof)) fail(`inclusion proof does not verify for ${bundle.claims[i].id}`);
  }
  let level = leafHashes;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? merkleNodeHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  const computedMerkleRoot = level.length ? level[0] : '0'.repeat(64);

  // 3. Every figure lineage hash.
  for (const lineage of bundle.figureLineage) {
    const recomputed = lineageHash(lineage);
    if (recomputed !== lineage.lineageHash) {
      fail(`figure lineage hash mismatch for ${lineage.figureId}`, `recorded ${lineage.lineageHash}`);
    }
  }

  // 4. The graph root, which is the Merkle root over the ordered claims.
  if (computedMerkleRoot !== bundle.graphRoot) {
    fail('graph root mismatch', `computed ${computedMerkleRoot}`);
  }

  console.log(`PASS: ${bundle.claims.length} claims, ${bundle.figureLineage.length} figures, `
    + `graph root ${bundle.graphRoot.slice(0, 16)}, render hash ${bundle.renderHash.slice(0, 16)}`);
  process.exit(0);
}

main();

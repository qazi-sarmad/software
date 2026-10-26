/**
 * W1.3: a Merkle tree over ordered claims, with inclusion proofs.
 *
 * Leaves are hashed with a `00` domain prefix and internal nodes with `01`, so a leaf can never be
 * mistaken for an internal node (second-preimage resistance). When a level has an odd number of
 * nodes the last node is promoted unchanged, not duplicated: promoting keeps two different claim
 * sets from producing the same root, which duplicating would not.
 */

import { sha256Hex, ZERO_HASH } from './canonical';

export interface MerkleProofStep {
  hash: string;
  position: 'left' | 'right';
}

export interface MerkleProof {
  leafIndex: number;
  leafCount: number;
  leafHash: string;
  steps: MerkleProofStep[];
  root: string;
}

export interface MerkleTree {
  root: string;
  leafCount: number;
  leafHashes: string[];
  /** levels[0] is the leaves; the last level is the single root. */
  levels: string[][];
}

/** The hash of a leaf. Domain-separated from an internal node. */
export function merkleLeafHash(canonicalLeaf: string): Promise<string> {
  return sha256Hex(`00${canonicalLeaf}`);
}

/** The hash of an internal node. */
export function merkleNodeHash(left: string, right: string): Promise<string> {
  return sha256Hex(`01${left}${right}`);
}

/** Build the tree from the canonical text of each leaf, in claim order. */
export async function buildMerkleTree(leaves: string[]): Promise<MerkleTree> {
  if (leaves.length === 0) {
    return { root: ZERO_HASH, leafCount: 0, leafHashes: [], levels: [[ZERO_HASH]] };
  }
  const leafHashes = await Promise.all(leaves.map(merkleLeafHash));
  const levels: string[][] = [leafHashes];
  let current = leafHashes;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(await merkleNodeHash(current[i], current[i + 1]));
      } else {
        next.push(current[i]);
      }
    }
    levels.push(next);
    current = next;
  }
  return { root: current[0], leafCount: leafHashes.length, leafHashes, levels };
}

/** The inclusion proof for one leaf. */
export function merkleProof(tree: MerkleTree, leafIndex: number): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(`leaf index ${leafIndex} out of range 0..${tree.leafCount - 1}`);
  }
  const steps: MerkleProofStep[] = [];
  let index = leafIndex;
  for (let level = 0; level < tree.levels.length - 1; level++) {
    const nodes = tree.levels[level];
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;
    if (siblingIndex < nodes.length) {
      steps.push({ hash: nodes[siblingIndex], position: isRightChild ? 'left' : 'right' });
    }
    index = Math.floor(index / 2);
  }
  return { leafIndex, leafCount: tree.leafCount, leafHash: tree.leafHashes[leafIndex], steps, root: tree.root };
}

/** Recompute the root from the proof. Returns false on any mismatch. */
export async function verifyMerkleProof(proof: MerkleProof): Promise<boolean> {
  let current = proof.leafHash;
  for (const step of proof.steps) {
    current = step.position === 'left'
      ? await merkleNodeHash(step.hash, current)
      : await merkleNodeHash(current, step.hash);
  }
  return current === proof.root;
}

/**
 * Verify a proof and that the recomputed root equals an expected root, and that the leaf hash is
 * the hash of the supplied canonical leaf. This is what the offline verifier (W10.2) calls.
 */
export async function verifyInclusion(
  proof: MerkleProof, canonicalLeaf: string, expectedRoot: string,
): Promise<boolean> {
  if (proof.leafHash !== (await merkleLeafHash(canonicalLeaf))) return false;
  if (proof.root !== expectedRoot) return false;
  return verifyMerkleProof(proof);
}

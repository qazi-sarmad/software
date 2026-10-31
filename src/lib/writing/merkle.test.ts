import { describe, expect, it } from 'vitest';
import { buildMerkleTree, merkleLeafHash, merkleNodeHash, merkleProof, verifyInclusion, verifyMerkleProof } from './merkle';
import { ZERO_HASH } from './canonical';

const leaves = (n: number): string[] => Array.from({ length: n }, (_, i) => `claim-${i}`);

describe('W1.3 Merkle tree over ordered claims', () => {
  it('an empty tree has the zero root', async () => {
    const tree = await buildMerkleTree([]);
    expect(tree.root).toBe(ZERO_HASH);
    expect(tree.leafCount).toBe(0);
  });

  it('a single leaf roots at its own hash', async () => {
    const tree = await buildMerkleTree(['a']);
    expect(tree.root).toBe(await merkleLeafHash('a'));
  });

  it('builds deterministically for 1..20 leaves', async () => {
    for (let n = 1; n <= 20; n++) {
      const a = await buildMerkleTree(leaves(n));
      const b = await buildMerkleTree(leaves(n));
      expect(a.root).toBe(b.root);
      expect(a.leafCount).toBe(n);
    }
  });

  it('changes the root when a leaf changes', async () => {
    const a = await buildMerkleTree(leaves(5));
    const changed = leaves(5);
    changed[3] = 'claim-3-changed';
    const b = await buildMerkleTree(changed);
    expect(a.root).not.toBe(b.root);
  });

  it('changes the root when the order changes', async () => {
    const a = await buildMerkleTree(['a', 'b', 'c', 'd']);
    const b = await buildMerkleTree(['b', 'a', 'c', 'd']);
    expect(a.root).not.toBe(b.root);
  });

  it('promotes an odd node rather than duplicating it', async () => {
    // ['a','b','c']: level1 = [H(ab), H(c)]; root = H(H(ab), H(c)) — c is promoted, not paired with itself.
    const tree = await buildMerkleTree(['a', 'b', 'c']);
    const ab = await merkleNodeHash(await merkleLeafHash('a'), await merkleLeafHash('b'));
    const c = await merkleLeafHash('c');
    expect(tree.root).toBe(await merkleNodeHash(ab, c));
  });

  it('does not let a duplicated last leaf masquerade as a promotion', async () => {
    const promoted = await buildMerkleTree(['a', 'b', 'c']);
    const duplicated = await buildMerkleTree(['a', 'b', 'c', 'c']);
    expect(promoted.root).not.toBe(duplicated.root);
  });

  it('domain-separates a leaf from a node', async () => {
    const node = await merkleNodeHash('x', 'y');
    const leaf = await merkleLeafHash('xy');
    expect(node).not.toBe(leaf);
  });

  it('proves and verifies every leaf, for 1..20 leaves', async () => {
    for (let n = 1; n <= 20; n++) {
      const tree = await buildMerkleTree(leaves(n));
      for (let i = 0; i < n; i++) {
        const proof = merkleProof(tree, i);
        expect(await verifyMerkleProof(proof)).toBe(true);
        expect(await verifyInclusion(proof, leaves(n)[i], tree.root)).toBe(true);
      }
    }
  });

  it('rejects a proof with a tampered sibling hash', async () => {
    const tree = await buildMerkleTree(leaves(8));
    const proof = merkleProof(tree, 5);
    if (proof.steps.length === 0) return;
    proof.steps[0].hash = 'f'.repeat(64);
    expect(await verifyMerkleProof(proof)).toBe(false);
  });

  it('rejects a proof with a flipped sibling position', async () => {
    const tree = await buildMerkleTree(leaves(8));
    const proof = merkleProof(tree, 5);
    if (proof.steps.length === 0) return;
    proof.steps[0].position = proof.steps[0].position === 'left' ? 'right' : 'left';
    expect(await verifyMerkleProof(proof)).toBe(false);
  });

  it('rejects a proof for a different leaf', async () => {
    const tree = await buildMerkleTree(leaves(8));
    const proof = merkleProof(tree, 2);
    expect(await verifyInclusion(proof, 'claim-3', tree.root)).toBe(false);
  });

  it('rejects a proof against the wrong root', async () => {
    const tree = await buildMerkleTree(leaves(8));
    const proof = merkleProof(tree, 2);
    expect(await verifyInclusion(proof, 'claim-2', ZERO_HASH)).toBe(false);
  });

  it('rejects a tampered leaf hash', async () => {
    const tree = await buildMerkleTree(leaves(4));
    const proof = merkleProof(tree, 1);
    proof.leafHash = await merkleLeafHash('claim-1-tampered');
    expect(await verifyMerkleProof(proof)).toBe(false);
  });

  it('refuses an out-of-range leaf index', async () => {
    const tree = await buildMerkleTree(leaves(3));
    expect(() => merkleProof(tree, 3)).toThrow();
    expect(() => merkleProof(tree, -1)).toThrow();
  });
});

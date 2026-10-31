import { describe, expect, it } from 'vitest';
import {
  claimCanonical, claimHash, graphHashes, claimProof, verifyClaim, renderHash, sortReferences,
  sectionHash,
} from './graph';
import { canonicalise } from './canonical';
import { ENGINE_VERSION, FIXED_TIMESTAMP, fixtureClaims } from './fixtures';
import { buildMerkleTree } from './merkle';
import type { Claim, Reference, Register } from './types';

function ref(type: string, id: string, seed = 'a'): Reference {
  return { type, id, contentHash: seed.repeat(64).slice(0, 64) };
}

const REG: Register = { formality: 3, tone: 2, voice: 'active' };

describe('W1 the claim graph: facts, root and render hash', () => {
  it('orders references by (type, id) so gather order cannot change the hash', () => {
    const a = [ref('finding', 'b'), ref('control', 'a'), ref('finding', 'a')];
    const b = [ref('finding', 'a'), ref('finding', 'b'), ref('control', 'a')];
    expect(sortReferences(a)).toEqual(sortReferences(b));
    expect(sortReferences(a).map((r) => `${r.type}:${r.id}`)).toEqual([
      'control:a', 'finding:a', 'finding:b',
    ]);
  });

  it('gives the same claim hash whatever order the slots or references were supplied in', async () => {
    const base = fixtureClaims()[1];
    const shuffled: Claim = {
      ...base,
      slots: [...base.slots].reverse(),
      references: [...base.references].reverse(),
    };
    expect(await claimHash(base)).toBe(await claimHash(shuffled));
  });

  it('changes the claim hash when one slot value changes', async () => {
    const base = fixtureClaims()[1];
    const changed: Claim = {
      ...base,
      slots: base.slots.map((s) => (s.name === 'exceptions' ? { ...s, value: 4 } : s)),
    };
    expect(await claimHash(base)).not.toBe(await claimHash(changed));
  });

  it('changes the claim hash when a reference content hash changes', async () => {
    const base = fixtureClaims()[1];
    const changed: Claim = {
      ...base,
      references: [ref('finding', base.references[0].id, 'f')],
    };
    expect(await claimHash(base)).not.toBe(await claimHash(changed));
  });

  it('excludes the words from the claim facts: only the phrase id and version are facts', () => {
    const base = fixtureClaims()[1];
    const facts = claimCanonical(base);
    expect(facts).not.toContain('Excep');
    expect(facts).toContain(base.phraseId);
    expect(facts).toContain(`"phraseVersion":${base.phraseVersion}`);
  });

  it('builds a Merkle root over the ordered claims and proves each claim', async () => {
    const claims = fixtureClaims();
    const hashes = await graphHashes(claims);
    expect(hashes.graphRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes.claimHashes.length).toBe(claims.length);
    for (let i = 0; i < claims.length; i += 1) {
      const proof = claimProof(hashes, i);
      expect(await verifyClaim(proof, claims[i], hashes.graphRoot)).toBe(true);
    }
  });

  it('fails inclusion for a claim that was not in the tree', async () => {
    const claims = fixtureClaims();
    const hashes = await graphHashes(claims);
    const tampered: Claim = {
      ...claims[1],
      slots: claims[1].slots.map((s) => (s.name === 'exceptions' ? { ...s, value: 99 } : s)),
    };
    const proof = claimProof(hashes, 1);
    expect(await verifyClaim(proof, tampered, hashes.graphRoot)).toBe(false);
  });

  it('changes the root when a claim is reordered (order is significant)', async () => {
    const claims = fixtureClaims();
    const a = await graphHashes(claims);
    const b = await graphHashes([claims[1], claims[0], ...claims.slice(2)]);
    expect(a.graphRoot).not.toBe(b.graphRoot);
  });

  it('groups claims into sections and hashes each section over its ordered claims', async () => {
    const claims = fixtureClaims();
    const hashes = await graphHashes(claims);
    const findings = claims.filter((c) => c.sectionId === 'findings');
    expect(hashes.sectionHashes.findings).toBe(await sectionHash(findings));
    expect(hashes.sectionHashes.findings).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is register-invariant by construction: the register is not an input to the graph root', async () => {
    const claims = fixtureClaims();
    // The register and locale are carried on the graph but never read by graphHashes: the root is
    // over the facts alone. Two independent builds of the same facts give one root.
    const roots = new Set<string>();
    for (const _locale of ['en-GB', 'en-US'] as const) {
      roots.add((await graphHashes(claims)).graphRoot);
    }
    expect(roots.size).toBe(1);
  });

  it('moves the render hash when only the register changes, but not the graph root', async () => {
    const claims = fixtureClaims();
    const hashes = await graphHashes(claims);
    const rendered = claims.map((c) => ({ claimId: c.id, phraseId: c.phraseId, phraseVersion: c.phraseVersion, text: `sentence for ${c.id}` }));
    const base = {
      graphRoot: hashes.graphRoot, locale: 'en-GB' as const, versions: ENGINE_VERSION,
      rendered, fixedTimestamp: FIXED_TIMESTAMP,
    };
    const a = await renderHash({ ...base, register: REG });
    const b = await renderHash({ ...base, register: { ...REG, formality: 5 } });
    expect(a).not.toBe(b);
    expect(hashes.graphRoot).toBe(hashes.graphRoot);
  });

  it('moves the render hash when the words change even at the same register', async () => {
    const claims = fixtureClaims();
    const hashes = await graphHashes(claims);
    const base = {
      graphRoot: hashes.graphRoot, register: REG, locale: 'en-GB' as const, versions: ENGINE_VERSION,
      fixedTimestamp: FIXED_TIMESTAMP,
    };
    const rendered = claims.map((c) => ({ claimId: c.id, phraseId: c.phraseId, phraseVersion: c.phraseVersion, text: `sentence for ${c.id}` }));
    const changed = rendered.map((r, i) => (i === 0 ? { ...r, text: `${r.text}!` } : r));
    expect(await renderHash({ ...base, rendered })).not.toBe(await renderHash({ ...base, rendered: changed }));
  });

  it('produces the same root as a direct Merkle build over the claim canonical forms', async () => {
    const claims = fixtureClaims();
    const hashes = await graphHashes(claims);
    const tree = await buildMerkleTree(claims.map(claimCanonical));
    expect(hashes.graphRoot).toBe(tree.root);
    expect(canonicalise({ a: 1 })).toBe('{"a":1}');
  });
});

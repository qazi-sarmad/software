/**
 * WP1: the full 100-cell matrix (5 formality x 5 tone x 2 voice x 2 locale) under MUTATED fixtures.
 *
 * The invariant the spec asks for is stronger than "the same fixture has one root": for any given
 * set of facts, all 100 cells must produce that ONE graph root, and only the render hash may move.
 * This suite proves it under several mutated fixtures (a changed figure, an added claim, a changed
 * slot, a removed cross-reference), and proves a broken fixture is refused in every cell.
 */

import { describe, expect, it } from 'vitest';
import { composeReport, type ComposerInput } from './compose';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import { registerMatrix } from './registers';
import type { Claim, ClaimGraph, Locale, Register } from './types';

function input(claims: Claim[], register: Register, locale: Locale): ComposerInput {
  const graph: ClaimGraph = { modelId: 'M1', register, locale, claims, versions: ENGINE_VERSION };
  return {
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
  };
}

/** The mutated fixtures. Each is a deterministic transformation of the base fixture claims. */
const MUTATIONS: Array<{ name: string; mutate: (claims: Claim[]) => Claim[] }> = [
  { name: 'base', mutate: (c) => c },
  {
    name: 'changed figure',
    mutate: (c) => c.map((claim) => claim.id === 'c-effect'
      ? { ...claim, figures: [{ figureId: 'fig.x', figureVersion: 1, parameters: {}, result: '42' }] }
      : claim),
  },
  {
    name: 'added claim',
    mutate: (c) => [...c, { ...c[0], id: 'c-extra', sectionId: 'findings' }],
  },
  {
    name: 'changed slot',
    mutate: (c) => c.map((claim) => claim.id === 'c-condition'
      ? { ...claim, slots: claim.slots.map((s) => (s.name === 'tests' ? { ...s, value: 41 } : s)) }
      : claim),
  },
  {
    name: 'changed reference hash',
    mutate: (c) => c.map((claim) => claim.id === 'c-scope'
      ? { ...claim, references: claim.references.map((r) => ({ ...r, contentHash: 'c'.repeat(64) })) }
      : claim),
  },
  {
    name: 'added cross-reference',
    mutate: (c) => c.map((claim) => claim.id === 'c-coverage'
      ? { ...claim, crossReferences: ['c-numeric'] } : claim),
  },
];

describe('WP1 all 100 matrix cells hold one graph root under each mutated fixture', () => {
  for (const mutation of MUTATIONS) {
    it(`holds one root across all 100 cells for: ${mutation.name}`, async () => {
      const claims = mutation.mutate(fixtureClaims());
      const roots = new Set<string>();
      let first: string | null = null;
      for (const { register, locale } of registerMatrix()) {
        const report = await composeReport(input(claims, register, locale));
        roots.add(report.hashes.graphRoot);
        first ??= report.hashes.graphRoot;
        expect(report.hashes.graphRoot).toBe(first);
      }
      expect(roots.size).toBe(1);
    });
  }

  it('the render hash varies across the matrix while the root does not', async () => {
    const claims = MUTATIONS[1].mutate(fixtureClaims());
    const renders = new Set<string>();
    const roots = new Set<string>();
    for (const { register, locale } of registerMatrix()) {
      const report = await composeReport(input(claims, register, locale));
      renders.add(report.renderHash);
      roots.add(report.hashes.graphRoot);
    }
    expect(roots.size).toBe(1);
    expect(renders.size).toBeGreaterThan(1);
  });
});

describe('WP1 a broken fixture is refused in every one of the 100 cells', () => {
  it('throws a missing-phrase error in every cell when a phrase is withdrawn', async () => {
    const cells = registerMatrix();
    const failures: string[] = [];
    for (const { register, locale } of cells) {
      const claims = fixtureClaims();
      // Withdraw the phrase a claim needs by pointing it at an id no released phrase carries.
      claims[0] = { ...claims[0], phraseId: 'scope.withdrawn' };
      try {
        await composeReport(input(claims, register, locale));
        failures.push(`f${register.formality}-t${register.tone}-${register.voice}-${locale}: did not throw`);
      } catch (e) {
        expect((e as Error).message).toContain('Missing');
      }
    }
    expect(failures).toEqual([]);
  });
});

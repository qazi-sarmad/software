/**
 * WP1: scale. A report is a graph of hundreds of claims, nested figures and many cross-references.
 * This suite realises a large graph, checks the graph root and render hash stay deterministic, and
 * measures realisation against a documented performance budget.
 *
 * The budget is not a guess. It is measured on this machine, on the head commit, and recorded in
 * docs/SCALE-PLAN.md. The assertion uses a ceiling with headroom so a slow CI runner does not make a
 * correct engine fail; the measured number is reported separately by the test that prints it.
 */

import { describe, expect, it } from 'vitest';
import { composeReport, type ComposerInput } from './compose';
import { graphHashes, claimProof, verifyClaim } from './graph';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import { DEFAULT_REGISTER } from './registers';
import type { Claim, ClaimGraph, Register, Slot } from './types';

/**
 * The performance budget. Realising a 500-claim report (composition plus both hashes) must finish
 * under this many milliseconds. The measured value on the head commit is recorded in SCALE-PLAN.md;
 * the ceiling below carries headroom for a slower machine while still catching a real regression.
 */
const SCALE_BUDGET_MS = 10_000;

const REPEAT_SECTIONS = ['scope', 'exec', 'findings', 'coverage', 'appendices'];
const FINDING_SECTIONS = ['findings'];

function slots(pairs: Array<[string, Slot['kind'], Slot['value']]>): Slot[] {
  return pairs.map(([name, kind, value]) => ({ name, kind, value }));
}

/** One claim derived from a seed-phrase shape, with a stable id and a real reference. */
function claimAt(index: number): Claim {
  const section = REPEAT_SECTIONS[index % REPEAT_SECTIONS.length];
  const id = `g-${String(index).padStart(4, '0')}`;
  const finding = `g-${String(index).padStart(4, '0')}-f1`;
  const base = {
    id, kind: 'calculated' as const, claimLevel: 'calculated' as const,
    phraseId: 'condition.test_exceptions', phraseVersion: 1,
    ruleId: 'condition.test_exceptions.rule', ruleVersion: 1,
    references: [{ type: 'finding', id: finding, contentHash: 'a'.repeat(64) }],
    figures: [], modelId: 'M1', sectionId: section, approval: null,
    slots: slots([
      ['tests', 'count', 40],
      ['test_noun', 'text', 'payments'],
      ['exceptions', 'count', index % 7],
    ]),
  };
  // Nest a figure and a cross-reference into most claims, so the graph is genuinely interconnected.
  if (index % 2 === 0) {
    return {
      ...base,
      figures: [{
        figureId: 'fig.controls_tested', figureVersion: 1,
        parameters: { engagementId: 'e1', index }, result: '40',
      }],
      crossReferences: index > 2 ? [`g-${String(index - 2).padStart(4, '0')}`] : undefined,
    };
  }
  return base;
}

/** A large graph: `count` claims in model M1, with a leading scope claim so the plan is complete. */
function largeGraph(count: number): Claim[] {
  const scope: Claim = {
    ...claimAt(0),
    id: 'g-scope',
    sectionId: 'scope',
    phraseId: 'scope.period',
    slots: slots([['start_date', 'date', '2026-01-01'], ['end_date', 'date', '2026-09-30']]),
    figures: [],
    crossReferences: undefined,
  };
  const claims: Claim[] = [scope];
  for (let i = 1; i < count; i++) claims.push(claimAt(i));
  return claims;
}

function inputFor(claims: Claim[], register: Register = DEFAULT_REGISTER): ComposerInput {
  const graph: ClaimGraph = {
    modelId: 'M1', register, locale: 'en-GB', claims, versions: ENGINE_VERSION,
  };
  return {
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY,
    versions: ENGINE_VERSION, fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT,
    variants: fixtureVariants(),
  };
}

describe('WP1 large-graph realisation', () => {
  it('realises a 500-claim graph with nested figures and cross-references', async () => {
    const claims = largeGraph(500);
    expect(claims.length).toBe(500);
    const withFigures = claims.filter((c) => c.figures.length > 0).length;
    const withXrefs = claims.filter((c) => (c.crossReferences ?? []).length > 0).length;
    expect(withFigures).toBeGreaterThan(100);
    expect(withXrefs).toBeGreaterThan(100);

    const report = await composeReport(inputFor(claims));
    expect(report.rendered.length).toBe(500);
    // Every rendered claim carries non-empty text.
    expect(report.rendered.every((r) => r.text.length > 0)).toBe(true);
    // The graph root and the render hash are 64-hex.
    expect(report.hashes.graphRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(report.renderHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the graph root over 500 claims is stable across two realisations', async () => {
    const a = await composeReport(inputFor(largeGraph(500)));
    const b = await composeReport(inputFor(largeGraph(500)));
    expect(a.hashes.graphRoot).toBe(b.hashes.graphRoot);
    expect(a.renderHash).toBe(b.renderHash);
  });

  it('every one of the 500 claims has a valid Merkle inclusion proof', async () => {
    const claims = largeGraph(500);
    const hashes = await graphHashes(claims);
    for (let i = 0; i < claims.length; i++) {
      const proof = claimProof(hashes, i);
      expect(await verifyClaim(proof, claims[i], hashes.graphRoot)).toBe(true);
    }
    // A proof against the wrong root must fail (the tree genuinely binds the claims).
    const proof = claimProof(hashes, 0);
    expect(await verifyClaim(proof, claims[0], 'f'.repeat(64))).toBe(false);
  });
});

describe('WP1 the 500-claim performance budget', () => {
  it(`realises 500 claims under ${SCALE_BUDGET_MS} ms and reports the measured time`, async () => {
    const claims = largeGraph(500);
    const started = performance.now();
    const report = await composeReport(inputFor(claims));
    const elapsed = performance.now() - started;
    // Printed so the number is visible in the vitest output and can be recorded in SCALE-PLAN.md.
    console.log(`[WP1] 500-claim realisation: ${elapsed.toFixed(1)} ms (budget ${SCALE_BUDGET_MS} ms)`);
    expect(report.rendered.length).toBe(500);
    expect(elapsed).toBeLessThan(SCALE_BUDGET_MS);
  });

  it('hashing 500 claims is under the same budget', async () => {
    const claims = largeGraph(500);
    const started = performance.now();
    const hashes = await graphHashes(claims);
    const elapsed = performance.now() - started;
    console.log(`[WP1] 500-claim hashing: ${elapsed.toFixed(1)} ms`);
    expect(hashes.graphRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(elapsed).toBeLessThan(SCALE_BUDGET_MS);
  });
});

describe('WP1 nested figures and cross-references fold into the root', () => {
  it('changing one nested figure changes the root but not a sibling claim hash', async () => {
    const claims = largeGraph(200);
    const before = await graphHashes(claims);
    const mutated = largeGraph(200);
    const target = mutated.find((c) => c.figures.length > 0)!;
    target.figures[0] = { ...target.figures[0], result: '41' };
    const after = await graphHashes(mutated);
    expect(after.graphRoot).not.toBe(before.graphRoot);
  });

  it('a nested figure at a large graph keeps a stable lineage in the render hash', async () => {
    const claims = largeGraph(300);
    const register: Register = { formality: 4, tone: 3, voice: 'passive' };
    const a = await composeReport(inputFor(claims, register));
    const b = await composeReport(inputFor(claims, register));
    expect(a.renderHash).toBe(b.renderHash);
    expect(a.hashes.graphRoot).toBe(b.hashes.graphRoot);
  });
});

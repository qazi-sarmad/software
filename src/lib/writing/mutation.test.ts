/**
 * W5.5: mutation tests. Each guarantee is demonstrably load-bearing: removing the behaviour makes
 * the corresponding check fail. These tests do not test the engine; they test that the engine's
 * checks catch the failure each guarantee exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { checkReferenceIntegrity, reconcileCoverage, findContradictions, checkAuditorText } from './verify';
import { recomputeFigures, buildLineage, evaluateFigure, figureFunctionById, toBinding, type SourceRecord } from './figures';
import { applyApprovalGate, checkStaleness, type Observation } from './observations';
import { assertNoHighConsequence, DEFAULT_HIGH_CONSEQUENCE_WORDS } from './phrases';
import { composeReport } from './compose';
import { planReport } from './planner';
import { fixtureClaims, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, ENGINE_VERSION, releasedSeedPhrases, fixtureVariants } from './fixtures';
import type { Claim } from './types';

const T = FIXED_TIMESTAMP;

describe('W5.5 mutation tests: each guarantee catches its failure', () => {
  it('an unreferenced claim is caught', () => {
    const claims = fixtureClaims();
    const bare: Claim = { ...claims[0], id: 'c-bare', references: [] };
    expect(checkReferenceIntegrity([...claims, bare], new Map()).unreferenced).toContain('c-bare');
  });

  it('a stale figure is caught', async () => {
    const fn = figureFunctionById('fig.controls_tested')!;
    const rec: SourceRecord = { type: 'test_rows', id: 'r1', contentHash: 'a'.repeat(64) };
    const columns = new Map([['test_rows', new Map([['r1', 'x']])]]);
    const lineage = await buildLineage(fn, {}, evaluateFigure(fn, [rec], columns), T);
    const claims = [{ id: 'c1', figures: [toBinding(fn, lineage)] }];
    const more: SourceRecord = { type: 'test_rows', id: 'r2', contentHash: 'b'.repeat(64) };
    const dirty = await recomputeFigures(claims, new Map([['c1', [lineage]]]), new Map([['test_rows', [rec, more]]]), columns, T);
    expect(dirty).toHaveLength(1);
  });

  it('a missing CAP is caught', () => {
    const report = reconcileCoverage(fixtureClaims(), { findingIds: ['c-scope-f1'], exceptionControlIds: [], capIds: ['cap-missing'] });
    expect(report.missing).toContain('cap:cap-missing');
  });

  it('a duplicate finding is caught', () => {
    const claims = fixtureClaims();
    const dup: Claim = { ...claims[0], id: 'c-scope-dup' };
    const report = reconcileCoverage([...claims, dup], { findingIds: ['c-scope-f1'], exceptionControlIds: [], capIds: [] });
    expect(report.duplicated.length).toBeGreaterThan(0);
  });

  it('a banned word is caught in a deterministic claim', () => {
    expect(() => assertNoHighConsequence('There is evidence of fraud here', DEFAULT_HIGH_CONSEQUENCE_WORDS, 'test')).toThrow();
  });

  it('a mutable released phrase would be caught: a changed template changes the render', async () => {
    // A released phrase is immutable by trigger in the database. Here we prove the engine notices a
    // phrase whose authored wording changed under a fixed version: the render hash differs.
    const graph = { modelId: 'M1', register: { formality: 3 as const, tone: 2 as const, voice: 'active' as const }, locale: 'en-GB' as const, claims: fixtureClaims(), versions: ENGINE_VERSION };
    const base = await composeReport({ graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION, fixedTimestamp: T, format: FIXTURE_FORMAT, variants: fixtureVariants() });
    const mutatedVariants = fixtureVariants();
    mutatedVariants['scope.period'] = {
      ...mutatedVariants['scope.period'],
      byFormality: { ...mutatedVariants['scope.period'].byFormality, 3: 'MUTATED {start_date} to {end_date}.' },
    };
    const after = await composeReport({ graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION, fixedTimestamp: T, format: FIXTURE_FORMAT, variants: mutatedVariants });
    expect(after.renderHash).not.toBe(base.renderHash);
  });

  it('a broken cross-reference is caught', () => {
    const claims = fixtureClaims();
    const withXref: Claim = { ...claims[0], crossReferences: ['c-nope'] };
    const planned = planReport({ modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB', claims: [withXref, ...claims.slice(1)], versions: ENGINE_VERSION });
    expect(planned.brokenReferences).toContain(`${withXref.id} -> c-nope`);
  });

  it('an unapproved observation is caught', () => {
    const observation: Observation = {
      id: 'o1', orgId: 'x', engagementId: 'y', title: 't', state: 'draft',
      sections: {}, version: 1, contentHash: 'a'.repeat(64), approval: null,
    };
    expect(applyApprovalGate([observation]).admitted).toEqual([]);
  });

  it('a reopened observation blocks the freeze', () => {
    const claim: Claim = { ...fixtureClaims()[0], approval: { observationId: 'o1', approvedBy: 'm', approvedAt: T, observationVersion: 1, contentHash: 'a'.repeat(64) } };
    const reopened = new Map<string, Observation>([['o1', {
      id: 'o1', orgId: 'x', engagementId: 'y', title: 't', state: 'reopened',
      sections: {}, version: 1, contentHash: 'a'.repeat(64), approval: null,
    }]]);
    expect(checkStaleness([claim], reopened).blocked).toBe(true);
  });
});

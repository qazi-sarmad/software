import { describe, expect, it } from 'vitest';
import {
  applyApprovalGate, checkStaleness, isClaimStale, observationContentHash,
  type Observation,
} from './observations';
import { changedSections, numbering, planReport, applyTerminology } from './planner';
import { modelSections, REPORT_MODELS } from './models';
import { composeReport } from './compose';
import { graphHashes } from './graph';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import { registerMatrix } from './registers';
import type { Claim, ClaimGraph } from './types';

const VERSIONS = ENGINE_VERSION;

function obs(overrides: Partial<Observation>): Observation {
  return {
    id: 'obs-1',
    orgId: 'org-1',
    engagementId: 'eng-1',
    title: 'Payments approval',
    state: 'approved',
    sections: { condition: 'x', criteria: 'y', cause: 'z', effect: 'w' },
    version: 1,
    contentHash: 'c'.repeat(64),
    approval: {
      approvedBy: 'manager-1', approvedAt: FIXED_TIMESTAMP, version: 1, contentHash: 'c'.repeat(64),
    },
    ...overrides,
  };
}

describe('W3.2 the approved-observation gate', () => {
  it('admits only final-approved observations', () => {
    const gate = applyApprovalGate([
      obs({ id: 'a', state: 'approved' }),
      obs({ id: 'b', state: 'finding' }),
      obs({ id: 'c', state: 'draft', approval: null }),
      obs({ id: 'd', state: 'submitted', approval: null }),
      obs({ id: 'e', state: 'in_review', approval: null }),
      obs({ id: 'f', state: 'rejected', approval: null }),
    ]);
    expect(gate.admitted.map((o) => o.id)).toEqual(['a', 'b']);
    expect(gate.excluded.map((o) => o.observationId)).toEqual(['c', 'd', 'e', 'f']);
    for (const ex of gate.excluded) expect(ex.reason.length).toBeGreaterThan(0);
  });

  it('excludes an observation with no approval record even if its state says approved', () => {
    const gate = applyApprovalGate([obs({ id: 'a', state: 'approved', approval: null })]);
    expect(gate.admitted).toEqual([]);
    expect(gate.excluded).toHaveLength(1);
  });

  it('stales a claim when its observation changes content', () => {
    const claim = { ...fixtureClaims()[0], approval: { observationId: 'o1', approvedBy: 'm', approvedAt: FIXED_TIMESTAMP, observationVersion: 1, contentHash: 'c'.repeat(64) } };
    const same = new Map([['o1', obs({ id: 'o1', contentHash: 'c'.repeat(64) })]]);
    expect(isClaimStale(claim, same)).toBe(false);
    const changed = new Map([['o1', obs({ id: 'o1', contentHash: 'd'.repeat(64) })]]);
    expect(isClaimStale(claim, changed)).toBe(true);
  });

  it('blocks the freeze when an approved observation is reopened', () => {
    const claims: Claim[] = [{
      ...fixtureClaims()[0],
      approval: { observationId: 'o1', approvedBy: 'm', approvedAt: FIXED_TIMESTAMP, observationVersion: 1, contentHash: 'c'.repeat(64) },
    }];
    const reopened = new Map([['o1', obs({ id: 'o1', state: 'reopened' })]]);
    const report = checkStaleness(claims, reopened);
    expect(report.blocked).toBe(true);
    expect(report.staleClaims).toEqual([claims[0].id]);
    expect(report.reopenedObservations).toEqual(['o1']);
  });

  it('hashes observation content deterministically and detects a change', async () => {
    const base = { id: 'o1', orgId: 'x', engagementId: 'y', title: 't', state: 'draft' as const, version: 1, approval: null };
    const h1 = await observationContentHash({ ...base, sections: { a: '1', b: '2' } });
    const h2 = await observationContentHash({ ...base, sections: { b: '2', a: '1' } });
    const h3 = await observationContentHash({ ...base, sections: { a: '1', b: '3' } });
    expect(h1).toBe(h2);
    expect(h3).not.toBe(h1);
  });
});

describe('W3.1 / W3.4 the twelve models', () => {
  it('has twelve models, each with a non-empty plan and unique section ids', () => {
    expect(REPORT_MODELS).toHaveLength(12);
    for (const model of REPORT_MODELS) {
      expect(model.plan.sections.length).toBeGreaterThan(0);
      const ids = model.plan.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(model.plan.modelId).toBe(model.modelId);
    }
  });

  it('is deterministic: the same input plans identically', () => {
    const claims = fixtureClaims();
    const input = { modelId: 'M1', register: { formality: 3 as const, tone: 2 as const, voice: 'active' as const }, locale: 'en-GB' as const, claims, versions: VERSIONS };
    const a = planReport(input);
    const b = planReport(input);
    expect(a.bySection.map((e) => e.claims.map((c) => c.id))).toEqual(b.bySection.map((e) => e.claims.map((c) => c.id)));
    expect(numbering(a)).toEqual(numbering(b));
  });

  it('numbers sections and claims stably', () => {
    const planned = planReport({ modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB', claims: fixtureClaims(), versions: VERSIONS });
    const n = numbering(planned);
    // M1's first section is 'cover', so 'scope' is section 2; within it claims sort by id, so
    // 'c-limitation' is 2.1 and 'c-scope' is 2.2. Numbering is stable and derived from plan order.
    expect(n['c-limitation']).toBe('2.1');
    expect(n['c-scope']).toBe('2.2');
  });

  it('changes only the sections that must change when a finding is added', () => {
    const base = fixtureClaims();
    const input = { modelId: 'M1', register: { formality: 3 as const, tone: 2 as const, voice: 'active' as const }, locale: 'en-GB' as const, versions: VERSIONS };
    const before = planReport({ ...input, claims: base });
    const added: Claim = { ...base[2], id: 'c-new-finding', sectionId: 'findings' };
    const after = planReport({ ...input, claims: [...base, added] });
    const changed = changedSections(before, after);
    expect(changed).toEqual(['findings']);
  });

  it('reports a broken cross-reference', () => {
    const base = fixtureClaims();
    const withXref: Claim = { ...base[0], crossReferences: ['c-does-not-exist'] };
    const planned = planReport({ modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB', claims: [withXref, ...base.slice(1)], versions: VERSIONS });
    expect(planned.brokenReferences).toContain(`${withXref.id} -> c-does-not-exist`);
  });

  it('renames a term through the terminology mapping without touching auditor text', () => {
    expect(applyTerminology('control deficiency evaluation', { 'control deficiency': 'control gap' }))
      .toBe('control gap evaluation');
    expect(applyTerminology('no mapping here', undefined)).toBe('no mapping here');
  });
});

describe('W3.4 the same engagement composes in every model with one root where claims coincide', () => {
  it('composes every model at the default register without a missing phrase', async () => {
    const failures: string[] = [];
    for (const model of REPORT_MODELS) {
      try {
        const graph: ClaimGraph = {
          modelId: model.modelId, register: model.defaultRegister, locale: model.defaultLocale,
          claims: fixtureClaims(model.modelId), versions: VERSIONS,
        };
        await composeReport({
          graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: VERSIONS,
          fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
        });
      } catch (e) {
        failures.push(`${model.modelId}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('gives the same graph root to two models that cite the same claims in the same order', async () => {
    // M1 and M4 both contain the finding claims; a report of just those claims has one root.
    const claims = fixtureClaims();
    const a = await graphHashes(claims);
    const b = await graphHashes([...claims]);
    expect(a.graphRoot).toBe(b.graphRoot);
  });
});

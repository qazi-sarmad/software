/**
 * WP1: the seal gate (`seal.ts`) gets direct unit tests. A clean graph seals; each single defect
 * opens exactly one blocker and never seals. Nothing reads a clock: the time argument is supplied.
 */

import { describe, expect, it } from 'vitest';
import { evaluateSeal, type SealInput } from './seal';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, fixtureClaims,
} from './fixtures';
import type { Observation } from './observations';
import type { CoverageScope, KnownRecord } from './verify';
import type { Claim, ClaimGraph } from './types';

/** The report date: after every fixture date, so a clean input has no date contradiction. */
const REPORT_DATE = '2027-01-31';

function graph(claims: Claim[]): ClaimGraph {
  return {
    modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB',
    claims, versions: ENGINE_VERSION,
  };
}

function known(claims: Claim[]): Map<string, KnownRecord> {
  const map = new Map<string, KnownRecord>();
  for (const c of claims) for (const r of c.references) map.set(`${r.type}:${r.id}`, r);
  return map;
}

function scopeFor(claims: Claim[]): CoverageScope {
  const findingIds = new Set<string>();
  for (const c of claims) for (const r of c.references) if (r.type === 'finding') findingIds.add(r.id);
  return { findingIds: [...findingIds], exceptionControlIds: [], capIds: [] };
}

/** The observation c-auditor derives from, approved and unchanged. */
function observations(): Map<string, Observation> {
  return new Map<string, Observation>([['obs-1', {
    id: 'obs-1', orgId: 'o1', engagementId: 'e1', title: 'Approved observation', state: 'approved',
    sections: {}, version: 2, contentHash: 'b'.repeat(64),
    approval: { approvedBy: 'manager-1', approvedAt: FIXED_TIMESTAMP, version: 2, contentHash: 'b'.repeat(64) },
  }]]);
}

function cleanInput(overrides: Partial<SealInput> = {}): SealInput {
  const claims = fixtureClaims();
  return {
    graph: graph(claims),
    known: known(claims),
    coverage: scopeFor(claims),
    contradictions: {
      capState: new Map(), riskRating: new Map(), findingSeverity: new Map(),
      auditorOverrides: new Map(), dismissedAlerts: new Set(), claimAlert: new Map(),
    },
    observations: observations(),
    lineageByClaim: new Map(),
    recordsByTable: new Map(),
    columns: new Map(),
    timeArgument: REPORT_DATE,
    ...overrides,
  };
}

describe('WP1 seal gate: a clean graph seals', () => {
  it('seals the fixture with no blockers', async () => {
    const report = await evaluateSeal(cleanInput());
    expect(report.blockers).toEqual([]);
    expect(report.sealed).toBe(true);
  });

  it('is deterministic: the same input yields the same report', async () => {
    const a = await evaluateSeal(cleanInput());
    const b = await evaluateSeal(cleanInput());
    expect(a).toEqual(b);
  });
});

describe('WP1 seal gate: each single defect blocks and names its check', () => {
  it('blocks an unreferenced claim (references)', async () => {
    const claims = fixtureClaims();
    const input = cleanInput({ graph: graph(claims) });
    const bare: Claim = { ...claims[0], id: 'c-bare', references: [] };
    input.graph = graph([...claims, bare]);
    const report = await evaluateSeal(input);
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'references' && b.subject === 'c-bare')).toBe(true);
  });

  it('blocks a changed reference hash (references)', async () => {
    const claims = fixtureClaims();
    const map = known(claims);
    const first = claims[0].references[0];
    map.set(`${first.type}:${first.id}`, { ...first, contentHash: 'f'.repeat(64) });
    const report = await evaluateSeal(cleanInput({ known: map }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'references' && b.detail.includes('content hash changed'))).toBe(true);
  });

  it('blocks a coverage hole (coverage)', async () => {
    const claims = fixtureClaims();
    const coverage = scopeFor(claims);
    coverage.capIds = ['cap-not-covered'];
    const report = await evaluateSeal(cleanInput({ coverage }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'coverage' && b.subject === 'cap:cap-not-covered')).toBe(true);
  });

  it('blocks a duplicate finding (coverage)', async () => {
    const claims = fixtureClaims();
    const dup: Claim = { ...claims[0], id: 'c-scope-dup' };
    const report = await evaluateSeal(cleanInput({ graph: graph([...claims, dup]) }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'coverage' && b.detail.includes('more than one claim'))).toBe(true);
  });

  it('blocks a status-vs-CAP contradiction (contradictions)', async () => {
    const claims = fixtureClaims();
    const status = claims.find((c) => c.id === 'c-status')!;
    status.phraseId = 'status.closed';
    status.references = [{ type: 'cap', id: 'cap-1', contentHash: 'a'.repeat(64) }];
    const capState = new Map<string, 'open' | 'closed' | 'overdue'>([['cap-1', 'open']]);
    const report = await evaluateSeal(cleanInput({
      graph: graph(claims), coverage: scopeFor(claims), contradictions: {
        capState, riskRating: new Map(), findingSeverity: new Map(),
        auditorOverrides: new Map(), dismissedAlerts: new Set(), claimAlert: new Map(),
      },
    }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'contradictions' && b.detail.includes('contradiction.status_vs_cap'))).toBe(true);
  });

  it('blocks a date after the report date (contradictions)', async () => {
    const claims = fixtureClaims();
    const report = await evaluateSeal(cleanInput({ graph: graph(claims), timeArgument: '2026-06-01' }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'contradictions' && b.detail.includes('contradiction.date_after_report'))).toBe(true);
  });

  it('blocks a reopened observation (staleness)', async () => {
    const observationsMap = observations();
    observationsMap.set('obs-1', { ...observationsMap.get('obs-1')!, state: 'reopened' });
    const report = await evaluateSeal(cleanInput({ observations: observationsMap }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'staleness' && b.subject === 'c-auditor')).toBe(true);
  });

  it('blocks a broken cross-reference (plan)', async () => {
    const claims = fixtureClaims();
    claims[0].crossReferences = ['c-nope'];
    const report = await evaluateSeal(cleanInput({ graph: graph(claims) }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'plan' && b.subject.includes('c-nope'))).toBe(true);
  });

  it('blocks a stale figure (figures)', async () => {
    const claims = fixtureClaims();
    const target = claims.find((c) => c.id === 'c-exceptions')!;
    target.figures = [{ figureId: 'fig.controls_tested', figureVersion: 1, parameters: { engagementId: 'e1' }, result: '40' }];
    const records = new Map([['test_rows', [{ type: 'test_rows', id: 'r1', contentHash: 'a'.repeat(64) }]]]);
    const columns = new Map([['test_rows', new Map([['r1', 'x']])]]);
    const report = await evaluateSeal(cleanInput({
      graph: graph(claims), recordsByTable: records, columns,
    }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'figures')).toBe(true);
  });

  it('blocks auditor text with no author (auditor)', async () => {
    const claims = fixtureClaims();
    const auditor = claims.find((c) => c.kind === 'auditor')!;
    auditor.auditorAuthor = '';
    const report = await evaluateSeal(cleanInput({ graph: graph(claims) }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'auditor' && b.detail.includes('no author'))).toBe(true);
  });

  it('flags (does not block) a high-consequence word in auditor text', async () => {
    const claims = fixtureClaims();
    const auditor = claims.find((c) => c.kind === 'auditor')!;
    auditor.auditorText = 'The auditor notes the possibility of fraud.';
    const report = await evaluateSeal(cleanInput({ graph: graph(claims) }));
    expect(report.sealed).toBe(true);
    expect(report.warnings.some((w) => w.check === 'auditor' && w.detail.includes('fraud'))).toBe(true);
  });
});

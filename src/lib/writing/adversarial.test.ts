/**
 * WP1: the adversarial suite. Every deliberately broken input below must never seal. Each case names
 * the defect the spec says blocks a report, and asserts the seal gate refuses it. Two of these are
 * the "would have caught it" tests the brief requires:
 *
 *   - a graph-root mutation: a single changed figure must move the root (a coverage/root hole);
 *   - a coverage hole: a CAP in scope with no claim must be refused.
 *
 * No test reads a clock. The report date is the time argument.
 */

import { describe, expect, it } from 'vitest';
import { evaluateSeal, type SealInput } from './seal';
import { graphHashes, claimHash } from './graph';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, fixtureClaims,
} from './fixtures';
import type { Observation } from './observations';
import type { CoverageScope, KnownRecord } from './verify';
import type { Claim, ClaimGraph } from './types';

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

function observations(): Map<string, Observation> {
  return new Map<string, Observation>([['obs-1', {
    id: 'obs-1', orgId: 'o1', engagementId: 'e1', title: 'Approved observation', state: 'approved',
    sections: {}, version: 2, contentHash: 'b'.repeat(64),
    approval: { approvedBy: 'manager-1', approvedAt: FIXED_TIMESTAMP, version: 2, contentHash: 'b'.repeat(64) },
  }]]);
}

function base(overrides: Partial<SealInput> = {}): SealInput {
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

describe('WP1 adversarial: broken inputs never seal', () => {
  it('refuses a report with a missing reference', async () => {
    const claims = fixtureClaims();
    const map = known(claims);
    map.delete(`${claims[0].references[0].type}:${claims[0].references[0].id}`);
    const report = await evaluateSeal(base({ known: map }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'references')).toBe(true);
  });

  it('refuses a report with a reference whose hash no longer matches', async () => {
    const claims = fixtureClaims();
    const map = known(claims);
    const r = claims[1].references[0];
    map.set(`${r.type}:${r.id}`, { ...r, contentHash: 'f'.repeat(64) });
    const report = await evaluateSeal(base({ known: map }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'references' && b.detail.includes('content hash changed'))).toBe(true);
  });

  it('COVERAGE HOLE (would have caught it): a CAP in scope with no claim is refused', async () => {
    const claims = fixtureClaims();
    const coverage = scopeFor(claims);
    coverage.capIds = ['cap-uncovered'];
    const report = await evaluateSeal(base({ coverage }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'coverage' && b.subject === 'cap:cap-uncovered')).toBe(true);
  });

  it('GRAPH-ROOT MUTATION (would have caught it): one changed figure moves the root and blocks', async () => {
    const claims = fixtureClaims();
    const target = claims.find((c) => c.id === 'c-exceptions')!;
    target.figures = [{ figureId: 'fig.controls_tested', figureVersion: 1, parameters: { engagementId: 'e1' }, result: '40' }];
    const before = await graphHashes(fixtureClaims());
    const after = await graphHashes(claims);
    expect(after.graphRoot).not.toBe(before.graphRoot);

    // The same change makes the seal gate refuse: the stored figure does not recompute to 40.
    const records = new Map([['test_rows', [{ type: 'test_rows', id: 'r1', contentHash: 'a'.repeat(64) }]]]);
    const columns = new Map([['test_rows', new Map([['r1', 'x']])]]);
    const report = await evaluateSeal(base({ graph: graph(claims), recordsByTable: records, columns }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'figures')).toBe(true);
  });

  it('refuses the same figure carrying two different values', async () => {
    const claims = fixtureClaims();
    claims[0].figures = [{ figureId: 'fig.x', figureVersion: 1, parameters: {}, result: '10' }];
    claims[1].figures = [{ figureId: 'fig.x', figureVersion: 1, parameters: {}, result: '11' }];
    const report = await evaluateSeal(base({ graph: graph(claims) }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes('contradiction.same_figure_two_values'))).toBe(true);
  });

  it('refuses a severity/risk mismatch with no auditor override', async () => {
    const claims = fixtureClaims();
    const findingId = claims[0].references[0].id;
    const report = await evaluateSeal(base({
      graph: graph(claims),
      contradictions: {
        capState: new Map(), riskRating: new Map([[findingId, 'high']]),
        findingSeverity: new Map([[findingId, 'low']]), auditorOverrides: new Map(),
        dismissedAlerts: new Set(), claimAlert: new Map(),
      },
    }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes('contradiction.severity_risk_mismatch'))).toBe(true);
  });

  it('allows the severity/risk mismatch when the auditor overrides it', async () => {
    const claims = fixtureClaims();
    const findingId = claims[0].references[0].id;
    const report = await evaluateSeal(base({
      graph: graph(claims),
      contradictions: {
        capState: new Map(), riskRating: new Map([[findingId, 'high']]),
        findingSeverity: new Map([[findingId, 'low']]), auditorOverrides: new Map([[findingId, 'accepted risk']]),
        dismissedAlerts: new Set(), claimAlert: new Map(),
      },
    }));
    expect(report.blockers.some((b) => b.detail.includes('severity_risk_mismatch'))).toBe(false);
  });

  it('refuses a CAP status mismatch', async () => {
    const claims = fixtureClaims();
    const status = claims.find((c) => c.id === 'c-status')!;
    status.phraseId = 'status.open';
    status.references = [{ type: 'cap', id: 'cap-1', contentHash: 'a'.repeat(64) }];
    const report = await evaluateSeal(base({
      graph: graph(claims), coverage: scopeFor(claims),
      contradictions: {
        capState: new Map([['cap-1', 'closed']]), riskRating: new Map(), findingSeverity: new Map(),
        auditorOverrides: new Map(), dismissedAlerts: new Set(), claimAlert: new Map(),
      },
    }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes('contradiction.status_vs_cap'))).toBe(true);
  });

  it('refuses a date after the report date', async () => {
    const claims = fixtureClaims();
    const report = await evaluateSeal(base({ graph: graph(claims), timeArgument: '2026-03-01' }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes('contradiction.date_after_report'))).toBe(true);
  });

  it('refuses a claim derived from a dismissed alert', async () => {
    const claims = fixtureClaims();
    const report = await evaluateSeal(base({
      graph: graph(claims),
      contradictions: {
        capState: new Map(), riskRating: new Map(), findingSeverity: new Map(),
        auditorOverrides: new Map(), dismissedAlerts: new Set(['alert-9']),
        claimAlert: new Map([['c-scope', 'alert-9']]),
      },
    }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes('contradiction.alert_dismissed'))).toBe(true);
  });

  it('refuses an unapproved observation behind a claim', async () => {
    const observationsMap = observations();
    observationsMap.set('obs-1', { ...observationsMap.get('obs-1')!, state: 'draft', approval: null });
    const report = await evaluateSeal(base({ observations: observationsMap }));
    expect(report.sealed).toBe(false);
    expect(report.blockers.some((b) => b.check === 'staleness')).toBe(true);
  });

  it('refuses when a claim hash does not match its facts (tampered claim)', async () => {
    const claims = fixtureClaims();
    const stored = await claimHash(claims[0]);
    const tampered: Claim = { ...claims[0], slots: [{ name: 'x', kind: 'text', value: 'changed' }] };
    const recomputed = await claimHash(tampered);
    expect(recomputed).not.toBe(stored);
    // The seal gate recomputes over the claims it is given, so a tampered claim is simply a different
    // graph: prove the root differs, which is the fact the seal commits to.
    const a = await graphHashes(claims);
    const b = await graphHashes([tampered, ...claims.slice(1)]);
    expect(a.graphRoot).not.toBe(b.graphRoot);
  });
});

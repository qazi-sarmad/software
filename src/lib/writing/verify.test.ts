import { describe, expect, it } from 'vitest';
import {
  auditorLabel, checkAuditorText, checkReferenceIntegrity, findContradictions, isStructural,
  reconcileCoverage, type ContradictionInput, type KnownRecord,
} from './verify';
import { fixtureClaims, FIXED_TIMESTAMP } from './fixtures';
import type { Claim } from './types';

function known(claims: Claim[]): Map<string, KnownRecord> {
  const map = new Map<string, KnownRecord>();
  for (const c of claims) for (const r of c.references) map.set(`${r.type}:${r.id}`, r);
  return map;
}

describe('W5.1 reference integrity', () => {
  it('passes when every reference resolves to a record with the same hash', () => {
    const claims = fixtureClaims();
    const report = checkReferenceIntegrity(claims, known(claims));
    expect(report.ok).toBe(true);
  });

  it('flags a claim with no reference', () => {
    const claims = fixtureClaims();
    const bare: Claim = { ...claims[0], id: 'c-bare', references: [] };
    const report = checkReferenceIntegrity([...claims, bare], known(claims));
    expect(report.unreferenced).toContain('c-bare');
    expect(report.ok).toBe(false);
  });

  it('flags a reference whose content hash changed', () => {
    const claims = fixtureClaims();
    const map = known(claims);
    const first = claims[0].references[0];
    map.set(`${first.type}:${first.id}`, { ...first, contentHash: 'f'.repeat(64) });
    const report = checkReferenceIntegrity(claims, map);
    expect(report.staleClaims).toContain(claims[0].id);
    expect(report.ok).toBe(false);
  });

  it('flags a reference that does not resolve', () => {
    const claims = fixtureClaims();
    const map = known(claims);
    map.delete(`${claims[0].references[0].type}:${claims[0].references[0].id}`);
    const report = checkReferenceIntegrity(claims, map);
    expect(report.stale.some((s) => s.reason === 'does not resolve')).toBe(true);
  });

  it('exempts a structural claim declared as such', () => {
    const claims = fixtureClaims();
    const structural: Claim = { ...claims[0], id: 'c-header', kind: 'derived', claimLevel: 'verified', references: [], crossReferences: [] };
    expect(isStructural(structural)).toBe(true);
    const report = checkReferenceIntegrity([structural], new Map());
    expect(report.unreferenced).toEqual([]);
  });
});

describe('W5.2 coverage reconciliation', () => {
  const scope = { findingIds: ['c-scope-f1'], exceptionControlIds: [], capIds: [] };

  it('passes when each fact appears exactly once', () => {
    const claims = fixtureClaims();
    const report = reconcileCoverage(claims, scope);
    expect(report.missing).toEqual([]);
    expect(report.duplicated).toEqual([]);
  });

  it('reports a missing fact', () => {
    const report = reconcileCoverage([], { findingIds: ['f-1'], exceptionControlIds: ['ctl-1'], capIds: ['cap-1'] });
    expect(report.missing).toEqual(['cap:cap-1', 'control:ctl-1', 'finding:f-1']);
    expect(report.ok).toBe(false);
  });

  it('reports a duplicate claim for the same fact', () => {
    const claims = fixtureClaims();
    const dup: Claim = { ...claims[0], id: 'c-scope-dup' };
    const report = reconcileCoverage([...claims, dup], scope);
    expect(report.duplicated.some((d) => d.startsWith('finding:c-scope-f1'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('reports an orphaned claim', () => {
    const orphan: Claim = { ...fixtureClaims()[0], id: 'c-orphan', references: [{ type: 'finding', id: 'not-in-scope', contentHash: 'a'.repeat(64) }] };
    const report = reconcileCoverage([orphan], { findingIds: ['x'], exceptionControlIds: [], capIds: [] });
    expect(report.orphaned).toContain('c-orphan');
  });
});

describe('W5.3 deterministic contradiction rules', () => {
  function input(overrides: Partial<ContradictionInput> = {}): ContradictionInput {
    return {
      claims: [], reportDate: '2026-10-25', capState: new Map(), riskRating: new Map(),
      findingSeverity: new Map(), auditorOverrides: new Map(), dismissedAlerts: new Set(),
      claimAlert: new Map(), ...overrides,
    };
  }

  it('finds the same figure with two values', () => {
    const base = fixtureClaims()[0];
    const a: Claim = { ...base, id: 'c-a', figures: [{ figureId: 'fig.x', figureVersion: 1, parameters: {}, result: '1' }] };
    const b: Claim = { ...base, id: 'c-b', figures: [{ figureId: 'fig.x', figureVersion: 1, parameters: {}, result: '2' }] };
    const found = findContradictions(input({ claims: [a, b] }));
    expect(found.some((c) => c.ruleId === 'contradiction.same_figure_two_values')).toBe(true);
  });

  it('finds a severity that differs from the risk rating without an override', () => {
    const claim: Claim = { ...fixtureClaims()[0], references: [{ type: 'finding', id: 'f1', contentHash: 'a'.repeat(64) }] };
    const found = findContradictions(input({
      claims: [claim], findingSeverity: new Map([['f1', 'High']]), riskRating: new Map([['f1', 'Low']]),
    }));
    expect(found.some((c) => c.ruleId === 'contradiction.severity_risk_mismatch')).toBe(true);
    // With an override, no contradiction.
    const withOverride = findContradictions(input({
      claims: [claim], findingSeverity: new Map([['f1', 'High']]), riskRating: new Map([['f1', 'Low']]),
      auditorOverrides: new Map([['f1', 'documented rationale']]),
    }));
    expect(withOverride.some((c) => c.ruleId === 'contradiction.severity_risk_mismatch')).toBe(false);
  });

  it('finds a closed status claim against an open CAP', () => {
    const claim: Claim = { ...fixtureClaims()[0], phraseId: 'status.closed', references: [{ type: 'cap', id: 'cap-1', contentHash: 'a'.repeat(64) }] };
    const found = findContradictions(input({ claims: [claim], capState: new Map([['cap-1', 'open']]) }));
    expect(found.some((c) => c.ruleId === 'contradiction.status_vs_cap')).toBe(true);
  });

  it('finds a date later than the report date', () => {
    const claim: Claim = { ...fixtureClaims()[0], slots: [{ name: 'due_date', kind: 'date', value: '2026-12-31' }] };
    const found = findContradictions(input({ claims: [claim], reportDate: '2026-10-25' }));
    expect(found.some((c) => c.ruleId === 'contradiction.date_after_report')).toBe(true);
  });

  it('finds an alert-derived claim whose alert was dismissed', () => {
    const claim = fixtureClaims()[0];
    const found = findContradictions(input({ claims: [claim], dismissedAlerts: new Set(['alert-1']), claimAlert: new Map([[claim.id, 'alert-1']]) }));
    expect(found.some((c) => c.ruleId === 'contradiction.alert_dismissed')).toBe(true);
  });
});

describe('W5.4 the auditor-text lane', () => {
  it('labels auditor text and flags (does not block) a high-consequence word', () => {
    const claims = fixtureClaims();
    const auditor = claims.find((c) => c.kind === 'auditor')!;
    expect(auditorLabel(auditor)).toContain('Auditor text');
    expect(checkAuditorText([auditor], ['fraud'])).toEqual([]);
    const withWord: Claim = { ...auditor, id: 'c-auditor-2', auditorText: 'The auditor notes a possible fraud indicator.' };
    const issues = checkAuditorText([withWord], ['fraud']);
    expect(issues.some((i) => i.reason.includes('fraud'))).toBe(true);
  });

  it('flags auditor text with no author or time', () => {
    const auditor = fixtureClaims().find((c) => c.kind === 'auditor')!;
    const bare: Claim = { ...auditor, auditorAuthor: undefined, auditorAt: undefined };
    const issues = checkAuditorText([bare], []);
    expect(issues.map((i) => i.reason)).toContain('auditor text has no author');
    expect(issues.map((i) => i.reason)).toContain('auditor text has no time');
  });
});

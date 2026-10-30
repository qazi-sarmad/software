// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RuleFinding } from './types';
import {
  requiredRowsFromFindings, buildAcceptedTestingSet, applyFloor, parsePastedBlock,
  verifyCompleteness, verifyEvidence, verifyRows, carriedOverrides,
  type TestedRow, type EvidenceRecord,
} from './flows';

const finding = (refs: string[]): RuleFinding => ({
  ruleId: 'numeric.duplicates', ruleVersion: 1, kind: 'duplicates', severity: 'medium',
  reason: 'dup', refs,
});

const row = (over: Partial<TestedRow> & { ref: string }): TestedRow => ({
  values: {}, remark: 'ok', decision: 'effective', evidenceIds: [], claim: null,
  required: true, autoAdded: false, ...over,
});

describe('accepted flow (S3, spec §2.2)', () => {
  it('takes rows from findings, de-duplicated and order-preserving', () => {
    const req = requiredRowsFromFindings([finding(['b', 'a']), finding(['a'])]);
    expect(req.map((r) => r.ref)).toEqual(['b', 'a']);
    expect(req[0].ruleId).toBe('numeric.duplicates');
  });

  it('builds a tested set from required rows, then auto-adds untested rows', () => {
    const req = requiredRowsFromFindings([finding(['p2'])]);
    const population = [{ ref: 'p1', values: {} }, { ref: 'p2', values: {} }, { ref: 'p3', values: {} }];
    const set = buildAcceptedTestingSet(req, population, 1);
    expect(set.map((r) => r.ref)).toEqual(['p2', 'p1']);
    expect(set[0].required).toBe(true);
    expect(set[1].autoAdded).toBe(true);
  });
});

describe('declined flow (S4, spec §2.3)', () => {
  it('treats the floor as a minimum, adding rows up to it and never fewer', () => {
    const population = Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, values: {} }));
    const set = applyFloor(4, population);
    expect(set).toHaveLength(4);
    expect(set.every((r) => r.autoAdded)).toBe(true);
  });

  it('counts already-tested rows toward the floor and keeps them', () => {
    const population = Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, values: {} }));
    const set = applyFloor(3, population, ['r7']);
    expect(set).toHaveLength(3);
    expect(set.some((r) => r.ref === 'r7' && r.required)).toBe(true);
  });

  it('keeps a tested row the population does not carry (never drops the auditor’s work)', () => {
    const set = applyFloor(1, [{ ref: 'a', values: {} }], ['gone']);
    expect(set.some((r) => r.ref === 'gone')).toBe(true);
  });

  it('parses a pasted block and maps a matching header row onto the columns', () => {
    const pasted = 'Ref\tAmount\nr1\t10\nr2\t20';
    const { header, rows } = parsePastedBlock(pasted, ['Ref', 'Amount']);
    expect(header).toEqual(['Ref', 'Amount']);
    expect(rows).toEqual([['r1', '10'], ['r2', '20']]);
  });

  it('treats a block with no matching header as all data', () => {
    const { rows } = parsePastedBlock('r1\t10', ['Ref', 'Amount']);
    expect(rows).toEqual([['r1', '10']]);
  });
});

describe('verification (S5, spec §6)', () => {
  const good: EvidenceRecord = {
    id: 'e1', reachable: true, type: 'pdf', contentSha256: 'a'.repeat(64),
    period: '2026-01', entity: 'Acme', amount: 100,
  };

  it('Mode A is exact: a closed decision and a remark, nothing else', () => {
    const rows = [row({ ref: 'a' }), row({ ref: 'b', decision: 'open' }), row({ ref: 'c', remark: '  ' })];
    const v = verifyCompleteness(rows);
    expect(v.find((x) => x.ref === 'a')?.ok).toBe(true);
    expect(v.find((x) => x.ref === 'b')?.reasons).toContain('no closed decision');
    expect(v.find((x) => x.ref === 'c')?.reasons).toContain('no remark');
  });

  it('Mode B verifies reachability, type, hash and the declared period/entity/amount', () => {
    const rows = [row({ ref: 'a', remark: 'receipt', evidenceIds: ['e1'], claim: { type: 'pdf', period: '2026-01', entity: 'Acme', amount: 100 } })];
    const v = verifyEvidence(rows, { e1: good });
    expect(v[0].ok).toBe(true);
  });

  it('Mode B fails closed and states every reason it is not satisfied', () => {
    const rows = [row({
      ref: 'a', remark: 'receipt', evidenceIds: ['e1'],
      claim: { type: 'sheet', period: '2026-02', entity: 'Other', amount: 999 },
    })];
    const bad: EvidenceRecord = { ...good, reachable: false, contentSha256: 'nope' };
    const v = verifyEvidence(rows, { e1: bad });
    expect(v[0].ok).toBe(false);
    expect(v[0].reasons.join(' | ')).toMatch(/not reachable/);
    expect(v[0].reasons.join(' | ')).toMatch(/not sheet/);
    expect(v[0].reasons.join(' | ')).toMatch(/amount/);
    expect(v[0].reasons.join(' | ')).toMatch(/no valid recorded hash/);
  });

  it('Mode B reports a missing evidence record rather than passing', () => {
    const rows = [row({ ref: 'a', evidenceIds: ['missing'], claim: { type: 'pdf' } })];
    const v = verifyEvidence(rows, {});
    expect(v[0].ok).toBe(false);
    expect(v[0].reasons.join(' ')).toMatch(/missing/);
  });

  it('dispatches to the configured mode', () => {
    const rows = [row({ ref: 'a', evidenceIds: [], claim: null })];
    expect(verifyRows(rows, 'completeness')[0].ok).toBe(true);
    expect(verifyRows(rows, 'evidence', {})[0].ok).toBe(false);
  });
});

describe('override carried forward (S12, spec §2.2)', () => {
  it('carries a failed-but-closed-with-a-remark row to the reviewer', () => {
    const rows = [row({ ref: 'a', evidenceIds: [], claim: null })];
    const v = verifyEvidence(rows, {});
    const carried = carriedOverrides(rows, v);
    expect(carried.map((c) => c.ref)).toEqual(['a']);
    expect(carried[0].reasons.length).toBeGreaterThan(0);
  });

  it('does not carry a clean row', () => {
    const rows = [row({ ref: 'a' })];
    expect(carriedOverrides(rows, verifyCompleteness(rows))).toEqual([]);
  });

  it('does not treat a closure without a remark as an override (it is an invalid close)', () => {
    const rows = [row({ ref: 'a', remark: '', evidenceIds: [], claim: null })];
    const v = verifyEvidence(rows, {});
    expect(carriedOverrides(rows, v)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { itRules, shariahRules, disciplineRules } from './disciplines';
import { runRules } from '../runner';
import type { RuleInput, SysteligonRule } from '../types';

const ctx = { evaluatedAt: '2026-10-30T00:00:00.000Z' };

function run(rules: SysteligonRule[], input: RuleInput) {
  return runRules(rules, input, ctx);
}

describe('discipline rule packs (D11)', () => {
  it('the IT base and the Shari\'ah base are both non-empty and every rule cites a source', () => {
    expect(itRules.length).toBeGreaterThanOrEqual(6);
    expect(shariahRules.length).toBeGreaterThanOrEqual(6);
    for (const r of disciplineRules) {
      expect(r.standards.length, `${r.id} must cite a source`).toBeGreaterThan(0);
      expect(r.status).toBe('released');
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it('every discipline rule declares a discipline and a stable id@version', () => {
    const refs = new Set<string>();
    for (const r of disciplineRules) {
      expect(['it', 'shariah']).toContain(r.discipline);
      const ref = `${r.id}@${r.version}`;
      expect(refs.has(ref), `duplicate rule ref ${ref}`).toBe(false);
      refs.add(ref);
    }
  });

  describe('IT — change management', () => {
    it('flags a change missing its approval, test or rollback plan', () => {
      const input: RuleInput = { rows: [
        { ref: 'CHG-1', values: { record_kind: 'change', approval_ref: 'A1', test_ref: 'T1', rollback_plan: 'R1' } },
        { ref: 'CHG-2', values: { record_kind: 'change', approval_ref: 'A2', test_ref: '', rollback_plan: 'R2' } },
      ] };
      const res = run(itRules, input);
      const found = res.findings.filter((f) => f.ruleId === 'it.change_management');
      expect(found).toHaveLength(1);
      expect(found[0].refs).toEqual(['CHG-2']);
      expect(found[0].reason).toContain('test_ref');
    });

    it('skips rows that do not claim the record kind', () => {
      const input: RuleInput = { rows: [
        { ref: 'X-1', values: { record_kind: 'something_else' } },
      ] };
      expect(run(itRules, input).findings).toHaveLength(0);
    });
  });

  describe("Shari'ah — riba", () => {
    it('flags an increase on a loan and a penalty not sent to charity', () => {
      const input: RuleInput = { rows: [
        { ref: 'LN-1', values: { record_kind: 'loan', increase_cents: 0, penalty_destination: 'charity' } },
        { ref: 'LN-2', values: { record_kind: 'loan', increase_cents: 5000, penalty_destination: 'charity' } },
        { ref: 'LN-3', values: { record_kind: 'loan', increase_cents: 0, penalty_destination: 'institution' } },
      ] };
      const found = run(shariahRules, input).findings.filter((f) => f.ruleId === 'shariah.riba');
      expect(found.map((f) => f.refs[0])).toEqual(['LN-2', 'LN-3']);
      expect(found[0].reason).toContain('increase');
      expect(found[1].reason).toContain('charity');
    });

    it('passes a loan that returns exactly the principal with no penalty', () => {
      const input: RuleInput = { rows: [
        { ref: 'LN-4', values: { record_kind: 'loan', increase_cents: 0 } },
      ] };
      expect(run(shariahRules, input).findings).toHaveLength(0);
    });
  });

  describe("Shari'ah — ownership sequence and profit distribution", () => {
    it('flags a Murabahah sold on with no prior acquisition', () => {
      const input: RuleInput = { rows: [
        { ref: 'MR-1', values: { record_kind: 'murabahah', acquisition_ref: 'ACQ-9' } },
        { ref: 'MR-2', values: { record_kind: 'murabahah' } },
      ] };
      const found = run(shariahRules, input).findings.filter((f) => f.ruleId === 'shariah.ownership_sequence');
      expect(found).toHaveLength(1);
      expect(found[0].refs).toEqual(['MR-2']);
    });

    it('flags a Mudarabah with no ratio agreed before the investment', () => {
      const input: RuleInput = { rows: [
        { ref: 'MD-1', values: { record_kind: 'mudarabah', ratio_agreed_at: '2026-01-01' } },
        { ref: 'MD-2', values: { record_kind: 'mudarabah' } },
      ] };
      const found = run(shariahRules, input).findings.filter((f) => f.ruleId === 'shariah.profit_distribution');
      expect(found).toHaveLength(1);
      expect(found[0].refs).toEqual(['MD-2']);
    });
  });

  it('the findings are deterministic: the same input yields the same findings', () => {
    const input: RuleInput = { rows: [
      { ref: 'CHG-3', values: { record_kind: 'change', approval_ref: '' } },
    ] };
    const a = run(itRules, input).findings;
    const b = run(itRules, input).findings;
    expect(a).toEqual(b);
  });
});

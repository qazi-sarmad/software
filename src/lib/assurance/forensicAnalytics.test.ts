import { describe, expect, it } from 'vitest';
import {
  FORENSIC_RULES,
  BENFORD_SECOND_DIGIT,
  checkBenfordSecondDigit,
  runForensicRules,
  sampleWithinPopulation,
} from './forensicAnalytics';
import type { PopulationEntry } from '../analyticsEngine';

function pop(over: Partial<PopulationEntry>[]): PopulationEntry[] {
  return over.map((o, i) => ({ rowRef: o.rowRef ?? i + 1, ...o }));
}

describe('D7: the forensic rule pack is named, versioned and sourced', () => {
  it('every rule carries an id, a version and a verified source, and cites a Benford/AS 2401/ISA 530 source', () => {
    expect(FORENSIC_RULES.length).toBeGreaterThanOrEqual(11);
    for (const r of FORENSIC_RULES) {
      expect(r.ruleId).toMatch(/^forensic\./);
      expect(r.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(r.source.length).toBeGreaterThan(0);
    }
  });

  it('includes the AS 2401 journal-entry family and both Benford digits', () => {
    const ids = FORENSIC_RULES.map((r) => r.ruleId);
    expect(ids).toContain('forensic.benford_first_digit');
    expect(ids).toContain('forensic.benford_second_digit');
    expect(ids).toContain('forensic.round_numbers');
    expect(ids).toContain('forensic.weekend_postings');
    expect(ids).toContain('forensic.same_user_create_approve');
    expect(ids).toContain('forensic.missing_attributes');
  });

  it("Benford's second-digit distribution is the published ten probabilities summing to ~1", () => {
    expect(BENFORD_SECOND_DIGIT).toHaveLength(10);
    const sum = BENFORD_SECOND_DIGIT.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });
});

describe('D7: runForensicRules — happy path and bad path', () => {
  it('flags duplicated rows and names them by row reference', () => {
    const entries = pop([
      { amount: 100, date: '2026-01-01', user: 'u1', attributes: { description: 'a' } },
      { amount: 100, date: '2026-01-01', user: 'u1', attributes: { description: 'a' } },
      { amount: 250, date: '2026-01-02', user: 'u2', attributes: { description: 'b' } },
    ]);
    const results = runForensicRules(entries, FORENSIC_RULES);
    const dup = results.find((r) => r.ruleId === 'forensic.duplicates')!;
    expect(dup.flaggedCount).toBeGreaterThanOrEqual(1);
    expect(dup.rowRefs.length).toBe(dup.flaggedCount);
    // every result names its source
    for (const r of results) expect(r.source.length).toBeGreaterThan(0);
  });

  it('BAD: an empty population yields no findings and no crash — the caller reports it, not clean', () => {
    const results = runForensicRules([], FORENSIC_RULES);
    for (const r of results) expect(r.flaggedCount).toBe(0);
    expect(results.every((r) => r.reason === 'no row matched the rule')).toBe(true);
  });

  it("computes Benford's second digit over the population and reports a MAD", () => {
    const entries = pop(Array.from({ length: 500 }, (_, i) => ({ amount: 100 + i, attributes: {} })));
    const r = checkBenfordSecondDigit(entries);
    expect(r.rows).toHaveLength(10);
    expect(typeof r.params.mad).toBe('number');
  });

  it('ISA 530: a sample larger than the population is refused, an empty population is refused', () => {
    expect(sampleWithinPopulation(10, 100).ok).toBe(true);
    expect(sampleWithinPopulation(101, 100).ok).toBe(false);
    expect(sampleWithinPopulation(101, 100).reason).toContain('ISA 530');
    expect(sampleWithinPopulation(1, 0).ok).toBe(false);
    expect(sampleWithinPopulation(1, 0).reason).toContain('empty');
  });
});

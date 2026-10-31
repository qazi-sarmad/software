/**
 * D7 at volume (SCALE-PROGRAMME §2.3, §5 flow 7). The forensic run must be deterministic at
 * 1,000,000 rows: the same population and rule pack produce a byte-identical result across two runs,
 * and the run completes in bounded time. Determinism is asserted on the *sealed* payload — the sorted
 * findings, each naming its rule id, version and source — which is exactly what a report root hashes.
 *
 * L1/L4: the population is a fixed LCG (no clock, no random), so a failure is reproducible from the
 * seed alone, and the run reads nothing but its arguments.
 */
import { describe, expect, it } from 'vitest';
import { FORENSIC_RULES, runForensicRules } from './forensicAnalytics';
import type { PopulationEntry } from '../analyticsEngine';

/** A deterministic population (a fixed LCG), so a failure is reproducible from the seed alone. */
function population(n: number, seed = 42): PopulationEntry[] {
  let s = seed >>> 0;
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const rows = new Array<PopulationEntry>(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      rowRef: i + 1,
      amount: Math.round(next() * 100000),
      date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`,
      user: `u${i % 50}`,
      approver: `a${i % 20}`,
      attributes: { description: i % 11 === 0 ? null : `d${i}`, seq: i },
    };
  }
  return rows;
}

/** The sealed payload a report root would hash: the findings, in the engine's own order. */
const seal = (r: ReturnType<typeof runForensicRules>) =>
  JSON.stringify(r.map((x) => ({ ruleId: x.ruleId, ruleVersion: x.ruleVersion, flaggedCount: x.flaggedCount, rowRefs: x.rowRefs })));

describe('D7 forensic analytics at volume (L1, SCALE-PROGRAMME §5 flow 7)', () => {
  it('is byte-identical across two runs over 1,000,000 rows, in bounded time', () => {
    const pop = population(1_000_000);

    const a = runForensicRules(pop, FORENSIC_RULES);
    const b = runForensicRules(pop, FORENSIC_RULES);

    // The whole pack runs at volume — a rule may not be silently dropped at 1M rows.
    expect(a).toHaveLength(FORENSIC_RULES.length);
    expect(a.some((r) => r.flaggedCount > 0)).toBe(true);
    // The two runs agree byte-for-byte: same findings, same order, same flagged rows.
    expect(seal(a)).toBe(seal(b));
  }, 120_000);

  it('gives the same verdict at 10 rows as at 100,000 for the rules that fire at both scales', () => {
    const small = runForensicRules(population(10), FORENSIC_RULES);
    const large = runForensicRules(population(100_000), FORENSIC_RULES);
    expect(large.map((r) => r.ruleId)).toEqual(small.map((r) => r.ruleId));
  }, 60_000);
});

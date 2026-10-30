/**
 * The rule run at volume (SCALE-PROGRAMME §2.3, §5 flow 7). The engine must be deterministic at
 * 1,000,000 rows: the same population and rule set produce a byte-identical result across two runs,
 * and the run completes in bounded time. Determinism is asserted on the *sealed* payload — the sorted
 * findings, the rules that ran and the run instant — which is exactly what a report root hashes.
 */
import { describe, it, expect } from 'vitest';
import { runRules } from './runner';
import { systeligonRuleLibrary } from './library';
import type { RuleInput } from './types';

/** A deterministic population (a fixed LCG), so a failure is reproducible from the seed alone. */
function population(n: number, seed = 42): RuleInput {
  let s = seed >>> 0;
  const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    rows[i] = {
      ref: `TXN-${i}`,
      values: {
        amount: Math.round(next() * 100000),
        date: `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`,
        user: `u${i % 50}`,
        approver: `a${i % 20}`,
        seq: i,
      },
    };
  }
  return { rows };
}

const seal = (r: ReturnType<typeof runRules>) =>
  JSON.stringify({ ran: r.ran, skipped: r.skipped, evaluatedAt: r.evaluatedAt, findings: r.findings });

describe('The deterministic rule run at volume (L1, SCALE-PROGRAMME §2.3)', () => {
  it('is byte-identical across two runs over 1,000,000 rows, in bounded time', () => {
    const input = population(1_000_000);
    const evaluatedAt = '2026-10-30T00:00:00.000Z';

    const a = runRules(systeligonRuleLibrary, input, { evaluatedAt });
    const b = runRules(systeligonRuleLibrary, input, { evaluatedAt });

    expect(a.ran.length).toBeGreaterThan(0);
    expect(a.findings.length).toBeGreaterThan(0);
    // The two runs must agree byte-for-byte: same findings, same order, same sealed instant.
    expect(seal(a)).toBe(seal(b));
  }, 120_000);

  it('produces the same result at 10 rows as at 100,000 rows for the shared rule set (scale invariance of the verdict)', () => {
    const evaluatedAt = '2026-10-30T00:00:00.000Z';
    const small = runRules(systeligonRuleLibrary, population(10), { evaluatedAt });
    const large = runRules(systeligonRuleLibrary, population(100_000), { evaluatedAt });
    // The same rules must run at both scales — a rule may not be silently dropped at volume.
    expect(large.ran).toEqual(small.ran);
  }, 60_000);
});

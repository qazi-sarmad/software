/**
 * Systeligon just-below-threshold rule (spec §3.1, S6). Values clustered immediately under a limit —
 * the shape of an approval being split to stay under an authority threshold. Pure: the limit and the
 * band are arguments; the rule never reads a clock or a config table.
 */
import type { RuleFinding, SysteligonRule } from '../types';

export const justBelowThreshold: SysteligonRule<{ limit: number; bandPct: number }> = {
  id: 'numeric.just_below_threshold',
  version: 1,
  kind: 'just_below_threshold',
  appliesTo: 'population',
  title: 'Values clustered immediately below a threshold',
  params: { limit: 10000, bandPct: 5 },
  standards: [],
  status: 'released',
  severity: 'medium',
  evaluate: (input, ctx) => {
    const { limit, bandPct } = justBelowThreshold.params;
    const floor = limit * (1 - bandPct / 100);
    const findings: RuleFinding[] = [];
    for (const row of input.rows) {
      const a = row.values.amount == null ? null : Math.abs(Number(row.values.amount));
      if (a == null || !Number.isFinite(a)) continue;
      // A value in [floor, limit) is under the limit but inside the band. At or above the limit is a
      // different, legitimate case; well below it is not clustering.
      if (a >= floor && a < limit) {
        findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'just_below_threshold', severity: ctx.severity,
          reason: `Amount ${a} sits in the ${bandPct}% band below the ${limit} threshold.`,
          refs: [row.ref],
        });
      }
    }
    return findings;
  },
};

/**
 * Systeligon sequential-document rules (S14/S15, spec §3.3). These two rules expose the action-item
 * register and the policy/procedure/regulation comparison through the S1 rule shape, so a run over a
 * document set records them with provenance like every other rule.
 *
 * `asOf` (the run's evaluated date) fixes the passed-due check; it is never read from a clock.
 */
import { buildActionRegister } from '../minutes';
import { compareDocuments } from '../policydiff';
import type { RuleFinding, SysteligonRule } from '../types';

/** S14 — the action-item register findings, as one sequential rule. */
export const actionItemRegister: SysteligonRule<Record<string, never>> = {
  id: 'doc.action_item_register', version: 1, kind: 'action_item', appliesTo: 'minutes',
  title: 'Action items are tracked across the minutes series', params: {}, standards: [], status: 'released', severity: 'medium',
  evaluate: (input, ctx) => {
    const asOf = input.scope?.['asOf'] ?? '';
    const findings: RuleFinding[] = [];
    for (const f of buildActionRegister(input.documents ?? [], asOf)) {
      findings.push({
        ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'action_item', severity: ctx.severity,
        reason: f.detail,
        // Cite every minute the item appeared in — the history is the evidence.
        refs: f.history.map((a) => `${a.documentRef}:${a.line}`),
      });
    }
    return findings;
  },
};

/** S15 — the policy/procedure/regulation comparison, as one sequential rule. */
export const policyComparison: SysteligonRule<Record<string, never>> = {
  id: 'doc.policy_comparison', version: 1, kind: 'policy_procedure', appliesTo: 'policy',
  title: 'Policy, procedure and regulation coverage', params: {}, standards: [], status: 'released', severity: 'medium',
  evaluate: (input, ctx) => {
    const { findings, coverage } = compareDocuments(input.documents ?? []);
    const out: RuleFinding[] = findings.map((m) => ({
      ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'policy_procedure', severity: ctx.severity,
      reason: m.detail,
      refs: m.b ? [`${m.a.documentRef}:${m.a.line}`, `${m.b.documentRef}:${m.b.line}`] : [`${m.a.documentRef}:${m.a.line}`],
    }));
    // §3.3: the engine reports its own coverage. An unparsed clause is not a clean clause.
    for (const ref of coverage.uninterpreted) {
      out.push({
        ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'policy_procedure', severity: 'info',
        reason: `Clause ${ref} could not be interpreted; it was not matched and is not a clean clause.`,
        refs: [ref],
      });
    }
    return out;
  },
};

export const sequentialRules: SysteligonRule[] = [actionItemRegister, policyComparison];

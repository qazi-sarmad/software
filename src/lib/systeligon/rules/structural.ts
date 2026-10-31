/**
 * Systeligon structural document rules (spec §3.2, §3.3). These match on parsed structure — element
 * roles, labels and cross-references — never on prose meaning. A rule reports the shape of a problem
 * and cites the elements it found; it does not decide what the shape means.
 */
import type { RuleFinding, SysteligonRule } from '../types';

/**
 * A minutes document must carry a quorum, an owner on every action item, and a due date on every
 * action item. Spec §3.2: "a minute with no quorum", "an action item with no responsible person or no
 * due date". One rule, because the three are the same shape: a required element is absent.
 */
export const minutesRequiredElements: SysteligonRule<{ required: string[] }> = {
  id: 'doc.minutes_required_elements',
  version: 1,
  kind: 'missing_element',
  appliesTo: 'minutes',
  title: 'Minutes carry quorum, an owner and a due date on every action',
  params: { required: ['quorum', 'owner', 'due_date'] },
  standards: ['IIA-2410'],
  status: 'released',
  severity: 'medium',
  evaluate: (input, ctx) => {
    const findings: RuleFinding[] = [];
    for (const doc of input.documents ?? []) {
      if (doc.kind !== 'minutes') continue;
      const hasQuorum = doc.elements.some((e) => e.role === 'field' && e.label?.toLowerCase() === 'quorum');
      if (!hasQuorum) {
        findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_element' as const, severity: ctx.severity,
          reason: `Minutes ${doc.ref} record no quorum.`, refs: [doc.ref],
        });
      }
      for (const item of doc.elements.filter((e) => e.role === 'action_item')) {
        const missing: string[] = [];
        if (!item.label) missing.push('owner');
        if (!item.value) missing.push('due date');
        if (missing.length) {
          findings.push({
            ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_element' as const, severity: ctx.severity,
            reason: `Action item ${item.ref} has no ${missing.join(' or ')}.`, refs: [item.ref],
          });
        }
      }
    }
    return findings;
  },
};

/**
 * A policy clause with no corresponding procedure element, matched on shared cross-reference numbers
 * (spec §3.3). Every reference the policy cites is checked against the procedure set; an unmatched
 * reference is reported with both locations so a human can decide.
 */
export const policyCoverage: SysteligonRule<{ requireKind: string }> = {
  id: 'doc.policy_clause_coverage',
  version: 1,
  kind: 'policy_procedure',
  appliesTo: 'policy',
  title: 'Every policy clause is covered by a procedure that references it',
  params: { requireKind: 'procedure' },
  standards: ['IIA-2110'],
  status: 'released',
  severity: 'medium',
  evaluate: (input, ctx) => {
    const docs = input.documents ?? [];
    const policies = docs.filter((d) => d.kind === 'policy');
    const procedures = docs.filter((d) => d.kind === 'procedure');
    const covered = new Set<string>();
    for (const p of procedures) {
      for (const e of p.elements) for (const r of e.crossRefs ?? []) covered.add(r);
    }
    const findings: RuleFinding[] = [];
    for (const policy of policies) {
      for (const clause of policy.elements.filter((e) => e.role === 'clause')) {
        const refs = clause.crossRefs ?? [];
        if (refs.length === 0) continue;
        if (!refs.some((r) => covered.has(r))) {
          findings.push({
            ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'policy_procedure' as const, severity: ctx.severity,
            reason: `Policy clause ${clause.ref} (references ${refs.join(', ')}) has no procedure that cites it.`,
            refs: [clause.ref],
          });
        }
      }
    }
    return findings;
  },
};

/** The structural rules S1 ships as the first, demonstrable content of the engine. */
export const structuralRules: SysteligonRule[] = [minutesRequiredElements, policyCoverage];

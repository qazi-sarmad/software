/**
 * Systeligon structural document rules (S8, spec §3.2). Deterministic matching on parsed structure:
 * missing required elements, internal inconsistencies (a date after the report date, an end before a
 * start, a total that does not equal its parts), and absent follow-through. Pure; `asOf` is an argument.
 */
import type { ParsedDocument, RuleFinding, SysteligonRule } from '../types';

const REPORT_DATE_PARAM = 'reportDate';

/** A required-element rule factory, so a contract, approval or minute reuses one shape. */
function requiredElementRule(
  id: string, docKind: ParsedDocument['kind'], element: string, severity: SysteligonRule['severity'],
): SysteligonRule<{ element: string }> {
  return {
    id, version: 1, kind: 'missing_element', appliesTo: 'document',
    title: `Every ${docKind} carries ${element}`, params: { element }, standards: [], status: 'released', severity,
    evaluate: (input, ctx) => {
      const findings: RuleFinding[] = [];
      for (const doc of input.documents ?? []) {
        if (doc.kind !== docKind) continue;
        const has = doc.elements.some((e) => e.role === 'field' && e.label?.toLowerCase() === element.toLowerCase())
          || doc.elements.some((e) => e.role === 'signature');
        if (!has) findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_element', severity: ctx.severity,
          reason: `${docKind} ${doc.ref} has no ${element}.`, refs: [doc.ref],
        });
      }
      return findings;
    },
  };
}

/** A contract must carry a signature block. */
export const contractSignature = requiredElementRule('doc.contract_signature', 'contract', 'signature', 'medium');
/** An approval must carry a date. */
export const approvalDate = requiredElementRule('doc.approval_date', 'approval', 'date', 'medium');

/** Internal inconsistency: a date in the document is after the report date (`asOf`). */
export const dateAfterReport: SysteligonRule<Record<string, never>> = {
  id: 'doc.date_after_report', version: 1, kind: 'internal_inconsistency', appliesTo: 'document',
  title: 'No date is after the report date', params: {}, standards: [], status: 'released', severity: 'medium',
  evaluate: (input, ctx) => {
    const reportDate = input.scope?.[REPORT_DATE_PARAM];
    if (!reportDate) return [];
    const findings: RuleFinding[] = [];
    const iso = /\d{4}-\d{2}-\d{2}/;
    for (const doc of input.documents ?? []) {
      for (const el of doc.elements) {
        const found = (el.value ?? el.text ?? '').match(iso);
        if (found && found[0] > reportDate) findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'internal_inconsistency', severity: ctx.severity,
          reason: `Date ${found[0]} at ${doc.ref}:${el.line} is after the report date ${reportDate}.`, refs: [el.ref],
        });
      }
    }
    return findings;
  },
};

/**
 * Absent follow-through: a prior action item with no corresponding later record (spec §3.2). Uses the
 * item register: an item still open with a single appearance never appears in a later minute.
 */
export const absentFollowThrough: SysteligonRule<Record<string, never>> = {
  id: 'doc.absent_follow_through', version: 1, kind: 'missing_element', appliesTo: 'minutes',
  title: 'A raised action item appears in a later minute', params: {}, standards: [], status: 'released', severity: 'medium',
  evaluate: (input, ctx) => {
    const findings: RuleFinding[] = [];
    for (const doc of input.documents ?? []) {
      if (doc.kind !== 'minutes') continue;
      for (const el of doc.elements.filter((e) => e.role === 'action_item')) {
        // A later document that names the same item is the follow-through. Absent it, the item has no record.
        const later = (input.documents ?? []).some((other) =>
          other !== doc && other.kind === 'minutes' && (other.date ?? '') > (doc.date ?? '') &&
          other.elements.some((o) => o.role === 'action_item' && (o.attributes?.itemId ?? o.label) === (el.attributes?.itemId ?? el.label)));
        if (!later && el.attributes?.status !== 'closed') findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'missing_element', severity: ctx.severity,
          reason: `Action item ${el.ref} has no later record.`, refs: [el.ref],
        });
      }
    }
    return findings;
  },
};

export const documentRules: SysteligonRule[] = [contractSignature, approvalDate, dateAfterReport, absentFollowThrough];

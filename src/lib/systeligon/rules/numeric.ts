/**
 * Systeligon numeric forensic rules (spec §3.1, S6). Each rule wraps an already-tested pure check from
 * `analyticsEngine.ts` and gives it the S1 shape: an id, a version, a family, its parameters and IIA
 * standards, and a deterministic `evaluate`.
 *
 * The checks are not duplicated — the arithmetic, thresholds and edge cases live once, in
 * `analyticsEngine`. This module is the adapter that makes them versioned rules with provenance. A
 * change to a check is a new rule version, never an edit that silently re-scores a sealed report.
 */
import {
  checkDuplicates, checkNearDuplicates, checkSequenceGaps, checkOutliersZScore, checkOutliersIqr,
  checkBenfordFirstDigit, checkRoundNumbers, checkWeekendPostings, checkSameUserCreateApprove,
  checkMissingAttributes,
  type PopulationEntry, type CheckResult,
} from '../../analyticsEngine';
import type { RuleFinding, RuleInput, SysteligonRule } from '../types';

/** Project the engine's opaque rows into the shape `analyticsEngine` expects, keeping `ref` on each. */
function toEntries(input: RuleInput): { entries: PopulationEntry[]; refOf: string[] } {
  const refOf = input.rows.map((r) => r.ref);
  const entries = input.rows.map((r, i) => ({
    rowRef: i,
    amount: r.values.amount == null ? null : Number(r.values.amount),
    date: (r.values.date as string | null) ?? null,
    user: (r.values.user as string | null) ?? null,
    approver: (r.values.approver as string | null) ?? null,
    attributes: r.values,
  }));
  return { entries, refOf };
}

/**
 * Turn a CheckResult into findings, one per flagged row, citing the row's `ref`. Benford reports on
 * leading digits (`rowRef` 1..9), not on rows: its reason is self-describing, so it becomes findings
 * with no row refs, one per over-represented digit.
 */
function toFindings(
  def: Pick<SysteligonRule, 'id' | 'version' | 'kind' | 'severity'>, check: CheckResult, refs: string[],
): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const row of check.rows) {
    if (!row.flagged) continue;
    out.push({
      ruleId: def.id, ruleVersion: def.version, kind: def.kind, severity: def.severity,
      reason: row.reason,
      refs: check.checkId === 'benford_first_digit' ? [] : [refs[row.rowRef] ?? String(row.rowRef)],
    });
  }
  return out;
}

/** Build a SysteligonRule around an analytics check. `run` receives the rule's own `params`. */
function wrap<P extends Record<string, unknown>>(
  def: Omit<SysteligonRule<P>, 'evaluate'>,
  run: (entries: PopulationEntry[], params: P) => CheckResult,
): SysteligonRule<P> {
  return {
    ...def,
    evaluate: (input) => {
      const { entries, refOf } = toEntries(input);
      return toFindings(def, run(entries, def.params), refOf);
    },
  };
}

const base = { version: 1, appliesTo: 'population' as const, standards: [] as string[], status: 'released' as const };

export const duplicateRows = wrap<Record<string, never>>(
  { id: 'numeric.duplicates', kind: 'duplicates', title: 'Exact duplicate records', params: {}, severity: 'medium', ...base },
  (entries) => checkDuplicates(entries),
);

export const nearDuplicateRows = wrap<Record<string, never>>(
  { id: 'numeric.near_duplicates', kind: 'near_duplicates', title: 'Near-duplicate postings (same amount and date, different user)', params: {}, severity: 'medium', ...base },
  (entries) => checkNearDuplicates(entries),
);

export const sequenceGaps = wrap<{ attribute: string }>(
  { id: 'numeric.sequence_gaps', kind: 'sequence_gaps', title: 'Gaps in a numeric sequence', params: { attribute: 'seq' }, severity: 'medium', ...base },
  (entries, params) => checkSequenceGaps(entries, params.attribute),
);

export const outliersZScore = wrap<{ threshold: number }>(
  { id: 'numeric.outliers_zscore', kind: 'outliers', title: 'Outliers by z-score', params: { threshold: 3 }, severity: 'low', ...base },
  (entries, params) => checkOutliersZScore(entries, params.threshold),
);

export const outliersIqr = wrap<{ k: number }>(
  { id: 'numeric.outliers_iqr', kind: 'outliers', title: 'Outliers by IQR fence', params: { k: 1.5 }, severity: 'low', ...base },
  (entries, params) => checkOutliersIqr(entries, params.k),
);

export const benfordFirstDigit = wrap<Record<string, never>>(
  { id: 'numeric.benford_first_digit', kind: 'benford', title: "Benford's law first-digit deviation", params: {}, severity: 'medium', ...base },
  (entries) => checkBenfordFirstDigit(entries),
);

export const roundNumbers = wrap<Record<string, never>>(
  { id: 'numeric.round_numbers', kind: 'round_numbers', title: 'Round-number clustering', params: {}, severity: 'low', ...base },
  (entries) => checkRoundNumbers(entries),
);

export const weekendPostings = wrap<{ holidays: string[] }>(
  { id: 'numeric.out_of_hours', kind: 'out_of_hours', title: 'Postings on a weekend or listed holiday', params: { holidays: [] }, severity: 'low', ...base },
  (entries, params) => checkWeekendPostings(entries, params.holidays),
);

export const sameUserCreateApprove = wrap<Record<string, never>>(
  { id: 'numeric.segregation_of_duties', kind: 'segregation_of_duties', title: 'The same user created and approved the record', params: {}, severity: 'high', ...base },
  (entries) => checkSameUserCreateApprove(entries),
);

export const missingAttributes = wrap<{ required: string[] }>(
  { id: 'numeric.missing_attributes', kind: 'missing_attributes', title: 'Missing mandatory attributes', params: { required: [] }, severity: 'low', ...base },
  (entries, params) => checkMissingAttributes(entries, params.required),
);

/** The numeric rules S6 ports into S1's shape. Order is by id once registered, not by this list. */
export const numericRules: SysteligonRule[] = [
  duplicateRows, nearDuplicateRows, sequenceGaps, outliersZScore, outliersIqr,
  benfordFirstDigit, roundNumbers, weekendPostings, sameUserCreateApprove, missingAttributes,
];

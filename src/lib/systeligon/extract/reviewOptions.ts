/**
 * Systeligon document-review options (S7, OA-36). The auditor chooses WHICH reviews to run on the
 * documents they attach; the engine then runs every option they selected, over the whole set — the
 * engine asks, it does not assume.
 *
 * This is the document surface's counterpart to the rule-run scope selector (S1 owns `RuleRunTab`).
 * A rule already declares its `appliesTo` scope (`RuleTarget`); an option bundles the released rules
 * for one scope with the named analysis that scope needs (the action register for minutes, the
 * comparison for policy/procedure/regulation, the declared-shape check for any document).
 *
 * Pure data and pure selectors: no clock, no network, no model. The rules and analyses it names are
 * the ones the engine already ships, so an option cannot promise a review the engine cannot perform.
 */
import type { RuleTarget, SysteligonRule } from '../types';
import { documentRules } from '../rules/documents';
import { minutesRequiredElements, policyCoverage } from '../rules/structural';
import { patternRules } from '../rules/patterns';
import { docTypeRules } from './docType';

/** The named analyses an option may run in addition to its rules. */
export type ReviewAnalysis = 'doc_type' | 'action_register' | 'policy_diff';

export type ReviewOptionId =
  | 'doc_type'
  | 'structural'
  | 'minutes'
  | 'policy'
  | 'patterns';

export interface ReviewOption {
  id: ReviewOptionId;
  label: string;
  /** The scope the option's rules declare, so a run can be filtered and a finding labelled by scope. */
  scope: RuleTarget;
  /** One line for the auditor: what the option checks. */
  description: string;
  /** The released rules the option runs through `runRules`. */
  rules: SysteligonRule[];
  /** The named analysis the option runs alongside its rules, when it has one. */
  analysis?: ReviewAnalysis;
}

/**
 * The review options, in a fixed order. `doc_type` is first because it is the cheapest and the one
 * whose verdict the auditor needs before trusting any other review: a document filed as minutes that
 * reads as a regulation should be flagged before its "missing quorum" is reported.
 */
export const REVIEW_OPTIONS: ReviewOption[] = [
  {
    id: 'doc_type', label: 'Declared-type check', scope: 'document',
    description: 'Check that each document’s declared type matches the shape of its own text.',
    rules: docTypeRules, analysis: 'doc_type',
  },
  {
    id: 'structural', label: 'Structural document rules', scope: 'document',
    description: 'Required elements and internal inconsistencies (a contract with no signature, a date after the report date, absent follow-through).',
    rules: documentRules,
  },
  {
    id: 'minutes', label: 'Minutes and action register', scope: 'minutes',
    description: 'Required minutes elements and the action-item register (carried, vanished, closed with no evidence, reopened).',
    rules: [minutesRequiredElements], analysis: 'action_register',
  },
  {
    id: 'policy', label: 'Policy / procedure comparison', scope: 'policy',
    description: 'A policy clause with no procedure, a procedure with no policy, an uncovered regulation, the same rule stated differently.',
    rules: [policyCoverage], analysis: 'policy_diff',
  },
  {
    id: 'patterns', label: 'Structural pattern rules', scope: 'config',
    description: 'Patterns in the document’s own text: hardcoded credentials, SELECT *, an external call with no error handling, a disabled check.',
    rules: patternRules,
  },
];

/** The id of every option, for a validity check that cannot drift from the table above. */
export const REVIEW_OPTION_IDS: ReviewOptionId[] = REVIEW_OPTIONS.map((o) => o.id);

/** Every option, selected — the "everything, every angle" default the engine runs when asked for all. */
export const ALL_REVIEW_OPTIONS: ReviewOptionId[] = [...REVIEW_OPTION_IDS];

/** Look an option up by id; null when the id is not one the engine ships. */
export function reviewOption(id: ReviewOptionId): ReviewOption | null {
  return REVIEW_OPTIONS.find((o) => o.id === id) ?? null;
}

/**
 * The options a run will perform, from the ids the auditor selected, in the fixed table order and
 * with duplicates and unknown ids dropped. Deterministic: the same selection always yields the same
 * run, and an unknown id is silently absent rather than a crash — the caller decides whether that is
 * worth reporting.
 */
export function resolveReviewOptions(selected: readonly string[]): ReviewOption[] {
  const want = new Set(selected);
  return REVIEW_OPTIONS.filter((o) => want.has(o.id));
}

/** The rules for a set of selected options, de-duplicated by (id, version), in table order. */
export function rulesForOptions(options: readonly ReviewOption[]): SysteligonRule[] {
  const seen = new Set<string>();
  const out: SysteligonRule[] = [];
  for (const o of options) {
    for (const r of o.rules) {
      const key = `${r.id}@${r.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

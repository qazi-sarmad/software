/**
 * Escalation rules and the deterministic recommendation (F12, S6).
 *
 * Pure and deterministic (L1). The recommendation is filled from the event fields by a rule-defined
 * template; there is no AI and no randomness anywhere in this module. It mirrors
 * `escalation_recommendation` in migration 0060, so the editor can preview the same answer the
 * server will store. Nothing here calls the network.
 */

/** One branch of a recommendation template. The first branch whose test matches wins. */
export interface RecommendationBranch {
  /** The event field to test. */
  field?: string;
  /** Match when the field equals this value (case-insensitive). */
  equals?: string;
  /** Match when the field contains this text (case-insensitive). */
  contains?: string;
  /** The recommendation to give when this branch matches. */
  recommend?: string;
  /** The plain reason to record when this branch matches. */
  reason?: string;
  /** On the last branch only: the recommendation when nothing else matched. */
  defaultRecommend?: string;
  /** On the last branch only: the reason when nothing else matched. */
  defaultReason?: string;
}

export type EscalationRecommendation = 'Yes' | 'No' | 'Needs review';

/**
 * Evaluate a recommendation template against an event payload. Mirrors
 * `escalation_recommendation` in SQL: the first matching branch wins; an empty or missing template
 * answers "Needs review" rather than erroring.
 */
export function recommend(
  payload: Record<string, unknown>, template: RecommendationBranch[]
): { recommendation: EscalationRecommendation; reason: string } {
  if (!Array.isArray(template) || template.length === 0) {
    return { recommendation: 'Needs review', reason: 'No recommendation template is configured for this rule.' };
  }

  for (const branch of template) {
    const value = payload[branch.field ?? ''] ?? '';
    const text = String(value).toLowerCase();
    let hit = false;
    if (branch.equals !== undefined) {
      hit = text === branch.equals.toLowerCase();
    } else if (branch.contains !== undefined) {
      hit = text.includes(branch.contains.toLowerCase());
    }
    if (hit) {
      return {
        recommendation: normaliseRecommendation(branch.recommend),
        reason: branch.reason ?? `${branch.field ?? 'the value'} is ${value}.`,
      };
    }
  }

  const last = template[template.length - 1];
  return {
    recommendation: normaliseRecommendation(last.defaultRecommend),
    reason: last.defaultReason ?? 'No rule matched; a person should review this.',
  };
}

function normaliseRecommendation(value: string | undefined): EscalationRecommendation {
  if (value === 'Yes' || value === 'No' || value === 'Needs review') return value;
  return 'Needs review';
}

/** The recommendation values the editor offers, so nobody types a free-text answer (F1). */
export const RECOMMENDATION_OPTIONS: EscalationRecommendation[] = ['Yes', 'No', 'Needs review'];

/** A plain-language sentence for a recommendation branch, for the rule list. */
export function describeBranch(branch: RecommendationBranch): string {
  if (branch.defaultRecommend !== undefined || branch.defaultReason !== undefined) {
    return `Otherwise, recommend ${branch.defaultRecommend ?? 'Needs review'}.`;
  }
  const test = branch.equals !== undefined
    ? `${branch.field} is ${branch.equals}`
    : `${branch.field} contains ${branch.contains}`;
  return `When ${test}, recommend ${branch.recommend ?? 'Needs review'}: ${branch.reason ?? ''}`.trim();
}

/** The seeded platform escalation template keys (F12), so the editor can label them. */
export const PLATFORM_ESCALATION_KEYS = [
  'platform.escalation.high_anomaly',
  'platform.escalation.repeated_anomaly',
  'platform.escalation.overdue_cap',
];

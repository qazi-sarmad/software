/**
 * W2.7: the first-wave phrase library, seeded as DRAFT.
 *
 * Every phrase is human-authored data: a structured condition, a template with typed slots, a
 * claim level, a model scope, a register, a locale, a banned-word list and a status. No phrase is
 * released here; release requires a qualified human (W2.9). Tests that need a released phrase
 * release it inside the test.
 *
 * Each phrase carries its formality variants (F1..F5) at the default tone, active voice. The tone
 * and voice rules (realisation.ts) transform those mechanically, so the whole matrix composes from
 * this one authored set. A section that genuinely cannot differ is declared `registerInvariant` in
 * the model plan.
 */

import type { ClaimLevel, Locale, Phrase, Register, RhetoricalRole } from './types';
import type { PhraseVariants } from './compose';

/** The default register a seed phrase is authored at (standard professional, neutral, active). */
const BASE: Register = { formality: 3, tone: 2, voice: 'active' };

export interface SeedPhraseSpec {
  /** A stable id: `<role>.<locale-independent key>`. */
  id: string;
  role: RhetoricalRole;
  claimLevel: ClaimLevel;
  modelScope: string[];
  /** The template at the base register. `{name}` marks a typed slot. */
  template: string;
  /** The formality variants (F1..F5). F3 defaults to the template. */
  byFormality: Partial<Record<number, string>>;
  /** The passive-voice variants (F1..F5), human-authored. Absent means the voice rule applies. */
  byPassive?: Partial<Record<number, string>>;
  bannedWords?: string[];
}

/**
 * The finding and report phrase families. Each id is `<family>.<n>`; the family names the
 * rhetorical role. The templates use only bound slots, never a typed literal (W2.5).
 */
export const SEED_PHRASE_SPECS: SeedPhraseSpec[] = [
  // --- Condition (what was found) -------------------------------------------------
  {
    id: 'condition.test_exceptions',
    role: 'condition',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'The engagement tested {tests} {test_noun}, of which {exceptions} produced exceptions.',
    byFormality: {
      1: 'We tested {tests} {test_noun}. {exceptions} of them had exceptions.',
      2: 'We tested {tests} {test_noun} and {exceptions} produced exceptions.',
      4: 'The engagement examined {tests} {test_noun} and identified exceptions in {exceptions} instances.',
      5: 'The engagement examined {tests} {test_noun}, drawn from the population described in the scope section, and identified exceptions in {exceptions} instances.',

    }
  },
  {
    id: 'condition.approval_missing',
    role: 'condition',
    claimLevel: 'verified',
    modelScope: [],
    template: '{exceptions} of {tests} payments tested had no evidence of approval.',
    byFormality: {
      1: 'We looked at {tests} payments. {exceptions} of them had no approval.',
      2: 'We tested {tests} payments and found no evidence of approval for {exceptions} of them.',
      4: 'The engagement examined {tests} payments and identified no evidence of approval for {exceptions} of them.',
      5: 'The engagement examined {tests} payments, drawn from the population described in the scope section, and identified no evidence of approval for {exceptions} of them.',

    }
  },
  {
    id: 'condition.control_not_operating',
    role: 'condition',
    claimLevel: 'verified',
    modelScope: [],
    template: 'The control did not operate for {exceptions} of {tests} items tested.',
    byFormality: {
      1: 'We saw the control not work for {exceptions} of {tests} items.',
      2: 'We tested {tests} items and saw the control not operate for {exceptions} of them.',
      4: 'The engagement examined {tests} items and observed the control not operating for {exceptions} of them.',
      5: 'The engagement examined {tests} items and observed that the control did not operate as designed for {exceptions} of them.',

    }
  },

  // --- Criteria (the requirement) -------------------------------------------------
  {
    id: 'criteria.policy_requirement',
    role: 'criteria',
    claimLevel: 'management_asserted',
    modelScope: [],
    template: 'The policy requires that {requirement}.',
    byFormality: {
      1: 'The policy says that {requirement}.',
      2: 'The policy requires that {requirement}.',
      4: 'The policy requires that {requirement}.',
      5: 'The policy, as approved by management, requires that {requirement}.',

    }
  },

  // --- Cause ---------------------------------------------------------------------
  {
    id: 'cause.not_assigned',
    role: 'cause',
    claimLevel: 'unresolved',
    modelScope: [],
    template: 'The responsibility for this step was not assigned to a named owner.',
    byFormality: {
      1: 'Nobody had this step as their job.',
      2: 'Nobody had assigned this step to a named owner.',
      4: 'Management had not assigned responsibility for this step to a named individual.',
      5: 'Management had not assigned responsibility for this control step to a named individual at the date of testing.',

    }
  },

  // --- Effect --------------------------------------------------------------------
  {
    id: 'effect.unapproved_payments',
    role: 'effect',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'Unapproved payments totalling {amount} could be released without detection.',
    byFormality: {
      1: 'The company could release payments worth {amount} with nobody checking.',
      2: 'The company could release payments totalling {amount} without approval.',
      4: 'The company could release payments totalling {amount} without evidence of approval.',
      5: 'The company could release payments totalling {amount} without evidence of approval and without detection by the control.',

    }
  },

  // --- Recommendation ------------------------------------------------------------
  {
    id: 'recommendation.assign_owner',
    role: 'recommendation',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'We recommend that management assigns a named owner to this step and confirms the assignment by {due_date}.',
    byFormality: {
      1: 'We suggest management gives this step to a named person by {due_date}.',
      2: 'We recommend that management assigns a named owner to this step by {due_date}.',
      4: 'We recommend that management assigns responsibility for this step to a named owner and confirms the assignment by {due_date}.',
      5: 'We recommend that management assigns responsibility for this step to a named owner and provides confirmation of the assignment by {due_date}.',

    }
  },

  // --- Management response -------------------------------------------------------
  {
    id: 'management_response.agreed',
    role: 'management_response',
    claimLevel: 'management_asserted',
    modelScope: [],
    template: 'Management agreed to this recommendation and set {due_date} as the date for completion.',
    byFormality: {
      1: 'Management agreed and said it would finish by {due_date}.',
      2: 'Management agreed to the recommendation and planned completion for {due_date}.',
      4: 'Management accepted the recommendation and recorded {due_date} as the planned completion date.',
      5: 'Management accepted the recommendation and recorded {due_date} as the planned date of completion.',

    }
  },

  // --- Status --------------------------------------------------------------------
  {
    id: 'status.open',
    role: 'status',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'This finding remains open at the date of this report.',
    byFormality: {
      1: 'We leave this finding open at the date of this report.',
      2: 'We leave this finding open at the date of this report.',
      4: 'We record this finding as open at the date of this report.',
      5: 'We record this finding as open, and unclosed, at the date of this report.',

    }
  },
  {
    id: 'status.closed',
    role: 'status',
    claimLevel: 'verified',
    modelScope: [],
    template: 'This finding is closed: the agreed action was completed and the evidence was reviewed.',
    byFormality: {
      1: 'We close this finding. The action is done and we checked the evidence.',
      2: 'We close this finding: management completed the action and we reviewed the evidence.',
      4: 'We close this finding. Management completed the agreed action and we reviewed the supporting evidence.',
      5: 'We close this finding. Management completed the agreed action and we examined the supporting evidence.',

    }
  },

  // --- Exception summary ---------------------------------------------------------
  {
    id: 'exception_summary.count',
    role: 'exception_summary',
    claimLevel: 'calculated',
    modelScope: [],
    template: '{exceptions} exceptions were identified across {controls} controls.',
    byFormality: {
      1: 'We found {exceptions} exceptions across {controls} controls.',
      2: 'We identified {exceptions} exceptions across {controls} controls.',
      4: 'We identified exceptions in {exceptions} instances across {controls} controls.',
      5: 'We identified exceptions in {exceptions} instances across the {controls} controls within the scope of this engagement.',

    }
  },

  // --- Coverage ------------------------------------------------------------------
  {
    id: 'coverage.reconciliation',
    role: 'coverage',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'Coverage is reconciled: {findings} findings, {controls} exception controls and {caps} corrective actions each appear exactly once.',
    byFormality: {
      1: 'We reconciled coverage: {findings} findings, {controls} exception controls and {caps} corrective actions, each listed once.',
      2: 'We reconciled coverage: {findings} findings, {controls} exception controls and {caps} corrective actions, each appearing once.',
      4: 'We reconciled coverage. {findings} findings, {controls} exception controls and {caps} corrective actions each appear once.',
      5: 'We reconciled coverage. The {findings} findings, {controls} exception controls and {caps} corrective actions each appear exactly once in this report.',

    }
  },

  // --- Scope ---------------------------------------------------------------------
  {
    id: 'scope.period',
    role: 'scope',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'The engagement covered the period from {start_date} to {end_date}.',
    byFormality: {
      1: 'We looked at the period from {start_date} to {end_date}.',
      2: 'We covered {start_date} to {end_date}.',
      4: 'We covered the period from {start_date} to {end_date}.',
      5: 'We covered the period from {start_date} to {end_date}, inclusive.',

    }
  },

  // --- Limitation -----------------------------------------------------------------
  {
    id: 'limitation.sample_basis',
    role: 'limitation',
    claimLevel: 'calculated',
    modelScope: [],
    template: 'The conclusions are based on a sample of {tests} items and not on the full population.',
    byFormality: {
      1: 'We tested {tests} items, not everything, so the conclusions rest on that sample.',
      2: 'We based the conclusions on a sample of {tests} items, not the full population.',
      4: 'We based the conclusions on a sample of {tests} items rather than on the full population.',
      5: 'We based the conclusions expressed in this report on a sample of {tests} items; they are not, and should not be read as, conclusions on the full population.',

    }
  },

  // --- Alert summary (W11.4, model M12) ------------------------------------------
  {
    id: 'alert_summary.by_rule',
    role: 'alert_summary',
    claimLevel: 'calculated',
    modelScope: ['M12'],
    template: '{alerts} alerts were triggered by {rules} monitor rules in the period.',
    byFormality: {
      1: 'Our monitors fired {alerts} times, from {rules} rules.',
      2: 'Our monitors triggered {alerts} alerts from {rules} rules.',
      4: 'Our monitors triggered {alerts} alerts from {rules} monitor rules during the period.',
      5: 'Our monitors triggered {alerts} alerts from {rules} monitor rules during the period under review.',

    }
  },
  {
    id: 'alert_summary.dispositioned',
    role: 'alert_summary',
    claimLevel: 'calculated',
    modelScope: ['M12'],
    template: 'Of these, {dismissed} were dismissed with a recorded reason and {escalated} were escalated to observations.',
    byFormality: {
      1: 'We dismissed {dismissed} of them with a reason, and {escalated} became observations.',
      2: 'We dismissed {dismissed} of them with a reason and escalated {escalated} to observations.',
      4: 'We dismissed {dismissed} alerts with a recorded reason and escalated {escalated} to observations.',
      5: 'We dismissed {dismissed} alerts with a recorded reason and escalated {escalated} alerts to observations.',

    }
  },

  // --- Numeric summary (register-invariant: a purely numeric line) ----------------
  {
    id: 'numeric_summary.counts',
    role: 'numeric_summary',
    claimLevel: 'calculated',
    modelScope: [],
    template: '{findings} findings; {controls} exception controls; {caps} corrective actions.',
    byFormality: {},
  },

  // --- Lead-in (the calibrated vocabulary is stored here too, W2.6) ---------------
  {
    id: 'lead_in.verified',
    role: 'lead_in',
    claimLevel: 'verified',
    modelScope: [],
    template: 'We confirmed that {statement}.',
    byFormality: { 1: 'We confirmed that {statement}.', 2: 'We confirmed that {statement}.', 3: 'We confirmed that {statement}.', 4: 'It was confirmed that {statement}.', 5: 'The examination confirmed that {statement}.' },
    byPassive: { 1: 'It was confirmed that {statement}.', 2: 'It was confirmed that {statement}.', 3: 'It was confirmed that {statement}.', 4: 'It was confirmed that {statement}.', 5: 'The examination confirmed that {statement}.' },
  },
];

/** Build a phrase row from a seed spec at a locale. */
export function seedPhrase(spec: SeedPhraseSpec, locale: Locale, version = 1): Phrase {
  const template = spec.byFormality[3] ?? spec.template;
  return {
    id: spec.id,
    version,
    condition: { all: [] },
    template,
    claimLevel: spec.claimLevel,
    modelScope: spec.modelScope,
    register: BASE,
    locale,
    bannedWords: spec.bannedWords ?? [],
    status: 'draft',
    bodyHash: '',
  };
}

/**
 * The human-authored passive-voice variants at the default formality (F3). The voice axis is
 * orthogonal to formality and tone (D-W-VOICE): a phrase keeps its formality variant when the
 * register asks for the active voice, and reads this variant when it asks for the passive. The
 * passive form is authored, not transformed, so it always reads as English. Where a phrase has no
 * entry the active variant is used unchanged and the voice rule does not apply.
 */
export const PASSIVE_F3: Record<string, string> = {
  'condition.test_exceptions': '{tests} {test_noun} were examined and exceptions were identified in {exceptions} of them.',
  'condition.approval_missing': '{tests} payments were examined and no evidence of approval was identified for {exceptions} of them.',
  'condition.control_not_operating': '{tests} items were examined and the control was observed not to be operating for {exceptions} of them.',
  'criteria.policy_requirement': 'The policy requires that {requirement}.',
  'cause.not_assigned': 'Responsibility for this step had not been assigned to a named individual.',
  'effect.unapproved_payments': 'Payments totalling {amount} could be released without evidence of approval.',
  'recommendation.assign_owner': 'A named owner is to be assigned to this step by {due_date}.',
  'management_response.agreed': 'The recommendation was accepted and {due_date} was recorded as the planned completion date.',
  'status.open': 'This finding is recorded as open at the date of this report.',
  'status.closed': 'This finding is recorded as closed. The agreed action was completed and the supporting evidence was reviewed.',
  'exception_summary.count': 'Exceptions were identified in {exceptions} instances across {controls} controls.',
  'coverage.reconciliation': 'Coverage was reconciled. {findings} findings, {controls} exception controls and {caps} corrective actions each appear once.',
  'scope.period': 'The period covered ran from {start_date} to {end_date}.',
  'limitation.sample_basis': 'The conclusions were based on a sample of {tests} items rather than on the full population.',
  'alert_summary.by_rule': '{alerts} alerts were triggered by {rules} monitor rules during the period.',
  'alert_summary.dispositioned': '{dismissed} alerts were dismissed with a recorded reason and {escalated} were escalated to observations.',
  'numeric_summary.counts': '{findings} findings; {controls} exception controls; {caps} corrective actions.',
  'lead_in.verified': 'It was confirmed that {statement}.',
};

/** The formality variants of a seed spec, in the composer's shape. */
export function seedVariants(spec: SeedPhraseSpec): PhraseVariants {
  const byFormality: Record<number, string> = {};
  for (const level of [1, 2, 3, 4, 5]) {
    byFormality[level] = spec.byFormality[level] ?? spec.template;
  }
  const byPassive: Record<number, string> = {};
  const authored = spec.byPassive ?? (PASSIVE_F3[spec.id] ? { 3: PASSIVE_F3[spec.id] } : undefined);
  if (authored) {
    // Only the levels a human authored. An unauthored level falls back to the deterministic voice
    // rule (a human-authored verb table), never to the active text.
    for (const level of [1, 2, 3, 4, 5]) {
      if (authored[level] !== undefined) byPassive[level] = authored[level];
    }
  }
  return { byFormality, byPassive };
}

/** All seed phrases for a locale. */
export function seedPhrases(locale: Locale): Phrase[] {
  return SEED_PHRASE_SPECS.map((spec) => seedPhrase(spec, locale));
}

/** All seed variants keyed by phrase id. */
export function seedVariantMap(): Record<string, PhraseVariants> {
  const map: Record<string, PhraseVariants> = {};
  for (const spec of SEED_PHRASE_SPECS) map[spec.id] = seedVariants(spec);
  return map;
}

/** The slots a seed phrase's family expects, so a fixture can supply them. */
export const SEED_SLOT_NAMES: Record<string, string[]> = {
  'condition.test_exceptions': ['tests', 'test_noun', 'exceptions'],
  'condition.approval_missing': ['tests', 'exceptions'],
  'condition.control_not_operating': ['tests', 'exceptions'],
  'criteria.policy_requirement': ['requirement'],
  'cause.not_assigned': [],
  'effect.unapproved_payments': ['amount'],
  'recommendation.assign_owner': ['due_date'],
  'management_response.agreed': ['due_date'],
  'status.open': [],
  'status.closed': [],
  'exception_summary.count': ['exceptions', 'controls'],
  'coverage.reconciliation': ['findings', 'controls', 'caps'],
  'scope.period': ['start_date', 'end_date'],
  'limitation.sample_basis': ['tests'],
  'alert_summary.by_rule': ['alerts', 'rules'],
  'alert_summary.dispositioned': ['dismissed', 'escalated'],
  'numeric_summary.counts': ['findings', 'controls', 'caps'],
  'lead_in.verified': ['statement'],
};

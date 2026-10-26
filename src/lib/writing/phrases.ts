/**
 * W2.1, W2.5, W2.6: the phrase library, slot discipline and calibrated language.
 *
 * A phrase is a structured condition over typed data plus a template with typed slots. It is never
 * code. A released phrase is immutable: releasing is a platform-admin action, and a change creates a
 * new version. This module holds the pure rules; the tables and RPCs live in migration 0089.
 */

import { canonicalise, hashCanonical } from './canonical';
import { renderTemplate, templateSlotNames } from './realise';
import type {
  ClaimLevel, ConditionClause, Locale, Phrase, PhraseCondition, PhraseStatus, Register, Slot,
} from './types';

/** The status lifecycle: draft -> reviewed -> released. A released phrase cannot change. */
export const PHRASE_STATUSES: PhraseStatus[] = ['draft', 'reviewed', 'released'];

export function isPhraseReleased(phrase: Phrase): boolean {
  return phrase.status === 'released';
}

/** The hash of a phrase body. A change to any of these fields changes the hash, so a released
 *  phrase can be shown to have changed (its hash no longer matches) or to be identical. */
export function phraseBody(phrase: Omit<Phrase, 'bodyHash'>): unknown {
  return {
    id: phrase.id,
    version: phrase.version,
    condition: phrase.condition,
    template: phrase.template,
    claimLevel: phrase.claimLevel,
    modelScope: [...phrase.modelScope].sort(),
    register: phrase.register,
    locale: phrase.locale,
    bannedWords: [...phrase.bannedWords].sort(),
    status: phrase.status,
  };
}

export function phraseBodyHash(phrase: Omit<Phrase, 'bodyHash'>): Promise<string> {
  return hashCanonical(phraseBody(phrase) as never);
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Evaluate one clause against typed data. A field absent from the data fails every clause. */
export function clauseMatches(clause: ConditionClause, data: Record<string, unknown>): boolean {
  const actual = data[clause.field];
  if (actual === undefined) return false;
  switch (clause.op) {
    case 'eq': return actual === clause.value;
    case 'ne': return actual !== clause.value;
    case 'gt': return Number(actual) > Number(clause.value);
    case 'gte': return Number(actual) >= Number(clause.value);
    case 'lt': return Number(actual) < Number(clause.value);
    case 'lte': return Number(actual) <= Number(clause.value);
    case 'in': return Array.isArray(clause.value) && clause.value.includes(String(actual));
    case 'contains':
      if (Array.isArray(actual)) return actual.map(String).includes(String(clause.value));
      return String(actual).includes(String(clause.value));
    default: return false;
  }
}

/** A phrase condition holds when every clause holds (a conjunction). */
export function conditionHolds(condition: PhraseCondition, data: Record<string, unknown>): boolean {
  return condition.all.every((clause) => clauseMatches(clause, data));
}

/**
 * Select the released phrase for a claim: the phrase with the claim's phrase id and the report's
 * locale, whose condition holds against the claim's typed data. The register (formality, tone,
 * voice) is applied by the composer from the phrase's human-authored formality variants and the
 * mechanical tone/voice rules, so the library holds one authored base per phrase id rather than one
 * row per cell. A later phrase wins a tie.
 */
export function selectPhrase(
  phrases: Phrase[],
  phraseId: string,
  data: Record<string, unknown>,
  locale: Locale,
  modelId: string,
): Phrase | null {
  let chosen: Phrase | null = null;
  for (const phrase of phrases) {
    if (phrase.id !== phraseId) continue;
    if (phrase.status !== 'released') continue;
    if (phrase.locale !== locale) continue;
    if (phrase.modelScope.length > 0 && !phrase.modelScope.includes(modelId)) continue;
    if (!conditionHolds(phrase.condition, data)) continue;
    chosen = phrase;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// W2.5 Slot discipline
// ---------------------------------------------------------------------------

/**
 * A deterministic claim may carry a number, date or amount only through a bound slot. This lint
 * finds a numeric, date or amount literal typed straight into a template or a rendered claim.
 */
export interface SlotViolation {
  kind: 'number' | 'date' | 'amount';
  text: string;
  index: number;
}

const FREE_NUMBER = /(?<![\w{.])(\d[\d,_]*)(\.\d+)?%?/g;
const FREE_AMOUNT = /[$\u00a3\u20ac]\s?\d[\d,_]*(\.\d+)?/g;
const FREE_DATE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;

/** Find a free numeric, amount or date literal. A token inside `{...}` is a slot, not a literal. */
export function findFreeNumerics(text: string): SlotViolation[] {
  const violations: SlotViolation[] = [];
  // Mask the slot tokens so a `{count}` is not read as a literal.
  const masked = text.replace(/\{[a-z][a-z0-9_]*\}/gi, (m) => '\u0000'.repeat(m.length));
  for (const re of [FREE_AMOUNT, FREE_DATE, FREE_NUMBER]) {
    for (const m of masked.matchAll(re)) {
      const start = m.index ?? 0;
      const raw = text.slice(start, start + m[0].length);
      const kind: SlotViolation['kind'] = re === FREE_AMOUNT ? 'amount'
        : re === FREE_DATE ? 'date' : 'number';
      violations.push({ kind, text: raw, index: start });
    }
  }
  return violations;
}

/** Throw when a template carries a free numeric, date or amount literal. */
export function assertNoFreeNumerics(template: string, label: string): void {
  const violations = findFreeNumerics(template);
  if (violations.length > 0) {
    const first = violations[0];
    throw new Error(`${label}: a free ${first.kind} literal "${first.text}" must be a bound slot`);
  }
}

// ---------------------------------------------------------------------------
// W2.6 Calibrated language
// ---------------------------------------------------------------------------

/**
 * The high-consequence words. A deterministic claim can never produce one. The list is
 * configurable per organisation; the defaults are the words the spec names plus close variants.
 * Locale variants are included so a US rendering cannot smuggle one through.
 */
export const DEFAULT_HIGH_CONSEQUENCE_WORDS = [
  'fraud', 'fraudulent', 'fraudulently',
  'misstatement', 'misstatements', 'misstated', 'misstate',
  'non-compliance', 'noncompliance', 'non-compliant',
  'embezzlement', 'embezzled', 'embezzling',
  'misappropriation', 'misappropriated', 'misappropriate',
  'defalcation',
  'illegal', 'unlawful', 'criminal', 'criminally',
  'bribery', 'bribed', 'corruption', 'corrupt',
  'theft', 'stolen', 'steal',
  'falsified', 'falsification', 'forged', 'forgery',
  'collusion', 'collusive', 'conspiracy',
  'material weakness', 'significant deficiency',
  'guilty', 'liability admitted',
];

export interface CalibratedVocabulary {
  /** The lead-in wording per claim level, per register and locale. Human-authored (W2.6). */
  leadIns: Record<ClaimLevel, Partial<Record<string, string>>>;
  /** The high-consequence words for this organisation. */
  highConsequence: string[];
}

/**
 * The default lead-in vocabulary. A lead-in is fixed wording stored as data, never invented. The
 * key is the register key (`f3-t2-active-en-GB`); a missing key falls back to the standard
 * professional / neutral / active cell.
 */
export const DEFAULT_LEAD_INS: Record<ClaimLevel, Partial<Record<string, string>>> = {
  verified: {
    'f1-t2-active-en-GB': 'We confirmed that',
    'f2-t2-active-en-GB': 'We confirmed that',
    'f3-t2-active-en-GB': 'We confirmed that',
    'f4-t2-active-en-GB': 'It was confirmed that',
    'f5-t2-active-en-GB': 'The examination confirmed that',
    'f3-t2-active-en-US': 'We confirmed that',
    'f4-t2-active-en-US': 'It was confirmed that',
    'f5-t2-active-en-US': 'The examination confirmed that',
    'f4-t2-passive-en-GB': 'It was confirmed that',
    'f5-t2-passive-en-GB': 'The examination confirmed that',
  },
  calculated: {
    // A lead-in must sit grammatically in front of every calculated claim, including a
    // recommendation and a status statement. These cells read correctly before all of them.
    'f1-t2-active-en-GB': 'Our work shows that',
    'f2-t2-active-en-GB': 'Our work shows that',
    'f3-t2-active-en-GB': 'Our work shows that',
    'f4-t2-active-en-GB': 'The work performed shows that',
    'f5-t2-active-en-GB': 'The work performed during this engagement shows that',
    'f3-t2-active-en-US': 'Our work shows that',
    'f4-t2-active-en-US': 'The work performed shows that',
    'f5-t2-active-en-US': 'The work performed during this engagement shows that',
    'f4-t2-passive-en-GB': 'The work performed shows that',
    'f5-t2-passive-en-GB': 'The work performed during this engagement shows that',
  },
  management_asserted: {
    'f1-t2-active-en-GB': 'Management told us that',
    'f2-t2-active-en-GB': 'Management stated that',
    'f3-t2-active-en-GB': 'Management stated that',
    'f4-t2-active-en-GB': 'Management has represented that',
    'f5-t2-active-en-GB': 'Management has represented, and the representation has not been '
      + 'independently verified, that',
    'f3-t2-active-en-US': 'Management stated that',
    'f4-t2-active-en-US': 'Management has represented that',
    'f5-t2-active-en-US': 'Management has represented, and the representation has not been '
      + 'independently verified, that',
    'f4-t2-passive-en-GB': 'It has been represented by management that',
    'f5-t2-passive-en-GB': 'It has been represented by management, without independent '
      + 'verification, that',
  },
  unresolved: {
    'f1-t2-active-en-GB': 'We could not resolve',
    'f2-t2-active-en-GB': 'We could not resolve',
    'f3-t2-active-en-GB': 'The position remains unresolved:',
    'f4-t2-active-en-GB': 'The matter remains unresolved:',
    'f5-t2-active-en-GB': 'The matter remains unresolved at the date of this report:',
    'f3-t2-active-en-US': 'The position remains unresolved:',
    'f4-t2-active-en-US': 'The matter remains unresolved:',
    'f5-t2-active-en-US': 'The matter remains unresolved at the date of this report:',
    'f4-t2-passive-en-GB': 'The matter remains unresolved:',
    'f5-t2-passive-en-GB': 'The matter remains unresolved at the date of this report:',
  },
};

/** The fallback register key: standard professional, neutral, active, en-GB. */
const FALLBACK_KEY = 'f3-t2-active-en-GB';

/** The lead-in for a claim level at a register and locale. Falls back to the default cell. */
export function leadIn(
  vocabulary: CalibratedVocabulary, level: ClaimLevel, registerKey: string,
): string {
  const byRegister = vocabulary.leadIns[level] ?? {};
  return byRegister[registerKey] ?? byRegister[FALLBACK_KEY] ?? '';
}

/**
 * Find a high-consequence word in text. Case-insensitive, whole-word (so "fraudulent" is caught as
 * its own entry and "defrauded" is not caught by "fraud" alone unless it is listed).
 */
export function findHighConsequenceWords(text: string, words: string[]): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const word of words) {
    const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A hyphenated or spaced term matches as written; a single word matches on a word boundary.
    const pattern = /[\s-]/.test(word) ? new RegExp(escaped, 'g') : new RegExp(`\\b${escaped}\\b`, 'g');
    if (pattern.test(lower)) found.add(word);
  }
  return [...found];
}

/**
 * The ban is enforced twice: by the lint and by the freeze. A deterministic claim that would
 * produce a high-consequence word is refused. Auditor text is flagged, never blocked (W5.4).
 */
export function assertNoHighConsequence(text: string, words: string[], label: string): void {
  const found = findHighConsequenceWords(text, words);
  if (found.length > 0) {
    throw new Error(`${label}: high-consequence wording "${found[0]}" cannot be produced by a `
      + 'deterministic claim; use auditor text instead');
  }
}

// ---------------------------------------------------------------------------
// The canonical form of a phrase (for the review workbook and the matrix test)
// ---------------------------------------------------------------------------

/** A rendered sample of a phrase, for the review workbook (W2.9). */
export function phraseSampleText(phrase: Phrase, slots: Slot[], ctx: Parameters<typeof renderTemplate>[2]): string {
  return renderTemplate(phrase.template, slots, ctx);
}

export { templateSlotNames, canonicalise };

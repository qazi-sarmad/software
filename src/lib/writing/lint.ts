/**
 * W9.1: style rules as data.
 *
 * Every rule has an id, a severity, a rationale and fixtures. The lint is advisory except where the
 * spec makes a rule blocking. Readability metrics are stated formulas (Flesch reading ease and
 * Flesch-Kincaid grade), tested against known values. The existing readability check (spec §14.3,
 * migration 0030) is a completeness check on the four mandatory roles; this lint is wired to report
 * that check rather than duplicating it.
 *
 * The lint never rewrites text and never suggests wording: it names a rule, a location and a reason.
 */

export type LintSeverity = 'blocking' | 'advisory' | 'info';

export interface StyleRule {
  id: string;
  severity: LintSeverity;
  rationale: string;
  /** The formality levels the rule applies to; absent means every level. */
  formalities?: number[];
}

export const STYLE_RULES: StyleRule[] = [
  { id: 'sentence.max_length', severity: 'advisory', rationale: 'A long sentence is hard to read; keep it to the declared maximum.' },
  { id: 'voice.passive', severity: 'advisory', rationale: 'Active voice names who does what.' },
  { id: 'term.banned', severity: 'blocking', rationale: 'A high-consequence word cannot appear in a deterministic claim.' },
  { id: 'term.preferred', severity: 'advisory', rationale: 'A preferred term is clearer than the alternative.' },
  { id: 'abbrev.first_use', severity: 'advisory', rationale: 'An abbreviation is expanded the first time it is used.' },
  { id: 'acronym.glossary', severity: 'advisory', rationale: 'Every acronym appears in the glossary.' },
  { id: 'number.consistent', severity: 'advisory', rationale: 'Numbers use one format throughout the report.' },
  { id: 'tense.per_section', severity: 'advisory', rationale: 'A section keeps one tense.' },
  { id: 'locale.spelling', severity: 'blocking', rationale: 'en-GB output carries no US-only spelling and en-US output carries no UK-only spelling.' },
  { id: 'slot.free_numeric', severity: 'blocking', rationale: 'A deterministic claim carries a number only through a bound slot.' },
];

export interface LintFinding {
  ruleId: string;
  severity: LintSeverity;
  /** The claim or phrase the finding is about. */
  subject: string;
  message: string;
  /** The offending text or token, for the reader to act on. */
  evidence: string;
}

export interface LintInput {
  /** One entry per rendered claim: its id and text. */
  sentences: Array<{ id: string; text: string }>;
  formality: number;
  locale: 'en-GB' | 'en-US';
  /** The maximum sentence length for the section and formality. */
  maxSentenceLength: number;
  /** The high-consequence words that can never appear in a deterministic claim. */
  bannedWords: string[];
  /** A preferred-term map: the alternative -> the preferred term. */
  preferredTerms?: Record<string, string>;
  /** The glossary of acronyms the report declares. */
  acronyms?: string[];
  /** The number format the report declares, for the consistency rule. */
  numberFormat?: { grouping: boolean; decimalSeparator: string };
  /** A locale lint callback: returns the US-only or UK-only spellings found in the text. */
  localeSpellings: (text: string, locale: 'en-GB' | 'en-US') => string[];
  /** A free-numeric detector for a rendered sentence. */
  freeNumerics: (text: string) => string[];
}

const PASSIVE = /\b(?:was|were|is|are|been|being|be)\s+\w+(?:ed|en)\b/i;

/** Count words: whitespace-separated tokens, ignoring pure punctuation. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/**
 * Flesch reading ease. The stated formula: 206.835 - 1.015 * (words / sentences) - 84.6 *
 * (syllables / words). Syllables are counted by vowel groups, which is the standard deterministic
 * approximation, and a word has at least one syllable.
 */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  const groups = clean.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (clean.endsWith('e') && n > 1 && !clean.endsWith('le')) n -= 1;
  return Math.max(1, n);
}

export function fleschReadingEase(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length || 1);
  const words = text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (words.length === 0) return 0;
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
}

export function fleschKincaidGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length || 1);
  const words = text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (words.length === 0) return 0;
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

/** The order a lint finding is reported in: blocking first, then advisory, then info; then by rule. */
const SEVERITY_ORDER: Record<LintSeverity, number> = { blocking: 0, advisory: 1, info: 2 };

export function lintReport(input: LintInput): LintFinding[] {
  const findings: LintFinding[] = [];
  const banned = input.bannedWords.map((w) => w.toLowerCase());

  for (const sentence of input.sentences) {
    const text = sentence.text;
    const lower = text.toLowerCase();

    if (wordCount(text) > input.maxSentenceLength) {
      findings.push({ ruleId: 'sentence.max_length', severity: 'advisory', subject: sentence.id,
        message: `the sentence has ${wordCount(text)} words, more than the maximum ${input.maxSentenceLength}`,
        evidence: text.slice(0, 80) });
    }

    if (PASSIVE.test(text)) {
      findings.push({ ruleId: 'voice.passive', severity: 'advisory', subject: sentence.id,
        message: 'the sentence uses a passive construction', evidence: text.slice(0, 80) });
    }

    for (const word of banned) {
      if (lower.includes(word)) {
        findings.push({ ruleId: 'term.banned', severity: 'blocking', subject: sentence.id,
          message: `the high-consequence word "${word}" cannot appear in a deterministic claim`, evidence: word });
      }
    }

    for (const [alt, preferred] of Object.entries(input.preferredTerms ?? {})) {
      if (lower.includes(alt.toLowerCase())) {
        findings.push({ ruleId: 'term.preferred', severity: 'advisory', subject: sentence.id,
          message: `prefer "${preferred}" over "${alt}"`, evidence: alt });
      }
    }

    for (const acr of input.acronyms ?? []) {
      const re = new RegExp(`\\b${acr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (re.test(text) && !new RegExp(`\\(${acr}\\)`).test(text)) {
        findings.push({ ruleId: 'abbrev.first_use', severity: 'advisory', subject: sentence.id,
          message: `expand the acronym ${acr} at first use`, evidence: acr });
      }
    }

    for (const bad of input.localeSpellings(text, input.locale)) {
      findings.push({ ruleId: 'locale.spelling', severity: 'blocking', subject: sentence.id,
        message: `the spelling "${bad}" does not belong in ${input.locale}`, evidence: bad });
    }

    for (const literal of input.freeNumerics(text)) {
      findings.push({ ruleId: 'slot.free_numeric', severity: 'blocking', subject: sentence.id,
        message: `the numeric literal "${literal}" must come through a bound slot`, evidence: literal });
    }
  }

  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)
    || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
  return findings;
}

/** A lint run is blocked when any finding is blocking. */
export function lintBlocks(findings: LintFinding[]): boolean {
  return findings.some((f) => f.severity === 'blocking');
}

// ---------------------------------------------------------------------------
// W9.2: guided intake.
// ---------------------------------------------------------------------------

/** The facts a finding needs before an observation can be submitted for approval (spec §14.3). */
export const REQUIRED_INTAKE_SLOTS = ['context', 'condition', 'effect', 'risk'] as const;
export type IntakeSlot = typeof REQUIRED_INTAKE_SLOTS[number] | 'criteria' | 'cause' | 'recommendation';

export interface IntakeField {
  slot: IntakeSlot;
  prompt: string;
  /** Required by the methodology, or only where the organisation requires it. */
  required: boolean;
  help?: string;
}

/** The guided intake: structured prompts and checklists. It never suggests wording. */
export function intakeFields(requireCauseCriteriaRecommendation: boolean): IntakeField[] {
  const fields: IntakeField[] = [
    { slot: 'context', prompt: 'Which area does this concern, and why does it matter?', required: true },
    { slot: 'condition', prompt: 'What was found?', required: true },
    { slot: 'effect', prompt: 'What does it lead to?', required: true },
    { slot: 'risk', prompt: 'What could go wrong?', required: true },
  ];
  const optional: IntakeField[] = [
    { slot: 'criteria', prompt: 'What should have happened?', required: requireCauseCriteriaRecommendation },
    { slot: 'cause', prompt: 'Why did it happen?', required: requireCauseCriteriaRecommendation },
    { slot: 'recommendation', prompt: 'What should change?', required: requireCauseCriteriaRecommendation },
  ];
  return [...fields, ...optional];
}

export interface IntakeAnswers {
  [slot: string]: string | undefined;
}

export interface IntakeCompleteness {
  filled: number;
  total: number;
  percent: number;
  missing: IntakeSlot[];
}

/**
 * The completeness indicator: the share of required slots that carry a non-empty answer. Derived
 * from the slots, never from the wording.
 */
export function intakeCompleteness(answers: IntakeAnswers, requireCauseCriteriaRecommendation: boolean): IntakeCompleteness {
  const fields = intakeFields(requireCauseCriteriaRecommendation);
  const required = fields.filter((f) => f.required);
  const missing = required.filter((f) => !(answers[f.slot] ?? '').trim()).map((f) => f.slot);
  const filled = required.length - missing.length;
  return {
    filled,
    total: required.length,
    percent: required.length === 0 ? 100 : Math.round((filled / required.length) * 100),
    missing,
  };
}

/** An observation may be submitted for approval only when every required slot is filled. */
export function canSubmitForApproval(answers: IntakeAnswers, requireCauseCriteriaRecommendation: boolean): boolean {
  return intakeCompleteness(answers, requireCauseCriteriaRecommendation).missing.length === 0;
}

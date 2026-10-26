/**
 * W2.4 (continued): surface realisation. The register transform that turns a phrase's human-authored
 * formality variants into the exact sentence for one cell of the matrix (formality, tone, voice,
 * locale).
 *
 * This is a RULE engine over human-authored data, not generation:
 *   - the formality variants are human-authored sentences (one per formality level);
 *   - the tone rule swaps declared evaluative words and connectives (human-authored data);
 *   - the voice rule is an active-to-passive transform driven by a human-authored verb table;
 *   - the locale rule applies the spelling lexicon and the date/number forms.
 *
 * Every rule family is a pure function and is covered by its own tests. No rule can change a slot
 * value, a figure or a reference: they operate on the wording around them.
 */

import { VARIANTS } from './locale';
import type { Formality, Locale, Register, Tone } from './types';

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

export interface ToneRule {
  tone: Tone;
  /** Words replaced at this tone, applied whole-word and case-insensitively. */
  replacements: Array<{ from: string; to: string }>;
  /** An optional connective inserted before the first sentence. */
  lead?: string;
}

/**
 * The tone vocabulary. Tone changes emphasis and word choice only; it never touches a fact. Each
 * pair is human-authored; the transform is mechanical.
 */
export const TONE_RULES: Record<Tone, ToneRule> = {
  1: {
    tone: 1,
    replacements: [
      { from: 'did not operate', to: 'can be strengthened' },
      { from: 'failed', to: 'did not yet meet the requirement' },
      { from: 'deficiency', to: 'improvement opportunity' },
      { from: 'must', to: 'should' },
    ],
  },
  2: { tone: 2, replacements: [] },
  3: {
    tone: 3,
    replacements: [
      { from: 'did not yet meet the requirement', to: 'did not operate' },
      { from: 'improvement opportunity', to: 'gap' },
      { from: 'can be strengthened', to: 'did not operate' },
    ],
  },
  4: {
    tone: 4,
    replacements: [
      { from: 'should', to: 'must' },
      { from: 'can be strengthened', to: 'must be corrected' },
      { from: 'gap', to: 'control gap' },
    ],
  },
  5: {
    tone: 5,
    replacements: [
      { from: 'should', to: 'must' },
      { from: 'can be strengthened', to: 'must be corrected immediately' },
      { from: 'gap', to: 'control gap requiring immediate action' },
      { from: 'must', to: 'must, without delay,' },
    ],
  },
};

/** Apply a tone rule to a sentence. Whole-word, case-insensitive. */
export function applyTone(text: string, tone: Tone): string {
  const rule = TONE_RULES[tone];
  let out = text;
  for (const { from, to } of rule.replacements) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match) =>
      match[0] === match[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Voice (active -> passive)
// ---------------------------------------------------------------------------

/** A verb entry: the active form and its passive participle. Human-authored. */
export interface VerbEntry {
  /** The active past-tense form as it appears in a template, e.g. "tested". */
  active: string;
  /** The past participle, e.g. "tested". */
  participle: string;
  /** True when the verb takes "by" in the passive ("was tested by the auditor"). */
  takesBy: boolean;
}

/**
 * The verb table. The passive transform is: "<subject> <aux> <participle> [by <agent>]". The table
 * is human-authored; the transform is a fixed rule. Where a template's verb is absent the sentence
 * is returned unchanged and the phrase is expected to carry a passive variant instead.
 */
export const VERBS: VerbEntry[] = [
  { active: 'tested', participle: 'tested', takesBy: true },
  { active: 'examined', participle: 'examined', takesBy: true },
  { active: 'identified', participle: 'identified', takesBy: true },
  { active: 'found', participle: 'found', takesBy: true },
  { active: 'observed', participle: 'observed', takesBy: true },
  { active: 'reviewed', participle: 'reviewed', takesBy: true },
  { active: 'selected', participle: 'selected', takesBy: true },
  { active: 'assessed', participle: 'assessed', takesBy: true },
  { active: 'evaluated', participle: 'evaluated', takesBy: true },
  { active: 'documented', participle: 'documented', takesBy: true },
  { active: 'approved', participle: 'approved', takesBy: true },
  { active: 'reconciled', participle: 'reconciled', takesBy: true },
  { active: 'confirmed', participle: 'confirmed', takesBy: true },
  { active: 'measured', participle: 'measured', takesBy: true },
  { active: 'calculated', participle: 'calculated', takesBy: true },
];

export function verbFor(active: string): VerbEntry | undefined {
  const lower = active.toLowerCase();
  return VERBS.find((v) => v.active === lower);
}

/**
 * Transform an active sentence to the passive where the rule applies. The pattern recognised is
 * "we <verb> <object>" and "the <agent> <verb> <object>": the object becomes the subject and the
 * agent moves behind "by". Where the pattern is not recognised the sentence is unchanged.
 */
export function toPassive(text: string): string {
  const we = /^we\s+([a-z]+)\s+(.*)$/i.exec(text);
  if (we) {
    const verb = verbFor(we[1]);
    if (verb) {
      const object = we[2].replace(/\.$/, '');
      return `${capitaliseFirst(object)} ${auxiliary(object)} ${verb.participle}.`;
    }
  }
  const named = /^(the\s+[a-z ]+?)\s+([a-z]+)\s+(.*)$/i.exec(text);
  if (named) {
    const verb = verbFor(named[2]);
    if (verb && verb.takesBy) {
      const object = named[3].replace(/\.$/, '');
      return `${capitaliseFirst(object)} ${auxiliary(object)} ${verb.participle} by ${named[1]}.`;
    }
  }
  return text;
}

function capitaliseFirst(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "was" for a singular object, "were" for a plural one. A count before the noun decides. */
function auxiliary(object: string): string {
  const plural = /\b(\d+|several|many|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(object)
    && !/\b(\d+|one)\b\s+\w+$/i.test(object.split(' ').slice(0, 3).join(' ') + ' x');
  return plural ? 'were' : 'was';
}

// ---------------------------------------------------------------------------
// Locale spelling
// ---------------------------------------------------------------------------

const VARIANT_INDEX = (() => {
  const gbToUs = new Map<string, string>();
  const usToGb = new Map<string, string>();
  for (const pair of VARIANTS) {
    gbToUs.set(pair.gb.toLowerCase(), pair.us);
    usToGb.set(pair.us.toLowerCase(), pair.gb);
  }
  return { gbToUs, usToGb };
})();

/**
 * Apply the locale spelling rule. For en-US every en-GB form becomes the en-US form; for en-GB
 * every en-US form becomes the en-GB form. Proper nouns and quoted client text are exempt and are
 * handled by the lint's documented exception list, not here.
 */
export function applyLocaleSpelling(text: string, locale: Locale): string {
  const map = locale === 'en-US' ? VARIANT_INDEX.gbToUs : VARIANT_INDEX.usToGb;
  // Match words, including multi-word entries ("annual leave") by trying the longest first.
  const multiWord = [...map.keys()].filter((k) => k.includes(' ')).sort((a, b) => b.length - a.length);
  let out = text;
  for (const phrase of multiWord) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (m) => matchCase(map.get(phrase)!, m));
  }
  out = out.replace(/\b([A-Za-z][A-Za-z'-]*)\b/g, (word) => {
    const mapped = map.get(word.toLowerCase());
    return mapped ? matchCase(mapped, word) : word;
  });
  return out;
}

function matchCase(replacement: string, original: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** Find a US-only spelling in en-GB text or a UK-only spelling in en-US text (the W2.3 lint). */
export function findWrongLocaleSpelling(text: string, locale: Locale): string[] {
  const wrongMap = locale === 'en-GB' ? VARIANT_INDEX.usToGb : VARIANT_INDEX.gbToUs;
  const found: string[] = [];
  for (const word of text.match(/\b[A-Za-z][A-Za-z'-]*\b/g) ?? []) {
    if (wrongMap.has(word.toLowerCase())) found.push(word);
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// The composed transform
// ---------------------------------------------------------------------------

export interface RealisationInput {
  /** The phrase's human-authored formality variant (at tone 2, active, en-GB). */
  formalityVariant: string;
  /** An optional human-authored override for this exact tone, replacing the tone rule. */
  toneOverride?: string;
  /** An optional human-authored passive variant, replacing the voice rule. */
  passiveOverride?: string;
  register: Register;
  locale: Locale;
}

/**
 * Realise one sentence: formality variant -> tone -> voice -> locale. Deterministic and pure.
 * A section declared register-invariant skips this entirely (its text is numeric).
 */
export function realise(input: RealisationInput): string {
  let text = input.formalityVariant;
  text = input.toneOverride ?? applyTone(text, input.register.tone);
  if (input.register.voice === 'passive') {
    text = input.passiveOverride ?? toPassive(text);
  }
  text = applyLocaleSpelling(text, input.locale);
  return text;
}

/** The formality of a register, for choosing the variant. */
export function formalityOf(register: Register): Formality {
  return register.formality;
}

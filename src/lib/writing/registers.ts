/**
 * W2.2: the registers. Five formality levels, five tone levels and two voices (active, passive).
 *
 * A register changes how a claim is WORDED. It never changes a fact, a figure, a claim level, a
 * reference, a severity or a required action, and it can never produce a high-consequence word.
 * The invariant is proved by test: the graph root is identical across the whole matrix, and only
 * the render hash changes.
 *
 * Every phrase variant is human-authored (W2.7). This module holds the definitions and the fixed
 * vocabulary; it never composes wording.
 */

import type { Formality, Register, Tone, Voice } from './types';

export const FORMALITY_LEVELS: Formality[] = [1, 2, 3, 4, 5];
export const TONE_LEVELS: Tone[] = [1, 2, 3, 4, 5];
export const VOICES: Voice[] = ['active', 'passive'];

export const DEFAULT_REGISTER: Register = { formality: 3, tone: 2, voice: 'active' };

export interface FormalityDefinition {
  level: Formality;
  name: string;
  /** A written definition, quoted in docs/WRITE-REGISTERS.md. */
  definition: string;
  /** An example sentence in this formality at the default tone. */
  example: string;
}

export const FORMALITY_DEFINITIONS: Record<Formality, FormalityDefinition> = {
  1: {
    level: 1,
    name: 'Plain and conversational',
    definition: 'Short words and active voice. Says "we found". A reader with no audit background '
      + 'understands it on the first read.',
    example: 'We tested 40 payments. Three of them had no approval.',
  },
  2: {
    level: 2,
    name: 'Friendly professional',
    definition: 'Everyday professional English. Contractions are avoided, but the sentence stays '
      + 'short and direct.',
    example: 'We tested 40 payments and found that three had no approval.',
  },
  3: {
    level: 3,
    name: 'Standard professional',
    definition: 'The default. Complete sentences, standard audit vocabulary, no informal words.',
    example: 'The engagement tested 40 payments, of which three had no evidence of approval.',
  },
  4: {
    level: 4,
    name: 'Formal',
    definition: 'Complete sentences, impersonal constructions, defined terms used consistently.',
    example: 'A sample of 40 payments was examined. In three instances, no evidence of approval '
      + 'was identified.',
  },
  5: {
    level: 5,
    name: 'Board and regulatory formal',
    definition: 'Fully formal, precise, qualified statements. Every figure is qualified by its '
      + 'scope and its basis.',
    example: 'The examination of a sample of 40 payments, drawn from the population described in '
      + 'the scope section, identified three instances for which evidence of approval was not '
      + 'available at the time of testing.',
  },
};

export interface ToneDefinition {
  level: Tone;
  name: string;
  definition: string;
  example: string;
}

export const TONE_DEFINITIONS: Record<Tone, ToneDefinition> = {
  1: {
    level: 1,
    name: 'Constructive and supportive',
    definition: 'Frames the finding as an opportunity and acknowledges the effort already made. '
      + 'Never softens a fact.',
    example: 'The control is close to working: three payments slipped past the approval step.',
  },
  2: {
    level: 2,
    name: 'Neutral and factual',
    definition: 'The default. States the position without evaluative words.',
    example: 'Three of the 40 payments tested had no evidence of approval.',
  },
  3: {
    level: 3,
    name: 'Direct',
    definition: 'States the gap plainly, without cushioning.',
    example: 'The approval control did not operate for three of the 40 payments tested.',
  },
  4: {
    level: 4,
    name: 'Firm',
    definition: 'Stresses the obligation and the deadline.',
    example: 'The approval control must be corrected for the three payments identified, by the '
      + 'date agreed in the action plan.',
  },
  5: {
    level: 5,
    name: 'Urgent',
    definition: 'Stresses time-critical exposure and the action required immediately.',
    example: 'Three payments bypassed approval. The gap must be closed immediately, before the '
      + 'next payment run.',
  },
};

export interface VoiceDefinition {
  voice: Voice;
  name: string;
  definition: string;
  example: string;
}

export const VOICE_DEFINITIONS: Record<Voice, VoiceDefinition> = {
  active: {
    voice: 'active',
    name: 'Active',
    definition: 'The actor is the subject: "we tested the payments".',
    example: 'We tested 40 payments.',
  },
  passive: {
    voice: 'passive',
    name: 'Passive',
    definition: 'The object is the subject: "the payments were tested". Used where the actor is '
      + 'unknown or immaterial.',
    example: 'A sample of 40 payments was tested.',
  },
};

/** The variant key used to select a phrase variant: formality, tone, voice, locale. */
export function registerKey(register: Register, locale: string): string {
  return `f${register.formality}-t${register.tone}-${register.voice}-${locale}`;
}

/** The full matrix: 5 formality x 5 tone x 2 voice x 2 locale = 100 cells. */
export function registerMatrix(): Array<{ register: Register; locale: 'en-GB' | 'en-US' }> {
  const out: Array<{ register: Register; locale: 'en-GB' | 'en-US' }> = [];
  for (const formality of FORMALITY_LEVELS) {
    for (const tone of TONE_LEVELS) {
      for (const voice of VOICES) {
        for (const locale of ['en-GB', 'en-US'] as const) {
          out.push({ register: { formality, tone, voice }, locale });
        }
      }
    }
  }
  return out;
}

export function isRegister(value: unknown): value is Register {
  if (!value || typeof value !== 'object') return false;
  const r = value as Register;
  return FORMALITY_LEVELS.includes(r.formality)
    && TONE_LEVELS.includes(r.tone)
    && VOICES.includes(r.voice);
}

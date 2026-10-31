/**
 * Test fixtures for the writing engine. Deterministic, fixed data: no clock, no random source.
 * The same fixture is used across the tests, the matrix-completeness check and the golden renders.
 */

import { decimal } from './canonical';
import { DEFAULT_REGISTER } from './registers';
import { SEED_PHRASE_SPECS, seedVariantMap } from './seedPhrases';
import type {
  Claim, ClaimGraph, EngineVersion, Locale, Reference, Register, Slot,
} from './types';
import type { CalibratedVocabulary } from './phrases';
import type { PhraseVariants } from './compose';
import { DEFAULT_HIGH_CONSEQUENCE_WORDS, DEFAULT_LEAD_INS } from './phrases';

export const ENGINE_VERSION: EngineVersion = {
  engine: '1.0.0', template: 'M1@1', phraseLibrary: '1.0.0',
};

export const FIXED_TIMESTAMP = '2026-10-25T09:00:00Z';

export const TEST_VOCABULARY: CalibratedVocabulary = {
  leadIns: DEFAULT_LEAD_INS,
  highConsequence: DEFAULT_HIGH_CONSEQUENCE_WORDS,
};

/** A reference with a fixed content hash, for the fixture claims. */
export function ref(type: string, id: string, seed = 'a'): Reference {
  return { type, id, contentHash: seed.repeat(64).slice(0, 64) };
}

function slots(pairs: Array<[string, Slot['kind'], Slot['value']]>): Slot[] {
  return pairs.map(([name, kind, value]) => ({ name, kind, value }));
}

/** The fixture claims: one per seed phrase that a full engagement report needs. */
export function fixtureClaims(modelId = 'M1'): Claim[] {
  const base = (id: string, sectionId: string, phraseId: string, phraseVersion: number,
    claimSlots: Slot[], extra: Partial<Claim> = {}): Claim => ({
    id,
    kind: 'calculated',
    claimLevel: 'calculated',
    slots: claimSlots,
    phraseId,
    phraseVersion,
    ruleId: `${phraseId}.rule`,
    ruleVersion: 1,
    references: [ref('finding', `${id}-f1`)],
    figures: [],
    modelId,
    sectionId,
    approval: null,
    ...extra,
  });

  return [
    base('c-scope', 'scope', 'scope.period', 1, slots([
      ['start_date', 'date', '2026-01-01'],
      ['end_date', 'date', '2026-09-30'],
    ])),
    base('c-exceptions', 'exec', 'exception_summary.count', 1, slots([
      ['exceptions', 'count', 3],
      ['controls', 'count', 40],
    ])),
    base('c-condition', 'findings', 'condition.test_exceptions', 1, slots([
      ['tests', 'count', 40],
      ['test_noun', 'text', 'payments'],
      ['exceptions', 'count', 3],
    ])),
    base('c-approval', 'findings', 'condition.approval_missing', 1, slots([
      ['tests', 'count', 40],
      ['exceptions', 'count', 3],
    ])),
    base('c-effect', 'findings', 'effect.unapproved_payments', 1, slots([
      ['amount', 'money', decimal('1250000', 2)],
    ])),
    base('c-cause', 'findings', 'cause.not_assigned', 1, []),
    base('c-recommendation', 'findings', 'recommendation.assign_owner', 1, slots([
      ['due_date', 'date', '2026-12-31'],
    ])),
    base('c-response', 'findings', 'management_response.agreed', 1, slots([
      ['due_date', 'date', '2026-12-31'],
    ])),
    base('c-status', 'findings', 'status.open', 1, []),
    base('c-coverage', 'coverage', 'coverage.reconciliation', 1, slots([
      ['findings', 'count', 5],
      ['controls', 'count', 40],
      ['caps', 'count', 4],
    ])),
    base('c-limitation', 'scope', 'limitation.sample_basis', 1, slots([
      ['tests', 'count', 40],
    ])),
    base('c-numeric', 'appendices', 'numeric_summary.counts', 1, slots([
      ['findings', 'count', 5],
      ['controls', 'count', 40],
      ['caps', 'count', 4],
    ])),
    // An auditor-text claim: the wording is the auditor's own.
    {
      ...base('c-auditor', 'findings', 'auditor.text', 1, []),
      kind: 'auditor',
      claimLevel: 'management_asserted',
      auditorText: 'The auditor notes that the process owner has agreed the timetable in writing.',
      auditorAuthor: 'Auditor One',
      auditorAt: FIXED_TIMESTAMP,
      approval: {
        observationId: 'obs-1', approvedBy: 'manager-1', approvedAt: FIXED_TIMESTAMP,
        observationVersion: 2, contentHash: 'b'.repeat(64),
      },
    },
  ];
}

export function fixtureGraph(register: Register = DEFAULT_REGISTER, locale: Locale = 'en-GB',
  modelId = 'M1'): ClaimGraph {
  return { modelId, register, locale, claims: fixtureClaims(modelId), versions: ENGINE_VERSION };
}

/** All seed phrase specs, as a released phrase list for the matrix test. */
export function releasedSeedPhrases(): import('./types').Phrase[] {
  return SEED_PHRASE_SPECS.flatMap((spec) =>
    (['en-GB', 'en-US'] as Locale[]).map((locale) => ({
      id: spec.id,
      version: 1,
      condition: { all: [] },
      template: spec.byFormality[3] ?? spec.template,
      claimLevel: spec.claimLevel,
      modelScope: spec.modelScope,
      register: DEFAULT_REGISTER,
      locale,
      bannedWords: spec.bannedWords ?? [],
      status: 'released' as const,
      bodyHash: '',
    })));
}

export function fixtureVariants(): Record<string, PhraseVariants> {
  return seedVariantMap();
}

export const FIXTURE_FORMAT = {
  scale: 2,
  rounding: 'half_up' as const,
  grouping: true,
  currencySymbol: '\u00a3',
};

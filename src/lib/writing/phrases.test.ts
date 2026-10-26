import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HIGH_CONSEQUENCE_WORDS, DEFAULT_LEAD_INS, PHRASE_STATUSES, assertNoFreeNumerics,
  assertNoHighConsequence, clauseMatches, conditionHolds, findFreeNumerics,
  findHighConsequenceWords, isPhraseReleased, leadIn, phraseBody, phraseBodyHash, selectPhrase,
} from './phrases';
import { DEFAULT_REGISTER } from './registers';
import { TEST_VOCABULARY } from './fixtures';
import type { Phrase, PhraseCondition } from './types';

function phrase(over: Partial<Phrase> = {}): Phrase {
  return {
    id: 'condition.test_exceptions',
    version: 1,
    condition: { all: [] },
    template: 'We tested {tests} {test_noun} and found {exceptions} with exceptions.',
    claimLevel: 'calculated',
    modelScope: [],
    register: DEFAULT_REGISTER,
    locale: 'en-GB',
    bannedWords: [],
    status: 'released',
    bodyHash: '',
    ...over,
  };
}

describe('W2.1 the phrase lifecycle and body hash', () => {
  it('has the closed status list draft -> reviewed -> released', () => {
    expect(PHRASE_STATUSES).toEqual(['draft', 'reviewed', 'released']);
  });

  it('recognises only a released phrase as released', () => {
    expect(isPhraseReleased(phrase({ status: 'released' }))).toBe(true);
    expect(isPhraseReleased(phrase({ status: 'reviewed' }))).toBe(false);
    expect(isPhraseReleased(phrase({ status: 'draft' }))).toBe(false);
  });

  it('changes the body hash when the template changes', async () => {
    const a = await phraseBodyHash(phrase());
    const b = await phraseBodyHash(phrase({ template: 'Different {tests}.' }));
    expect(a).not.toBe(b);
  });

  it('sorts the model scope and banned words, so their order cannot change the hash', async () => {
    const a = await phraseBodyHash(phrase({ modelScope: ['M2', 'M1'], bannedWords: ['b', 'a'] }));
    const b = await phraseBodyHash(phrase({ modelScope: ['M1', 'M2'], bannedWords: ['a', 'b'] }));
    expect(a).toBe(b);
  });

  it('changes the body hash when the status moves, so a released phrase is provably immutable', async () => {
    const draft = await phraseBodyHash(phrase({ status: 'draft' }));
    const released = await phraseBodyHash(phrase({ status: 'released' }));
    expect(draft).not.toBe(released);
  });

  it('exposes the body fields without the hash', () => {
    const body = phraseBody(phrase()) as Record<string, unknown>;
    expect(body.bodyHash).toBeUndefined();
    expect(body.id).toBe('condition.test_exceptions');
  });
});

describe('W2.1 condition evaluation (a predicate, never code)', () => {
  it('matches each comparison operator', () => {
    expect(clauseMatches({ field: 'a', op: 'eq', value: 1 }, { a: 1 })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'ne', value: 1 }, { a: 2 })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'gt', value: 1 }, { a: 2 })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'gte', value: 2 }, { a: 2 })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'lt', value: 2 }, { a: 1 })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'lte', value: 1 }, { a: 1 })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'in', value: ['x', 'y'] }, { a: 'x' })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'contains', value: 'x' }, { a: 'axb' })).toBe(true);
    expect(clauseMatches({ field: 'a', op: 'contains', value: 'x' }, { a: ['x', 'y'] })).toBe(true);
  });

  it('fails every clause for a field the data does not carry', () => {
    expect(clauseMatches({ field: 'missing', op: 'eq', value: 1 }, { a: 1 })).toBe(false);
    expect(clauseMatches({ field: 'missing', op: 'ne', value: 1 }, { a: 1 })).toBe(false);
  });

  it('treats a condition as a conjunction: every clause must hold', () => {
    const condition: PhraseCondition = { all: [{ field: 'a', op: 'gt', value: 1 }, { field: 'b', op: 'eq', value: 'x' }] };
    expect(conditionHolds(condition, { a: 2, b: 'x' })).toBe(true);
    expect(conditionHolds(condition, { a: 2, b: 'y' })).toBe(false);
    expect(conditionHolds({ all: [] }, {})).toBe(true);
  });
});

describe('W2.1 phrase selection', () => {
  const data = { tests: 40, exceptions: 3 };

  it('selects only a released phrase for the claim id and locale', () => {
    const library = [phrase({ status: 'draft' }), phrase({ status: 'released' })];
    expect(selectPhrase(library, 'condition.test_exceptions', data, 'en-GB', 'M1')?.status).toBe('released');
  });

  it('returns null when no released phrase matches the locale', () => {
    expect(selectPhrase([phrase()], 'condition.test_exceptions', data, 'en-US', 'M1')).toBeNull();
  });

  it('skips a phrase whose condition does not hold', () => {
    const gated = phrase({ condition: { all: [{ field: 'exceptions', op: 'gt', value: 10 }] } });
    expect(selectPhrase([gated], 'condition.test_exceptions', data, 'en-GB', 'M1')).toBeNull();
  });

  it('honours the model scope, and an empty scope means every model', () => {
    const scoped = phrase({ modelScope: ['M2'] });
    expect(selectPhrase([scoped], 'condition.test_exceptions', data, 'en-GB', 'M1')).toBeNull();
    expect(selectPhrase([scoped], 'condition.test_exceptions', data, 'en-GB', 'M2')).not.toBeNull();
    expect(selectPhrase([phrase({ modelScope: [] })], 'condition.test_exceptions', data, 'en-GB', 'M1')).not.toBeNull();
  });

  it('returns null for an unknown phrase id', () => {
    expect(selectPhrase([phrase()], 'no.such.phrase', data, 'en-GB', 'M1')).toBeNull();
  });
});

describe('W2.5 slot discipline: no free numeric, date or amount literal', () => {
  it('catches a hand-typed percentage', () => {
    const v = findFreeNumerics('Exceptions increased by 12%.');
    expect(v.map((x) => x.text)).toContain('12%');
  });

  it('catches a hand-typed money amount', () => {
    expect(findFreeNumerics('The value was £1,250,000.').some((x) => x.kind === 'amount')).toBe(true);
  });

  it('catches a hand-typed date in both forms', () => {
    expect(findFreeNumerics('As at 25/10/2026.').some((x) => x.kind === 'date')).toBe(true);
    expect(findFreeNumerics('As at 2026-10-25.').some((x) => x.kind === 'date')).toBe(true);
  });

  it('does not flag a bound slot token', () => {
    expect(findFreeNumerics('We tested {tests} items and found {exceptions}.')).toEqual([]);
  });

  it('still flags a free literal that sits beside a slot', () => {
    const v = findFreeNumerics('We tested {tests} items, up 12% on last year.');
    expect(v.map((x) => x.text)).toContain('12%');
  });

  it('throws with the offending literal named', () => {
    expect(() => assertNoFreeNumerics('We found 3 exceptions.', 'test phrase')).toThrow(/free number literal "3"/);
  });

  it('passes a template that carries only slots', () => {
    expect(() => assertNoFreeNumerics('We found {exceptions} of {tests}.', 'ok')).not.toThrow();
  });
});

describe('W2.6 calibrated language: high-consequence words can never be produced', () => {
  it('finds a high-consequence word case-insensitively and whole-word', () => {
    expect(findHighConsequenceWords('This is Fraud.', DEFAULT_HIGH_CONSEQUENCE_WORDS)).toContain('fraud');
    expect(findHighConsequenceWords('defrauded', DEFAULT_HIGH_CONSEQUENCE_WORDS)).toEqual([]);
  });

  it('matches a multi-word term as written', () => {
    expect(findHighConsequenceWords('We report a material weakness.', DEFAULT_HIGH_CONSEQUENCE_WORDS))
      .toContain('material weakness');
  });

  it('finds a US-locale variant so a US rendering cannot smuggle one through', () => {
    expect(findHighConsequenceWords('A noncompliance was noted.', DEFAULT_HIGH_CONSEQUENCE_WORDS))
      .toContain('noncompliance');
  });

  it('refuses a deterministic claim that would produce one, and names the word', () => {
    expect(() => assertNoHighConsequence('There was fraud.', DEFAULT_HIGH_CONSEQUENCE_WORDS, 'c1'))
      .toThrow(/high-consequence wording "fraud"/);
  });

  it('passes clean wording', () => {
    expect(() => assertNoHighConsequence('We found three exceptions.', DEFAULT_HIGH_CONSEQUENCE_WORDS, 'c1'))
      .not.toThrow();
  });

  it('has a fixed lead-in for every claim level and falls back to the default cell', () => {
    expect(leadIn(TEST_VOCABULARY, 'verified', 'f3-t2-active-en-GB')).toBe('We confirmed that');
    expect(leadIn(TEST_VOCABULARY, 'management_asserted', 'f3-t2-active-en-US')).toBe('Management stated that');
    // An unlisted cell falls back to the standard professional / neutral / active default.
    expect(leadIn(TEST_VOCABULARY, 'verified', 'f1-t5-passive-en-US')).toBe('We confirmed that');
  });

  it('carries a lead-in for all four claim levels', () => {
    for (const level of ['verified', 'calculated', 'management_asserted', 'unresolved'] as const) {
      expect(DEFAULT_LEAD_INS[level]['f3-t2-active-en-GB']).toBeTruthy();
      expect(leadIn(TEST_VOCABULARY, level, 'f3-t2-active-en-GB')).toBeTruthy();
    }
  });
});

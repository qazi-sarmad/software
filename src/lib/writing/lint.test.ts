import { describe, expect, it } from 'vitest';
import {
  canSubmitForApproval, countSyllables, fleschKincaidGrade, fleschReadingEase, intakeCompleteness,
  intakeFields, lintBlocks, lintReport, STYLE_RULES, wordCount, type LintInput,
} from './lint';
import { localeSpellings } from './locale';
import { findFreeNumerics } from './phrases';

function baseInput(overrides: Partial<LintInput> = {}): LintInput {
  return {
    sentences: [{ id: 'c1', text: 'We tested 25 payments.' }],
    formality: 3,
    locale: 'en-GB',
    maxSentenceLength: 30,
    bannedWords: ['fraud'],
    localeSpellings,
    freeNumerics: (t) => findFreeNumerics(t).map((v) => v.text),
    ...overrides,
  };
}

describe('W9.1 style rules as data', () => {
  it('declares a rationale and a severity for every rule', () => {
    for (const rule of STYLE_RULES) {
      expect(rule.rationale.length).toBeGreaterThan(10);
      expect(['blocking', 'advisory', 'info']).toContain(rule.severity);
    }
  });

  it('catches a long sentence', () => {
    const long = `We ${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}.`;
    const findings = lintReport(baseInput({ sentences: [{ id: 'c1', text: long }] }));
    expect(findings.some((f) => f.ruleId === 'sentence.max_length')).toBe(true);
  });

  it('catches a passive construction', () => {
    const findings = lintReport(baseInput({ sentences: [{ id: 'c1', text: 'The control was tested by us.' }] }));
    expect(findings.some((f) => f.ruleId === 'voice.passive')).toBe(true);
  });

  it('blocks a high-consequence word', () => {
    const findings = lintReport(baseInput({ sentences: [{ id: 'c1', text: 'This suggests fraud.' }] }));
    const banned = findings.find((f) => f.ruleId === 'term.banned');
    expect(banned?.severity).toBe('blocking');
    expect(lintBlocks(findings)).toBe(true);
  });

  it('blocks a free numeric literal: it catches a hand-typed "increased by 12%"', () => {
    const findings = lintReport(baseInput({ sentences: [{ id: 'c1', text: 'Errors increased by 12%.' }] }));
    expect(findings.some((f) => f.ruleId === 'slot.free_numeric' && f.severity === 'blocking')).toBe(true);
  });

  it('does not flag a number that arrives through a bound slot', () => {
    const findings = lintReport(baseInput({ sentences: [{ id: 'c1', text: 'We tested {tests} payments.' }] }));
    expect(findings.some((f) => f.ruleId === 'slot.free_numeric')).toBe(false);
  });

  it('blocks a US-only spelling in en-GB and a UK-only spelling in en-US', () => {
    const gb = lintReport(baseInput({ sentences: [{ id: 'c1', text: 'The organization reviewed the color.' }] }));
    expect(gb.some((f) => f.ruleId === 'locale.spelling' && f.evidence === 'organization')).toBe(true);
    const us = lintReport(baseInput({ locale: 'en-US', sentences: [{ id: 'c1', text: 'The organisation reviewed the colour.' }] }));
    expect(us.some((f) => f.ruleId === 'locale.spelling' && f.evidence === 'organisation')).toBe(true);
  });

  it('does not flag a correct-locale spelling', () => {
    const findings = lintReport(baseInput({ sentences: [{ id: 'c1', text: 'The organisation reviewed the colour.' }] }));
    expect(findings.some((f) => f.ruleId === 'locale.spelling')).toBe(false);
  });

  it('advises on a preferred term and an unexpanded acronym', () => {
    const findings = lintReport(baseInput({
      sentences: [{ id: 'c1', text: 'The CIA will utilise the report.' }],
      preferredTerms: { utilise: 'use' },
      acronyms: ['CIA'],
    }));
    expect(findings.some((f) => f.ruleId === 'term.preferred')).toBe(true);
    expect(findings.some((f) => f.ruleId === 'abbrev.first_use')).toBe(true);
  });

  it('orders blocking findings first', () => {
    const findings = lintReport(baseInput({
      sentences: [
        { id: 'c1', text: 'The control was tested by us with a very long sentence that runs well beyond the declared maximum length for the section.' },
        { id: 'c2', text: 'This suggests fraud.' },
      ],
    }));
    expect(findings[0].severity).toBe('blocking');
  });
});

describe('W9.1 readability formulas against known values', () => {
  it('counts syllables with a minimum of one', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('banana')).toBe(3);
    expect(countSyllables('a')).toBe(1);
    expect(countSyllables('')).toBe(0);
  });

  it('gives the stated formula output for a short sentence of one-syllable words', () => {
    // "The cat sat on the mat." is one sentence of six one-syllable words:
    // 206.835 - 1.015 * 6 - 84.6 * 1 = 116.145. (The formula is unbounded above.)
    expect(fleschReadingEase('The cat sat on the mat.')).toBeCloseTo(116.145, 2);
  });

  it('gives a lower reading ease for a longer, multi-syllable sentence', () => {
    const easy = fleschReadingEase('The cat sat on the mat.');
    const hard = fleschReadingEase('The organisation implemented comprehensive reconciliation procedures across multiple jurisdictions.');
    expect(hard).toBeLessThan(easy);
  });

  it('gives a higher grade for a multi-syllable sentence', () => {
    const simple = fleschKincaidGrade('The cat sat on the mat.');
    const hard = fleschKincaidGrade('The organisation implemented comprehensive reconciliation procedures.');
    expect(hard).toBeGreaterThan(simple);
  });

  it('counts words, ignoring pure punctuation', () => {
    expect(wordCount('The cat sat.')).toBe(3);
    expect(wordCount('--- !!!')).toBe(0);
  });
});

describe('W9.2 guided intake', () => {
  it('requires the four mandatory roles and optionally the other three', () => {
    const fields = intakeFields(false);
    expect(fields.filter((f) => f.required).map((f) => f.slot)).toEqual(['context', 'condition', 'effect', 'risk']);
    const strict = intakeFields(true);
    expect(strict.filter((f) => f.required).length).toBe(7);
  });

  it('reports a completeness percentage and the missing slots', () => {
    const c = intakeCompleteness({ context: 'a', condition: 'b' }, false);
    expect(c.total).toBe(4);
    expect(c.filled).toBe(2);
    expect(c.percent).toBe(50);
    expect(c.missing).toEqual(['effect', 'risk']);
  });

  it('refuses a submission while a required slot is empty', () => {
    expect(canSubmitForApproval({ context: 'a', condition: 'b', effect: 'c' }, false)).toBe(false);
    expect(canSubmitForApproval({ context: 'a', condition: 'b', effect: 'c', risk: 'd' }, false)).toBe(true);
  });

  it('treats a whitespace-only answer as empty', () => {
    const c = intakeCompleteness({ context: '   ', condition: 'b', effect: 'c', risk: 'd' }, false);
    expect(c.missing).toEqual(['context']);
  });
});

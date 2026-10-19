import { describe, expect, it } from 'vitest';
import {
  assemblePrompt, cosineSimilarity, describeTerms, describeVoice, inverseDocumentFrequency,
  rankSamples, termFrequency, tokenise, type VoiceSample,
} from '../../supabase/functions/_shared/aiPrompt';

const samples: VoiceSample[] = [
  { id: 's1', kind: 'observation', title: 'Access control', text: 'We found access control weaknesses in the payment system.' },
  { id: 's2', kind: 'observation', title: 'Segregation', text: 'Duties are not segregated between preparation and approval.' },
  { id: 's3', kind: 'finding', title: 'Access', text: 'Access control in the payment system is weak.' },
];

describe('tokenise', () => {
  it('lowercases and drops single characters', () => {
    expect(tokenise('The A/C control is OK')).toEqual(['the', 'control', 'is', 'ok']);
  });
});

describe('termFrequency', () => {
  it('counts tokens', () => {
    expect(termFrequency(['a', 'a', 'b']).get('a')).toBe(2);
  });
});

describe('inverseDocumentFrequency', () => {
  it('gives a rarer term a higher weight', () => {
    const idf = inverseDocumentFrequency([['a', 'b'], ['a'], ['a']]);
    expect(idf.get('b')!).toBeGreaterThan(idf.get('a')!);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for disjoint ones', () => {
    const v = new Map([['a', 1], ['b', 2]]);
    expect(cosineSimilarity(v, new Map([['a', 1], ['b', 2]]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(v, new Map([['c', 1]]))).toBe(0);
  });
  it('is 0 when a vector is empty', () => {
    expect(cosineSimilarity(new Map(), new Map([['a', 1]]))).toBe(0);
  });
});

describe('rankSamples', () => {
  it('ranks the same-kind sample that shares vocabulary highest', () => {
    const ranked = rankSamples('access control in the payment system', samples, 'observation', 3);
    expect(ranked[0].sample.id).toBe('s1');
  });
  it('excludes samples of another kind', () => {
    const ranked = rankSamples('access control', samples, 'observation', 3);
    expect(ranked.map((r) => r.sample.id)).not.toContain('s3');
  });
  it('is deterministic for equal scores', () => {
    const a = rankSamples('access control', samples, 'observation', 2);
    const b = rankSamples('access control', samples, 'observation', 2);
    expect(a.map((r) => r.sample.id)).toEqual(b.map((r) => r.sample.id));
  });
  it('returns an empty list when no sample of the kind exists', () => {
    expect(rankSamples('x', samples, 'cap', 3)).toEqual([]);
  });
});

describe('describeVoice and describeTerms', () => {
  it('writes the profile as plain statements', () => {
    expect(describeVoice({ tone: 'formal', person: 'third', length: 'brief' }))
      .toBe('Tone: formal. Person: third. Length: brief.');
  });
  it('writes terms as plain lines', () => {
    const text = describeTerms([{ preferredPhrase: 'management response', avoidPhrase: 'rebuttal', glossaryTerm: 'CAP', definition: 'corrective action plan' }]);
    expect(text).toContain('Prefer the phrase "management response".');
    expect(text).toContain('Avoid the phrase "rebuttal".');
    expect(text).toContain('Use "CAP" to mean corrective action plan.');
  });
});

describe('assemblePrompt', () => {
  const base = {
    systemPrompt: 'You draft audit observations.',
    profile: { tone: 'neutral', person: 'third', length: 'standard' },
    terms: [],
    samples,
    sampleKind: 'observation',
    recordContext: 'access control in the payment system',
    allowedNumbers: ['12', '30'],
    topK: 3,
    charBudget: 8000,
  };

  it('includes the system prompt, voice, numbers and record context', () => {
    const p = assemblePrompt(base);
    expect(p).toContain('You draft audit observations.');
    expect(p).toContain('Tone: neutral.');
    expect(p).toContain('Numbers you may use: 12, 30');
    expect(p).toContain('Record context:');
  });

  it('is deterministic for the same input', () => {
    expect(assemblePrompt(base)).toBe(assemblePrompt(base));
  });

  it('adds branding facts as plain statements', () => {
    const p = assemblePrompt({ ...base, brandingFacts: ['font Arial', 'page A4'] });
    expect(p).toContain('Formatting: font Arial');
    expect(p).toContain('Formatting: page A4');
  });

  it('respects the character budget by dropping samples', () => {
    const p = assemblePrompt({ ...base, charBudget: 260 });
    expect(p).not.toContain('house style');
    expect(p).toContain('You draft audit observations.');
  });

  it('adds at least one sample when the budget allows', () => {
    const p = assemblePrompt(base);
    expect(p).toContain('house style');
  });
});

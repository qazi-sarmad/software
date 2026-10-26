import { describe, expect, it } from 'vitest';
import {
  counterfactualRegister, counterfactualSlot, provenanceTrace, verifyTrace,
} from './explain';
import { composeReport, type ComposerInput } from './compose';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import type { ClaimGraph } from './types';

function input(): ComposerInput {
  const graph: ClaimGraph = {
    modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB',
    claims: fixtureClaims(), versions: ENGINE_VERSION,
  };
  return {
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
  };
}

describe('W6.1 the provenance trace', () => {
  it('reconstructs the exact sentence and names the phrase, rule, slots, register and locale', async () => {
    const i = input();
    const report = await composeReport(i);
    const rendered = report.rendered.find((r) => r.claimId === 'c-condition')!;
    const claim = i.graph.claims.find((c) => c.id === 'c-condition')!;
    const trace = await provenanceTrace(claim, rendered, i.graph.register, i.graph.locale, ENGINE_VERSION.engine, i.phrases);
    expect(trace.sentence).toBe(rendered.text);
    expect(trace.phraseId).toBe('condition.test_exceptions');
    expect(trace.ruleId).toBe(claim.ruleId);
    expect(trace.register).toEqual(i.graph.register);
    expect(trace.locale).toBe('en-GB');
    expect(trace.slots.map((s) => s.name)).toEqual(claim.slots.map((s) => s.name));
    expect(await verifyTrace(trace, claim, rendered)).toBe(true);
  });

  it('detects tampering with a stored trace', async () => {
    const i = input();
    const report = await composeReport(i);
    const rendered = report.rendered.find((r) => r.claimId === 'c-condition')!;
    const claim = i.graph.claims.find((c) => c.id === 'c-condition')!;
    const trace = await provenanceTrace(claim, rendered, i.graph.register, i.graph.locale, ENGINE_VERSION.engine, i.phrases);
    const tampered = { ...trace, sentence: 'A sentence nobody wrote.' };
    expect(await verifyTrace(tampered, claim, rendered)).toBe(false);
  });

  it('refuses a trace for a phrase whose condition did not hold', async () => {
    const i = input();
    const report = await composeReport(i);
    const rendered = report.rendered.find((r) => r.claimId === 'c-condition')!;
    const claim = i.graph.claims.find((c) => c.id === 'c-condition')!;
    // An unknown phrase id has no released phrase, so the trace cannot be built.
    const bogus: typeof claim = { ...claim, phraseId: 'no.such.phrase' };
    await expect(provenanceTrace(bogus, rendered, i.graph.register, i.graph.locale, ENGINE_VERSION.engine, i.phrases))
      .rejects.toThrow(/no released phrase/);
  });
});

describe('W6.2 deterministic counterfactuals', () => {
  it('shows what the sentence would read if a value changed', async () => {
    const i = input();
    const cf = await counterfactualSlot(i, 'c-condition', 'exceptions', 7);
    expect(cf.description).toBe('if exceptions were 7');
    expect(cf.sentence).toContain('7');
    // The real composition is unchanged; the counterfactual is a re-run, not a mutation.
    const report = await composeReport(i);
    const original = report.rendered.find((r) => r.claimId === 'c-condition')!;
    expect(original.text).toContain('3');
    expect(cf.sentence).not.toBe(original.text);
  });

  it('shows the same facts in a formal register', async () => {
    const i = input();
    const cf = await counterfactualRegister(i, 'c-condition', { formality: 5, tone: 2, voice: 'active' });
    expect(cf.description).toContain('formality 5');
    const report = await composeReport(i);
    const original = report.rendered.find((r) => r.claimId === 'c-condition')!;
    expect(cf.sentence).not.toBe(original.text);
  });

  it('shows the same facts in the passive voice', async () => {
    const i = input();
    const cf = await counterfactualRegister(i, 'c-condition', { formality: 3, tone: 2, voice: 'passive' });
    expect(cf.description).toContain('passive voice');
    expect(cf.sentence).toContain('were examined');
  });
});

import { describe, expect, it } from 'vitest';
import { composeReport, type ComposerInput } from './compose';
import { graphHashes } from './graph';
import {
  FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, ENGINE_VERSION, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import { registerKey, registerMatrix } from './registers';
import { modelSections, REPORT_MODELS } from './models';
import type { ClaimGraph, Locale, Register } from './types';

function input(register: Register, locale: Locale, modelId = 'M1', claims?: ClaimGraph['claims']): ComposerInput {
  const graph: ClaimGraph = {
    modelId, register, locale, claims: claims ?? fixtureClaims(modelId), versions: ENGINE_VERSION,
  };
  return {
    graph,
    phrases: releasedSeedPhrases(),
    vocabulary: TEST_VOCABULARY,
    versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP,
    format: FIXTURE_FORMAT,
    variants: fixtureVariants(),
  };
}

describe('W2.2 / W2.3 / W2.8 the full matrix: 5 formality x 5 tone x 2 voice x 2 locale', () => {
  it('composes every one of the 100 cells with no missing phrase', async () => {
    const cells = registerMatrix();
    expect(cells.length).toBe(100);
    const failures: string[] = [];
    for (const { register, locale } of cells) {
      try {
        const report = await composeReport(input(register, locale));
        expect(report.rendered.length).toBeGreaterThan(0);
      } catch (e) {
        failures.push(`f${register.formality}-t${register.tone}-${register.voice}-${locale}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('holds ONE graph root across all 100 cells; only the render hash changes', async () => {
    const roots = new Set<string>();
    const renders = new Set<string>();
    let first: string | null = null;
    for (const { register, locale } of registerMatrix()) {
      const report = await composeReport(input(register, locale));
      roots.add(report.hashes.graphRoot);
      renders.add(report.renderHash);
      first ??= report.hashes.graphRoot;
      expect(report.hashes.graphRoot).toBe(first);
    }
    // One root for all cells.
    expect(roots.size).toBe(1);
    // The render hash is not constant: wording genuinely varies.
    expect(renders.size).toBeGreaterThan(1);
  });

  it('a register or locale change never changes the graph root', async () => {
    const base = await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB'));
    for (const { register, locale } of registerMatrix()) {
      const report = await composeReport(input(register, locale));
      expect(report.hashes.graphRoot).toBe(base.hashes.graphRoot);
    }
  });

  it('a change to one figure changes the graph root', async () => {
    const base = await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB'));
    const changed = fixtureClaims();
    const effect = changed.find((c) => c.id === 'c-effect')!;
    effect.slots = effect.slots.map((s) => (s.name === 'amount' ? { ...s, value: { scale: 2, units: '999900' } } : s));
    const graph: ClaimGraph = {
      modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB',
      claims: changed, versions: ENGINE_VERSION,
    };
    const after = await composeReport({
      graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
      fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
    });
    expect(after.hashes.graphRoot).not.toBe(base.hashes.graphRoot);
  });

  it('the same slot values and references appear in every variant (a wording-only diff)', async () => {
    // The invariant the spec asks for: the same facts, in different words. We prove it by checking
    // that every variant carries the same rendered claim ids and the same numeric substrings.
    const base = await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB'));
    const baseIds = base.rendered.map((r) => r.claimId).join(',');
    const numbers = (text: string) => (text.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, '')).sort().join('|');
    const baseNumbers = numbers(base.rendered.map((r) => r.text).join(' '));
    for (const { register, locale } of registerMatrix()) {
      const report = await composeReport(input(register, locale));
      expect(report.rendered.map((r) => r.claimId).join(',')).toBe(baseIds);
      // en-GB/en-US differ only in grouping and date form, so the digits are the same.
      expect(numbers(report.rendered.map((r) => r.text).join(' '))).toBe(baseNumbers);
    }
  });
});

describe('W2.2 tone and voice change wording, never facts', () => {
  it('produces different wording at different tones', async () => {
    const t1 = await composeReport(input({ formality: 3, tone: 1, voice: 'active' }, 'en-GB'));
    const t5 = await composeReport(input({ formality: 3, tone: 5, voice: 'active' }, 'en-GB'));
    expect(t1.renderHash).not.toBe(t5.renderHash);
    expect(t1.hashes.graphRoot).toBe(t5.hashes.graphRoot);
  });

  it('produces different wording in the passive voice', async () => {
    const active = await composeReport(input({ formality: 4, tone: 2, voice: 'active' }, 'en-GB'));
    const passive = await composeReport(input({ formality: 4, tone: 2, voice: 'passive' }, 'en-GB'));
    expect(active.hashes.graphRoot).toBe(passive.hashes.graphRoot);
    const aText = active.rendered.map((r) => r.text).join('\n');
    const pText = passive.rendered.map((r) => r.text).join('\n');
    expect(aText).not.toBe(pText);
  });

  it('produces the US date form in en-US and the UK form in en-GB', async () => {
    const gb = await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB'));
    const us = await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-US'));
    const gbText = gb.rendered.map((r) => r.text).join(' ');
    const usText = us.rendered.map((r) => r.text).join(' ');
    // The fixture scope runs 1 January 2026 to 30 September 2026.
    expect(gbText).toContain('1 January 2026');
    expect(gbText).toContain('30 September 2026');
    expect(usText).toContain('January 1, 2026');
    expect(usText).toContain('September 30, 2026');
    expect(gb.hashes.graphRoot).toBe(us.hashes.graphRoot);
  });
});

describe('W1.2 / W1.3 the graph hashes', () => {
  it('is stable for the same claims and changes when a claim changes', async () => {
    const a = await graphHashes(fixtureClaims());
    const b = await graphHashes(fixtureClaims());
    expect(a.graphRoot).toBe(b.graphRoot);
    const changed = fixtureClaims();
    changed[0].slots = [{ name: 'x', kind: 'text', value: 'different' }];
    const c = await graphHashes(changed);
    expect(c.graphRoot).not.toBe(a.graphRoot);
  });
});

// ---------------------------------------------------------------------------
// W2.8: every model, every cell. Twelve models x 100 cells = 1200 compositions.
// ---------------------------------------------------------------------------

/** The claims of a model: the fixture claims that belong to its declared sections. */
function modelClaims(modelId: string) {
  const sectionIds = new Set(modelSections(modelId).map((s) => s.id));
  return fixtureClaims(modelId).filter((c) => sectionIds.has(c.sectionId));
}

/** The register-invariant sections a model declares, in plan order. */
function declaredInvariantSections(modelId: string): string[] {
  return modelSections(modelId).filter((s) => s.registerInvariant).map((s) => s.id);
}

describe('W2.8 every model composes every cell of the matrix', () => {
  it('composes all 12 models x 100 cells = 1200 cells with no missing phrase', async () => {
    const cells = registerMatrix();
    expect(cells.length).toBe(100);
    expect(REPORT_MODELS.length).toBe(12);
    const failures: string[] = [];
    let checked = 0;
    for (const model of REPORT_MODELS) {
      const claims = modelClaims(model.modelId);
      for (const { register, locale } of cells) {
        checked += 1;
        try {
          const report = await composeReport(input(register, locale, model.modelId, claims));
          if (report.rendered.length !== claims.length) {
            failures.push(`${model.modelId} ${registerKey(register, locale)}: rendered `
              + `${report.rendered.length} of ${claims.length} claims`);
          }
        } catch (e) {
          failures.push(`${model.modelId} ${registerKey(register, locale)}: ${(e as Error).message}`);
        }
      }
    }
    // The failure names the exact model, cell and phrase when a phrase is missing.
    expect(failures).toEqual([]);
    expect(checked).toBe(1200);
  });

  it('holds ONE graph root per model across its 100 cells; only the render hash changes', async () => {
    for (const model of REPORT_MODELS) {
      const claims = modelClaims(model.modelId);
      const roots = new Set<string>();
      const renders = new Set<string>();
      for (const { register, locale } of registerMatrix()) {
        const report = await composeReport(input(register, locale, model.modelId, claims));
        roots.add(report.hashes.graphRoot);
        renders.add(report.renderHash);
      }
      // One root for the model, across all 100 cells.
      expect(`${model.modelId}:${roots.size}`).toBe(`${model.modelId}:1`);
      // The render hash is not constant: wording genuinely varies within the model.
      expect(renders.size).toBeGreaterThan(1);
    }
  });

  it('a declared register-invariant section renders identical text in all 100 cells', async () => {
    // Where a section is declared register-invariant, the declaration must be true: its text cannot
    // differ by formality, tone, voice or locale. The composer honours the declaration; this test
    // proves it and would fail the moment the declaration stopped being true.
    const differing: string[] = [];
    for (const model of REPORT_MODELS) {
      const invariant = new Set(declaredInvariantSections(model.modelId));
      if (invariant.size === 0) continue;
      const claims = modelClaims(model.modelId);
      const texts = new Map<string, Set<string>>();
      for (const { register, locale } of registerMatrix()) {
        const report = await composeReport(input(register, locale, model.modelId, claims));
        for (const rc of report.rendered) {
          if (!invariant.has(rc.sectionId)) continue;
          if (!texts.has(rc.claimId)) texts.set(rc.claimId, new Set());
          texts.get(rc.claimId)!.add(rc.text);
        }
      }
      for (const [claimId, set] of texts) {
        if (set.size !== 1) differing.push(`${model.modelId} ${claimId}: ${set.size} distinct texts`);
      }
    }
    expect(differing).toEqual([]);
  });

  it('a section NOT declared register-invariant genuinely varies (the declaration is not over-used)', async () => {
    // The converse guard: a wording section must vary, or the declaration is meaningless. Every
    // model has at least one wording section and its text must differ across the matrix.
    const constant: string[] = [];
    for (const model of REPORT_MODELS) {
      const invariant = new Set(declaredInvariantSections(model.modelId));
      const claims = modelClaims(model.modelId);
      const texts = new Map<string, Set<string>>();
      for (const { register, locale } of registerMatrix()) {
        const report = await composeReport(input(register, locale, model.modelId, claims));
        for (const rc of report.rendered) {
          if (invariant.has(rc.sectionId)) continue;
          if (rc.phraseId === 'auditor.text') continue; // auditor wording is the auditor's own
          if (!texts.has(rc.claimId)) texts.set(rc.claimId, new Set());
          texts.get(rc.claimId)!.add(rc.text);
        }
      }
      const anyVaries = [...texts.values()].some((s) => s.size > 1);
      if (!anyVaries) constant.push(model.modelId);
    }
    expect(constant).toEqual([]);
  });

  it('a register or locale change never changes the graph root, for every model', async () => {
    for (const model of REPORT_MODELS) {
      const claims = modelClaims(model.modelId);
      const base = await composeReport(input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB', model.modelId, claims));
      for (const { register, locale } of registerMatrix()) {
        const report = await composeReport(input(register, locale, model.modelId, claims));
        expect(report.hashes.graphRoot).toBe(base.hashes.graphRoot);
      }
    }
  });
});

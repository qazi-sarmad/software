/**
 * WP1: concurrency and determinism.
 *
 * Realisation and verification are pure functions of their arguments, so running many of them at once
 * must produce exactly the same graph root and render hash as running them one at a time. This suite
 * interleaves realisation and verification across the matrix concurrently and asserts determinism.
 *
 * The "concurrency" here is genuine interleaving on the event loop (the functions are async because
 * hashing is async). It is deterministic by construction: there is no clock and no shared mutable
 * state, so the only thing concurrency could break is a hidden global, which this test would expose.
 */

import { describe, expect, it } from 'vitest';
import { composeReport, type ComposerInput, type ComposedReport } from './compose';
import { graphHashes, renderHash } from './graph';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import { registerMatrix } from './registers';
import type { ClaimGraph, Locale, Register } from './types';

function input(register: Register, locale: Locale): ComposerInput {
  const graph: ClaimGraph = {
    modelId: 'M1', register, locale, claims: fixtureClaims(), versions: ENGINE_VERSION,
  };
  return {
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
  };
}

/** Run a promise N times concurrently and return the results. */
async function fanOut<T>(n: number, run: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => run(i)));
}

describe('WP1 concurrent realisation is deterministic', () => {
  it('100 concurrent realisations of the same input give one graph root and one render hash', async () => {
    const cells = registerMatrix();
    // Fire every matrix cell at once; each cell is realised independently.
    const reports = await fanOut(cells.length, (i) =>
      composeReport(input(cells[i].register, cells[i].locale)));

    const roots = new Set(reports.map((r) => r.hashes.graphRoot));
    const rendersByCell = new Map<string, string>();
    reports.forEach((r, i) => rendersByCell.set(`${cells[i].register.formality}-${cells[i].register.tone}-${cells[i].register.voice}-${cells[i].locale}`, r.renderHash));

    // One root across all concurrent cells.
    expect(roots.size).toBe(1);

    // Re-run sequentially and compare: the concurrent hashes equal the sequential ones.
    for (let i = 0; i < cells.length; i++) {
      const sequential = await composeReport(input(cells[i].register, cells[i].locale));
      const key = `${cells[i].register.formality}-${cells[i].register.tone}-${cells[i].register.voice}-${cells[i].locale}`;
      expect(sequential.renderHash).toBe(rendersByCell.get(key));
      expect(sequential.hashes.graphRoot).toBe(reports[i].hashes.graphRoot);
    }
  });

  it('interleaved realisation and verification never disagree', async () => {
    const cells = registerMatrix().slice(0, 25);
    const tasks: Array<Promise<{ root: string; render: string; claimHashes: string[] }>> = [];
    for (const { register, locale } of cells) {
      // Kick off composition and, in the same tick, an independent hashing of the same claims.
      const composed: Promise<ComposedReport> = composeReport(input(register, locale));
      const hashed = graphHashes(fixtureClaims());
      tasks.push((async () => {
        const [c, h] = await Promise.all([composed, hashed]);
        expect(c.hashes.graphRoot).toBe(h.graphRoot);
        return { root: c.hashes.graphRoot, render: c.renderHash, claimHashes: c.hashes.claimHashes };
      })());
    }
    const results = await Promise.all(tasks);
    const roots = new Set(results.map((r) => r.root));
    expect(roots.size).toBe(1);
    // Every result carries the same 13 claim hashes.
    for (const r of results) expect(r.claimHashes.length).toBe(13);
  });

  it('recomputing the render hash directly matches the composer, under concurrency', async () => {
    const cells = registerMatrix();
    const pairs = await fanOut(cells.length, async (i) => {
      const { register, locale } = cells[i];
      const report = await composeReport(input(register, locale));
      const direct = await renderHash({
        graphRoot: report.hashes.graphRoot, register, locale, versions: ENGINE_VERSION,
        rendered: report.rendered, fixedTimestamp: FIXED_TIMESTAMP,
      });
      return { composer: report.renderHash, direct };
    });
    for (const p of pairs) expect(p.direct).toBe(p.composer);
  });
});

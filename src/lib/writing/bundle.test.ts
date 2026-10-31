import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBundle, serialiseBundle, bundleHash, BUNDLE_FORMAT } from './bundle';
import { composeReport } from './compose';
import { buildLineage, evaluateFigure, figureFunctionById, type SourceRecord } from './figures';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, TEST_VOCABULARY, fixtureClaims,
  fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import type { ClaimGraph } from './types';

const VERIFIER = join(process.cwd(), 'scripts', 'verify-report-bundle.mjs');

async function makeBundle() {
  const graph: ClaimGraph = {
    modelId: 'M1', register: { formality: 3, tone: 2, voice: 'active' }, locale: 'en-GB',
    claims: fixtureClaims(), versions: ENGINE_VERSION,
  };
  const composed = await composeReport({
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, format: FIXTURE_FORMAT, variants: fixtureVariants(),
  });
  const fn = figureFunctionById('fig.controls_tested')!;
  const rec: SourceRecord = { type: 'test_rows', id: 'r1', contentHash: 'a'.repeat(64) };
  const columns = new Map([['test_rows', new Map([['r1', 'x']])]]);
  const lineage = await buildLineage(fn, { engagementId: 'e1' }, evaluateFigure(fn, [rec], columns), FIXED_TIMESTAMP);
  const bundle = await buildBundle({
    modelId: 'M1', register: graph.register, locale: graph.locale, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, graphRoot: composed.hashes.graphRoot, renderHash: composed.renderHash,
    claims: graph.claims, rendered: composed.rendered, lineage: [lineage],
  });
  return bundle;
}

function runVerifier(bundle: unknown): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  const path = join(dir, 'bundle.json');
  writeFileSync(path, JSON.stringify(bundle));
  try {
    const out = execFileSync('node', [VERIFIER, path], { encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('W10.1 / W10.2 the bundle and the standalone verifier', () => {
  it('builds a bundle whose graph root is the Merkle root over the claims', async () => {
    const bundle = await makeBundle();
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.claims.length).toBe(fixtureClaims().length);
    expect(bundle.proofs.length).toBe(bundle.claims.length);
    expect(bundle.graphRoot).toHaveLength(64);
  });

  it('serialises identically every time and hashes stably', async () => {
    const a = await makeBundle();
    const b = await makeBundle();
    expect(serialiseBundle(a)).toBe(serialiseBundle(b));
    expect(await bundleHash(a)).toBe(await bundleHash(b));
  });

  it('passes the standalone verifier', async () => {
    const bundle = await makeBundle();
    const result = runVerifier(bundle);
    expect(result.out).toContain('PASS');
    expect(result.ok).toBe(true);
  });

  it('fails when a claim hash is tampered with', async () => {
    const bundle = await makeBundle();
    bundle.claims[0].claimHash = 'f'.repeat(64);
    const result = runVerifier(bundle);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('claim hash mismatch');
  });

  it('fails when the canonical facts are tampered with', async () => {
    const bundle = await makeBundle();
    // Change one character of the canonical facts: the hash no longer matches.
    bundle.claims[0].canonical = bundle.claims[0].canonical.replace('"c-approval"', '"c-approva1"');
    const result = runVerifier(bundle);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('claim hash mismatch');
  });

  it('fails when the graph root is tampered with', async () => {
    const bundle = await makeBundle();
    bundle.graphRoot = 'f'.repeat(64);
    const result = runVerifier(bundle);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('graph root mismatch');
  });

  it('fails when an inclusion proof is tampered with', async () => {
    const bundle = await makeBundle();
    bundle.proofs[0].proof.steps = [];
    const result = runVerifier(bundle);
    expect(result.ok).toBe(false);
    expect(result.out).toMatch(/inclusion proof/);
  });

  it('fails when a figure lineage hash is tampered with', async () => {
    const bundle = await makeBundle();
    bundle.figureLineage[0].lineageHash = 'f'.repeat(64);
    const result = runVerifier(bundle);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('figure lineage hash mismatch');
  });

  it('fails when a source record hash in a lineage is tampered with', async () => {
    const bundle = await makeBundle();
    bundle.figureLineage[0].records[0].contentHash = 'f'.repeat(64);
    const result = runVerifier(bundle);
    expect(result.ok).toBe(false);
    expect(result.out).toContain('figure lineage hash mismatch');
  });
});

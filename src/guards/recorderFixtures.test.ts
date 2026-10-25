import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * S12: a state-dependent tutorial screen must have its state seeded before the recorder reaches it.
 *
 * Three keys were recorded against an empty screen in CI and failed with "none of its step targets
 * are on /", because the recorder assumed the fixture data was there:
 *   - `sa.tutorials` reads the `tutorials` registry, which the SQL test seed TRUNCATES and never
 *     re-inserts. CI runs that suite against the same project in step 7, before the recorder.
 *   - `oa.dual-session` and `sa.dual-session` drive the GL-01 banner, which renders only while a
 *     `consultation_sessions` row is open for the org.
 * The seed side is now explicit: `e2e/global-setup.ts` re-seeds the registry, and the recorder opens
 * and closes the consultation session itself. These tests pin both, so a future edit cannot quietly
 * drop the seeding and return the keys to recording empty screens.
 */

const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('the recorder seeds every state-dependent screen (S12)', () => {
  it('global-setup re-seeds the tutorials registry that the SQL seed truncates', () => {
    const setup = read('e2e/global-setup.ts');
    expect(setup).toMatch(/from\('tutorials'\)\s*\.upsert\(/);
    // The registry must be read from the one source of truth, never a second hand-written list.
    expect(setup).toContain('tutorialKeys.json');
  });

  it('the recorder opens a consultation session for the GL-01 keys and removes it again', () => {
    const rec = read('scripts/record-tutorials.mjs');
    expect(rec).toMatch(/openConsultationFixture\(\)/);
    expect(rec).toMatch(/closeConsultationFixture\(\)/);
    // The banner's End button ends the session, so the fixture is re-opened per GL-01 key, not once
    // for the batch. Pin that the two keys are named in the per-key guard.
    expect(rec).toMatch(/def\.key === 'oa\.dual-session'/);
    expect(rec).toMatch(/def\.key === 'sa\.dual-session'/);
  });

  it('the consultation fixture is keyed to the same org as the rest of the synthetic data', () => {
    const setup = read('e2e/global-setup.ts');
    const rec = read('scripts/record-tutorials.mjs');
    const org = /const ORG_A = '([0-9a-f-]+)'/.exec(setup)?.[1];
    expect(org).toBeTruthy();
    expect(rec).toContain(org as string);
  });
});

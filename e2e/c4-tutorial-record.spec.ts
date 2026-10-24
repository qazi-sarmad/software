import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * C4: the tutorial recorder really drives the UI.
 *
 * Five keys are recorded against the CI app (stub provider, synthetic data) and the output must differ
 * from the placeholder, carry 8 to 15 frames and stay under 400 KB. This is the proof that a
 * recording shows the real screen, not a coloured rectangle.
 *
 * The recording itself needs a signed-in session, so it runs as one serial test with its own browser
 * (scripts/record-tutorials.mjs opens the pages itself). It writes into the git-ignored
 * `artifacts/tutorial-smoke/` so it never touches the committed GIFs.
 */
const BASE_URL = process.env.TUTORIALS_BASE_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), 'artifacts', 'tutorial-smoke');

const SMOKE_KEYS = ['oa.features', 'oa.roles', 'sa.tenant-hub', 'oa.boardpack-use', 'oa.tutorials'];

/**
 * The real frame count, from the GIF block structure (scripts/gifInfo.mjs). A byte scan for the
 * Graphic Control Extension introducer also matches those bytes inside compressed image data, which
 * over-counts a real recording; this walks the blocks.
 */
async function gifFrames(buf: Buffer): Promise<number> {
  // Imported lazily: the spec is ESM (package.json type: module) and the parser is plain .mjs.
  const { readGif } = await import('../scripts/gifInfo.mjs');
  return readGif(buf).frames;
}

function placeholderHash(): string {
  const file = join(process.cwd(), 'public', 'tutorials', '.placeholder-hash');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

import { createHash } from 'node:crypto';
const sha = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 32);

test.describe('C4 tutorial recording', () => {
  test('[E2E] five keys record real frames, not a placeholder', async () => {
    test.setTimeout(300_000);
    const { recordLive } = await import('../scripts/record-tutorials.mjs');
    const keys = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'lib', 'tutorialKeys.json'), 'utf8'),
    );
    const defs = keys.filter((k: { key: string }) => SMOKE_KEYS.includes(k.key));
    expect(defs.length).toBe(SMOKE_KEYS.length);

    const { mkdirSync } = await import('node:fs');
    mkdirSync(OUT, { recursive: true });
    const result = await recordLive(defs, BASE_URL, OUT);
    expect(result.failed, result.failed.join('\n')).toEqual([]);

    const placeholder = placeholderHash();
    for (const def of defs) {
      const buf = readFileSync(join(OUT, `${def.key}.gif`));
      expect(sha(buf), `${def.key} is a placeholder`).not.toBe(placeholder);
      const frames = await gifFrames(buf);
      expect(frames, `${def.key} has ${frames} frames`).toBeGreaterThanOrEqual(8);
      expect(frames, `${def.key} has ${frames} frames`).toBeLessThanOrEqual(15);
      expect(buf.length, `${def.key} is ${(buf.length / 1024).toFixed(0)} KB`).toBeLessThanOrEqual(400 * 1024);
    }
  });
});

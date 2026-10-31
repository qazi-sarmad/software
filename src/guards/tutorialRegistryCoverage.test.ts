import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TUTORIAL_KEYS } from '../lib/tutorialKeys';

/**
 * Tutorial registry coverage (W12).
 *
 * The registry seed (0071) was written against the 77 keys the JSON held at the time. Two keys were
 * added to src/lib/tutorialKeys.json afterwards — `oa.connectors` (OA-23) and `oa.formats` (OA-24) —
 * with their GIFs, and `check-tutorials` passed because it compares the JSON against the GIF files.
 * The registry is a different artefact: nothing compared the JSON against the migrations, so a fresh
 * database ended up two rows short of the app. The rows appeared locally only because
 * e2e/global-setup.ts upserts the JSON for the recorder.
 *
 * This guard pins the invariant at build time: every key in the JSON must be seeded by some
 * migration, so a key added to the JSON without a registry row fails here rather than in production.
 */

const ROOT = resolve(process.cwd());
const MIGRATIONS = join(ROOT, 'supabase/migrations');

function migrationText(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

describe('every tutorial key is seeded by a migration (W12)', () => {
  it('has a registry row for each key in the JSON key list', () => {
    const sql = migrationText();
    const missing = TUTORIAL_KEYS
      .map((k) => k.key)
      .filter((key) => !new RegExp(`'${key.replace(/\./g, '\\.')}'`).test(sql));
    expect(missing).toEqual([]);
  });

  it('seeds a media path for every key', () => {
    const sql = migrationText();
    const missing = TUTORIAL_KEYS
      .map((k) => k.key)
      .filter((key) => !sql.includes(`tutorials/${key}.gif`));
    expect(missing).toEqual([]);
  });
});

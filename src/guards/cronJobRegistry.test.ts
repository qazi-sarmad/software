import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Scheduled-job registry (C2.2).
 *
 * A migration schedules cron jobs and a later migration may unschedule one. `supabase/tests/83`
 * asserts the surviving names, but only when `pg_cron` is present, and the local harness has no
 * `pg_cron` — so on a developer machine that whole block is skipped and a name the migration removed
 * can stay in the test forever. That is exactly what happened: 0087 unschedules `ai-purge-expired`
 * while the AI feature was removed, but test 83 still listed it and the hosted project (which has
 * `pg_cron`) failed with "the job ai-purge-expired exists in cron.job".
 *
 * This guard replays `cron.schedule`/`cron.unschedule` in migration order and pins the surviving set
 * to what test 83 expects, so the mismatch is caught locally.
 */
const ROOT = resolve(process.cwd());
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const TEST = resolve(ROOT, 'supabase/tests/83_scheduled_jobs.sql');

/** The job names that survive after every migration, by replaying schedule then unschedule. */
function survivingJobs(): Set<string> {
  const jobs = new Set<string>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const text = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    // Calls appear in file order, and a migration unschedules before it re-schedules, so replaying
    // by match position within the file is the same order the database sees.
    const calls = [...text.matchAll(/cron\.(un)?schedule\('([^']+)'/g)];
    for (const [, un, name] of calls) {
      if (un) jobs.delete(name); else jobs.add(name);
    }
  }
  return jobs;
}

/** The `v_names` arrays test 83 asserts against, deduplicated. */
function expectedJobs(): Set<string> {
  const text = readFileSync(TEST, 'utf8');
  const names = new Set<string>();
  for (const m of text.matchAll(/v_(?:names|jobs) text\[\] := array\[([^\]]+)\]/g)) {
    for (const n of m[1].matchAll(/'([^']+)'/g)) names.add(n[1]);
  }
  return names;
}

describe('the scheduled-job names match the migrations (C2.2)', () => {
  it('every job test 83 asserts is one that survives every migration', () => {
    // test 83 covers the jobs migration 0074 schedules, not the whole registry (0064 also schedules
    // the two email jobs), so the invariant is containment, not equality.
    const surviving = survivingJobs();
    const missing = [...expectedJobs()].filter((n) => !surviving.has(n)).sort();
    expect(missing, `test 83 asserts jobs no migration leaves scheduled: ${missing.join(', ')}`).toEqual([]);
  });

  it('no migration-scheduled job was removed by the AI removal and left in the test', () => {
    expect(expectedJobs().has('ai-purge-expired')).toBe(false);
    expect(survivingJobs().has('ai-purge-expired')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Owner policy: no agent, co-author or session provenance may appear in tracked content or in any
 * commit message. The vendor patterns are spelled as fragments so this guard does not itself
 * contain the strings it forbids.
 */
const VENDOR = new RegExp(
  [
    'clau' + 'de',
    'anthro' + 'pic',
    'gro' + 'k',
    'open' + 'ai',
    'chat' + 'gpt',
    'co[- ]?authored[- ]?by',
    'all[- ]hands\\.dev',
  ].join('|'),
  'i',
);

/**
 * The deterministic deny list names vendor hosts precisely so the platform can refuse to call them.
 * It is the mechanism that keeps the platform AI-free, not provenance, so it is exempt by design.
 */
const DENY_LIST_FILES = new Set([
  'src/guards/provenance.test.ts',
  'src/guards/noAi.test.ts',
  'supabase/migrations/0059_ai.sql',
  'supabase/tests/94_ai_removed.sql',
  'package-lock.json',
]);

function trackedFiles(): string[] {
  return execSync('git ls-files', { cwd: process.cwd(), encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

describe('provenance guard', () => {
  it('no tracked file carries agent, co-author or session provenance', () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (DENY_LIST_FILES.has(file)) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      text.split('\n').forEach((line, i) => {
        if (VENDOR.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the database keeps the model-endpoint deny list as product configuration, not provenance', () => {
    const migration = readFileSync('supabase/migrations/0059_ai.sql', 'utf8');
    expect(migration).toMatch(/api\.open/);
  });

  it('new commits are authored by the owner identity', () => {
    const name = execSync('git config user.name', { encoding: 'utf8' }).trim();
    const email = execSync('git config user.email', { encoding: 'utf8' }).trim();
    expect(name).toBe('Qazi Sarmad Ali Mahesar');
    expect(email).toBe('qazisarmadalimahesar@gmail.com');
  });

  it('the most recent commit message carries no provenance trailer', () => {
    const message = execSync('git log -1 --format=%B', { encoding: 'utf8' });
    expect(VENDOR.test(message)).toBe(false);
  });
});

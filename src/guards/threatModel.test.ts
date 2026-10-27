import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SECURITY-PLAN item E: the threat model cannot drift from the code.
 *
 * docs/SECURITY-THREAT-MODEL.md names, for each STRIDE threat, the exact file, RPC or test that
 * mitigates it. This guard reads that document and asserts every named control still exists, so a
 * control cannot be deleted (or a file renamed) without the threat model failing. It is a
 * documentation-vs-code link, not a behavioural test; the behavioural proof is in each control's own
 * unit / SQL / e2e test.
 */

const ROOT = resolve(process.cwd());
const DOC = resolve(ROOT, 'docs/SECURITY-THREAT-MODEL.md');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');

/** Every file path the document names in backticks, that looks like a real path. */
function namedFiles(doc: string): string[] {
  const out = new Set<string>();
  for (const m of doc.matchAll(/`([^`]+)`/g)) {
    const raw = m[1].trim();
    if (/^(src|docs|supabase|e2e|scripts|public)\/[A-Za-z0-9._/-]+$/.test(raw) && /\.[a-z]+$/.test(raw)) {
      out.add(raw);
    }
  }
  return [...out];
}

/** Every SQL function name the document names in backticks, e.g. `require_platform_admin()`. */
function namedRpcs(doc: string): string[] {
  const out = new Set<string>();
  for (const m of doc.matchAll(/`([a-z_][a-z0-9_]*)\(\)`/g)) out.add(m[1]);
  return [...out];
}

describe('security threat model (WP12)', () => {
  const doc = readFileSync(DOC, 'utf8');

  it('names at least one control file and one RPC', () => {
    expect(namedFiles(doc).length).toBeGreaterThan(3);
    expect(namedRpcs(doc).length).toBeGreaterThan(0);
  });

  it('every control file it names exists', () => {
    const missing = namedFiles(doc).filter((p) => !existsSync(resolve(ROOT, p)));
    expect(missing, 'control files named by the threat model that do not exist').toEqual([]);
  });

  it('every RPC it names is defined in a migration', () => {
    // Every migration, in order: a named control may be defined in any of them.
    const sql = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))
      .join('\n');
    const missing = namedRpcs(doc).filter((fn) => !new RegExp(`function\\s+public\\.${fn}\\s*\\(`, 'i').test(sql));
    expect(missing, 'RPCs named by the threat model with no migration definition').toEqual([]);
  });

  it('names each trust boundary B1..B7', () => {
    for (const b of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']) {
      expect(doc, `boundary ${b} missing`).toContain(`### ${b} `);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Rule (F1, spec §23): no screen lets anyone type JSON, including Super Admin. Configuration is
 * edited through dropdowns, toggles, multi-selects, ordered lists, colour pickers and file uploads.
 *
 * This guard fails if any non-test file under src/components parses user-typed text as JSON or
 * renders serialised JSON into an editable field. Two shapes are banned:
 *
 *   1. `JSON.parse(` — parsing JSON that came from a person (a textarea, an input, a prompt).
 *   2. `JSON.stringify(` — a serialised object shown as text is a JSON editor in disguise; a
 *      configuration surface that shows a value renders the individual fields instead.
 *
 * The allow-list is empty (F1). Widening it is a deliberate act and must be recorded in
 * docs/ACP-DECISIONS.md with the reason and how to reverse it.
 */
const ALLOWED = new Set<string>([]);

const BANNED = [/JSON\s*\.\s*parse\s*\(/, /JSON\s*\.\s*stringify\s*\(/];

describe('no raw JSON editing (F1, spec §23)', () => {
  const files = walk(SRC).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && relative(SRC, f).startsWith('components')
  );

  it('finds component files to scan', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('no component parses or serialises JSON', () => {
    const offenders = files
      .filter((f) => !ALLOWED.has(relative(SRC, f).replace(/\\/g, '/')))
      .filter((f) => {
        const body = readFileSync(f, 'utf-8');
        return BANNED.some((re) => re.test(body));
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('has an empty allow-list (F1: no screen types JSON)', () => {
    expect([...ALLOWED]).toEqual([]);
  });

  it('the guard detects JSON.parse and JSON.stringify (self-check)', () => {
    expect(BANNED.some((re) => re.test('const x = JSON.parse(raw);'))).toBe(true);
    expect(BANNED.some((re) => re.test('value={JSON.stringify(cfg)}'))).toBe(true);
    expect(BANNED.some((re) => re.test('const x = cfg.value;'))).toBe(false);
  });
});

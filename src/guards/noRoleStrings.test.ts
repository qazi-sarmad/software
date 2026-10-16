import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Task 2F-2b guard: no permission decision in production code may compare a role name.
 *
 * The app decides with rights (src/lib/rights.ts). A role slug may still appear as data — in the
 * seed, the Role union, the role registry, or the fallback rights table — but it must never appear
 * in a comparison that gates behaviour. This test fails if a new `role === '...'` style check is
 * introduced anywhere under src/.
 *
 * A small allow-list covers the places where a role slug is data, not a decision.
 */

const ROOT = resolve(process.cwd(), 'src');

// Files where role slugs are legitimately data (the role registry, the union type, the rights table).
const DATA_FILES = new Set([
  'types/index.ts',
  'lib/rights.ts',
  'data/client.ts',
  'test/testUsers.ts',
]);

// A comparison of a role field against a role-name string literal.
const ROLE_NAME = `'(cia|audit_manager|reviewer|preparer|observer|org_admin|auditee)'`;
const COMPARISON = new RegExp(
  String.raw`\b(?:user|currentUser|actor|member)?\.?role\b\s*(?:===|!==|==|!=)\s*${ROLE_NAME}` +
    `|${ROLE_NAME}\\s*(?:===|!==|==|!=)\\s*\\b(?:user|currentUser|actor|member)?\\.?role\\b`
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('2F-2b: no role-name comparison in production code', () => {
  const files = walk(ROOT).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p)
  );

  it('finds the production source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((p) => [p.replace(ROOT + '/', ''), p] as const))(
    'has no role-name comparison in %s',
    (rel, abs) => {
      if (DATA_FILES.has(rel)) return;
      const text = readFileSync(abs, 'utf-8');
      const offenders = text
        .split('\n')
        .map((line, i) => ({ line: line.trim(), n: i + 1 }))
        .filter(({ line }) => COMPARISON.test(line) && !line.startsWith('//') && !line.startsWith('*'));
      expect(offenders).toEqual([]);
    }
  );

  it('the guard detects a role-name comparison (self-check)', () => {
    expect(COMPARISON.test("if (user.role === 'cia') return true;")).toBe(true);
    expect(COMPARISON.test("if (currentUser.role !== 'org_admin') {")).toBe(true);
    expect(COMPARISON.test("const x = hasRight(user, 'can_reopen');")).toBe(false);
  });
});

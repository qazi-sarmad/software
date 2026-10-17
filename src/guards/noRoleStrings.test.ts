import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Task 2F-2b guard, extended in R5a: no permission decision in production code may compare a role
 * name or a team-role name.
 *
 * The app decides with rights (src/lib/rights.ts). A role slug may still appear as data — in the
 * seed, the Role union, the role registry, or the fallback rights table — but it must never appear
 * in a comparison that gates behaviour. This test fails if a new `role === '...'` style check is
 * introduced anywhere under src/.
 *
 * R5a widens the rule in two ways:
 *   - the platform slug `platform_admin` is included (the platform portal is the only place allowed
 *     to read it, per D-PLATFORM-RIGHTS, and that read is not a comparison in src/);
 *   - team-role names (`lead`, `preparer`, `reviewer`, `observer`) compared on a teamRole field are
 *     caught too (the SQL side keys team rights by team role, but the app must not gate on them).
 *
 * The allow-list below holds the files that docs/ROLE-CHECKS.md classifies as DISPLAY or SCOPE (role
 * slugs used as labels/seed data, not as permission decisions), plus the role registry that
 * validates a session slug. Every entry is justified here so widening it is a deliberate act.
 */

const ROOT = resolve(process.cwd(), 'src');

// Files where role slugs are legitimately data (the role registry, the union type, the rights table,
// the demo/initial seed, the test-user helper). Mirrors the DISPLAY/SCOPE rows in docs/ROLE-CHECKS.md.
const DATA_FILES = new Set([
  'types/index.ts',
  'lib/rights.ts',
  'data/client.ts',
  'data/demoSeed.ts',
  'data/initialData.ts',
  'context/AppContext.tsx',
  'App.tsx',
  'components/glassbox/GlassBoxPublicRoute.tsx',
  'test/testUsers.ts',
]);

// A comparison of a role field against a role-name string literal.
const ROLE_NAME = `'(cia|audit_manager|reviewer|preparer|observer|org_admin|auditee|platform_admin)'`;
const ROLE_FIELD = String.raw`\b(?:user|currentUser|actor|member)?\.?(?:role|user_role|role_slug|slug)\b`;
const ROLE_COMPARISON = new RegExp(
  `${ROLE_FIELD}\\s*(?:===|!==|==|!=)\\s*${ROLE_NAME}` +
    `|${ROLE_NAME}\\s*(?:===|!==|==|!=)\\s*${ROLE_FIELD}`
);

// A comparison of a team-role field against a team-role name literal.
const TEAM_NAME = `'(lead|preparer|reviewer|observer)'`;
const TEAM_FIELD = String.raw`\b\w*[Tt]eamRole\b`;
const TEAM_COMPARISON = new RegExp(
  `${TEAM_FIELD}\\s*(?:===|!==|==|!=)\\s*${TEAM_NAME}` +
    `|${TEAM_NAME}\\s*(?:===|!==|==|!=)\\s*${TEAM_FIELD}`
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function offendersIn(text: string, pattern: RegExp): { line: string; n: number }[] {
  return text
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => pattern.test(line) && !line.startsWith('//') && !line.startsWith('*'));
}

describe('2F-2b (extended R5a): no role-name or team-role comparison in production code', () => {
  const files = walk(ROOT).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p));

  it('finds the production source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((p) => [p.replace(ROOT + '/', ''), p] as const))(
    'has no role-name comparison in %s',
    (rel, abs) => {
      if (DATA_FILES.has(rel)) return;
      expect(offendersIn(readFileSync(abs, 'utf-8'), ROLE_COMPARISON)).toEqual([]);
    }
  );

  it.each(files.map((p) => [p.replace(ROOT + '/', ''), p] as const))(
    'has no team-role comparison in %s',
    (rel, abs) => {
      if (DATA_FILES.has(rel)) return;
      expect(offendersIn(readFileSync(abs, 'utf-8'), TEAM_COMPARISON)).toEqual([]);
    }
  );

  it('the guard detects a role-name comparison (self-check)', () => {
    expect(ROLE_COMPARISON.test("if (user.role === 'cia') return true;")).toBe(true);
    expect(ROLE_COMPARISON.test("if (currentUser.role !== 'org_admin') {")).toBe(true);
    expect(ROLE_COMPARISON.test("if (member.user_role === 'platform_admin') {")).toBe(true);
    expect(ROLE_COMPARISON.test("const x = hasRight(user, 'can_reopen');")).toBe(false);
  });

  it('the guard detects a team-role comparison (self-check)', () => {
    expect(TEAM_COMPARISON.test("if (m.teamRole === 'lead') return true;")).toBe(true);
    expect(TEAM_COMPARISON.test("const lead = assignee.teamRole !== 'preparer';")).toBe(true);
    expect(TEAM_COMPARISON.test("const x = hasRight(user, 'manage_team');")).toBe(false);
  });
});

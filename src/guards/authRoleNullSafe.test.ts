import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `auth.role()` is NULL when the request JWT carries no `role` claim (Supabase's definition reads
 * only the claim; it does not fall back to `current_user`). A guard written as
 *
 *   if auth.role() <> 'service_role' then raise ... end if;
 *
 * is therefore NULL for such a caller, the `if` does not fire, and the guard FAILS OPEN. The same
 * happens for a negated equality: `not (current_user = 'service_role' or auth.role() = 'service_role')`
 * is NULL, not TRUE, so the refusal is skipped. Migration 0086 fixes the instances that were live;
 * this guard stops a new one being written.
 *
 * A NULL-safe comparison is `is distinct from` / `is not distinct from`, or an explicit
 * `coalesce(auth.role(), ...)`. `is distinct from` reads naturally as "an absent role is not the
 * service role", which is the restrictive default.
 */
const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');

/** Strip -- comments so prose about auth.role() is not mistaken for code. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * The failing-open forms:
 *   auth.role() <> 'service_role'   (and !=)   — a refusal that a NULL role skips
 *   not ( ... auth.role() = ... )              — a negated equality, likewise NULL, likewise skipped
 * An affirmative `if auth.role() = 'service_role' then allow` is fail-CLOSED (NULL does not allow) and
 * is not flagged.
 */
function unsafeRoleComparisons(sql: string): string[] {
  const out: string[] = [];
  const text = stripComments(sql);
  const cmp = /auth\.role\(\)\s*(<>|!=)/g;
  let m: RegExpExecArray | null;
  while ((m = cmp.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (/coalesce\s*\(\s*$/.test(before)) continue; // coalesce(auth.role(), ...) is NULL-safe
    out.push(m[0].replace(/\s+/g, ' '));
  }
  return out;
}

/** A negated equality: `not (` ... `auth.role() =` before the matching close. */
function hasNegatedEquality(sql: string): boolean {
  return /not\s*\([^)]*auth\.role\(\)\s*=(?!=)/i.test(stripComments(sql));
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ file: f, text: readFileSync(join(MIGRATIONS, f), 'utf-8') }));

interface Def { file: string; name: string; key: string; body: string; }

/** Every `create [or replace] function [public.]<name>(<args>) ... $$;` block, with its argument list. */
function definitionsIn(file: string, rawSql: string): Def[] {
  const sql = stripComments(rawSql);
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  const starts: { name: string; idx: number; args: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = head.exec(sql)) !== null) {
    // Capture the argument list by balancing parentheses from the opening one.
    let depth = 1;
    let i = head.lastIndex;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
      i++;
    }
    const args = sql.slice(head.lastIndex, i - 1).replace(/\s+/g, ' ').trim().toLowerCase();
    starts.push({ name: m[1].toLowerCase(), idx: m.index, args });
  }
  return starts.map((s, i) => ({
    file,
    name: s.name,
    key: `${s.name}(${s.args})`,
    body: sql.slice(s.idx, i + 1 < starts.length ? starts[i + 1].idx : sql.length),
  }));
}

/** The effective definition of each function after every migration has been applied in order. */
function effectiveDefinitions(list: { file: string; text: string }[]): Def[] {
  const byKey = new Map<string, Def>();
  for (const { file, text } of list) {
    for (const def of definitionsIn(file, text)) byKey.set(def.key, def);
  }
  return [...byKey.values()];
}

describe('auth.role() comparisons are NULL-safe', () => {
  const effective = effectiveDefinitions(files);

  it('scans the migrations and finds functions', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(effective.length).toBeGreaterThan(200);
  });

  it('no effective function compares auth.role() with =, <> or != outside coalesce', () => {
    const offenders = effective
      .flatMap((d) => unsafeRoleComparisons(d.body).map((c) => `${d.file}: ${d.name}: ${c}`));
    expect(offenders).toEqual([]);
  });

  it('no effective function negates an equality against auth.role()', () => {
    const offenders = effective.filter((d) => hasNegatedEquality(d.body)).map((d) => `${d.file}: ${d.name}`);
    expect(offenders).toEqual([]);
  });

  it('the detector flags the failing-open forms and accepts the NULL-safe ones', () => {
    expect(unsafeRoleComparisons("if auth.role() <> 'service_role' then")).toEqual(["auth.role() <>"]);
    expect(unsafeRoleComparisons("if auth.role() != 'service_role' then")).toEqual(['auth.role() !=']);
    expect(unsafeRoleComparisons("if coalesce(auth.role(), '') <> 'service_role' then")).toEqual([]);
    expect(unsafeRoleComparisons("if auth.role() is distinct from 'service_role' then")).toEqual([]);
    expect(unsafeRoleComparisons("if auth.role() is not distinct from 'service_role' then")).toEqual([]);
    expect(unsafeRoleComparisons("-- auth.role() <> 'service_role' in prose")).toEqual([]);
    // An affirmative equality is fail-closed: a NULL role does not take the branch.
    expect(unsafeRoleComparisons("if auth.role() = 'service_role' then return; end if;")).toEqual([]);
    expect(hasNegatedEquality("if not (auth.role() = 'service_role' or public.is_platform_admin()) then")).toBe(true);
    expect(hasNegatedEquality("if auth.role() = 'service_role' then return; end if;")).toBe(false);
  });
});

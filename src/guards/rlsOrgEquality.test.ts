import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Law: RLS + `jwt_org_id()` is the only read path for tenant data.
 *
 * Every SELECT policy for an authenticated caller on a table that carries `org_id` must scope on
 * `org_id = public.jwt_org_id()`. A table whose policy instead relies on `is_platform_admin()` (a
 * platform metadata table) or on `auth.uid()` (a per-user table) is a deliberate, narrow exception,
 * listed below with its reason. This guard replays every migration in order and fails if a new
 * tenant table gains a select policy that is not org-scoped, so tenant isolation cannot be widened
 * by accident.
 *
 * The cross-universe share path (`shared_universe_view`) is a `security definer` projection, not a
 * policy, so it never appears here and never weakens a normal tenant read.
 */

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');

/** Policies that intentionally do not carry `jwt_org_id()`, each with its reason. */
const ALLOWED: Record<string, string> = {
  tenant_settings_select: 'platform-admin metadata (is_platform_admin())',
  tenant_settings_write: 'platform-admin metadata write (is_platform_admin(), with check)',
  sag_select: 'platform-admin view of support grants (is_platform_admin())',
  icap_settings_platform_select: 'platform-admin view of the invite cap (is_platform_admin())',
  email_settings_platform: 'platform-admin view of the sender shape (is_platform_admin())',
  email_queue_platform_select: 'platform-admin view of the queue (is_platform_admin())',
  np_select: 'per-user preference row (user_id = auth.uid())',
};

function allSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

/** Tables that carry an `org_id` column (created with it, or altered to add it). */
function orgTables(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/create table if not exists (?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    if (/\borg_id\b/.test(m[2])) out.add(m[1]);
  }
  for (const m of sql.matchAll(/alter table (?:public\.)?(\w+) add column if not exists org_id/g)) {
    out.add(m[1]);
  }
  return out;
}

interface Policy { name: string; table: string; command: string; body: string; }

function selectPolicies(sql: string): Policy[] {
  const out: Policy[] = [];
  const re = /create policy (\w+) on (?:public\.)?(\w+) for (select|all) to authenticated\s*([\s\S]*?);/g;
  for (const m of sql.matchAll(re)) {
    out.push({ name: m[1], table: m[2], command: m[3], body: m[4] });
  }
  return out;
}

describe('tenant isolation: RLS read path (WP12)', () => {
  const sql = allSql();
  const tables = orgTables(sql);
  const policies = selectPolicies(sql);

  it('finds the tenant tables and their select policies', () => {
    expect(tables.size).toBeGreaterThan(50);
    expect(policies.length).toBeGreaterThan(50);
  });

  it('every select policy on an org_id table is org-scoped or a listed exception', () => {
    const violations = policies
      .filter((p) => tables.has(p.table))
      .filter((p) => !/jwt_org_id\(\)/.test(p.body))
      .filter((p) => !(p.name in ALLOWED))
      .map((p) => `${p.table}.${p.name}`);
    expect(violations, 'select policies that could read across tenants').toEqual([]);
  });

  it('every listed exception still exists (no stale allow-list entry)', () => {
    const names = new Set(policies.map((p) => p.name));
    const stale = Object.keys(ALLOWED).filter((n) => !names.has(n));
    expect(stale, 'allow-list entries with no matching policy').toEqual([]);
  });

  it('no tenant table exposes an anon-facing policy', () => {
    // A grant of SELECT to anon is harmless while every policy is `to authenticated` (RLS returns
    // zero rows, the 0008 blanket-privilege convention). The invariant that matters is that no
    // policy names `anon` or `public` on a tenant table, which would make those grants readable.
    const anonPolicies = [...sql.matchAll(/create policy (\w+) on (?:public\.)?(\w+)[\s\S]{0,60}?to\s+(anon|public)\b/gi)]
      .filter((m) => tables.has(m[2]))
      .map((m) => `${m[2]}.${m[1]}`);
    expect(anonPolicies, 'tenant policies readable by anon/public').toEqual([]);
  });
});

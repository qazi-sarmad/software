/**
 * C2.1: the hosting requirements the Edge Function checks must be the ones the migrations create.
 *
 * A tenant's self-hosted database is told which extensions and roles it needs. If a migration adds
 * an extension and this list is not updated, the check silently passes a database that cannot run
 * the application. This test derives the lists from supabase/migrations and compares them, so the
 * two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CORE_EXTENSIONS, OPTIONAL_EXTENSIONS, REQUIRED_EXTENSIONS, REQUIRED_ROLES,
} from '../../supabase/functions/_shared/requiredHostingSpec';

const MIGRATIONS = resolve(process.cwd(), 'supabase/migrations');

function allMigrationText(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n')
    .replace(/--[^\n]*/g, '');
}

/** `create extension [if not exists] <name>` in any form, including inside a dynamic execute. */
function extensionsInMigrations(): Set<string> {
  const text = allMigrationText();
  const out = new Set<string>();
  for (const m of text.matchAll(/create\s+extension(?:\s+if\s+not\s+exists)?\s+([a-z_0-9]+)/gi)) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/** `create role <name>` in the migrations. */
function rolesInMigrations(): Set<string> {
  const text = allMigrationText();
  const out = new Set<string>();
  for (const m of text.matchAll(/create\s+role\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi)) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

describe('hosting requirements match the migrations', () => {
  it('lists every extension the migrations create', () => {
    const inMigrations = extensionsInMigrations();
    const listed = new Set([...REQUIRED_EXTENSIONS, ...CORE_EXTENSIONS, ...OPTIONAL_EXTENSIONS]
      .map((e) => e.toLowerCase()));
    for (const ext of inMigrations) {
      expect(listed.has(ext), `migration creates extension ${ext} but the hosting spec omits it`).toBe(true);
    }
  });

  it('lists no extension the migrations do not create', () => {
    const inMigrations = extensionsInMigrations();
    for (const ext of REQUIRED_EXTENSIONS) {
      expect(inMigrations.has(ext), `hosting spec lists ${ext} but no migration creates it`).toBe(true);
    }
  });

  it('splits the extensions into core and optional with no overlap', () => {
    const core = new Set(CORE_EXTENSIONS.map((e) => e.toLowerCase()));
    for (const ext of OPTIONAL_EXTENSIONS) {
      expect(core.has(ext.toLowerCase()), `${ext} is both core and optional`).toBe(false);
    }
    expect(new Set([...CORE_EXTENSIONS, ...OPTIONAL_EXTENSIONS]).size)
      .toBe(CORE_EXTENSIONS.length + OPTIONAL_EXTENSIONS.length);
  });

  it('lists every role the migrations create', () => {
    const inMigrations = rolesInMigrations();
    const listed = new Set(REQUIRED_ROLES.map((r) => r.toLowerCase()));
    for (const role of inMigrations) {
      expect(listed.has(role), `migration creates role ${role} but the hosting spec omits it`).toBe(true);
    }
    for (const role of REQUIRED_ROLES) {
      expect(inMigrations.has(role.toLowerCase()), `hosting spec lists role ${role} but no migration creates it`).toBe(true);
    }
  });

  it('keeps pgcrypto core and the scheduling extras optional', () => {
    expect([...CORE_EXTENSIONS]).toEqual(['pgcrypto']);
    expect([...OPTIONAL_EXTENSIONS].sort()).toEqual(['pg_cron', 'pg_net']);
  });
});

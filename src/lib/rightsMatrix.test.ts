import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RIGHTS, rightsForRole } from './rights';
import type { Role } from '../types';

/**
 * The seed rights matrix is declared in two places that must not drift: migrations
 * 0012_rights_closed.sql (the original eleven keys) and 0050_rights_extended.sql (the fourteen-key
 * matrix, authoritative at runtime), and src/lib/rights.ts (the fallback the app uses for demo and
 * test sessions). This test parses the migrations' UPDATE statements in order and asserts the final
 * per-role defaults equal the app's, right for right.
 */
const MIGRATIONS = [
  resolve(process.cwd(), 'supabase/migrations/0012_rights_closed.sql'),
  resolve(process.cwd(), 'supabase/migrations/0050_rights_extended.sql'),
];

function matrixFromMigrations(): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const file of MIGRATIONS) {
    const sql = readFileSync(file, 'utf-8');
    // Each update line carries the rights jsonb and a trailing "where is_seed and slug = '...'".
    for (const line of sql.split('\n')) {
      const m = line.match(/set rights = '(\{.*\})'::jsonb where is_seed and slug = '([a-z_]+)'/);
      if (m) out[m[2]] = JSON.parse(m[1]) as Record<string, boolean>;
    }
  }
  return out;
}

describe('2F-2b: the seed rights matrix matches src/lib/rights.ts', () => {
  const migration = matrixFromMigrations();
  const roles: Role[] = ['org_admin', 'cia', 'audit_manager', 'reviewer', 'preparer', 'observer', 'auditee'];

  it('the migration declares all seven seed roles', () => {
    for (const r of roles) expect(migration[r], `${r} missing from 0050`).toBeDefined();
  });

  it.each(roles)('%s: every right key agrees with the app defaults', (role) => {
    const app = rightsForRole(role);
    for (const key of RIGHTS) {
      expect(migration[role][key] ?? false, `${role}.${key}`).toBe(app[key] === true);
    }
  });
});

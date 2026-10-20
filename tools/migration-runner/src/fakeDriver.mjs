/**
 * A fake driver for the migration-runner step tests. It records every call and returns scripted
 * results, so the step logic is tested without two live databases. The real driver (driver.mjs) has
 * the same shape.
 */

export function makeFakeDriver(overrides = {}) {
  const calls = [];
  const record = (name, args) => calls.push({ name, args });

  const target = {
    serverVersion: async () => 'PostgreSQL 17.4',
    assertExtensions: async (ext) => { record('assertExtensions', [ext]); return ext.length; },
    assertRoles: async (roles) => { record('assertRoles', [roles]); return roles.length; },
    applyMigrations: async (migs) => { record('applyMigrations', [migs]); return migs.length; },
    seedTenant: async (org, rows) => { record('seedTenant', [org, rows]); return rows.length; },
    writeBatch: async (table, rows) => { record('writeBatch', [table, rows]); return rows.length; },
    copyAuthUsers: async (source, org) => { record('copyAuthUsers', [org]); return { rows: 3 }; },
    copyLedger: async (source, org) => { record('copyLedger', [org]); return { rows: 7 }; },
    verifyCopy: async (source, org, tables) => { record('verifyCopy', [org, tables]); return { ok: true }; },
    deltaSync: async (source, org, tables) => { record('deltaSync', [org, tables]); return { rows: 2 }; },
    buildDeploymentKit: async (org, path) => { record('buildDeploymentKit', [org, path]); return path; },
    ...overrides.target,
  };

  const source = {
    readBatch: async (table, fromKey, size) => {
      record('readBatch', [table, fromKey, size]);
      // Two batches then empty, deterministically.
      if (fromKey === 0) return { rows: Array.from({ length: size }, (_, i) => ({ id: i + 1 })), lastKey: size };
      if (fromKey === size) return { rows: [{ id: size + 1 }], lastKey: size + 1 };
      return { rows: [], lastKey: fromKey };
    },
    setMigrating: async (org, on) => { record('setMigrating', [org, on]); return true; },
    exportHash: async (org) => { record('exportHash', [org]); return 'abcdef0123456789'; },
    retireConnection: async (org) => { record('retireConnection', [org]); return true; },
    ...overrides.source,
  };

  return { target, source, calls };
}

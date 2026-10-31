/**
 * Gate G5 — two sources: the pure detector. The gate script (scripts/check-two-sources.mjs) does the
 * filesystem walk and imports this; the guard test (src/guards/twoSources.test.ts) drives the same
 * detector with synthetic source. Keeping the logic here (no top-level side effects) is what lets the
 * test exercise the real rule instead of a copy of it.
 *
 * No component may read the same tenant table from both the seed (the TenantSeed the shell hydrates,
 * reached through the scoped accessors `useScopedData` / `useApp` expose) and the database (a direct
 * `src/data` reader). That pattern is what produced the "two UIs" defect the audit found: two lists
 * for one table that agree in the dev demo and disagree in production, where the seed is empty.
 */

/** The scoped accessors the shell exposes, mapped to the table they are hydrated from. */
export const SEED_ACCESSOR_TABLE = {
  scopedUniverses: 'universes', rawUniverses: 'universes',
  scopedEntities: 'entities', rawEntities: 'entities',
  scopedEngagements: 'engagements', rawEngagements: 'engagements',
  scopedControls: 'controls', rawControls: 'controls',
  scopedWorkpapers: 'workpapers', rawWorkpapers: 'workpapers',
  scopedObservations: 'observations', rawObservations: 'observations',
  scopedIssues: 'issues', rawIssues: 'issues',
  scopedComments: 'comments', rawComments: 'comments',
  scopedCapItems: 'cap_items', rawCapItems: 'cap_items',
};

/**
 * @param source the component's source text
 * @param dataFunctions Map(key -> Map(exportName -> Set(table)))
 * @param resolve (specifier) -> key into dataFunctions, or null
 * @returns null when clean, else { clash: string[], note: Map(table -> Set(readerName)) }
 */
export function analyzeComponent(source, dataFunctions, resolve) {
  const seedTables = new Set();
  for (const [acc, table] of Object.entries(SEED_ACCESSOR_TABLE)) {
    if (new RegExp('\\b' + acc + '\\b').test(source)) seedTables.add(table);
  }
  if (seedTables.size === 0) return null;

  const dbTables = new Set();
  const note = new Map();
  const add = (table, name) => {
    dbTables.add(table);
    if (!note.has(table)) note.set(table, new Set());
    note.get(table).add(name);
  };

  // Named / aliased imports from a src/data module: `import { listEntities as le } from '...'`.
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const to = resolve(m[2]);
    if (!to || !dataFunctions.has(to)) continue;
    for (const part of m[1].split(',')) {
      const ex = part.trim().split(/\s+as\s+/)[0].trim();
      if (!ex) continue;
      const tables = dataFunctions.get(to).get(ex);
      if (tables) for (const t of tables) add(t, ex);
    }
  }
  // Namespace imports: `import * as writes from '../data/mutations'` -> writes.foo.
  for (const m of source.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g)) {
    const to = resolve(m[2]);
    if (!to || !dataFunctions.has(to)) continue;
    for (const mm of source.matchAll(new RegExp('\\b' + m[1] + '\\.([A-Za-z_$][\\w$]*)', 'g'))) {
      const tables = dataFunctions.get(to).get(mm[1]);
      if (tables) for (const t of tables) add(t, mm[1]);
    }
  }

  const clash = [...seedTables].filter((t) => dbTables.has(t));
  return clash.length ? { clash, note } : null;
}

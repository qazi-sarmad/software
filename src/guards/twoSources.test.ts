import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeComponent } from '../../scripts/two-sources-core.mjs';

/**
 * G5 — two sources. The gate (scripts/check-two-sources.mjs) bans a component reading one tenant
 * table from BOTH the seed (the scoped accessors) and the database (a src/data reader). That is the
 * defect the audit found: two lists for one table that agree in the dev demo and disagree in
 * production, where the seed is empty — so half the screen is blank and no test notices.
 *
 * These tests drive the SAME detector the gate runs (imported from scripts/two-sources-core.mjs), so a
 * change to the rule is exercised here too, and pin the real component that was fixed.
 */

const UNIVERSE = resolve(process.cwd(), 'src/data/universe.ts');
const dataFunctions = new Map([
  [UNIVERSE, new Map([['listEntities', new Set(['entities'])]])],
]);
const resolveSpec = (spec: string) => (spec.includes('data/universe') ? UNIVERSE : null);

describe('G5 two-sources detector', () => {
  it('flags a component that reads one table from the seed and the database', () => {
    const src = `
      import { listEntities } from '../data/universe';
      const { scopedEntities } = useScopedData();
      const [db, setDb] = useState([]);
      useEffect(() => { listEntities().then(setDb); }, []);
    `;
    const r = analyzeComponent(src, dataFunctions, resolveSpec);
    expect(r).not.toBeNull();
    expect(r!.clash).toEqual(['entities']);
    expect([...r!.note.get('entities')!]).toEqual(['listEntities']);
  });

  it('flags an aliased import (the name-based grep would miss it)', () => {
    const src = `
      import { listEntities as le } from '../data/universe';
      const { scopedEntities } = useScopedData();
      le().then(() => {});
    `;
    const r = analyzeComponent(src, dataFunctions, resolveSpec);
    expect(r!.clash).toEqual(['entities']);
  });

  it('passes a component that reads the table from one source only', () => {
    const onlySeed = `
      const { scopedEntities } = useScopedData();
      scopedEntities.map((e) => e.id);
    `;
    const onlyDb = `
      import { listEntities } from '../data/universe';
      const [db, setDb] = useState([]);
      useEffect(() => { listEntities().then(setDb); }, []);
    `;
    expect(analyzeComponent(onlySeed, dataFunctions, resolveSpec)).toBeNull();
    expect(analyzeComponent(onlyDb, dataFunctions, resolveSpec)).toBeNull();
  });

  it('does not treat a mention in a comment or string as a read', () => {
    const src = `
      // This screen must NOT also read listEntities().
      const note = 'listEntities() was the two-sources defect';
      const { scopedEntities } = useScopedData();
    `;
    expect(analyzeComponent(src, dataFunctions, resolveSpec)).toBeNull();
  });

  it('pins the real component that was fixed: AuditUniverseTab is single-source', () => {
    const s = readFileSync(
      resolve(process.cwd(), 'src/components/universe/AuditUniverseTab.tsx'),
      'utf-8',
    );
    // It still reads the seed (scopedEntities) — that is the one allowed source — and must not import
    // a database reader for the same table.
    expect(s).toMatch(/scopedEntities/);
    expect(s).not.toMatch(/import\s*\{[^}]*listEntities[^}]*\}\s*from/);
    expect(analyzeComponent(s, dataFunctions, resolveSpec)).toBeNull();
  });
});

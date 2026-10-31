import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { EXPLAIN_ENTRIES } from '../lib/explain/catalogue';
import { IIA_STANDARDS } from '../lib/explain/iia';
import { AGGREGATE_SURFACES } from '../lib/drilldownAggregates';
import { explainMounts, explainIdsForScreen, DYNAMIC_EXPLAIN } from '../lib/uiInventoryAttribution';

/**
 * E10 guard: the UI inventory's explain attribution must be the AUTHORED one.
 *
 * docs/EXPLAIN-LAYER.md §6 makes docs/UI-INVENTORY.md the designer's source of truth for "which
 * explain affordance does this screen carry". The first cut inferred it by substring-matching a
 * screen's contract testids across all of src/, which inverted the answer: OA-10 (certificate
 * config) was credited with 216 ids because its testids contain bare field names, while DB-01
 * (which mounts StandardsAffordance) was credited with none.
 *
 * This guard reads the real mounts and asserts the inventory agrees with them, so the doc cannot
 * drift back to the substring heuristic without a red test.
 */
const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\./.test(p)) out.push(p);
  }
  return out;
}

function srcTexts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of walk(SRC)) out[relative(ROOT, f)] = readFileSync(f, 'utf8');
  return out;
}

describe('UI inventory explain attribution (E10)', () => {
  const mounts = explainMounts(srcTexts());
  const inventory = readFileSync(join(ROOT, 'docs/UI-INVENTORY.md'), 'utf8');

  it('every attributed explain id resolves to a catalogue entry', () => {
    const known = new Set(EXPLAIN_ENTRIES.map((e) => e.id));
    const unknown: string[] = [];
    for (const [screen, ids] of mounts) {
      for (const id of ids) {
        if (id === DYNAMIC_EXPLAIN) continue;
        if (id.startsWith('standard.')) continue; // standards are held to the IIA catalogue below
        if (!known.has(id)) unknown.push(`${screen}:${id}`);
      }
    }
    expect(unknown, `explain mounts naming unknown ids: ${unknown.join(', ')}`).toEqual([]);
  });

  it('every attributed standard id resolves to a verified IIA standard', () => {
    const known = new Set(IIA_STANDARDS.map((s) => s.id));
    const unknown: string[] = [];
    for (const [screen, ids] of mounts) {
      for (const id of ids) {
        if (!id.startsWith('standard.')) continue;
        if (!known.has(id.slice('standard.'.length))) unknown.push(`${screen}:${id}`);
      }
    }
    expect(unknown, `explain mounts naming unknown standards: ${unknown.join(', ')}`).toEqual([]);
  });

  it('DB-01 carries its mounted standards, not an empty list (the inversion regression)', () => {
    const db01 = explainIdsForScreen(mounts, 'DB-01');
    expect(db01.length, 'DB-01 mounts StandardsAffordance, so it must carry ≥1 explain id').toBeGreaterThan(0);
    expect(db01).toContain('standard.12.2');
  });

  it('the certificate-config screen does not absorb the whole catalogue', () => {
    const oa10 = explainIdsForScreen(mounts, 'OA-10');
    expect(oa10.length, 'OA-10 mounts no explain surface, so it must be empty').toBe(0);
  });

  it('the inventory agrees with the authored attribution for every screen it names', () => {
    // Extract the `- **Explain ids (n):** ...` line under each `### ...` header, keyed by screen id.
    const byScreen = new Map<string, string>();
    let current: string[] = [];
    for (const line of inventory.split('\n')) {
      const h = line.match(/^### (.+)$/);
      if (h) {
        current = h[1].match(/[A-Z]{2,3}-\d{2}/g) ?? [];
        continue;
      }
      const m = line.match(/^- \*\*Explain ids \((\d+|dynamic)\):\*\* (.*)$/);
      if (m) {
        for (const id of current) byScreen.set(id, m[2]);
      }
    }
    const mismatches: string[] = [];
    for (const [screen, ids] of mounts) {
      if (!byScreen.has(screen)) continue; // a mount on an id the inventory does not document
      const authored = ids.has(DYNAMIC_EXPLAIN) ? 'dynamic' : [...ids].sort().join(',');
      const documented = byScreen.get(screen)!;
      if (authored === 'dynamic') {
        if (!documented.startsWith('dynamic')) mismatches.push(`${screen}: documented "${documented}" but dynamic`);
        continue;
      }
      for (const id of [...ids].sort()) {
        if (!documented.includes('`' + id + '`')) mismatches.push(`${screen}: missing ${id}`);
      }
    }
    expect(mismatches, `inventory disagrees with authored mounts: ${mismatches.join('; ')}`).toEqual([]);
  });

  it('the drilldown targets named in the inventory exist in the aggregate registry', () => {
    const known = new Set(AGGREGATE_SURFACES.map((a) => a.testId));
    const named = [...inventory.matchAll(/`([A-Z]{2,3}-\d{2}-[a-z0-9-]+)` → /g)].map((m) => m[1]);
    const unknown = named.filter((t) => !known.has(t));
    expect(unknown, `inventory names drilldown testids not in the registry: ${unknown.join(', ')}`).toEqual([]);
  });
});

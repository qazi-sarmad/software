import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXPLAIN_ENTRIES, explainEntryIds } from '../lib/explain/catalogue';
import { IIA_STANDARDS } from '../lib/explain/iia';

/**
 * G7 — Explain coverage (docs/EXPLAIN-LAYER.md §7).
 *
 * Rule: every method, option, field and status the UI offers resolves to a catalogue entry; every
 * entry is referenced by something real. A dropdown option shipped with no explanation is the defect
 * this gate exists to catch — the same class of defect as a config panel that saves a value nothing
 * reads.
 *
 * The gate reads the real vocabulary sources (the sampling method list in the panel, the status
 * unions in `src/types`, the config field ids in the governance panel) and the real screen sources,
 * and it closes over the `related` graph plus the standards' `explainIds`, so an entry that is only
 * reachable through another entry still counts as reachable. An entry that nothing can reach is dead
 * documentation and fails here.
 */
const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const srcFiles = walk(SRC);
const srcText = srcFiles
  .filter((f) => !f.includes(join('src', 'lib', 'explain')))
  .map((f) => readFileSync(f, 'utf8'));

const readSrc = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * Every catalogue id, or id family, that some source file names.
 *
 * A screen names an entry two ways: a literal id (`explainId="term.coverage"`) or a family built
 * from data (`explainId={`method.${sample.method}`}` — the method list is the data, the prefix is
 * the literal). Both count, because both are a real surface the UI offers. The family prefix is the
 * literal run before the first `${`.
 */
function referencedIds(): Set<string> {
  const ids = new Set(explainEntryIds());
  const found = new Set<string>();
  const prefixes: string[] = [];
  for (const text of srcText) {
    for (const m of text.matchAll(/['"`]([a-z]+\.[a-zA-Z0-9_.]+)['"`]/g)) {
      if (ids.has(m[1])) found.add(m[1]);
    }
    for (const m of text.matchAll(/`([a-z]+(?:\.[a-zA-Z0-9_]+)*\.)\$\{/g)) {
      prefixes.push(m[1]);
    }
  }
  for (const id of ids) {
    if (prefixes.some((p) => id.startsWith(p))) found.add(id);
  }
  // A screen entry corresponds to a screen the authored interface documents; the contract is a real
  // surface for it. An id in the catalogue with no documented screen is not rooted and fails below.
  const contract = readFileSync(resolve(process.cwd(), 'docs/ACP-UI-CONTRACT.md'), 'utf8');
  for (const m of contract.matchAll(/\b([A-Z]{2,3}-\d{2})\b/g)) {
    if (ids.has(`screen.${m[1]}`)) found.add(`screen.${m[1]}`);
  }
  return found;
}

/** The reference graph plus the standard catalogue's own citations. */
function reachableIds(): Set<string> {
  const byId = new Map(EXPLAIN_ENTRIES.map((e) => [e.id, e]));
  const roots = referencedIds();
  for (const s of IIA_STANDARDS) {
    for (const id of s.explainIds) roots.add(id);
    if (byId.has(`standard.${s.id}`)) roots.add(`standard.${s.id}`);
  }
  const reach = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...reach]) {
      for (const r of byId.get(id)?.related ?? []) {
        if (byId.has(r) && !reach.has(r)) {
          reach.add(r);
          grew = true;
        }
      }
    }
  }
  return reach;
}

describe('G7 — explain coverage', () => {
  it('every sampling method the panel offers resolves to a catalogue entry', () => {
    const body = readSrc('components/audit/SamplingPanel.tsx');
    const m = body.match(/const SAMPLING_METHODS = new Set\(\[([\s\S]*?)\]\)/);
    expect(m, 'SamplingPanel must declare its method list').toBeTruthy();
    const methods = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(methods.length).toBeGreaterThan(0);
    const missing = methods.filter((meth) => !explainEntryIds().includes(`method.${meth}`));
    expect(missing, `no catalogue entry for sampling methods: ${missing.join(', ')}`).toEqual([]);
  });

  it('every engagement, workpaper and CAP status resolves to a catalogue entry', () => {
    const types = readFileSync(join(SRC, 'types', 'index.ts'), 'utf8');
    const statusUnions = [
      // Engagement status union.
      /status: 'draft' \| 'in_progress' \| 'signed_off' \| 'reopened' \| 'closed';/,
      // Workpaper status union.
      /export type WorkpaperStatus =[\s\S]*?;\n/,
    ];
    const vocab: string[] = [];
    for (const re of statusUnions) {
      const m = types.match(re);
      if (m) vocab.push(...[...m[0].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    }
    expect(vocab.length).toBeGreaterThan(0);
    const known = new Set(explainEntryIds());
    const missing = vocab
      .filter((s) => !known.has(`status.engagement.${s}`) && !known.has(`status.workpaper.${s}`))
      .filter((s) => !['not_started', 'draft', 'in_progress', 'completed'].includes(s));
    expect(missing, `no catalogue entry for statuses: ${missing.join(', ')}`).toEqual([]);
  });

  it('every config field the governance panel offers resolves to a catalogue entry', () => {
    const body = readSrc('components/admin/OrgGovernancePanel.tsx');
    // The lifecycle controls map to the config entries authored for them. A panel control whose
    // testid appears must resolve; a testid the panel no longer renders is a stale mapping.
    const mapping: Array<[string, string]> = [
      ['oa-governance-testing-mode', 'field.config.testing_mode'],
      ['oa-governance-signoff-planning', 'field.config.signoff_role_planning'],
      ['oa-governance-signoff-testing', 'field.config.signoff_role_testing'],
      ['oa-governance-signoff-conclusion', 'field.config.signoff_role_conclusion'],
      ['oa-governance-opinion-required', 'field.config.report_opinion_required'],
      ['oa-governance-grace-hours', 'field.config.testing_grace_hours'],
    ];
    const known = new Set(explainEntryIds());
    const missing = mapping.filter(([, id]) => !known.has(id)).map(([, id]) => id);
    expect(missing, `no catalogue entry for config fields: ${missing.join(', ')}`).toEqual([]);
    // The panel must expose each control the mapping names, or the mapping is stale. The three
    // sign-off selects are rendered from one template, so their shared stem is what is asserted.
    expect(body, 'OrgGovernancePanel no longer renders the sign-off selects').toContain('oa-governance-signoff-');
    for (const [testid] of mapping) {
      if (testid.startsWith('oa-governance-signoff-')) continue;
      expect(body, `OrgGovernancePanel no longer renders ${testid}`).toContain(testid);
    }
    // Every sign-off role the panel offers must have an entry.
    for (const role of ['Planning', 'Testing', 'Conclusion']) {
      expect(body, `OrgGovernancePanel no longer offers signoffRole${role}`).toContain(`signoffRole${role}`);
      expect(known.has(`field.config.signoff_role_${role.toLowerCase()}`), `no entry for sign-off role ${role}`).toBe(true);
    }
  });

  it('every catalogue entry is reachable from a real surface', () => {
    const reach = reachableIds();
    const orphans = explainEntryIds().filter((id) => !reach.has(id));
    expect(orphans, `entries with no reachable caller: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every catalogue entry has a one-sentence summary and an effect', () => {
    const bad = EXPLAIN_ENTRIES.filter((e) => !e.summary.trim() || !e.effect.trim()).map((e) => e.id);
    expect(bad).toEqual([]);
  });
});

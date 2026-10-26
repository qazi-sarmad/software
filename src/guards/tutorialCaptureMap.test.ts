import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TUTORIAL_KEYS } from '../lib/tutorialKeys';
import { captureFor } from '../../scripts/tutorialCapture.mjs';

/**
 * Recorder navigation coverage (T2).
 *
 * `scripts/tutorialCapture.mjs` maps every key to the portal tab its screen lives on. The lookup
 * falls back to a default tab (`ORG_TAB[key] ?? 'features'`, `SA_TAB[key] ?? 'tenants'`), so a key
 * that is missing from the map records a DIFFERENT screen, and the recorder only fails when that
 * wrong screen renders none of the targets. `oa.governance` (OA-22) was in the frozen key list but
 * absent from `ORG_TAB`, so it would have recorded the Features tab.
 *
 * The invariant: every key whose plan opens an org or super-admin tab must have that tab named
 * explicitly in the map, never fall through to the default. The named tab must also be one the
 * portal actually declares.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The `ORG_TAB` / `SA_TAB` object literal from tutorialCapture.mjs, as key -> tab pairs. */
function tabMap(source: string, name: string): Map<string, string> {
  const body = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(source)?.[1];
  expect(body, `${name} not found in tutorialCapture.mjs`).toBeTruthy();
  const pairs = [...(body as string).matchAll(/'([a-z0-9.-]+)':\s*'([a-z0-9-]+)'/g)];
  return new Map(pairs.map((m) => [m[1], m[2]]));
}

/** The tab ids a portal declares, read from its `{ id: '...' }` tab list. */
function declaredTabs(source: string): Set<string> {
  return new Set([...source.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
}

const capture = read('scripts/tutorialCapture.mjs');
const ORG_TAB = tabMap(capture, 'ORG_TAB');
const SA_TAB = tabMap(capture, 'SA_TAB');

describe('every tutorial key is mapped to its portal tab (T2)', () => {
  it('never reaches the ORG_TAB default for a key that opens an org tab', () => {
    const offenders = TUTORIAL_KEYS
      .filter((d) => captureFor(d).kind === 'org')
      // GL-01 opens the consultation tab by name inside captureFor, not through ORG_TAB.
      .filter((d) => captureFor(d).tab !== 'consultation')
      .map((d) => d.key)
      .filter((k) => !ORG_TAB.has(k));
    expect(offenders, `fell back to the ORG_TAB default: ${offenders.join(', ')}`).toEqual([]);
  });

  it('never reaches the SA_TAB default for a key that opens a super-admin tab', () => {
    const offenders = TUTORIAL_KEYS
      .filter((d) => captureFor(d).kind === 'superadmin')
      .map((d) => d.key)
      .filter((k) => !SA_TAB.has(k));
    expect(offenders, `fell back to the SA_TAB default: ${offenders.join(', ')}`).toEqual([]);
  });

  it('maps each key to a tab its portal declares', () => {
    const orgTabs = declaredTabs(read('src/components/admin/OrgControlPanel.tsx'));
    const saTabs = declaredTabs(read('src/components/superadmin/SuperAdminPortal.tsx'));
    const offenders: string[] = [];
    for (const [key, tab] of ORG_TAB) {
      if (!orgTabs.has(tab)) offenders.push(`ORG_TAB ${key} -> ${tab}`);
    }
    for (const [key, tab] of SA_TAB) {
      if (!saTabs.has(tab)) offenders.push(`SA_TAB ${key} -> ${tab}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('sends oa.governance to the governance tab (regression: it fell back to features)', () => {
    expect(ORG_TAB.get('oa.governance')).toBe('governance');
    expect(captureFor({ key: 'oa.governance', screenId: 'OA-22' })).toEqual({ kind: 'org', tab: 'governance' });
  });
});

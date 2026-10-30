import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { TUTORIAL_KEYS } from '../lib/tutorialKeys';

/**
 * Tutorial target ownership (T1).
 *
 * A key's steps drive the screen the key belongs to, so a step target must be rendered by that
 * screen's own component — not by a component of another audience's portal. The concrete defect this
 * catches: `oa.tutorials` (OA-18, the Org Admin tutorial library) targeted `superadmin-tutorials`,
 * which only `src/components/superadmin/SuperAdminTutorials.tsx` declares, so the key depended on
 * another portal's implementation detail.
 */
/** Every non-test `.tsx?` file under `src`, with its text, read once and cached. */
let SRC_INDEX: { path: string; text: string }[] | null = null;
function srcIndex(): { path: string; text: string }[] {
  if (SRC_INDEX) return SRC_INDEX;
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) continue;
      out.push({ path: relative(process.cwd(), p), text: readFileSync(p, 'utf8') });
    }
  };
  walk(resolve(process.cwd(), 'src'));
  SRC_INDEX = out;
  return out;
}

function renderersOf(testid: string): string[] {
  const literal = testid.includes('<') ? testid.split('<')[0] : testid;
  const needles = [`"${literal}`, `'${literal}`, `\`${literal}`];
  return srcIndex()
    .filter((f) => needles.some((n) => f.text.includes(n)))
    .map((f) => f.path);
}

/**
 * Keys with a target that belongs to another portal, found by this audit and REPORTED for owner
 * approval rather than fixed here (T1: change only oa.tutorials now). An entry is not a waiver of
 * the rule: the assertion still fails for any key that is not listed, and each entry names the
 * screen it should target once approved. See docs/TUTORIAL-TARGET-AUDIT.md.
 */
const REPORTED_PENDING_APPROVAL = new Set(['oa.templates']);

describe('tutorial step targets belong to the key\'s own screen (T1)', () => {
  it('no org-admin key drives a control only the super-admin portal renders', () => {
    const offenders: string[] = [];
    for (const def of TUTORIAL_KEYS) {
      if (!def.key.startsWith('oa.')) continue;
      for (const step of def.steps) {
        if (!step.testid) continue;
        const renderers = renderersOf(step.testid);
        if (renderers.length > 0 && renderers.every((f) => f.includes('components/superadmin/'))) {
          if (REPORTED_PENDING_APPROVAL.has(def.key)) continue;
          offenders.push(`${def.key} -> ${step.testid} (only ${renderers.join(', ')})`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('OA-18 declares its own testid and oa.tutorials drives it', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/admin/OrgControlPanel.tsx'), 'utf8');
    expect(panel, 'OA-18 must render its own testid').toContain('data-testid="org-tutorials"');
    const def = TUTORIAL_KEYS.find((k) => k.key === 'oa.tutorials');
    expect(def, 'oa.tutorials must exist').toBeTruthy();
    const targets = def!.steps.map((s) => s.testid).filter(Boolean);
    expect(targets).toContain('org-tutorials');
  });
});

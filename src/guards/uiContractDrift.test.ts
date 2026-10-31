import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * UI contract drift guard (SCALE-1, UI doc update).
 *
 * The parallel UI redesign reads docs/ACP-UI-CONTRACT.md and its derived docs/UI-INVENTORY.md and
 * never opens the code. Both were authored when only the Appendix A screens existed; whole surfaces
 * built later (the core audit workspace, auth, chrome, sharing, guided provisioning) had no section,
 * so the inventory silently omitted them. This guard fails when a component declares a *static*
 * `data-testid="..."` that no contract section names, so a new screen cannot land undocumented.
 *
 * Only fully-static ids are checked. A prefix-parameterised id (`${prefix}-loading`) is skipped: its
 * literal stem is a component concern, not a screen the designer draws.
 */

const ROOT = resolve(process.cwd());
const contract = readFileSync(resolve(ROOT, 'docs/ACP-UI-CONTRACT.md'), 'utf8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('every static data-testid is documented in the UI contract (SCALE-1)', () => {
  const undocumented: string[] = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-testid="([^"$]+)"/g)) {
      if (!contract.includes(m[1])) undocumented.push(`${m[1]} (${relative(ROOT, file)})`);
    }
  }

  it('no component declares an undocumented static testid', () => {
    expect(
      undocumented.sort(),
      'add a contract section (docs/ACP-UI-CONTRACT.md) and regenerate docs/UI-INVENTORY.md for these',
    ).toEqual([]);
  });
});

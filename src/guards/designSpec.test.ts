import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The designer's spec (docs/DESIGN-SPEC.md) is auto-updating: it is generated from the inventory,
 * the contract, the tutorial keys, the recorded media and the stylesheet. This guard fails when
 *   (1) the committed file is not exactly what the generator produces (it has gone stale), or
 *   (2) it has lost one of the sections a designer relies on, or
 *   (3) it documents fewer screens/flows/tokens than the sources carry (a silent truncation).
 *
 * It regenerates into a temp file and diffs byte-for-byte — the only check that catches a stale
 * derived document. Run `npm run gen:design` to fix it.
 */

const ROOT = resolve(process.cwd());
const doc = readFileSync(resolve(ROOT, 'docs/DESIGN-SPEC.md'), 'utf8');
const inventory = readFileSync(resolve(ROOT, 'docs/UI-INVENTORY.md'), 'utf8');
const tutorialKeys = JSON.parse(readFileSync(resolve(ROOT, 'src/lib/tutorialKeys.json'), 'utf8'));

/** Screen ids named in the inventory's section headers. */
function inventoryScreenCount(): number {
  let n = 0;
  for (const m of inventory.matchAll(/^### (.+)$/gm)) {
    if ((m[1].match(/[A-Z]{2,3}-\d{2}/g) ?? []).length) n += 1;
  }
  return n;
}

describe('design spec is derived and current (designer catalogue)', () => {
  it('carries every section a designer needs', () => {
    for (const section of [
      '## Open design decisions',
      '## Screens',
      '## Flows',
      '## Design tokens',
      '## Typography',
      '## Coverage cross-check',
    ]) {
      expect(doc, `section ${section} absent`).toContain(section);
    }
  });

  it('documents every screen the inventory carries', () => {
    const n = inventoryScreenCount();
    expect(doc).toContain(`- **Screens:** ${n} `);
  });

  it('names every screen\'s data functions and RPCs (the calls a redesign must not move)', () => {
    const n = inventoryScreenCount();
    const count = (re: RegExp) => (doc.match(re) ?? []).length;
    expect(count(/^- \*\*Data functions \(/gm)).toBe(n);
    expect(count(/^- \*\*RPCs reachable \(/gm)).toBe(n);
  });

  it('documents every flow', () => {
    expect(doc).toContain(`- **Flows (tutorial keys):** ${tutorialKeys.length};`);
  });

  it('lists the deferred design-language rows (the boundary)', () => {
    for (const id of ['E8', 'U5', 'U7', 'U9', 'U10', 'U11', 'U12', 'U13', 'A-U1']) {
      expect(doc, `deferred row ${id} absent`).toMatch(new RegExp(`\\| ${id.replace('-', '\\-')} \\|`));
    }
  });

  it('the committed spec is exactly what the generator produces', () => {
    const dir = mkdtempSync(join(tmpdir(), 'design-spec-'));
    const out = join(dir, 'DESIGN-SPEC.md');
    try {
      execFileSync('node', ['scripts/gen-design-spec.mjs', out], { cwd: ROOT, stdio: 'pipe' });
      const generated = readFileSync(out, 'utf8');
      expect(
        generated,
        'docs/DESIGN-SPEC.md is stale — run `npm run gen:design` and commit the result'
      ).toBe(doc);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

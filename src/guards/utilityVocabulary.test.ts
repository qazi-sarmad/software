import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Design-system utility-vocabulary guard (integrator).
 *
 * The components read the design tokens through a semantic class vocabulary (`bg-surface`,
 * `text-primary`, `ring-accent`, …). Two defects are possible, and both shipped at once:
 *
 *   1. A class the components use is defined nowhere, so the element renders unstyled. `bg-primary`
 *      was used by 12 screens and declared in no stylesheet; `text-canvas` by 18; `divide-hairline`
 *      by 53.
 *   2. A class is defined as *plain CSS* in `tokens.css`, so Tailwind v4 cannot compose a variant
 *      onto it and every `hover:bg-surface-hover` (166 uses), `hover:text-primary` (116),
 *      `focus:border-accent` (29) compiled to nothing — the hover and focus states were dead.
 *
 * `STEMS` is the semantic vocabulary contract: the set of design-system names, independent of which
 * stylesheet declares them. Deriving it from the stylesheets alone would miss defect 1 entirely (a
 * class declared nowhere is in neither stylesheet, so nothing would look for it). The guard asserts:
 *
 *   A. every `(property)-(stem)` a component uses is declared — as a plain rule in
 *      `src/styles/tokens.css` or as a `@utility` in `src/index.css` (the builder's layer);
 *   B. every class a component uses *with a variant* (`hover:`, `focus:`, `group-hover:`,
 *      `placeholder:`, …) is a `@utility`, because only that form is variant-composable;
 *   C. every `@utility` in `index.css` is a name from this contract — the list cannot silently rot.
 */

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'src');

/** The design-system property prefixes the vocabulary is written with. */
const PROPS = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'divide', 'shadow', 'animate'];
/** The semantic stems — the design contract, not derived from any one stylesheet. */
const STEMS = [
  'canvas', 'surface', 'surface-hover', 'surface-elevated', 'surface-sunken', 'surface-active',
  'primary', 'secondary', 'tertiary',
  'accent', 'accent-subtle', 'accent-hover', 'accent-foreground',
  'verdigris', 'verdigris-text', 'verdigris-subtle',
  'cinnabar', 'cinnabar-subtle', 'brass', 'brass-subtle', 'brass-text',
  'glass', 'hairline', 'strong', 'border',
  'apple-10', 'apple-11', 'apple-12', 'apple-13', 'apple-14', 'apple-15', 'apple-16', 'apple-17',
  'apple-18', 'apple-20', 'apple-28', 'apple-32', 'apple-40',
  'muted', 'positive', 'moss', 'verdant', 'danger', 'critical',
  'btn-primary-bg', 'btn-primary-text', 'soft', 'fade-in',
];
const CLASSES = PROPS.flatMap((p) => STEMS.map((s) => `${p}-${s}`));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const componentFiles = walk(SRC).filter((f) => {
  const rel = relative(SRC, f).replace(/\\/g, '/');
  return /\.(tsx|ts)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !rel.startsWith('guards/') && !rel.startsWith('styles/');
});

const tokensCss = readFileSync(resolve(ROOT, 'src/styles/tokens.css'), 'utf-8');
const indexCss = readFileSync(resolve(ROOT, 'src/index.css'), 'utf-8');

/** Classes declared as a plain CSS rule in tokens.css (`.name` or `.name:hover`). */
const plainDeclared = new Set([...tokensCss.matchAll(/^\.([a-z0-9-]+)/gm)].map((m) => m[1]));
/** Classes declared as a Tailwind v4 utility in index.css — the variant-composable form. */
const utilityDeclared = new Set([...indexCss.matchAll(/@utility\s+([a-z0-9-]+)/g)].map((m) => m[1]));

const declared = (name: string) => plainDeclared.has(name) || utilityDeclared.has(name);

interface Use { file: string; cls: string; variant: string; }
const uses: Use[] = [];
for (const f of componentFiles) {
  const text = readFileSync(f, 'utf-8');
  for (const cls of CLASSES) {
    const re = new RegExp(String.raw`(?:^|[\s"'` + '`' + String.raw`])((?:[a-z-]+:)*)${cls}(?![\w-])`, 'g');
    for (const m of text.matchAll(re)) uses.push({ file: relative(ROOT, f), cls, variant: m[1] });
  }
}

describe('the design-system utility vocabulary resolves', () => {
  it('finds the components and the vocabulary', () => {
    expect(componentFiles.length).toBeGreaterThan(40);
    expect(CLASSES.length).toBeGreaterThan(100);
    expect(utilityDeclared.size).toBeGreaterThan(0);
  });

  it('every vocabulary class a component uses is declared (tokens.css rule or index.css @utility)', () => {
    const missing = new Map<string, string>();
    for (const u of uses) if (!declared(u.cls)) missing.set(u.cls, u.file);
    expect([...missing.entries()].map(([c, f]) => `${c} (used in ${f})`)).toEqual([]);
  });

  it('every class used with a variant is declared as a @utility, so no variant is dead', () => {
    const offenders = new Map<string, string>();
    for (const u of uses) if (u.variant && !utilityDeclared.has(u.cls)) offenders.set(`${u.variant}${u.cls}`, u.file);
    expect([...offenders.entries()].map(([c, f]) => `${c} (used in ${f})`)).toEqual([]);
  });

  it('every @utility in index.css is a name from the vocabulary contract', () => {
    expect([...utilityDeclared].filter((c) => !CLASSES.includes(c)).sort()).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ENGINE_NAME, PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_TITLE } from '../lib/product';
import { syncIndexHtml, syncMetadata } from '../../scripts/sync-product-name.mjs';

/**
 * S16 — the product and engine names live in ONE module (`src/lib/product.ts`). A rename is one
 * commit: edit the constant and run `npm run gen:name` for the two files a browser build cannot
 * import (`index.html`, `metadata.json`).
 *
 * This guard fails the build when:
 *   - a raw `Provio` / `Systeligon` literal reappears in live code outside the constants modules and
 *     the sync script (so a new screen cannot hard-code the name);
 *   - the Edge Function mirror `supabase/functions/_shared/productName.ts` drifts from this module;
 *   - the committed `index.html` / `metadata.json` no longer match what `gen:name` would write.
 */

const ROOT = resolve(process.cwd());
const SCAN_DIRS = ['src', 'supabase/functions'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);
const SCAN_EXT = /\.(ts|tsx|js|mjs)$/;

// The files that are allowed to hold the literal: the single source of truth, its Edge mirror, the
// parity fixture, and the generator that writes the literal into the two static files.
const ALLOW = new Set([
  'src/lib/product.ts',
  'supabase/functions/_shared/productName.ts',
  'src/guards/productName.test.ts',
  'scripts/sync-product-name.mjs',
]);

const NAMES = [PRODUCT_NAME, ENGINE_NAME];

function walk(dir: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    if (SKIP_DIRS.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A name occurrence in code (not in a comment): a bare word, JSX text, or a quoted string. */
export function nameHits(text: string): string[] {
  const body = stripComments(text);
  const hits: string[] = [];
  for (const name of NAMES) {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    if (re.test(body)) hits.push(name);
  }
  return hits;
}

describe('S16 — the product name lives in one module', () => {
  it('no raw name literal in live code outside the allowed files', () => {
    const offenders: string[] = [];
    for (const d of SCAN_DIRS) {
      for (const file of walk(join(ROOT, d))) {
        const rel = relative(ROOT, file).split('\\').join('/');
        if (ALLOW.has(rel) || !SCAN_EXT.test(rel)) continue;
        const hits = nameHits(readFileSync(file, 'utf8'));
        if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Edge Function mirror matches the app constant', () => {
    const mirror = readFileSync(
      join(ROOT, 'supabase/functions/_shared/productName.ts'), 'utf8',
    );
    expect(/PRODUCT_NAME\s*=\s*'([^']*)'/.exec(mirror)?.[1]).toBe(PRODUCT_NAME);
  });

  it('the committed index.html and metadata.json match what gen:name would write', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const meta = readFileSync(join(ROOT, 'metadata.json'), 'utf8');
    expect(syncIndexHtml(html, PRODUCT_TITLE)).toBe(html);
    expect(syncMetadata(meta, PRODUCT_TITLE)).toBe(meta);
    expect(html).toContain(`<title>${PRODUCT_TITLE}</title>`);
    expect(PRODUCT_TITLE).toBe(`${PRODUCT_NAME} - ${PRODUCT_TAGLINE}`);
  });

  it('the detector catches a reintroduced literal (so the guard cannot go blind)', () => {
    expect(nameHits('<h1>{PRODUCT_NAME}</h1>')).toEqual([]);
    expect(nameHits('const t = PRODUCT_TITLE')).toEqual([]);
    expect(nameHits('<h1>Provio</h1>').length).toBeGreaterThan(0);
    expect(nameHits("const e = 'Systeligon'").length).toBeGreaterThan(0);
    expect(nameHits('// a comment naming Provio and Systeligon')).toEqual([]);
  });
});

#!/usr/bin/env node
/**
 * S16 — write the product name from `src/lib/product.ts` into the files a browser build cannot
 * import: `index.html` (the title and the OpenGraph title) and `metadata.json` (the web manifest
 * name). Run after changing PRODUCT_NAME:
 *
 *   npm run gen:name
 *
 * `src/guards/productName.test.ts` runs the same replacement over a copy and fails if the committed
 * files differ, so the two cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read PRODUCT_NAME / PRODUCT_TITLE from src/lib/product.ts — the single source of truth. */
export function productTitle() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/product.ts'), 'utf8');
  const tagline = /PRODUCT_TAGLINE = '([^']*)'/.exec(src)?.[1];
  const name = /export const PRODUCT_NAME = '([^']*)'/.exec(src)?.[1];
  if (!name || !tagline) throw new Error('PRODUCT_NAME / PRODUCT_TAGLINE not found in src/lib/product.ts');
  return { name, tagline, title: `${name} - ${tagline}` };
}

/** `Provio - Enterprise Internal Audit Platform` -> PRODUCT_TITLE, wherever it appears. */
const OLD_TITLE = 'Provio - Enterprise Internal Audit Platform';

export function syncIndexHtml(text, title) {
  return text.split(OLD_TITLE).join(title);
}

export function syncMetadata(text, title) {
  return text.replace(/"name":\s*"[^"]*"/, `"name": "${title}"`);
}

export function apply() {
  const { title } = productTitle();
  const htmlPath = path.join(ROOT, 'index.html');
  const metaPath = path.join(ROOT, 'metadata.json');
  fs.writeFileSync(htmlPath, syncIndexHtml(fs.readFileSync(htmlPath, 'utf8'), title));
  fs.writeFileSync(metaPath, syncMetadata(fs.readFileSync(metaPath, 'utf8'), title));
  console.log(`sync-product-name: wrote "${title}" to index.html and metadata.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) apply();

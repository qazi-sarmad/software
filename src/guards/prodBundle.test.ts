import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Builds the app in production mode into a temp folder and greps the emitted files.
 * This is the build-time guard for: no dev routes, no persona code and no TEMP_AUTH in production.
 */
const FORBIDDEN = [
  'Simulate Viewpoint',
  '/dev/access',
  '/dev/palette',
  'TEMP_AUTH',
  'DevAccessPage',
  'DevPalettePage',
  'Identity & Role Simulation',
  'Identity &amp; Role Simulation',
  'Trace Red Thread',
  'Executive Assurance Committee Deck',
  // Tenant seed data must not be shipped in a production build (Spec 28: no hardcoded or demo data in production).
  'Global Banking',
  'Treasury & Liquidity',
  'Treasury Intraday',
  'Corporate Treasury Revenue',
  'Prime Brokerage',
  'provio.internal',
  'provio-corp-tenant',
  'Alexandra Wright',
  'Elena Rostova',
  'Marcus Vance',
  'CANARY',
];

let outDir = '';
let files: { path: string; text: string }[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('production bundle', () => {
  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), 'provio-prod-'));
    // Vitest sets NODE_ENV=test, which Vite would treat as a development build (import.meta.env.DEV = true).
    // A real `vite build` runs with NODE_ENV=production, so do the same here.
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({
        root: resolve(process.cwd()),
        mode: 'production',
        logLevel: 'silent',
        configFile: resolve(process.cwd(), 'vite.config.ts'),
        build: { outDir, emptyOutDir: true, write: true },
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
    files = walk(outDir)
      .filter((p) => /\.(js|css|html|map)$/.test(p))
      .map((p) => ({ path: p, text: readFileSync(p, 'utf-8') }));
  }, 240_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('emitted JavaScript', () => {
    expect(files.filter((f) => f.path.endsWith('.js')).length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)('contains no "%s"', (needle) => {
    const hits = files.filter((f) => f.text.includes(needle)).map((f) => f.path.replace(outDir, ''));
    expect(hits).toEqual([]);
  });

  it('emits no dev-page chunks', () => {
    const names = files.map((f) => f.path.replace(outDir, ''));
    expect(names.filter((n) => /Dev(Access|Palette)/i.test(n))).toEqual([]);
  });

  it('shows the sign-in screen as unavailable rather than offering any stub', () => {
    const all = files.map((f) => f.text).join('\n');
    expect(all).toContain('Authentication has not been configured');
  });
});

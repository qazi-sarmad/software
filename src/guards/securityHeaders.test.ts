import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * WP10 guard: the browser-hardening headers are artefacts on disk, and a header is easy to delete by
 * accident. This guard fails if the CSP, the static-host header set, the noindex posture or the
 * Vite mirror disappears, so the control cannot be lost silently. It asserts content, not behaviour:
 * the header values themselves are reviewed in docs/SECURITY-THREAT-MODEL.md.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const HEADERS = read('public/_headers');
const ROBOTS = read('public/robots.txt');
const INDEX = read('index.html');
const VITE = read('vite.config.ts');

describe('security header artefacts (WP10)', () => {
  it('the static-host header set carries the full policy', () => {
    expect(HEADERS).toMatch(/Content-Security-Policy:.*default-src 'self'/);
    expect(HEADERS).toMatch(/frame-ancestors 'none'/);
    expect(HEADERS).toMatch(/Strict-Transport-Security: max-age=\d+/);
    expect(HEADERS).toMatch(/X-Frame-Options: DENY/);
    expect(HEADERS).toMatch(/X-Content-Type-Options: nosniff/);
    expect(HEADERS).toMatch(/Referrer-Policy: strict-origin-when-cross-origin/);
    expect(HEADERS).toMatch(/Permissions-Policy:.*camera=\(\)/);
  });

  it('the console path is explicitly noindexed', () => {
    expect(HEADERS).toMatch(/\/superadmin\/\*[\s\S]*?X-Robots-Tag: noindex, nofollow, noarchive/);
  });

  it('robots.txt disallows every crawler', () => {
    expect(ROBOTS).toMatch(/User-agent: \*/);
    expect(ROBOTS).toMatch(/Disallow: \//);
  });

  it('index.html carries noindex and a referrer policy, and no meta CSP', () => {
    expect(INDEX).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(INDEX).toMatch(/<meta name="referrer" content="strict-origin-when-cross-origin"/);
    // A meta CSP would also bind the dev server and block the React-refresh preamble.
    expect(INDEX).not.toMatch(/http-equiv="Content-Security-Policy"/i);
  });

  it('the Vite server mirrors the same header set', () => {
    expect(VITE).toMatch(/Strict-Transport-Security/);
    expect(VITE).toMatch(/X-Frame-Options': 'DENY'/);
    expect(VITE).toMatch(/frame-ancestors 'none'/);
  });
});

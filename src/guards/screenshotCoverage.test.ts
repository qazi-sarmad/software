import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * C5.4: the screenshot sweep must name every Appendix A screen. The sweep is a tool, not a gate, so
 * an unreachable screen is recorded in the manifest rather than failing the run — but a screen the
 * sweep never attempts to capture is a silent gap, which is what this guard prevents.
 *
 * Appendix A: GL-01, TUT-01, SA-01..15, OA-01..21, WK-01..10, EX-01..04, plus OA-22 (C3.2-B).
 */
const APPENDIX_A = [
  'GL-01',
  'TUT-01',
  ...Array.from({ length: 15 }, (_, i) => `SA-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 21 }, (_, i) => `OA-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `WK-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 4 }, (_, i) => `EX-${String(i + 1).padStart(2, '0')}`),
  'OA-22',
];

describe('screenshot sweep coverage (C5.4)', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts/screenshot-all.mjs'), 'utf8');
  const captured = new Set([...script.matchAll(/id: '([A-Z]{2,3}-\d{2})'/g)].map((m) => m[1]));

  it('names every Appendix A screen id', () => {
    expect(APPENDIX_A.filter((id) => !captured.has(id))).toEqual([]);
  });

  it('captures each screen in all three presets and both themes', () => {
    expect(script).toContain("const PRESETS = ['ledger', 'porcelain', 'bone']");
    expect(script).toContain("const THEMES = ['light', 'dark']");
  });

  it('signs in with the seeded synthetic principals, not a made-up address', () => {
    // The emails must match e2e/global-setup.ts. A typo here silently produces an unreached screen.
    const setup = readFileSync(resolve(process.cwd(), 'e2e/global-setup.ts'), 'utf8');
    const emails = [...script.matchAll(/'([a-z.]+@provio-test\.invalid)'/g)].map((m) => m[1]);
    expect(emails.length).toBeGreaterThan(3);
    for (const email of emails) expect(setup).toContain(email);
  });
});

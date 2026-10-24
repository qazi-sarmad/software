import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * S5 / L2: a security assertion must never be skippable.
 *
 * `e2e/s5-ai.spec.ts` guarded its L2 check with `if (await result.count()) { expect(...) }`. When
 * the fixture left `ai_assist` unentitled and `ai_enabled` false, the plan refusal fired before the
 * endpoint deny-list, the result element rendered a different message and the guard made the whole
 * assertion pass — an L2 rule (tenant data never reaches a vendor-hosted model) with no test behind
 * it. This guard rejects that shape in every spec: an `if (await ...count())` (or `.isVisible()`)
 * wrapping an `expect` inside a conditional body.
 */

const SPEC_DIR = resolve(process.cwd(), 'e2e');

function specFiles(): string[] {
  return readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => join(SPEC_DIR, f));
}

describe('E2E assertions are unconditional (S5 / L2)', () => {
  it('no spec wraps an expect in an if on a locator count or visibility', () => {
    const offenders: string[] = [];
    for (const file of specFiles()) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/^\s*if\s*\(\s*await\s+.*\.(count|isVisible)\(\)\s*\)/.test(line)) return;
        // Look at the block the `if` opens: a conditional `expect` is the defect.
        const body = lines.slice(i, i + 8).join('\n');
        if (/expect\(/.test(body)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders, `conditional assertion(s): ${offenders.join(', ')}`).toEqual([]);
  });

  it('the L2 vendor-hosted assertion is not guarded', () => {
    const src = readFileSync(join(SPEC_DIR, 's5-ai.spec.ts'), 'utf8');
    const test = src.slice(src.indexOf('a vendor-hosted endpoint is refused'));
    const body = test.slice(0, test.indexOf('});'));
    expect(body).not.toMatch(/if\s*\(\s*await/);
    expect(body).toContain("toContainText('vendor-hosted AI service')");
  });
});

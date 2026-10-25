import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * A security assertion must never be skippable.
 *
 * The defect this guards against was first seen in the (since-removed) AI spec, which wrapped its
 * L2 check in `if (await result.count()) { expect(...) }`: when the fixture left the feature
 * unentitled the refusal fired first, the result element rendered a different message, and the
 * guard made the whole assertion pass — a rule with no test behind it. This guard rejects that shape
 * in every spec: an `if (await ...count())` (or `.isVisible()`) wrapping an `expect` inside a
 * conditional body.
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

  it('the escalation refusal assertion is not guarded', () => {
    const src = readFileSync(join(SPEC_DIR, 's6-escalation.spec.ts'), 'utf8');
    expect(src).not.toMatch(/if\s*\(\s*await[^)]*\.(count|isVisible)\(\)\s*\)[\s\S]{0,200}expect\(/);
  });
});

/**
 * Released-pack resolution (S10/S11). A released pack is data; this proves the data is turned back
 * into the executable rules, and that a rule the client cannot reconstruct is reported, never
 * silently substituted.
 */
import { describe, expect, it } from 'vitest';
import { resolveReleasedRules } from './released';

describe('resolveReleasedRules', () => {
  it('resolves a shipped id@version to its implementation', () => {
    const { rules, missing } = resolveReleasedRules({
      name: 'audit-default', version: 1, target: 'population', contentHash: 'a'.repeat(64),
      rules: [{ id: 'numeric.duplicates', version: 1, kind: 'duplicates' }],
    });
    expect(missing).toEqual([]);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('numeric.duplicates');
    expect(typeof rules[0].evaluate).toBe('function');
  });

  it('reports a rule it cannot reconstruct rather than dropping it silently', () => {
    const { rules, missing } = resolveReleasedRules({
      name: 'audit-default', version: 1, target: 'population', contentHash: 'a'.repeat(64),
      rules: [
        { id: 'numeric.duplicates', version: 1, kind: 'duplicates' },
        { id: 'numeric.gone', version: 7, kind: 'gone' },
      ],
    });
    expect(rules.map((r) => r.id)).toEqual(['numeric.duplicates']);
    expect(missing).toEqual(['numeric.gone@7']);
  });

  it('an empty pack resolves to no rules and no missing entries', () => {
    const { rules, missing } = resolveReleasedRules({
      name: 'empty', version: 1, target: 'population', contentHash: 'b'.repeat(64), rules: [],
    });
    expect(rules).toEqual([]);
    expect(missing).toEqual([]);
  });
});

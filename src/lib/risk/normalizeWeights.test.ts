import { describe, expect, it } from 'vitest';
import { normalizeWeights } from '../siraEngine';

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('D14: factor weights normalise to exactly 100', () => {
  it('an even split sums to exactly 100', () => {
    expect(sum(normalizeWeights({ a: 1, b: 1, c: 1 }))).toBe(100);
  });

  it('an uneven split sums to exactly 100 (never 99.99)', () => {
    const w = normalizeWeights({ a: 1, b: 2, c: 3, d: 7, e: 11 });
    expect(sum(w)).toBe(100);
    expect(Object.values(w).every(Number.isInteger)).toBe(true);
  });

  it('the default six-factor model stays at 100', () => {
    const w = normalizeWeights({ inherent_risk: 1, complexity: 1, regulatory_exposure: 1, prior_findings: 1, time_since_audit: 1, materiality: 1 });
    expect(sum(w)).toBe(100);
    // Ties are broken by factor key, so the four alphabetically-first keys take the remainder.
    expect(w).toEqual({ complexity: 17, inherent_risk: 17, materiality: 17, prior_findings: 17, regulatory_exposure: 16, time_since_audit: 16 });
  });

  it('is deterministic: the same weights give the same result, ties broken by key', () => {
    const a = normalizeWeights({ z: 1, a: 1, m: 1 });
    const b = normalizeWeights({ m: 1, z: 1, a: 1 });
    expect(a).toEqual(b);
    expect(sum(a)).toBe(100);
  });

  it('a non-positive weight is zero, and the rest still sum to 100', () => {
    const w = normalizeWeights({ a: 1, b: 0, c: 3 });
    expect(w.b).toBe(0);
    expect(sum(w)).toBe(100);
  });

  it('all-non-positive gives all zeros, not a division by zero', () => {
    expect(normalizeWeights({ a: 0, b: -1 })).toEqual({ a: 0, b: 0 });
  });

  it('a single factor takes the whole 100', () => {
    expect(normalizeWeights({ only: 5 })).toEqual({ only: 100 });
  });
});

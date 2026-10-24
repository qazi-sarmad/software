import { describe, expect, it } from 'vitest';
import { formatFieldPairs, stableKey } from './readable';

describe('formatFieldPairs', () => {
  it('renders a flat record as key: value pairs', () => {
    expect(formatFieldPairs({ z: 2, min: 10 })).toBe('z: 2, min: 10');
  });

  it('shows null and undefined as a dash', () => {
    expect(formatFieldPairs({ a: null, b: undefined })).toBe('a: —, b: —');
  });

  it('renders arrays and nested values without JSON', () => {
    expect(formatFieldPairs({ rows: [1, 2], nested: { a: 1 } })).toBe('rows: 1, 2, nested: …');
  });

  it('returns an empty string for a missing record', () => {
    expect(formatFieldPairs(null)).toBe('');
  });
});

describe('stableKey', () => {
  it('is order-independent for object keys', () => {
    expect(stableKey({ a: 1, b: 2 })).toBe(stableKey({ b: 2, a: 1 }));
  });

  it('distinguishes different values', () => {
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
  });

  it('handles arrays, primitives and null', () => {
    expect(stableKey([1, 'x', true])).toBe('[n:1,s:x,n:true]');
    expect(stableKey(null)).toBe('∅');
    expect(stableKey(3)).toBe('n:3');
  });

  it('is deterministic across calls', () => {
    const v = { b: [1, 2], a: 'x' };
    expect(stableKey(v)).toBe(stableKey(v));
  });
});

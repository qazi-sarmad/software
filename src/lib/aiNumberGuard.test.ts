import { describe, expect, it } from 'vitest';
import {
  extractNumbers, findUnverifiedFigures, normaliseNumber,
} from '../../supabase/functions/_shared/aiNumberGuard';

describe('normaliseNumber', () => {
  it('strips separators, a trailing percent and trailing zeros', () => {
    expect(normaliseNumber('1,234.50')).toBe('1234.5');
    expect(normaliseNumber('1234')).toBe('1234');
    expect(normaliseNumber('50%')).toBe('50');
    expect(normaliseNumber('+7')).toBe('7');
    expect(normaliseNumber('10.00')).toBe('10');
  });
});

describe('extractNumbers', () => {
  it('finds integers, decimals, percentages and thousands separators', () => {
    expect(extractNumbers('risk is 12 and amount 1,500.75 at 30%')).toEqual(['12', '1,500.75', '30%']);
  });
  it('finds ISO and slash dates', () => {
    expect(extractNumbers('issued 2024-05-01 and 2024/06/02')).toEqual(['2024-05-01', '2024/06/02']);
  });
  it('does not treat a word as a number', () => {
    expect(extractNumbers('plan2 is ready')).toEqual(['2']);
  });
});

describe('findUnverifiedFigures', () => {
  it('flags a figure not in the allow-list', () => {
    const out = findUnverifiedFigures('The residual risk is 42 and the amount is 100.', ['100']);
    expect(out.map((f) => f.token)).toEqual(['42']);
    expect(out[0].context).toContain('residual risk');
  });
  it('accepts an equal value written differently', () => {
    expect(findUnverifiedFigures('Total 1,000 items.', ['1000'])).toEqual([]);
    expect(findUnverifiedFigures('At 50 percent (50%).', ['50'])).toEqual([]);
  });
  it('returns nothing when every figure is allowed', () => {
    expect(findUnverifiedFigures('12 of 30 sampled', ['12', '30'])).toEqual([]);
  });
  it('deduplicates a repeated figure', () => {
    expect(findUnverifiedFigures('42 and again 42', []).length).toBe(1);
  });
  it('flags an invented date', () => {
    const out = findUnverifiedFigures('Sealed on 2099-01-01.', []);
    expect(out.map((f) => f.token)).toEqual(['2099-01-01']);
  });
});

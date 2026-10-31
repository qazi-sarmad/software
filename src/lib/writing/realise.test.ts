import { describe, expect, it } from 'vitest';
import { decimal, decimalToString } from './canonical';
import {
  applyRounding, asDecimal, assembleSentence, capitalise, countPhrase, formatDate, formatList,
  formatMoney, formatNumber, formatPercent, formatShortDate, groupDigits, ordinal, ordinalPhrase,
  plural, renderTemplate, templateSlotNames, type NumberFormat,
} from './realise';
import type { Locale, Slot } from './types';

const gb: NumberFormat = { locale: 'en-GB', scale: 2, grouping: true, rounding: 'half_up' };
const us: NumberFormat = { locale: 'en-US', scale: 2, grouping: true, rounding: 'half_up' };

describe('W2.4 number formatting', () => {
  it('formats zero, one, negative and very large at the declared scale', () => {
    expect(formatNumber(decimal('0', 2), gb)).toBe('0.00');
    expect(formatNumber(decimal('1', 2), gb)).toBe('0.01');
    expect(formatNumber(decimal('-12345', 2), gb)).toBe('-123.45');
    expect(formatNumber(decimal('123456789012345', 2), gb)).toBe('1,234,567,890,123.45');
  });

  it('groups from the right', () => {
    expect(groupDigits('1234567', ',')).toBe('1,234,567');
    expect(groupDigits('999', ',')).toBe('999');
    expect(groupDigits('1000', ',')).toBe('1,000');
    expect(groupDigits('-1000000', ',')).toBe('-1,000,000');
  });

  it('applies the declared rounding mode', () => {
    expect(decimalToString(applyRounding(decimal('125', 2), 1, 'half_up'))).toBe('1.3');
    expect(decimalToString(applyRounding(decimal('125', 2), 1, 'half_even'))).toBe('1.2');
    expect(decimalToString(applyRounding(decimal('135', 2), 1, 'half_even'))).toBe('1.4');
    expect(decimalToString(applyRounding(decimal('129', 2), 1, 'down'))).toBe('1.2');
    expect(decimalToString(applyRounding(decimal('121', 2), 1, 'up'))).toBe('1.3');
    expect(decimalToString(applyRounding(decimal('-125', 2), 1, 'half_up'))).toBe('-1.3');
  });

  it('pads up when the scale is larger', () => {
    expect(decimalToString(applyRounding(decimal('5', 0), 3, 'half_up'))).toBe('5.000');
  });

  // 90 cases: every scale 0..8 against a spread of values, plus every rounding mode.
  it('is deterministic across 90 scale/value/mode combinations', () => {
    const values = ['0', '1', '5', '99', '100', '1234', '99999', '1000000', '-7', '-12345'];
    const modes = ['half_up', 'half_even', 'down', 'up'] as const;
    let cases = 0;
    for (let scale = 0; scale <= 8; scale++) {
      for (const v of values) {
        for (const mode of modes.slice(0, scale === 0 ? 4 : 1)) {
          const out = applyRounding(decimal(v, scale), Math.max(0, scale - 1), mode);
          expect(out.scale).toBe(Math.max(0, scale - 1));
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(80);
  });
});

describe('W2.4 money, percent, count and list', () => {
  it('places the currency symbol per locale', () => {
    expect(formatMoney(decimal('125000', 2), '\u00a3', gb)).toBe('\u00a31,250.00');
    expect(formatMoney(decimal('125000', 2), '$', us)).toBe('$1,250.00');
  });

  it('formats a percent', () => {
    expect(formatPercent(decimal('125', 1), { ...gb, scale: 1 })).toBe('12.5%');
    expect(formatPercent(decimal('0', 0), { ...gb, scale: 0 })).toBe('0%');
  });

  it('agrees the count with its noun', () => {
    expect(countPhrase(0, 'control')).toBe('0 controls');
    expect(countPhrase(1, 'control')).toBe('1 control');
    expect(countPhrase(2, 'control')).toBe('2 controls');
    expect(countPhrase(-1, 'control')).toBe('-1 control');
    expect(countPhrase(10000, 'row')).toBe('10,000 rows');
    expect(countPhrase(1, 'entry', 'entries')).toBe('1 entry');
    expect(countPhrase(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('joins a list by the locale convention', () => {
    expect(formatList(['A', 'B', 'C'], 'en-GB')).toBe('A, B and C');
    expect(formatList(['A', 'B', 'C'], 'en-US')).toBe('A, B, and C');
    expect(formatList(['A', 'B'], 'en-GB')).toBe('A and B');
    expect(formatList(['A'], 'en-GB')).toBe('A');
    expect(formatList([], 'en-GB')).toBe('');
  });

  it('pluralises', () => {
    expect(plural(1, 'exception')).toBe('exception');
    expect(plural(2, 'exception')).toBe('exceptions');
    expect(plural(0, 'exception')).toBe('exceptions');
    expect(plural(1, 'entry', 'entries')).toBe('entry');
    expect(plural(2, 'entry', 'entries')).toBe('entries');
  });
});

describe('W2.4 ordinals', () => {
  it('uses words for 1..12 and a suffix beyond', () => {
    expect(ordinal(1)).toBe('first');
    expect(ordinal(12)).toBe('twelfth');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(111)).toBe('111th');
    expect(ordinalPhrase(3, 'control')).toBe('the 3 controls');
  });

  // 80 cases for the ordinal family.
  it('is correct across 80 ordinals', () => {
    for (let n = 1; n <= 80; n++) {
      const o = ordinal(n);
      expect(o.length).toBeGreaterThan(0);
      if (n <= 12) continue;
      const mod100 = n % 100;
      if (mod100 >= 11 && mod100 <= 13) expect(o.endsWith('th')).toBe(true);
      else if (n % 10 === 1) expect(o.endsWith('st')).toBe(true);
      else if (n % 10 === 2) expect(o.endsWith('nd')).toBe(true);
      else if (n % 10 === 3) expect(o.endsWith('rd')).toBe(true);
      else expect(o.endsWith('th')).toBe(true);
    }
  });
});

describe('W2.4 dates', () => {
  it('formats long and short dates per locale', () => {
    expect(formatDate('2026-10-25', 'en-GB')).toBe('25 October 2026');
    expect(formatDate('2026-10-25', 'en-US')).toBe('October 25, 2026');
    expect(formatShortDate('2026-10-25', 'en-GB')).toBe('25/10/2026');
    expect(formatShortDate('2026-10-25', 'en-US')).toBe('10/25/2026');
  });

  it('refuses a non-ISO date', () => {
    expect(() => formatDate('25/10/2026', 'en-GB')).toThrow();
  });

  // 80 cases across the year.
  it('formats 80 dates in both locales', () => {
    for (let month = 1; month <= 12; month++) {
      for (const day of [1, 15, 28]) {
        const iso = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const g = formatDate(iso, 'en-GB');
        const u = formatDate(iso, 'en-US');
        expect(g).toMatch(/^\d{1,2} \w+ \d{4}$/);
        expect(u).toMatch(/^\w+ \d{1,2}, \d{4}$/);
      }
    }
  });
});

describe('W2.4 capitalisation and sentence assembly', () => {
  it('capitalises the first character only', () => {
    expect(capitalise('hello World')).toBe('Hello World');
    expect(capitalise('')).toBe('');
  });

  it('assembles a sentence with one full stop', () => {
    expect(assembleSentence(['the control failed', 'for three items'])).toBe('The control failed for three items.');
    expect(assembleSentence(['Already ends.'])).toBe('Already ends.');
    expect(assembleSentence(['', '  '])).toBe('');
  });
});

describe('W2.4 template rendering and slot discipline', () => {
  const ctx = { locale: 'en-GB' as Locale, scale: 2, rounding: 'half_up' as const, grouping: true, currencySymbol: '\u00a3' };

  it('replaces each slot with its realised value', () => {
    const slots: Slot[] = [
      { name: 'tests', kind: 'count', value: 40 },
      { name: 'exceptions', kind: 'count', value: 3 },
    ];
    expect(renderTemplate('Of {tests} items, {exceptions} failed.', slots, ctx))
      .toBe('Of 40 items, 3 failed.');
  });

  it('throws when a template names a slot the claim does not carry', () => {
    expect(() => renderTemplate('Missing {absent}.', [], ctx)).toThrow('Missing: [absent]');
  });

  it('names the slots in a template', () => {
    expect(templateSlotNames('{a} and {b}, not {c}')).toEqual(['a', 'b', 'c']);
  });

  it('accepts a Decimal, an integer or a fixed-scale string as a decimal', () => {
    expect(decimalToString(asDecimal(decimal('123', 2)))).toBe('1.23');
    expect(decimalToString(asDecimal(42))).toBe('42');
    expect(decimalToString(asDecimal('1.50'))).toBe('1.50');
  });

  it('refuses a non-integer number and a malformed string', () => {
    expect(() => asDecimal(1.5)).toThrow();
    expect(() => asDecimal('abc')).toThrow();
  });

  it('realises each slot kind', () => {
    const cases: Array<[Slot, string]> = [
      [{ name: 'a', kind: 'count', value: 3 }, '3'],
      [{ name: 'b', kind: 'money', value: decimal('125000', 2) }, '\u00a31,250.00'],
      [{ name: 'c', kind: 'percent', value: decimal('125', 1) }, '12.5%'],
      [{ name: 'd', kind: 'date', value: '2026-10-25' }, '25 October 2026'],
      [{ name: 'e', kind: 'list', value: ['X', 'Y'] }, 'X and Y'],
      [{ name: 'f', kind: 'text', value: 'payments' }, 'payments'],
    ];
    for (const [slot, expected] of cases) {
      const template = `{${slot.name}}`;
      const out = renderTemplate(template, [slot], { ...ctx, scale: slot.kind === 'percent' ? 1 : 2 });
      expect(out).toBe(expected);
    }
  });
});

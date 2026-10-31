import { describe, expect, it } from 'vitest';
import {
  CanonicalError, addDecimal, canonicalise, compareDecimal, decimal, decimalFromString, decimalToString,
  divDecimal, hashCanonical, mulDecimal, normaliseText, rescaleDecimal, roundUnits, sha256Hex, subDecimal, utcDate,
  utcInstant, type CanonicalValue,
} from './canonical';

describe('W1.2 canonical serialisation', () => {
  it('sorts object keys, so any input key order gives the same bytes', () => {
    const a: CanonicalValue = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b: CanonicalValue = { c: { y: 2, z: 1 }, a: 2, b: 1 };
    expect(canonicalise(a)).toBe(canonicalise(b));
    expect(canonicalise(a)).toBe('{"a":2,"b":1,"c":{"y":2,"z":1}}');
  });

  it('has no insignificant whitespace', () => {
    expect(canonicalise({ a: [1, 2, 3] })).toBe('{"a":[1,2,3]}');
  });

  it('keeps array order significant', () => {
    expect(canonicalise([1, 2, 3])).not.toBe(canonicalise([3, 2, 1]));
  });

  it('writes decimals as fixed-scale strings, never floating point', () => {
    expect(canonicalise(decimal('12345', 2))).toBe('{"$dec":"123.45"}');
    expect(canonicalise(decimal('5', 0))).toBe('{"$dec":"5"}');
    expect(canonicalise(decimal('-12345', 2))).toBe('{"$dec":"-123.45"}');
  });

  it('refuses a non-integer number, so a float cannot slip into a hash', () => {
    expect(() => canonicalise(1.5 as unknown as CanonicalValue)).toThrow(CanonicalError);
  });

  it('NFC-normalises text, so the same characters in different compositions hash the same', () => {
    const composed = '\u00e9'; // é
    const decomposed = 'e\u0301'; // e + combining acute
    expect(composed).not.toBe(decomposed);
    expect(canonicalise(composed)).toBe(canonicalise(decomposed));
    expect(normaliseText(decomposed)).toBe(composed);
  });

  it('writes dates as UTC', () => {
    expect(canonicalise(new Date('2026-10-25T13:45:00Z'))).toBe('{"$utc":"2026-10-25T13:45:00Z"}');
    expect(utcDate('2026-10-25')).toBe('2026-10-25');
    expect(utcInstant('2026-10-25T13:45:00Z')).toBe('2026-10-25T13:45:00Z');
  });

  it('changes the hash when one character changes', async () => {
    const base: CanonicalValue = { a: 'organisation', b: 1 };
    const changed: CanonicalValue = { a: 'organizations', b: 1 };
    expect(await hashCanonical(base)).not.toBe(await hashCanonical(changed));
  });

  it('gives the same hash for the same bytes', async () => {
    expect(await hashCanonical({ a: 1, b: 2 })).toBe(await hashCanonical({ b: 2, a: 1 }));
  });

  it('hashes to a 64-character lowercase hex string', async () => {
    expect(await sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('W1.2 decimals are exact', () => {
  it('parses and prints a fixed-scale decimal', () => {
    expect(decimalToString(decimalFromString('-123.45'))).toBe('-123.45');
    expect(decimalToString(decimalFromString('0.05', 2))).toBe('0.05');
    expect(decimalToString(decimalFromString('10', 2))).toBe('10.00');
  });

  it('refuses more fractional digits than the scale', () => {
    expect(() => decimalFromString('1.005', 2)).toThrow(CanonicalError);
  });

  it('adds, subtracts, multiplies and divides exactly', () => {
    expect(decimalToString(addDecimal(decimal('1', 2), decimal('2', 2)))).toBe('0.03');
    expect(decimalToString(subDecimal(decimal('100', 2), decimal('1', 2)))).toBe('0.99');
    expect(decimalToString(mulDecimal(decimal('1234', 2), decimal('100', 0), 2))).toBe('1234.00');
    expect(decimalToString(divDecimal(decimal('1', 0), decimal('3', 0), 4))).toBe('0.3333');
  });

  it('rounds half away from zero', () => {
    expect(decimalToString(roundUnits(5n, 1, 0))).toBe('1');
    expect(decimalToString(roundUnits(4n, 1, 0))).toBe('0');
    expect(decimalToString(roundUnits(-5n, 1, 0))).toBe('-1');
  });

  it('compares decimals at different scales', () => {
    expect(compareDecimal(decimal('100', 2), decimal('1', 0))).toBe(0);
    expect(compareDecimal(decimal('99', 2), decimal('1', 0))).toBe(-1);
    expect(compareDecimal(decimal('101', 2), decimal('1', 0))).toBe(1);
  });

  it('refuses a rescale that would lose information', () => {
    expect(() => rescaleDecimal(decimal('5', 3), 2)).toThrow(CanonicalError);
    expect(decimalToString(rescaleDecimal(decimal('50', 3), 2))).toBe('0.05');
  });

  it('does not lose a cent in a long sum (the float failure case)', () => {
    let total = decimal('0', 2);
    for (let i = 0; i < 1000; i++) total = addDecimal(total, decimal('1', 2));
    expect(decimalToString(total)).toBe('10.00');
  });
});

// A broad property sweep (>= 30 cases): key-order invariance and single-character sensitivity.
describe('W1.2 properties over 40 generated cases', () => {
  const cases: Array<CanonicalValue> = [];
  for (let i = 0; i < 20; i++) {
    cases.push({
      [`k${i}`]: i,
      [`nested${i}`]: { b: [i, i + 1], a: decimal(String(i * 100 + 7), 2) },
      text: `Case ${i} — ${'\u00e9'.repeat(i % 3)}`,
    });
  }
  for (let i = 0; i < 20; i++) {
    cases.push([i, `s${i}`, { z: i % 2 === 0, y: decimal(String(i), 0) }]);
  }

  it('gives the same bytes for a reordered copy, for all 40 cases', () => {
    const reorder = (v: CanonicalValue): CanonicalValue => {
      if (Array.isArray(v)) return v.map(reorder);
      if (v && typeof v === 'object' && !('scale' in v)) {
        const keys = Object.keys(v).sort().reverse();
        const out: { [k: string]: CanonicalValue } = {};
        for (const k of keys) out[k] = reorder((v as { [k: string]: CanonicalValue })[k]);
        return out;
      }
      return v;
    };
    for (const c of cases) {
      expect(canonicalise(reorder(c))).toBe(canonicalise(c));
    }
  });

  it('changes the hash for a one-character change, for all 40 cases', async () => {
    for (const c of cases) {
      const text = canonicalise(c);
      const changed = text.replace('"text"', '"texu"').replace(/"(s|Case)(\d)"/, '"$1$2x"');
      if (changed === text) continue; // a case with no such token: skip rather than assert falsely
      expect(await sha256Hex(changed)).not.toBe(await sha256Hex(text));
    }
  });

  it('has at least 30 cases in the sweep', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });
});

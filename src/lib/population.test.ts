import { describe, it, expect } from 'vitest';
import { checkPopulationCsv, parseAmountCents, parseCsv, isValidIsoDate, sha256Hex, isSupportedPopulationFile } from './population';

const good = 'reference,date,amount\nINV-1,2026-01-05,100.00\nINV-2,2026-01-06,"1,250.50"\nINV-3,2026-02-01,-50\n';

describe('parseCsv', () => {
  it('handles BOM, CRLF, quoted commas and newlines', () => {
    const t = parseCsv('\uFEFFa,b\r\n"x,1","y\nz"\r\n');
    expect(t).toEqual([['a', 'b'], ['x,1', 'y\nz']]);
  });
});
describe('parseAmountCents', () => {
  it('accepts valid and rejects invalid', () => {
    expect(parseAmountCents('1,234.56')).toBe(123456);
    expect(parseAmountCents('-50')).toBe(-5000);
    for (const bad of ['', ' ', 'NaN', 'Infinity', '(1.00)', '1e3', '12,34', 'abc']) expect(parseAmountCents(bad)).toBeNull();
  });
});
describe('isValidIsoDate', () => {
  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('05/01/2026')).toBe(false);
  });
});
describe('checkPopulationCsv', () => {
  it('verifies when clean and reconciled to the cent', () => {
    const r = checkPopulationCsv(good, 1300.5);
    expect(r.verified).toBe(true);
    expect(r.rowCount).toBe(3);
    expect(r.totalCents).toBe(130050);
    expect([r.minDate, r.maxDate]).toEqual(['2026-01-05', '2026-02-01']);
  });
  it('fails on control total mismatch or missing control total', () => {
    expect(checkPopulationCsv(good, 1300.51).verified).toBe(false);
    expect(checkPopulationCsv(good, null).verified).toBe(false);
  });
  it('reports row-specific errors and never coerces to zero', () => {
    const r = checkPopulationCsv('reference,date,amount\nA,2026-01-01,\nA,2026-13-01,5\n,2026-01-01,1\nB,2026-01-01,2\n', 2);
    expect(r.verified).toBe(false);
    expect(r.issues.some((i) => i.line === 2 && /amount/i.test(i.message))).toBe(true);
    expect(r.issues.some((i) => i.line === 3 && /date/i.test(i.message))).toBe(true);
    expect(r.issues.some((i) => i.line === 4 && /reference/i.test(i.message))).toBe(true);
    expect(r.rowCount).toBe(1);
  });
  it('flags duplicate keys', () => {
    const r = checkPopulationCsv('ref,date,amount\nA,2026-01-01,1\nA,2026-01-02,1\n', 2);
    expect(r.issues.some((i) => /Duplicate/.test(i.message))).toBe(true);
    expect(r.verified).toBe(false);
  });
  it('rejects headerless/empty files', () => {
    expect(checkPopulationCsv('', 0).verified).toBe(false);
    expect(checkPopulationCsv('x,y\n1,2\n', 0).verified).toBe(false);
  });
});
describe('sha256Hex', () => {
  it('hashes raw bytes incl. >0x7f', async () => {
    const h = await sha256Hex(new Uint8Array([0x80, 0xff]).buffer);
    expect(h).toHaveLength(64);
    expect(await sha256Hex(new Uint8Array([0x80, 0xff]).buffer)).toBe(h);
    expect(await sha256Hex(new Uint8Array([]).buffer)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
describe('isSupportedPopulationFile', () => {
  it('csv only for now', () => {
    expect(isSupportedPopulationFile('a.csv').ok).toBe(true);
    expect(isSupportedPopulationFile('a.xlsx').ok).toBe(false);
    expect(isSupportedPopulationFile('a.exe').ok).toBe(false);
  });
});

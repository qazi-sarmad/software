import { describe, expect, it } from 'vitest';
import {
  exportContentHash,
  exportFilename,
  serialiseExport,
} from './exportSerialise';

describe('export serialisation (7G, §18)', () => {
  it('serialises an array of objects to CSV with a sorted header union', () => {
    const csv = serialiseExport([{ b: 1, a: 'x' }, { a: 'y', c: true }], 'csv');
    expect(csv.split('\n')[0]).toBe('a,b,c');
    expect(csv.split('\n')[1]).toBe('x,1,');
    expect(csv.split('\n')[2]).toBe('y,,true');
  });

  it('quotes fields containing commas, quotes or newlines (RFC 4180)', () => {
    const csv = serialiseExport([{ note: 'a,b', quote: 'say "hi"' }], 'csv');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
  });

  it('serialises a scalar object to a single CSV row', () => {
    expect(serialiseExport({ total: 3 }, 'csv')).toBe('total\n3');
  });

  it('serialises to JSON for the json format, pretty-printed', () => {
    expect(serialiseExport({ a: 1 }, 'json')).toBe('{\n  "a": 1\n}');
  });

  it('serialises a bare array to JSON when the format is json', () => {
    expect(serialiseExport([1, 2], 'json')).toBe('[\n  1,\n  2\n]');
  });

  it('treats null as JSON regardless of format', () => {
    expect(serialiseExport(null, 'csv')).toBe('null');
  });

  it('names the file from the object type and format', () => {
    expect(exportFilename('cap_register', 'csv')).toBe('cap_register-export.csv');
    expect(exportFilename('ledger', 'json')).toBe('ledger-export.json');
  });

  it('content hash is stable for the same text and differs for different text', async () => {
    const a = await exportContentHash('hello');
    const b = await exportContentHash('hello');
    const c = await exportContentHash('world');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

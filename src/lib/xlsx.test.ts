/**
 * R6b (spec §19): the XLSX parser used by the import wizard. The fixture is the same file the e2e
 * test uploads, so the browser path and this unit test exercise the same bytes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSpreadsheet, parseSpreadsheet } from './xlsx';

function fixtureBuffer(name: string): ArrayBuffer {
  const buf = readFileSync(join(process.cwd(), 'e2e', 'fixtures', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('isSpreadsheet (R6b)', () => {
  it('recognises spreadsheet extensions, case-insensitively', () => {
    expect(isSpreadsheet('rcm.xlsx')).toBe(true);
    expect(isSpreadsheet('RCM.XLS')).toBe(true);
    expect(isSpreadsheet('book.xlsm')).toBe(true);
    expect(isSpreadsheet('rows.csv')).toBe(false);
    expect(isSpreadsheet('doc.docx')).toBe(false);
  });
});

describe('parseSpreadsheet (R6b)', () => {
  it('parses the first sheet into headers and rows', async () => {
    const { headers, rows } = await parseSpreadsheet(fixtureBuffer('rcm-sample.xlsx'));
    expect(headers).toEqual([
      'risk_id', 'risk_description', 'control_id', 'control_description', 'control_type', 'frequency', 'owner',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['R-001', 'Revenue recognition', 'C-001', 'Monthly reconciliation', 'preventive', 'monthly', 'Finance']);
    expect(rows[2][0]).toBe('R-003');
  });

  it('returns empty headers and rows for an empty buffer', async () => {
    const { headers, rows } = await parseSpreadsheet(new ArrayBuffer(0));
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });
});

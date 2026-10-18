/**
 * R6b (spec §19): spreadsheet parsing for the import wizard. CSV is parsed inline; XLSX/XLS is
 * parsed here with SheetJS, loaded on demand so the parser never enters the main bundle. Both paths
 * return the same { headers, rows } shape the wizard maps and validates.
 *
 * SheetJS 0.20.3, installed from the vendor CDN (see docs/OVERNIGHT-D1-D23-DECISIONS.md D-D1-xlsx):
 * the npm `xlsx` package stopped at 0.18.5 and carried two unfixed advisories, so D1 moved to the
 * current release, which resolves both. It still parses only a file the operator chose in their own
 * browser.
 */
export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

const SPREADSHEET_EXT = /\.(xlsx|xlsm|xls)$/i;

export function isSpreadsheet(filename: string): boolean {
  return SPREADSHEET_EXT.test(filename);
}

/** Parse an XLSX/XLS ArrayBuffer's first sheet into the wizard's { headers, rows } shape. */
export async function parseSpreadsheet(buf: ArrayBuffer): Promise<ParsedSheet> {
  if (buf.byteLength === 0) return { headers: [], rows: [] };
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[first], { header: 1, raw: false, defval: '' });
  const [headerRow, ...bodyRows] = grid;
  if (!headerRow || headerRow.length === 0) return { headers: [], rows: [] };
  const headers = headerRow.map((h) => String(h ?? '').trim());
  if (headers.every((h) => h.length === 0)) return { headers: [], rows: [] };
  const rows = bodyRows
    .map((r) => headers.map((_, i) => String((r as unknown[])[i] ?? '').trim()))
    .filter((r) => r.some((c) => c.length > 0));
  return { headers, rows };
}

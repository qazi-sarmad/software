/**
 * DOCX import parsing (C2.8, spec §19).
 *
 * A DOCX is a zip of OOXML parts; mammoth (BSD-2-Clause, 1.13.0) converts it to HTML, and the tables
 * in that HTML are what the import wizard maps. This module turns each table into the same
 * `{ name, headers, rows }` shape the CSV and XLSX paths produce, so the wizard has one mapping and
 * validation step whatever the source file was. Parsing happens in the operator's browser on a file
 * they chose; nothing leaves it.
 *
 * The parser is deliberately small and literal: a table is a sequence of `<tr>` rows of `<td>`/`<th>`
 * cells, a cell's text is the concatenation of its runs, and HTML entities are decoded. Nested tables
 * inside a cell are flattened into that cell's text, which is the honest reading for a worksheet table.
 */
import type { ParsedSheet } from './xlsx';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

/** Decode the HTML entities mammoth emits, plus numeric references. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * The visible text of one cell: its `<p>`/`<br>` become spaces, everything else is stripped, and the
 * entities are decoded. A cell that holds a nested table gets that table's text inline.
 */
function cellText(cellHtml: string): string {
  return decodeEntities(
    cellHtml
      .replace(/<\/p>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<\/tr>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split an HTML string into the rows and cells of each top-level `<table>`. */
function extractTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  for (const m of html.matchAll(tableRe)) {
    const rows: string[][] = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    for (const r of m[0].matchAll(rowRe)) {
      const cells: string[] = [];
      const cellRe = /<t([dh])[\s\S]*?<\/t\1>/gi;
      for (const c of r[0].matchAll(cellRe)) cells.push(cellText(c[0]));
      rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

/** Convert a DOCX (Word) file into the wizard's sheets: one sheet per table, first row = headers. */
export async function parseDocxTables(buf: ArrayBuffer): Promise<ParsedSheet[]> {
  if (buf.byteLength === 0) return [];
  // The package's `browser` field redirects the unzip and file-read modules, so the plain specifier
  // is already the browser build under Vite; naming the browser bundle explicitly would double it.
  const mammoth = (await import('mammoth')) as unknown as {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer; buffer?: Uint8Array }) => Promise<{ value: string }>;
  };
  // The bundled (browser) build reads `arrayBuffer`; the Node build reads `buffer`. Supplying both
  // keeps one code path working under Vite and under the test runner.
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buf, buffer: new Uint8Array(buf) });
  const tables = extractTables(value);
  return tables.map((grid, i) => {
    const [headerRow, ...bodyRows] = grid;
    const headers = (headerRow ?? []).map((h) => h.trim());
    // A header row of blanks is not a header; the wizard needs one to map against.
    if (headers.length === 0 || headers.every((h) => h.length === 0)) {
      return { name: `Table ${i + 1}`, headers: [], rows: [] };
    }
    const rows = bodyRows
      .map((r) => headers.map((_, c) => (r[c] ?? '').trim()))
      .filter((r) => r.some((c) => c.length > 0));
    return { name: `Table ${i + 1}`, headers, rows };
  });
}

/** The names of every table in a DOCX, so the wizard can offer a choice when there is more than one. */
export async function listDocxTables(buf: ArrayBuffer): Promise<{ name: string; headers: string[]; rowCount: number }[]> {
  const sheets = await parseDocxTables(buf);
  return sheets.map((s) => ({ name: s.name, headers: s.headers, rowCount: s.rows.length }));
}

/** A small helper the wizard uses to decide which parser a filename needs. */
export function isDocx(filename: string): boolean {
  return /\.docx$/i.test(filename);
}

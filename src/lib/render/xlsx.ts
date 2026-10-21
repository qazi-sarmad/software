/**
 * renderXlsx and renderZip (C2.7, spec §18).
 *
 * XLSX is built from the same { headers, rows } shape the import wizard already parses, using the
 * vendored SheetJS parser (the same one the browser already ships), so a file exported here round
 * trips through the import path. ZIP bundles carry a manifest with a SHA-256 per file, as §18
 * requires for the full engagement bundle.
 *
 * Deterministic: SheetJS writes no timestamp we do not give it, and JSZip is told a fixed date so
 * two runs over the same input produce identical bytes.
 */
import JSZip from 'jszip';
import { sha256Hex } from '../population';
import type { DocumentModel } from './document';

export interface Sheet {
  name: string;
  headers: string[];
  rows: string[][];
}

/** Sheet names in Excel are limited to 31 characters and cannot contain []:*?/\. */
function safeSheetName(name: string): string {
  return (name || 'Sheet1').replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1';
}

/** Build an XLSX workbook from one or more sheets. Deterministic for the same sheets. */
export async function renderXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of sheets) {
    let name = safeSheetName(sheet.name);
    let n = 1;
    while (used.has(name)) name = safeSheetName(`${sheet.name} ${++n}`);
    used.add(name);
    const aoa = [sheet.headers, ...sheet.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  // `type: 'array'` writes to a Uint8Array; no file is touched and no clock is read.
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Uint8Array(out);
}

/** A DocumentModel as a single-sheet XLSX (a table block becomes rows; prose becomes a column). */
export async function renderModelXlsx(model: DocumentModel): Promise<Uint8Array> {
  const rows: string[][] = [];
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'table' && block.table) {
        rows.push([section.heading, block.text ?? '']);
        rows.push([section.heading, block.table.headers.join(' | ')]);
        for (const r of block.table.rows) rows.push([section.heading, r.join(' | ')]);
      } else {
        rows.push([section.heading, block.text ?? '']);
      }
    }
  }
  return renderXlsx([{ name: model.title, headers: ['Section', 'Content'], rows }]);
}

export interface ZipEntry {
  path: string;
  data: Uint8Array | string;
}

export interface ZipResult {
  bytes: Uint8Array;
  /** One row per file: path and its SHA-256, exactly what the manifest records. */
  hashes: Array<{ path: string; sha256: string }>;
}

/** The manifest text: one line per file, path and hash, sorted by path. Deterministic. */
export async function zipManifest(entries: ZipEntry[]): Promise<Array<{ path: string; sha256: string }>> {
  const rows = await Promise.all(entries.map(async (e) => {
    const bytes = typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return { path: e.path, sha256: await sha256Hex(buf) };
  }));
  return rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Bundle files into a ZIP with a manifest.json and a manifest.txt. Every file's SHA-256 is recorded
 * in the manifest; the returned hashes are the same values, for the export log.
 */
export async function renderZip(entries: ZipEntry[]): Promise<ZipResult> {
  const hashes = await zipManifest(entries);
  const manifest = { generatedFor: 'provio-export', files: hashes };
  const zip = new JSZip();
  for (const e of entries) zip.file(e.path, typeof e.data === 'string' ? e.data : e.data);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('manifest.txt', hashes.map((h) => `${h.sha256}  ${h.path}`).join('\n'));
  // A fixed DOS date (1980-01-01) makes the archive reproducible; JSZip accepts a Date.
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', date: new Date(Date.UTC(1980, 0, 1)) } as JSZip.JSZipGeneratorOptions<'uint8array'>);
  return { bytes, hashes };
}

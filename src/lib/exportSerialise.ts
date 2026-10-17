/**
 * Client-side serialisation for exports (7G, spec §18).
 *
 * The database owns the export data (log_export + the export_* functions return JSON); this module
 * only turns that JSON into the file the browser downloads and computes the content hash that is
 * recorded on the export. Nothing here reads the database and no component imports the client.
 */
import { sha256Hex } from '../lib/population';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'zip' | 'json';

/** Escape one CSV field (RFC 4180): quote when it holds a comma, quote, CR or LF. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flatten one record's scalar fields into a CSV row. */
function csvRow(record: Record<string, unknown>, headers: string[]): string {
  return headers.map((h) => csvField(record[h])).join(',');
}

/**
 * Serialise an export payload to text. Objects and arrays of objects become a CSV table (union of
 * keys); anything else becomes a single-column JSON document. Deterministic: keys are sorted.
 */
export function serialiseExport(data: unknown, format: ExportFormat): string {
  if (format === 'json' || data === null || typeof data !== 'object') {
    return JSON.stringify(data, null, 2);
  }
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : [data as Record<string, unknown>];
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))].sort();
  return [headers.join(','), ...rows.map((r) => csvRow(r ?? {}, headers))].join('\n');
}

export function exportFilename(objectType: string, format: ExportFormat): string {
  return `${objectType}-export.${format === 'json' ? 'json' : format}`;
}

/** SHA-256 of the serialised text (UTF-8), the content hash recorded on the export (§18). */
export async function exportContentHash(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

/**
 * Trigger a browser download of the serialised export. Uses a Blob object URL; no blocking dialog.
 * Returns the filename used so the caller can show a confirmation chip.
 */
export function downloadExport(text: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

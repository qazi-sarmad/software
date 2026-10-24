/**
 * Binary export rendering (C2.7, spec §18).
 *
 * Exports used to serialise CSV, JSON and plain text only, so a "PDF" export was a text file with a
 * .pdf name and the issued report had no binary at all. This module turns the export payload the
 * database returns into real bytes for every format §18 lists: PDF, XLSX, DOCX, PNG, SVG and a ZIP
 * bundle with a manifest. The content hash the export log records is computed over exactly the bytes
 * delivered, never over an intermediate string.
 *
 * Everything is deterministic for the same input, so the hash is stable and the export is auditable.
 */
import { DEFAULT_BRANDING, type BrandingSpec } from './render/branding';
import { renderPdf } from './render/pdf';
import { renderDocx, documentPlainText } from './render/docx';
import { renderXlsx, renderZip, type Sheet } from './render/xlsx';
import { renderChartPng, renderChartSvg, type ChartModel } from './render/chart';
import { documentFromReportBlocks, toPdfModel, type DocumentModel, type FooterContext } from './render/document';
import { sha256Hex } from './population';

export type BinaryFormat = 'csv' | 'json' | 'text' | 'pdf' | 'docx' | 'xlsx' | 'png' | 'svg' | 'zip';

export interface RenderedExport {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
  /** SHA-256 of `bytes` — the value recorded by `log_export` (§18). */
  hash: string;
}

/** Turn any export payload into a table: objects/arrays of objects become headers plus rows. */
export function tabulate(data: unknown): Sheet {
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : (data && typeof data === 'object' ? [data as Record<string, unknown>] : [{ value: data }]);
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))].sort();
  return {
    name: 'Export',
    headers,
    rows: rows.map((r) => headers.map((h) => {
      const v = (r ?? {})[h];
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    })),
  };
}

function csvText(sheet: Sheet): string {
  const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [sheet.headers.map(field).join(','), ...sheet.rows.map((r) => r.map(field).join(','))].join('\n');
}

/** A one-table DocumentModel, so a tabular export has a PDF and a DOCX with identical content. */
export function modelFromTable(title: string, sheet: Sheet, footer?: FooterContext): DocumentModel {
  return {
    title,
    sections: [{ heading: title, blocks: [{ kind: 'table', text: title, table: { headers: sheet.headers, rows: sheet.rows } }] }],
    footer,
  };
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return sha256Hex(buf);
}

export interface RenderExportInput {
  objectType: string;
  data: unknown;
  format: BinaryFormat;
  branding?: BrandingSpec;
  footer?: FooterContext;
  /** Extra files for a ZIP bundle (for example a chart plus its data). */
  extraFiles?: Array<{ path: string; data: Uint8Array | string }>;
  chart?: ChartModel;
}

/**
 * Render an export to real bytes. Text formats keep the CSV/JSON shape the product already had;
 * binary formats render the same content through the render module.
 */
export async function renderExport(input: RenderExportInput): Promise<RenderedExport> {
  const sheet = tabulate(input.data);
  const spec: BrandingSpec = input.branding ?? { orgId: 'default', ...DEFAULT_BRANDING };

  if (input.format === 'csv') {
    const bytes = encode(csvText(sheet));
    return { bytes, contentType: 'text/csv;charset=utf-8', extension: 'csv', hash: await hashBytes(bytes) };
  }
  if (input.format === 'json') {
    const bytes = encode(JSON.stringify(input.data, null, 2));
    return { bytes, contentType: 'application/json', extension: 'json', hash: await hashBytes(bytes) };
  }
  if (input.format === 'text') {
    const bytes = encode(documentPlainText(modelFromTable(input.objectType, sheet, input.footer)));
    return { bytes, contentType: 'text/plain;charset=utf-8', extension: 'txt', hash: await hashBytes(bytes) };
  }
  if (input.format === 'pdf') {
    const model = modelFromTable(input.objectType, sheet, input.footer);
    const bytes = await renderPdf(spec, toPdfModel(model));
    return { bytes, contentType: 'application/pdf', extension: 'pdf', hash: await hashBytes(bytes) };
  }
  if (input.format === 'docx') {
    const bytes = await renderDocx(modelFromTable(input.objectType, sheet, input.footer));
    return {
      bytes,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      hash: await hashBytes(bytes),
    };
  }
  if (input.format === 'xlsx') {
    const bytes = await renderXlsx([sheet]);
    return {
      bytes,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      hash: await hashBytes(bytes),
    };
  }
  if (input.format === 'png') {
    const chart = input.chart ?? { title: input.objectType, categories: [''], series: [{ label: 'value', values: [1], colour: '#2f6f6a' }], kind: 'bar' };
    const bytes = renderChartPng(chart, { background: '#ffffff', axis: '#888888', text: '#222222' });
    return { bytes, contentType: 'image/png', extension: 'png', hash: await hashBytes(bytes) };
  }
  if (input.format === 'svg') {
    const chart = input.chart ?? { title: input.objectType, categories: [''], series: [{ label: 'value', values: [1], colour: '#2f6f6a' }], kind: 'bar' };
    const bytes = encode(renderChartSvg(chart, { background: '#ffffff', axis: '#888888', text: '#222222' }));
    return { bytes, contentType: 'image/svg+xml', extension: 'svg', hash: await hashBytes(bytes) };
  }
  // ZIP bundle: the tabular data in CSV, JSON and XLSX, plus any extra files and a manifest.
  const files = [
    { path: 'data.csv', data: csvText(sheet) },
    { path: 'data.json', data: JSON.stringify(input.data, null, 2) },
    { path: 'data.xlsx', data: await renderXlsx([sheet]) },
    ...(input.extraFiles ?? []),
  ];
  const zip = await renderZip(files);
  return { bytes: zip.bytes, contentType: 'application/zip', extension: 'zip', hash: await hashBytes(zip.bytes) };
}

/** Build a DocumentModel from report blocks; re-exported so callers need one import. */
export { documentFromReportBlocks };

/** Trigger a browser download of raw bytes; no blocking dialog. */
export function downloadBytes(bytes: Uint8Array, filename: string, contentType: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([bytes as unknown as BlobPart], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

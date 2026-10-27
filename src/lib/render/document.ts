/**
 * One document model, every renderer (C2.7, spec §18 "Report | Frozen PDF, editable DOCX").
 *
 * Before this, the PDF and the DOCX (and the exports generally) were built from separate shapes, so
 * the same report could say different things in different files. Here the report is assembled once
 * into a DocumentModel and every output — PDF, DOCX, XLSX, ZIP — renders that one model, so the text
 * parity test can pass by construction.
 *
 * The model is derived from the report's blocks (report_blocks), which are the product's own
 * structured content; nothing here reaches the network or the database.
 */
import type { PdfDocumentModel, PdfSection, PdfTextBlock } from './pdf';

export interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'table';
  /** For a paragraph/heading: the text. For a table: the section label used as its caption. */
  text?: string;
  table?: { headers: string[]; rows: string[][] };
}

export interface DocumentSection {
  heading: string;
  blocks: DocumentBlock[];
}

export interface DocumentModel {
  title: string;
  subtitle?: string;
  sections: DocumentSection[];
  /** The footer line every export carries (§18): engagement, export time, user and hash. */
  footer?: FooterContext;
}

export interface FooterContext {
  engagement: string;
  exportedAt: string;
  user: string;
  contentHash: string;
}

/** The header shape the report's blocks carry (a subset of ReportBlockRow.content). */
export interface ReportBlockInput {
  sectionType: string;
  blockType: 'text' | 'table' | 'image';
  content: Record<string, unknown>;
  position: number;
}

/** Build the one model from the report's blocks. Order is by section first seen, then position. */
export function documentFromReportBlocks(
  title: string, blocks: ReportBlockInput[], footer?: FooterContext,
): DocumentModel {
  const order: string[] = [];
  const bySection = new Map<string, DocumentBlock[]>();
  for (const b of [...blocks].sort((a, z) => a.position - z.position)) {
    if (!bySection.has(b.sectionType)) {
      bySection.set(b.sectionType, []);
      order.push(b.sectionType);
    }
    const list = bySection.get(b.sectionType)!;
    if (b.blockType === 'table') {
      const headers = toStringArray(b.content.headers);
      const rows = toRows(b.content.rows);
      list.push({ kind: 'table', text: String(b.content.caption ?? b.sectionType), table: { headers, rows } });
    } else {
      const text = String(b.content.text ?? b.content.body ?? '');
      list.push({ kind: b.blockType === 'text' && Boolean(b.content.heading) ? 'heading' : 'paragraph', text });
    }
  }
  return {
    title,
    sections: order.map((h) => ({ heading: h, blocks: bySection.get(h) ?? [] })),
    footer,
  };
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function toRows(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  return v.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r)]));
}

/** Append the footer line to a model's subtitle-like slot; used by both renderers identically. */
export function footerLine(footer?: FooterContext): string {
  if (!footer) return '';
  return `${footer.engagement} · exported ${footer.exportedAt} · ${footer.user} · ${footer.contentHash.slice(0, 12)}`;
}

/** Adapt the shared model to the PDF renderer's own model type. `timestamp` pins the PDF metadata
 *  (creation/modification date) so the bytes are reproducible; it is passed in, never read. The
 *  optional `typography` carries the report format's resolved sizes to the printer (WP-C3). */
export function toPdfModel(
  model: DocumentModel,
  timestamp?: string,
  typography?: PdfDocumentModel['typography'],
): PdfDocumentModel {
  const sections: PdfSection[] = model.sections.map((s) => {
    const blocks: PdfTextBlock[] = [];
    for (const b of s.blocks) {
      if (b.kind === 'table' && b.table) {
        blocks.push({ kind: 'heading', text: b.text ?? '' });
        blocks.push({ kind: 'paragraph', text: b.table.headers.join('  |  ') });
        for (const row of b.table.rows) blocks.push({ kind: 'paragraph', text: row.join('  |  ') });
      } else {
        blocks.push({ kind: b.kind === 'heading' ? 'heading' : 'paragraph', text: b.text ?? '' });
      }
    }
    return { heading: s.heading, blocks };
  });
  const line = footerLine(model.footer);
  if (line) sections.push({ heading: 'Document control', blocks: [{ kind: 'paragraph', text: line }] });
  return { title: model.title, subtitle: model.subtitle, sections, timestamp, typography };
}

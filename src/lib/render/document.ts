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
import type { PdfBlock, PdfDocumentModel, PdfSection, PdfTextBlock } from './pdf';
import { figurePng, FIGURE_SIZE_PT } from './figure';
import type { ChromeSpec, PageSetup, PlacedBlock } from '../writing/pageDesign';
import type { GridSpec } from '../writing/grid';
import type { DesignTheme } from '../writing/designTheme';
import type { ShapeSpec } from '../writing/shapes';
import type { CrossReferenceSpec, HyperlinkSpec } from '../writing/links';
import type { TableStyleName } from '../writing/tableStyleDefaults';

export interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'table' | 'figure';
  /** For a paragraph/heading: the text. For a table: the section label used as its caption. */
  text?: string;
  table?: { headers: string[]; rows: string[][] };
  /** WP-G: a deterministic formula graphic. The renderers sample it through the same pure engine, so
   *  the PNG, the SVG and the printed page are one figure, not three. */
  figure?: FormulaFigure;
}

/**
 * The formula graphic a report block may carry (WP-G). The expression is the canonical thing; the
 * sampled points are derived. The grammar is restricted and pure (no `eval`), so a client can express
 * a curve without the report ever running client-supplied code, and the same spec always draws the
 * same figure.
 */
export interface FormulaFigure {
  expression: string;
  minX: number;
  maxX: number;
  /** The caption printed under the figure. */
  label: string;
  /** The line colour, as a hex value (the caller resolves it from the design tokens). */
  colour: string;
  /** The figure title, printed above it. */
  title: string;
}

export interface DocumentSection {
  heading: string;
  blocks: DocumentBlock[];
  /** WP-D: the format block key this section came from, so placement, table styles and
   *  cross-references can name a section stably even when two sections share a heading. */
  key?: string;
}

export interface DocumentModel {
  title: string;
  subtitle?: string;
  sections: DocumentSection[];
  /** The footer line every export carries (§18): engagement, export time, user and hash. */
  footer?: FooterContext;
  /** The report format's resolved print typography (WP-C3/C4). Present means every renderer prints
   *  the format's sizes and line height; absent means each renderer keeps its own defaults. */
  typography?: DocumentTypography;
  /** The format's table-of-contents choice (WP-T). Absent means the model carries no TOC. */
  contents?: ContentsSpec;
  /** The page design (WP-D): page setup, chrome, columns, shapes, placement, links, references and
   *  table styles. Present means the renderers print the designed page; absent means the plain flow. */
  design?: DocumentDesign;
}

/**
 * The page design a renderer prints (WP-D). Every value is derived data from the org's branding and
 * the format's layout; the renderers read it and compute nothing about the brand themselves.
 */
export interface DocumentDesign {
  setup: PageSetup;
  grid: GridSpec;
  chrome: ChromeSpec;
  /** The derived colours: heading, rule, link, reference, surfaces, table shades. */
  theme: DesignTheme;
  columns: number;
  columnGapMm: number;
  numberedHeadings: boolean;
  placed: PlacedBlock[];
  shapes: ShapeSpec[];
  links: HyperlinkSpec[];
  crossReferences: CrossReferenceSpec[];
  tableStyles: { key: string; style: TableStyleName }[];
  defaultTableStyle: TableStyleName;
  tableBorder: string;
  tableRowAlternate: string;
  /** The header/footer template variables (org, engagement, classification, date). */
  chromeVars: Record<string, string | number>;
}

/** The resolved print typography every renderer agrees on, produced by `toPdfTypography` (WP-C3). */
export interface DocumentTypography {
  headingPt: number;
  bodyPt: number;
  headingWeight: number;
  bodyWeight: number;
  lineHeight: number;
  /** The heading and body families, from the self-hosted set. Absent means the renderer default. */
  headingFamily?: string;
  bodyFamily?: string;
}

/** The table-of-contents the format asks for (WP-T): depth, title and whether it numbers entries. */
export interface ContentsSpec {
  title: string;
  depth: number;
  numbered: boolean;
  /** Include the level-1 entries themselves (the section headings). */
  includeSections: boolean;
  /** Include the level-2 entries (a section's sub-headings). */
  includeSubheadings: boolean;
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
    } else if (b.blockType === 'image' && b.content.figure) {
      const f = b.content.figure as Record<string, unknown>;
      list.push({
        kind: 'figure',
        text: String(f.title ?? 'Figure'),
        figure: {
          expression: String(f.expression ?? ''),
          minX: Number(f.minX ?? 0),
          maxX: Number(f.maxX ?? 1),
          label: String(f.label ?? 'value'),
          colour: String(f.colour ?? '#2f6f6a'),
          title: String(f.title ?? 'Figure'),
        },
      });
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

/**
 * Build the table-of-contents entries for a model (WP-T). Pure and deterministic: the entries are the
 * model's own headings, in model order, so the contents can never disagree with the body. A depth of
 * 1 lists only section headings; depth 2 also lists each section's own sub-headings.
 */
export function buildContents(model: DocumentModel): ContentsEntry[] {
  const spec = model.contents;
  if (!spec || spec.depth < 1) return [];
  const out: ContentsEntry[] = [];
  let n = 0;
  for (const section of model.sections) {
    if (spec.includeSections !== false) {
      n += 1;
      out.push({ level: 1, label: section.heading, number: spec.numbered ? String(n) : '' });
    }
    if (spec.depth >= 2 && spec.includeSubheadings) {
      for (const block of section.blocks) {
        if (block.kind !== 'heading' || !block.text) continue;
        out.push({ level: 2, label: block.text, number: '' });
      }
    }
  }
  return out;
}

export interface ContentsEntry {
  level: 1 | 2;
  label: string;
  /** The printed entry number when the format numbers its contents, otherwise an empty string. */
  number: string;
}

/** Adapt the shared model to the PDF renderer's own model type. `timestamp` pins the PDF metadata
 *  (creation/modification date) so the bytes are reproducible; it is passed in, never read. The
 *  optional `typography` carries the report format's resolved sizes to the printer (WP-C3). */
export function toPdfModel(
  model: DocumentModel,
  timestamp?: string,
  typography?: PdfDocumentModel['typography'],
): PdfDocumentModel {
  const sections: PdfSection[] = [];
  // WP-T: the contents page comes first, before the body, exactly as the format ordered it.
  const contents = buildContents(model);
  if (contents.length > 0) {
    sections.push({
      heading: model.contents?.title ?? 'Contents',
      blocks: contents.map((e) => ({
        kind: 'paragraph' as const,
        text: `${e.number ? `${e.number}. ` : ''}${e.level === 2 ? '   ' : ''}${e.label}`,
      })),
    });
  }
  for (const s of model.sections) {
    const blocks: PdfBlock[] = [];
    for (const b of s.blocks) {
      if (b.kind === 'table' && b.table) {
        blocks.push({ kind: 'heading', text: b.text ?? '' });
        blocks.push({ kind: 'paragraph', text: b.table.headers.join('  |  ') });
        for (const row of b.table.rows) blocks.push({ kind: 'paragraph', text: row.join('  |  ') });
      } else if (b.kind === 'figure' && b.figure) {
        // WP-G: rasterise the figure through the one pure engine, so the printed page is the figure
        // the canvas showed. A figure that cannot be rendered is skipped, never faked.
        const png = figurePng(b.figure);
        if (png) {
          blocks.push({
            kind: 'figure',
            title: b.figure.title,
            caption: b.figure.label,
            png,
            widthPt: FIGURE_SIZE_PT.widthPt,
            heightPt: FIGURE_SIZE_PT.heightPt,
          });
        }
      } else {
        blocks.push({ kind: b.kind === 'heading' ? 'heading' : 'paragraph', text: b.text ?? '' });
      }
    }
    sections.push({ heading: s.heading, blocks });
  }
  const line = footerLine(model.footer);
  if (line) sections.push({ heading: 'Document control', blocks: [{ kind: 'paragraph', text: line }] });
  return { title: model.title, subtitle: model.subtitle, sections, timestamp, typography };
}

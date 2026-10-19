/**
 * Board Pack document builders (F10, S7). Pure: they turn a snapshot into the models the shared
 * renderers consume (renderPdf, renderPptx), so the web view, the PDF and the PPTX all come from the
 * same snapshot. Every figure becomes a hyperlink to its record (drill-down), built with
 * figureDrillDownUrl. No data leaves the tenant boundary; no AI (L1).
 */
import type { PdfDocumentModel, PdfSection } from './render/pdf';
import type { PptxDocumentModel, PptxSlide } from './render/pptx';
import type { BrandingSpec } from './render/branding';
import {
  capBandLabel,
  collectFigures,
  excludedNote,
  figureDrillDownUrl,
  type BoardPackSnapshot,
  type FigureRef,
  type FigureRow,
} from './boardPack';

export interface BoardPackDocInput {
  title: string;
  snapshot: BoardPackSnapshot;
  branding: BrandingSpec;
  /** The org's app_base_url. Refuse to render until it is set (F10). */
  appBaseUrl: string;
  dataHash: string;
  generatedAt: string;
}

/** The first ref of a figure, which is what a drill-down opens. */
function firstRef(row: FigureRow): FigureRef | null {
  return row.refs.length > 0 ? row.refs[0] : null;
}

/** A figure row as a hyperlink, when it has something to point at. */
function rowLink(row: FigureRow, appBaseUrl: string): { label: string; url: string } | null {
  const ref = firstRef(row);
  if (!ref) return null;
  return { label: `${row.label}: ${row.value}`, url: figureDrillDownUrl(appBaseUrl, ref) };
}

/** The rows of the pack, grouped for a readable document. */
export function figureRowsByGroup(snapshot: BoardPackSnapshot): { group: string; rows: FigureRow[] }[] {
  const rows = collectFigures(snapshot);
  const order = ['sira', 'plan', 'cap', 'sealed_work', 'management_responses'];
  const labels: Record<string, string> = {
    sira: 'SIRA residual risk',
    plan: 'Audit plan progress',
    cap: 'Open issues and CAP aging',
    sealed_work: 'Sealed work and integrity',
    management_responses: 'Management responses',
  };
  const groups = new Map<string, FigureRow[]>();
  for (const r of rows) {
    const key = order.find((k) => r.path === k || r.path.startsWith(`${k}.`)) ?? 'other';
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...order, 'other']
    .filter((k) => groups.has(k))
    .map((k) => ({ group: labels[k] ?? 'Other figures', rows: groups.get(k) as FigureRow[] }));
}

/** Build the PDF model for a pack: sections, a table of figures, a QR for the data hash and links. */
export function buildBoardPackPdf(input: BoardPackDocInput): PdfDocumentModel {
  const { title, snapshot, appBaseUrl, dataHash, generatedAt } = input;
  const sections: PdfSection[] = [];

  sections.push({
    heading: 'Cover and assurance statement',
    blocks: [
      { kind: 'paragraph', text: title },
      { kind: 'paragraph', text: `Generated ${generatedAt}. Snapshot hash ${dataHash}.` },
      { kind: 'paragraph', text: 'Every figure below links to the sealed or ledgered record it came from.' },
    ],
  });

  for (const { group, rows } of figureRowsByGroup(snapshot)) {
    const links = rows
      .map((r) => rowLink(r, appBaseUrl))
      .filter((l): l is { label: string; url: string } => l !== null);
    sections.push({
      heading: group,
      blocks: rows.map((r) => ({ kind: 'paragraph' as const, text: `${r.label}: ${r.value}` })),
      links: links.length > 0 ? links : undefined,
    });
  }

  sections.push({
    heading: 'Sources',
    blocks: [
      { kind: 'paragraph', text: excludedNote(snapshot) },
      { kind: 'paragraph', text: 'Each figure above is a drill-down link to its source record.' },
    ],
  });

  return {
    title,
    subtitle: 'Board Pack',
    sections,
    qrCaption: 'Scan to verify this pack',
    templateVars: { dataHash },
  };
}

/** Build the PPTX model for a pack: a cover slide, one slide per group, native tables and links. */
export function buildBoardPackPptx(input: BoardPackDocInput): PptxDocumentModel {
  const { title, snapshot, appBaseUrl, dataHash, generatedAt } = input;
  const slides: PptxSlide[] = [];

  slides.push({
    title,
    bullets: [`Generated ${generatedAt}`, `Snapshot hash ${dataHash}`, 'Figures link to their records'],
  });

  for (const { group, rows } of figureRowsByGroup(snapshot)) {
    const links = rows
      .map((r) => rowLink(r, appBaseUrl))
      .filter((l): l is { label: string; url: string } => l !== null);
    slides.push({
      title: group,
      bullets: rows.map((r) => `${r.label}: ${r.value}`),
      table: {
        header: ['Figure', 'Value'],
        rows: rows.map((r) => [r.label, String(r.value)]),
      },
      links: links.length > 0 ? links : undefined,
    });
  }

  slides.push({ title: 'Sources', bullets: [excludedNote(snapshot)] });

  return { title, subtitle: 'Board Pack', slides };
}

/** The CAP aging bands as a small table for the web view, in the F10 order. */
export function capAgingRows(snapshot: BoardPackSnapshot): { band: string; label: string; value: number }[] {
  const cap = snapshot.cap ?? {};
  const order = ['0-30', '31-60', '61-90', '90+', 'not_due', 'no_due_date'];
  return order
    .filter((band) => band in cap)
    .map((band) => ({ band, label: capBandLabel(band), value: Number(cap[band]?.value ?? 0) }));
}

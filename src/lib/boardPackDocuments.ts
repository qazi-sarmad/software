/**
 * Board Pack document builders (F10, S7). Pure: they turn a snapshot into the models the shared
 * renderers consume (renderPdf, renderPptx), so the web view, the PDF and the PPTX all come from the
 * same snapshot. Every figure becomes a hyperlink to its record (drill-down), built with
 * figureDrillDownUrl. No data leaves the tenant boundary; no AI (L1).
 */
import type { PdfDocumentModel, PdfFigureBlock, PdfSection } from './render/pdf';
import type { PptxDocumentModel, PptxSlide } from './render/pptx';
import type { BrandingSpec } from './render/branding';
import { renderChartPng, type ChartModel } from './render/chart';
import {
  capBandLabel,
  collectFigures,
  excludedNote,
  figureDrillDownUrl,
  type BoardPackSnapshot,
  type FigureRef,
  type FigureRow,
} from './boardPack';
import {
  ganttChart,
  ganttLegend,
  ganttLayout,
  heatmapChart,
  heatmapGrid,
  type GanttRow,
} from './boardPackVisuals';

export interface BoardPackDocInput {
  title: string;
  snapshot: BoardPackSnapshot;
  branding: BrandingSpec;
  /** The org's app_base_url. Refuse to render until it is set (F10). */
  appBaseUrl: string;
  dataHash: string;
  generatedAt: string;
  /** Band name -> hex colour, read from the org's SIRA bands. Optional; falls back to a token. */
  bandColours?: Record<string, string>;
  /** The chart colours, from the branding. Optional so existing callers keep working. */
  chartColours?: { background: string; axis: string; text: string };
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

/** The default chart colours when the caller supplies none (a PDF needs a value, not a token). */
const DEFAULT_CHART_COLOURS = { background: '#ffffff', axis: '#8a8a8a', text: '#1c1c1e' };

/** A chart as a PDF figure block: the same PNG the canvas and the DOCX show (WP-G bridge). */
function chartFigureBlock(
  chart: ChartModel, title: string, caption: string, colours?: BoardPackDocInput['chartColours'],
): PdfFigureBlock {
  const png = renderChartPng(chart, colours ?? DEFAULT_CHART_COLOURS);
  return { kind: 'figure', title, caption, png, widthPt: 468, heightPt: 240 };
}

/** The SIRA heatmap as a PDF figure, or null when the pack has no heatmap (older packs). */
export function heatmapFigureBlock(input: BoardPackDocInput): PdfFigureBlock | null {
  const chart = heatmapChart(input.snapshot.sira?.heatmap, input.bandColours ?? {}, '#5b8def');
  if (!chart) return null;
  const grid = heatmapGrid(input.snapshot.sira?.heatmap);
  return chartFigureBlock(chart, 'SIRA residual risk heatmap',
    `${grid.total} score${grid.total === 1 ? '' : 's'} across ${grid.entities.length} entities.`, input.chartColours);
}

/** The plan Gantt as a PDF figure, or null when no plan item carries a date. */
export function ganttFigureBlock(input: BoardPackDocInput): PdfFigureBlock | null {
  const chart = ganttChart(input.snapshot.plan?.gantt, input.generatedAt.slice(0, 10), '#3f9e7c');
  if (!chart) return null;
  const layout = ganttLayout(input.snapshot.plan?.gantt, input.generatedAt.slice(0, 10));
  return chartFigureBlock(chart, 'Audit plan window',
    `${layout.bars.length} planned item${layout.bars.length === 1 ? '' : 's'}, ${layout.minStart} to ${layout.maxEnd}.`,
    input.chartColours);
}

/** The heatmap as a table: header entity + bands, one row per entity, values in the cells. */
export function heatmapTable(snapshot: BoardPackSnapshot): { header: string[]; rows: string[][] } | null {
  const grid = heatmapGrid(snapshot.sira?.heatmap);
  if (grid.total === 0) return null;
  return {
    header: ['Entity', ...grid.bands],
    rows: grid.entities.map((e) => [e, ...grid.bands.map((b) => String(grid.value(e, b)))]),
  };
}

/** The Gantt as a table: title, start, end, days and status, in the axis order. */
export function ganttTable(snapshot: BoardPackSnapshot, asOf: string): { header: string[]; rows: string[][] } | null {
  const layout = ganttLayout(snapshot.plan?.gantt, asOf);
  if (layout.bars.length === 0) return null;
  return {
    header: ['Plan item', 'Start', 'End', 'Days', 'Status'],
    rows: layout.bars.map((b) => [b.title, b.start, b.end, String(b.widthDays), b.status]),
  };
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

  // The two visuals the section list names, drawn before the figure tables.
  const heatmap = heatmapFigureBlock(input);
  const heatmapTableModel = heatmapTable(snapshot);
  if (heatmap) {
    const grid = heatmapGrid(snapshot.sira?.heatmap);
    sections.push({
      heading: 'SIRA residual risk heatmap',
      blocks: [
        heatmap,
        { kind: 'paragraph', text: `Residual risk by entity and band: ${grid.total} score${grid.total === 1 ? '' : 's'} across ${grid.entities.length} entit${grid.entities.length === 1 ? 'y' : 'ies'}.` },
      ],
      table: heatmapTableModel ?? undefined,
    });
  }

  const gantt = ganttFigureBlock(input);
  const ganttTableModel = ganttTable(snapshot, generatedAt.slice(0, 10));
  if (gantt) {
    const layout = ganttLayout(snapshot.plan?.gantt, generatedAt.slice(0, 10));
    const legend = ganttLegend(snapshot.plan?.gantt)
      .map((l) => `${l.status}: ${l.count}`).join(' · ');
    sections.push({
      heading: 'Audit plan window',
      blocks: [
        gantt,
        { kind: 'paragraph', text: `Plan window ${layout.minStart} to ${layout.maxEnd}. Status mix — ${legend}.` },
      ],
      table: ganttTableModel ?? undefined,
    });
  }

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

/** Build the PPTX model for a pack: a cover slide, the heatmap and Gantt, one slide per group. */
export function buildBoardPackPptx(input: BoardPackDocInput): PptxDocumentModel {
  const { title, snapshot, appBaseUrl, dataHash, generatedAt } = input;
  const slides: PptxSlide[] = [];
  const asOf = generatedAt.slice(0, 10);

  slides.push({
    title,
    bullets: [`Generated ${generatedAt}`, `Snapshot hash ${dataHash}`, 'Figures link to their records'],
  });

  const heatmap = heatmapChart(snapshot.sira?.heatmap, input.bandColours ?? {}, '#5b8def');
  const heatmapTableModel = heatmapTable(snapshot);
  if (heatmap && heatmapTableModel) {
    const grid = heatmapGrid(snapshot.sira?.heatmap);
    slides.push({
      title: 'SIRA residual risk heatmap',
      bullets: [`${grid.total} score${grid.total === 1 ? '' : 's'} across ${grid.entities.length} entities.`],
      table: heatmapTableModel,
      // A native bar chart of the band totals, so the deck has a real editable chart (F10).
      chart: {
        categories: grid.entities,
        values: grid.entities.map((e) => grid.bands.reduce((sum, b) => sum + grid.value(e, b), 0)),
        seriesName: 'Scores by entity',
      },
    });
  }

  const gantt = ganttChart(snapshot.plan?.gantt, asOf, '#3f9e7c');
  const ganttTableModel = ganttTable(snapshot, asOf);
  if (gantt && ganttTableModel) {
    const layout = ganttLayout(snapshot.plan?.gantt, asOf);
    slides.push({
      title: 'Audit plan window',
      bullets: [`Plan window ${layout.minStart} to ${layout.maxEnd}.`],
      table: ganttTableModel,
      chart: { categories: gantt.categories, values: gantt.series[0].values, seriesName: 'Days planned' },
    });
  }

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

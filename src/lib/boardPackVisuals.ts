/**
 * Board Pack visuals (F10, S7) — the pictures the pack promised but did not draw.
 *
 * The section list names "SIRA residual risk and heatmap" and "Audit plan progress and Gantt", yet
 * the pack rendered both as flat lists. This module turns the snapshot's `sira.heatmap` and
 * `plan.gantt` into the two grids the pack prints, and builds the chart models the shared chart
 * renderer consumes for the PDF and the PPTX.
 *
 * Pure throughout (L1): every function is a function of its arguments. Time is an argument
 * (`asOf`), never read from the clock. Colours are passed in from the design tokens or the org
 * branding, never hard-coded here. No AI, no network.
 */
import type { ChartModel, ChartSeries } from './render/chart';

/** One cell of the SIRA heatmap, as the snapshot carries it. */
export interface HeatmapCell {
  entity: string;
  band: string;
  value: number;
  refs?: { type: string; id: string }[];
}

export interface SiraHeatmap {
  entities?: string[];
  bands?: string[];
  cells?: HeatmapCell[];
}

/** One bar of the plan Gantt, as the snapshot carries it. */
export interface GanttRow {
  value?: number;
  title?: string;
  start?: string | null;
  end?: string | null;
  status?: string;
  refs?: { type: string; id: string }[];
}

/** A laid-out Gantt bar: offsets in days from the earliest start, and a width in days. */
export interface GanttBar {
  title: string;
  status: string;
  start: string;
  end: string;
  offsetDays: number;
  widthDays: number;
  /** True when the bar's window has not begun as at the as-of day. */
  future: boolean;
  /** True when the bar is still open as at the as-of day (end on or after the as-of day). */
  open: boolean;
}

export interface GanttLayout {
  bars: GanttBar[];
  /** Total span in days from the earliest start to the latest end, at least 1. */
  spanDays: number;
  minStart: string | null;
  maxEnd: string | null;
}

/** Whole days between two ISO dates; 0 when either is unparseable or the order is reversed. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * The heatmap as a dense grid: one row per entity, one column per band, in the snapshot's order.
 * A missing cell is zero, so the grid is always rectangular and every cell has a stable position.
 */
export function heatmapGrid(heatmap: SiraHeatmap | null | undefined): {
  entities: string[];
  bands: string[];
  value: (entity: string, band: string) => number;
  max: number;
  total: number;
} {
  const entities = [...(heatmap?.entities ?? [])];
  const bands = [...(heatmap?.bands ?? [])];
  const byKey = new Map<string, number>();
  let max = 0;
  let total = 0;
  for (const cell of heatmap?.cells ?? []) {
    if (!entities.includes(cell.entity)) entities.push(cell.entity);
    if (!bands.includes(cell.band)) bands.push(cell.band);
    byKey.set(`${cell.entity}\u0000${cell.band}`, cell.value);
    if (cell.value > max) max = cell.value;
    total += cell.value;
  }
  return {
    entities,
    bands,
    value: (entity, band) => byKey.get(`${entity}\u0000${band}`) ?? 0,
    max,
    total,
  };
}

/** The snapshot's heatmap as a chart model: one series per band, one category per entity. */
export function heatmapChart(
  heatmap: SiraHeatmap | null | undefined,
  bandColours: Record<string, string>,
  fallbackColour: string,
): ChartModel | null {
  const grid = heatmapGrid(heatmap);
  if (grid.total === 0 || grid.entities.length === 0 || grid.bands.length === 0) return null;
  const series: ChartSeries[] = grid.bands.map((band) => ({
    label: band,
    values: grid.entities.map((entity) => grid.value(entity, band)),
    colour: bandColours[band] ?? fallbackColour,
  }));
  return { title: 'SIRA residual risk by entity and band', categories: grid.entities, series, kind: 'bar' };
}

/**
 * Lay the Gantt bars out on a common time axis. The axis starts at the earliest bar start; each bar
 * is placed by its offset from that start and sized by its own span. Deterministic: the input order
 * is the snapshot order (already sorted by start then title in the database).
 */
export function ganttLayout(gantt: GanttRow[] | null | undefined, asOf: string): GanttLayout {
  const rows = (gantt ?? []).filter((r) => typeof r.start === 'string' && r.start);
  if (rows.length === 0) return { bars: [], spanDays: 1, minStart: null, maxEnd: null };

  let minStart = rows[0].start as string;
  let maxEnd = (rows[0].end ?? rows[0].start) as string;
  for (const r of rows) {
    const start = r.start as string;
    const end = (r.end ?? r.start) as string;
    if (Date.parse(start) < Date.parse(minStart)) minStart = start;
    if (Date.parse(end) > Date.parse(maxEnd)) maxEnd = end;
  }

  const bars: GanttBar[] = rows.map((r) => {
    const start = r.start as string;
    const end = (r.end ?? r.start) as string;
    const offsetDays = daysBetween(minStart, start);
    const widthDays = Math.max(1, daysBetween(start, end));
    return {
      title: r.title ?? 'Plan item',
      status: r.status ?? 'proposed',
      start: start.slice(0, 10),
      end: end.slice(0, 10),
      offsetDays,
      widthDays,
      future: Date.parse(`${start.slice(0, 10)}T00:00:00Z`) > Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`),
      open: Date.parse(`${end.slice(0, 10)}T00:00:00Z`) >= Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`),
    };
  });

  return {
    bars,
    spanDays: Math.max(1, daysBetween(minStart, maxEnd)),
    minStart: minStart.slice(0, 10),
    maxEnd: maxEnd.slice(0, 10),
  };
}

/** A bar's position on the axis as percentages, so the screen draws it without knowing any dates. */
export function barPercentages(bar: GanttBar, spanDays: number): { left: number; width: number } {
  const span = Math.max(1, spanDays);
  const left = (bar.offsetDays / span) * 100;
  const width = Math.max(1.5, (bar.widthDays / span) * 100);
  return { left, width: Math.min(width, 100 - Math.min(left, 98.5)) };
}

/** The Gantt as a chart model, so the PDF and the PPTX get a native chart of the plan window. */
export function ganttChart(
  gantt: GanttRow[] | null | undefined,
  asOf: string,
  colour: string,
): ChartModel | null {
  const layout = ganttLayout(gantt, asOf);
  if (layout.bars.length === 0) return null;
  return {
    title: 'Audit plan window',
    categories: layout.bars.map((b) => b.title),
    series: [{ label: 'Days planned', values: layout.bars.map((b) => b.widthDays), colour }],
    kind: 'bar',
  };
}

/** The statuses present in the Gantt, in the F10 plan-status order, for a legend. */
export const PLAN_STATUS_ORDER = ['approved', 'pending_adhoc', 'proposed', 'removed'] as const;

export function ganttLegend(gantt: GanttRow[] | null | undefined): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of gantt ?? []) {
    const status = r.status ?? 'proposed';
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const ordered = PLAN_STATUS_ORDER.filter((s) => counts.has(s));
  const extra = [...counts.keys()].filter((s) => !(PLAN_STATUS_ORDER as readonly string[]).includes(s)).sort();
  return [...ordered, ...extra].map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

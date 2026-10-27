/**
 * Formula figures in a report (WP-G).
 *
 * A report block may carry a formula graphic. This module is the one bridge between the stored figure
 * spec and every output: the on-screen preview (SVG text), the PDF (PNG bytes) and the DOCX (PNG
 * bytes). All three call `formulaToChart` and then the existing pure renderer, so the printed figure
 * and the on-screen figure are the same figure, and a figure can never disagree with itself.
 *
 * Pure throughout: no clock, no randomness, no network. The expression grammar is the restricted one
 * in `./formula` (no `eval`), so a stored figure can never run code.
 */
import { formulaToChart, type FormulaPlotError } from './formulaPlot';
import { renderChartPng, renderChartSvg, type ChartModel, type ChartSize } from './chart';

/** The stored shape of a figure block, matching `FormulaFigure` in ./document. */
export interface FigureSpec {
  expression: string;
  minX: number;
  maxX: number;
  label: string;
  colour: string;
  title: string;
}

export type FigureResult =
  | { ok: true; chart: ChartModel }
  | { ok: false; error: FormulaPlotError };

/** The default figure size in the document, in points (roughly 6.5in x 3in on A4). */
export const FIGURE_SIZE_PT = { widthPt: 468, heightPt: 216 } as const;

/** The pixel size the figure is rasterised at, so a 2x print stays crisp. */
export const FIGURE_PIXELS: ChartSize = { width: 936, height: 432 };

const FIGURE_COLOURS = { background: '#ffffff', axis: '#888888', text: '#222222' };

/** Build the chart model for a figure, or a structured error. Pure. */
export function figureChart(spec: FigureSpec): FigureResult {
  const result = formulaToChart({
    expression: spec.expression,
    minX: spec.minX,
    maxX: spec.maxX,
    title: spec.title,
    label: spec.label,
    colour: spec.colour,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, chart: result.chart };
}

/** The figure as PNG bytes for embedding (PDF and DOCX). Pure and deterministic. */
export function figurePng(spec: FigureSpec): Uint8Array | null {
  const chart = figureChart(spec);
  if (!chart.ok) return null;
  return renderChartPng(chart.chart, FIGURE_COLOURS, FIGURE_PIXELS);
}

/** The figure as SVG text for the on-screen preview. Pure and deterministic. */
export function figureSvg(spec: FigureSpec): string | null {
  const chart = figureChart(spec);
  if (!chart.ok) return null;
  return renderChartSvg(chart.chart, FIGURE_COLOURS, FIGURE_PIXELS);
}

/**
 * Validate a figure spec without rendering it. Returns the first error message, or null when the
 * spec is renderable. Used by the editor to show a precise, non-blocking message under the input.
 */
export function figureError(spec: FigureSpec): string | null {
  const chart = figureChart(spec);
  return chart.ok ? null : chart.error.message;
}

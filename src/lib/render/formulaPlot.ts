/**
 * Formula-driven graphics (WP-G, spec §18 "Charts and graphs").
 *
 * The premium layer over the deterministic formula engine: a client gives an expression and a domain,
 * and this module samples it into the chart model the existing PNG/SVG/PDF renderers already draw. The
 * result is a branded, vector-crisp graphic produced from a formula, with no illustrator and no model
 * call.
 *
 * The sampling grid is fixed (`FORMULA_LIMITS.samples`), so the same formula, domain and colours
 * always produce the same graphic — the same determinism rule every other renderer follows. A point
 * where the expression is undefined (a gap in the domain) is skipped, so a curve never draws a false
 * segment across a discontinuity.
 */
import {
  compileFormula, evaluateFormula, FORMULA_LIMITS, type CompiledFormula, type FormulaError,
} from './formula';
import type { ChartModel } from './chart';

export interface FormulaPlotSpec {
  /** The expression, in the fixed grammar: `x`, numbers, `+ - * / ^`, parentheses and the functions. */
  expression: string;
  /** The left and right ends of the domain. `minX` must be less than `maxX`. */
  minX: number;
  maxX: number;
  /** The caption printed above the graphic. */
  title: string;
  /** The series label, for the legend. */
  label: string;
  /** The line colour, as a hex value from the org branding. */
  colour: string;
}

export interface FormulaPlotError {
  /** A stable code: `formula` carries a parse/evaluate reason; `domain` an unusable range. */
  code: 'formula' | 'domain';
  message: string;
  /** The parse error, when `code` is `formula`. */
  formula?: FormulaError;
}

export type FormulaPlotResult =
  | { ok: true; chart: ChartModel; formula: CompiledFormula; points: Array<{ x: number; y: number }> }
  | { ok: false; error: FormulaPlotError };

/** The largest domain the sampler will walk, so a hostile range cannot exhaust the loop. */
export const PLOT_LIMITS = {
  maxSpan: 1_000_000,
  samples: FORMULA_LIMITS.samples,
} as const;

/**
 * Sample a formula over a domain into a one-series line chart. Pure: no clock, no randomness. The
 * chart model it returns renders through `renderChartPng`, `renderChartSvg` and `chartDrawList`
 * unchanged, so a formula graphic is branded exactly like every other chart.
 */
export function formulaToChart(spec: FormulaPlotSpec): FormulaPlotResult {
  const compiled = compileFormula(spec.expression);
  if (!compiled.ok) {
    return { ok: false, error: { code: 'formula', message: compiled.error.message, formula: compiled.error } };
  }
  const { minX, maxX } = spec;
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return { ok: false, error: { code: 'domain', message: 'the domain ends must be numbers' } };
  }
  if (maxX <= minX) {
    return { ok: false, error: { code: 'domain', message: 'the right end of the domain must be greater than the left' } };
  }
  if (maxX - minX > PLOT_LIMITS.maxSpan) {
    return { ok: false, error: { code: 'domain', message: `the domain may span at most ${PLOT_LIMITS.maxSpan}` } };
  }

  const n = PLOT_LIMITS.samples;
  const step = (maxX - minX) / (n - 1);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) {
    const x = minX + step * i;
    const y = evaluateFormula(compiled.formula, x);
    if (Number.isFinite(y)) points.push({ x, y });
  }

  // The category axis is the sampled x, labelled by its value, so the graphic is a real function plot.
  const categories = points.map((p) => formatTick(p.x));
  const chart: ChartModel = {
    title: spec.title,
    categories,
    series: [{ label: spec.label, values: points.map((p) => p.y), colour: spec.colour }],
    kind: 'line',
  };
  return { ok: true, chart, formula: compiled.formula, points };
}

/** A compact axis label for a sampled x. Deterministic, so the SVG and PNG agree. */
export function formatTick(x: number): string {
  if (Number.isInteger(x)) return String(x);
  const rounded = Math.round(x * 1000) / 1000;
  return String(rounded);
}

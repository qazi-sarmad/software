/**
 * The designer grid (WP-D).
 *
 * The grid is the snap step, the rulers and the guides. Snapping is a pure function of the value and
 * the step, so the model never holds a half-step coordinate and the canvas and the renderers agree.
 * Pure: no clock, no randomness, no DOM.
 */

export const GRID_LIMITS = {
  sizeMm: { min: 1, max: 20 },
} as const;

export interface GridSpec {
  /** Whether the grid guides are drawn on the canvas. */
  visible: boolean;
  /** Whether dragging snaps to the grid. */
  snap: boolean;
  /** The snap step in millimetres. */
  sizeMm: number;
  /** Whether the rulers are drawn. */
  rulers: boolean;
  /** The ruler/grid subdivision marks per step (2 draws a half-step mark). */
  subdivisions: 1 | 2 | 4;
}

export const DEFAULT_GRID: GridSpec = {
  visible: true,
  snap: true,
  sizeMm: 5,
  rulers: true,
  subdivisions: 2,
};

/** Snap a value to the nearest step. Snapping is off when the grid is disabled, off, or the step is
 *  not a positive number, in which case the value is returned rounded to two decimals. */
export function snapValue(value: number, grid: GridSpec): number {
  const step = grid.sizeMm;
  if (!grid.snap || !Number.isFinite(step) || step <= 0) return round2(value);
  return round2(Math.round(value / step) * step);
}

/** Snap a width to the grid, but never below one step, so a block can never be snapped to nothing. */
export function snapWidth(value: number, grid: GridSpec): number {
  const step = Number.isFinite(grid.sizeMm) && grid.sizeMm > 0 ? grid.sizeMm : 1;
  return Math.max(step, snapValue(value, grid));
}

/** The grid lines for a span, as offsets from the span's own start. Pure. */
export function gridLines(lengthMm: number, grid: GridSpec): number[] {
  const step = grid.sizeMm;
  if (!grid.visible || !Number.isFinite(step) || step <= 0) return [];
  const out: number[] = [];
  for (let v = step; v <= lengthMm + 1e-6; v += step) out.push(round2(v));
  return out;
}

/** The ruler marks for a span, at the subdivision step. Pure. */
export function rulerMarks(lengthMm: number, grid: GridSpec): number[] {
  const step = grid.sizeMm / (grid.subdivisions || 1);
  if (!grid.rulers || !Number.isFinite(step) || step <= 0) return [];
  const out: number[] = [];
  for (let v = 0; v <= lengthMm + 1e-6; v += step) out.push(round2(v));
  return out;
}

/** The nearest grid line to a value, for a guide highlight. Pure. */
export function nearestGridLine(value: number, grid: GridSpec): number {
  return snapValue(value, grid);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

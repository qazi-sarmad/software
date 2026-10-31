/**
 * SIRA engine (Phase 3, task 3C; spec §8.2, Law L1).
 *
 * Deterministic scoring only: no I/O, no randomness, no AI. This is the exact mirror of the SQL
 * function public.sira_compute (migration 0019_sira_model.sql); the parity test
 * (src/lib/siraEngine.test.ts) runs the same fixtures through both and asserts they agree.
 *
 * All scores normalise to 0-100. The four aggregation methods are the fixed library the spec names:
 * weighted_sum, maximum, weighted_average and weighted_average_floor.
 */

export const SIRA_METHODS = [
  'weighted_sum',
  'maximum',
  'weighted_average',
  'weighted_average_floor',
] as const;

export type SiraMethod = (typeof SIRA_METHODS)[number];

export interface SiraFactor {
  key: string;
  label: string;
  weight: number;
  ordinal: number;
}

export interface SiraScalePoint {
  point: number;
  label: string;
}

export interface SiraBand {
  name: string;
  min: number;
  max: number;
  ordinal: number;
}

export interface SiraModel {
  aggregation: SiraMethod;
  factors: SiraFactor[];
  scales: SiraScalePoint[];
  bands: SiraBand[];
}

/** A 1..maxPoint point per factor key. */
export type FactorValues = Record<string, number>;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Compute a 0-100 SIRA score from factor values.
 * Mirrors public.sira_compute exactly. Throws on an out-of-range value or an unknown method.
 */
export function siraCompute(
  factorValues: FactorValues,
  weights: Record<string, number>,
  maxPoint: number,
  method: SiraMethod,
): number {
  const max = Math.max(maxPoint || 5, 2);

  let sumWDelta = 0; // sum(weight * (v-1))
  let sumWSpan = 0; // sum(weight * (max-1))
  let sumW = 0; // sum(weight)
  let sumWV = 0; // sum(weight * v)
  let maxDelta = 0; // max(v-1)

  for (const [k, v] of Object.entries(factorValues)) {
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (v < 1 || v > max) {
      throw new Error(`sira_compute: factor ${k} value ${v} is outside 1..${max}`);
    }
    const w = weights[k] ?? 1;
    sumW += w;
    sumWV += w * v;
    sumWDelta += w * (v - 1);
    sumWSpan += w * (max - 1);
    if (v - 1 > maxDelta) maxDelta = v - 1;
  }

  if (sumW === 0) return 0;

  switch (method) {
    case 'maximum':
      return round2((100 * maxDelta) / (max - 1));
    case 'weighted_average':
      return round2((100 * sumWV) / (sumW * max));
    case 'weighted_average_floor':
      return round2(
        Math.max((100 * sumWV) / (sumW * max), ((100 * maxDelta) / (max - 1)) * 0.5),
      );
    case 'weighted_sum':
      if (sumWSpan === 0) return 0;
      return round2((100 * sumWDelta) / sumWSpan);
    default:
      throw new Error(`sira_compute: unknown aggregation method ${method}`);
  }
}

/** Map a 0-100 score to a band name. The highest matching band wins. */
export function siraBandFor(score: number, bands: SiraBand[]): string | null {
  const matches = bands
    .filter((b) => score >= b.min && score <= b.max)
    .sort((a, b) => b.ordinal - a.ordinal);
  return matches.length ? matches[0].name : null;
}

/**
 * Normalise factor weights so they sum to exactly 100 (docs/RISK-ASSESSMENT-MODEL.md §5 — "the
 * total factors and the mathematical formula stay at 100"). Deterministic: the largest-remainder
 * method, ties broken by factor key, so the same weights always give the same integers and the sum
 * is exactly 100, never 99.99. A non-positive weight is dropped; all-non-positive gives all zeros.
 *
 * Mirrors public.sira_normalize_weights exactly (parity test).
 */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights)
    .filter(([, w]) => Number.isFinite(w) && w > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const out: Record<string, number> = {};
  for (const [k] of Object.entries(weights)) out[k] = 0;
  if (total <= 0) return out;

  const exact = entries.map(([k, w]) => ({ k, exact: (w / total) * 100 }));
  const floors = exact.map((e) => ({ k: e.k, floor: Math.floor(e.exact), rem: e.exact - Math.floor(e.exact) }));
  let deficit = 100 - floors.reduce((s, f) => s + f.floor, 0);
  const byRemainder = [...floors].sort((a, b) => (b.rem - a.rem) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  for (const f of byRemainder) {
    if (deficit <= 0) break;
    f.floor += 1;
    deficit -= 1;
  }
  for (const f of floors) out[f.k] = f.floor;
  return out;
}

/** The QSCorp default model (§8.2): six factors, 1-5 scale, four bands, weighted_sum. */
export function defaultSiraModel(): SiraModel {
  return {
    aggregation: 'weighted_sum',
    factors: [
      { key: 'inherent_risk', label: 'Inherent risk', weight: 1, ordinal: 1 },
      { key: 'complexity', label: 'Complexity', weight: 1, ordinal: 2 },
      { key: 'regulatory_exposure', label: 'Regulatory exposure', weight: 1, ordinal: 3 },
      { key: 'prior_findings', label: 'Prior findings', weight: 1, ordinal: 4 },
      { key: 'time_since_audit', label: 'Time since last audit', weight: 1, ordinal: 5 },
      { key: 'materiality', label: 'Materiality', weight: 1, ordinal: 6 },
    ],
    scales: [
      { point: 1, label: 'Very low' },
      { point: 2, label: 'Low' },
      { point: 3, label: 'Medium' },
      { point: 4, label: 'High' },
      { point: 5, label: 'Very high' },
    ],
    bands: [
      { name: 'Low', min: 0, max: 25, ordinal: 1 },
      { name: 'Medium', min: 25, max: 50, ordinal: 2 },
      { name: 'High', min: 50, max: 75, ordinal: 3 },
      { name: 'Critical', min: 75, max: 100, ordinal: 4 },
    ],
  };
}

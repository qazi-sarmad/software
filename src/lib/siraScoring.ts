/**
 * SIRA scoring surface model (S18; spec §8.2, Law L1).
 *
 * The pure rule behind the scoring panel: what the panel shows and what it will refuse. It is
 * deterministic and takes the model as data, so the score previewed here is the score the RPC will
 * store — `previewScore` calls the same `siraCompute` the SQL function mirrors.
 *
 * Nothing here reads the clock or the database, and nothing is inferred: an unscored entity×risk
 * pair is reported as unscored, never as a zero.
 */
import { siraCompute, type FactorValues, type SiraMethod } from './siraEngine';

/**
 * The model as the scoring surface holds it. Structural and `aggregation: string` so the panel does
 * not have to narrow a union it never chooses; `previewScore` validates the method by catching
 * `siraCompute`'s own refusal rather than re-implementing the check.
 */
export interface ScoringModel {
  aggregation: string;
  factors: { key: string; label: string; weight: number; ordinal: number }[];
  scales: { point: number; label: string }[];
  bands: { name: string; min: number; max: number; ordinal: number }[];
}

/** One cell of the scoring matrix: an entity against a risk, scored or not. */
export interface ScoreCell {
  entityId: string;
  riskId: string;
  score: number | null;
  band: string | null;
}

/** A score as the screen holds it, keyed by `entityId::riskId`. */
export interface ExistingScore {
  entityId: string;
  riskId: string | null;
  score: number;
  band: string | null;
}

export interface CycleScoreSummary {
  cells: number;
  scored: number;
  unscored: number;
  meanScore: number | null;
}

const cellKey = (entityId: string, riskId: string): string => `${entityId}::${riskId}`;

/**
 * The scoring matrix from the model, the entities and the risks. A cell with no recorded score is
 * `score: null` — the honest "not scored yet", never a fabricated zero. A score recorded against a
 * risk that is no longer in the library is still reported, under a `null` risk id, so a score is
 * never silently dropped.
 */
export function scoreMatrix(entities: string[], risks: string[], existing: ExistingScore[]): ScoreCell[] {
  const byKey = new Map<string, ExistingScore>();
  for (const s of existing) {
    if (s.riskId) byKey.set(cellKey(s.entityId, s.riskId), s);
  }
  const cells: ScoreCell[] = [];
  for (const entityId of entities) {
    for (const riskId of risks) {
      const hit = byKey.get(cellKey(entityId, riskId));
      cells.push({
        entityId,
        riskId,
        score: hit ? hit.score : null,
        band: hit ? hit.band : null,
      });
    }
  }
  return cells;
}

/** The cycle's scored/unscored counts and the mean of the scores that exist. `null`, not 0, when none. */
export function summariseCycle(cells: ScoreCell[]): CycleScoreSummary {
  const scored = cells.filter((c) => c.score !== null);
  const total = scored.reduce((acc, c) => acc + (c.score as number), 0);
  return {
    cells: cells.length,
    scored: scored.length,
    unscored: cells.length - scored.length,
    meanScore: scored.length ? Math.round((total / scored.length) * 100) / 100 : null,
  };
}

/** The highest scale point in the model, or 5 — the ceiling a factor value may take. */
export function modelMaxPoint(model: ScoringModel): number {
  return model.scales.reduce((max, s) => (s.point > max ? s.point : max), 5);
}

/** The factor values a fresh score starts from: every factor at 1 (the lowest point). */
export function initialFactorValues(model: ScoringModel): FactorValues {
  const out: FactorValues = {};
  for (const f of model.factors) out[f.key] = 1;
  return out;
}

export type ScoreValidation = { ok: true } | { ok: false; reason: string };

/**
 * Validate a factor-value set against the model before it is sent. Every factor must carry a value
 * inside 1..maxPoint; a missing factor is refused rather than defaulted, so the stored score always
 * reflects what the preparer entered.
 */
export function validateFactorValues(model: ScoringModel, values: FactorValues): ScoreValidation {
  const max = modelMaxPoint(model);
  for (const f of model.factors) {
    const v = values[f.key];
    if (v === undefined || v === null || Number.isNaN(v)) {
      return { ok: false, reason: `${f.label} needs a value.` };
    }
    if (!Number.isInteger(v) || v < 1 || v > max) {
      return { ok: false, reason: `${f.label} must be a whole number from 1 to ${max}.` };
    }
  }
  return { ok: true };
}

/**
 * The score the panel previews, or `null` when the values are not yet valid. Never throws: an
 * out-of-range value returns null so the preview reads as "not ready", not as a crash.
 */
export function previewScore(model: ScoringModel, values: FactorValues): number | null {
  if (!validateFactorValues(model, values).ok) return null;
  const weights: Record<string, number> = {};
  for (const f of model.factors) weights[f.key] = f.weight;
  try {
    return siraCompute(values, weights, modelMaxPoint(model), model.aggregation as SiraMethod);
  } catch {
    return null;
  }
}

/** A draft emergent risk is valid when it has a non-empty title. */
export function emergentRiskIsValid(title: string): boolean {
  return title.trim().length > 0;
}

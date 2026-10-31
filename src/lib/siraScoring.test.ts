import { describe, expect, it } from 'vitest';
import {
  emergentRiskIsValid,
  initialFactorValues,
  modelMaxPoint,
  previewScore,
  scoreMatrix,
  summariseCycle,
  validateFactorValues,
} from './siraScoring';
import { defaultSiraModel } from './siraEngine';

const MODEL = defaultSiraModel();

describe('siraScoring (S18)', () => {
  it('builds the matrix from entities × risks, unscored cells as null (never a fabricated zero)', () => {
    const cells = scoreMatrix(['e1', 'e2'], ['r1', 'r2'], [
      { entityId: 'e1', riskId: 'r1', score: 40, band: 'Medium' },
    ]);
    expect(cells).toHaveLength(4);
    const scored = cells.filter((c) => c.score !== null);
    expect(scored).toHaveLength(1);
    expect(scored[0]).toMatchObject({ entityId: 'e1', riskId: 'r1', score: 40, band: 'Medium' });
  });

  it('reports a score recorded against a risk no longer in the library under a null risk id', () => {
    const cells = scoreMatrix(['e1'], ['r1'], [{ entityId: 'e1', riskId: null, score: 10, band: 'Low' }]);
    expect(cells).toHaveLength(1);
    expect(cells[0].score).toBeNull();
  });

  it('summarises scored and unscored counts, and the mean is null when nothing is scored', () => {
    const empty = summariseCycle(scoreMatrix(['e1'], ['r1'], []));
    expect(empty).toMatchObject({ cells: 1, scored: 0, unscored: 1, meanScore: null });
    const some = summariseCycle([
      { entityId: 'e1', riskId: 'r1', score: 30, band: null },
      { entityId: 'e1', riskId: 'r2', score: 50, band: null },
    ]);
    expect(some).toMatchObject({ cells: 2, scored: 2, unscored: 0, meanScore: 40 });
  });

  it('reads the model max point and seeds every factor at the lowest point', () => {
    expect(modelMaxPoint(MODEL)).toBe(5);
    const init = initialFactorValues(MODEL);
    expect(Object.keys(init)).toHaveLength(6);
    expect(Object.values(init).every((v) => v === 1)).toBe(true);
  });

  it('refuses a missing or out-of-range factor rather than defaulting it', () => {
    expect(validateFactorValues(MODEL, initialFactorValues(MODEL)).ok).toBe(true);
    const missing = { ...initialFactorValues(MODEL) };
    delete missing.materiality;
    expect(validateFactorValues(MODEL, missing)).toMatchObject({ ok: false });
    const tooHigh = { ...initialFactorValues(MODEL), materiality: 9 };
    expect(validateFactorValues(MODEL, tooHigh)).toMatchObject({ ok: false });
    const fractional = { ...initialFactorValues(MODEL), materiality: 2.5 };
    expect(validateFactorValues(MODEL, fractional)).toMatchObject({ ok: false });
  });

  it('previews the score via the same engine the RPC mirrors, and null when invalid', () => {
    const allLow = initialFactorValues(MODEL);
    expect(previewScore(MODEL, allLow)).toBe(0);
    const allHigh = Object.fromEntries(MODEL.factors.map((f) => [f.key, 5]));
    expect(previewScore(MODEL, allHigh)).toBe(100);
    const bad = { ...initialFactorValues(MODEL), materiality: 99 };
    expect(previewScore(MODEL, bad)).toBeNull();
  });

  it('accepts an emergent risk only with a non-empty title', () => {
    expect(emergentRiskIsValid('New risk')).toBe(true);
    expect(emergentRiskIsValid('   ')).toBe(false);
  });
});

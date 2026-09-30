import { describe, expect, it } from 'vitest';
import { computeSiraScore, drawSeededSample, verifyPopulationGate } from './auditEngines';

describe('Audit Engines: Seeded Sampling, Population Gate, and SIRA', () => {
  it('Deterministic seeded sampling produces identical samples for identical seeds', () => {
    const population = Array.from({ length: 100 }, (_, i) => ({ id: `row-${i + 1}`, value: i * 10 }));
    const seed = 'PROVIO-AUDIT-2026-Q3-TREASURY';

    const sample1 = drawSeededSample(population, 10, seed);
    const sample2 = drawSeededSample(population, 10, seed);

    expect(sample1).toHaveLength(10);
    expect(sample2).toHaveLength(10);
    expect(sample1).toEqual(sample2);

    // Different seed produces different selection
    const sample3 = drawSeededSample(population, 10, 'DIFFERENT-SEED-999');
    expect(sample1).not.toEqual(sample3);
  });

  it('Population SHA-256 gate verifies population data integrity', async () => {
    const population = [{ id: 1, val: 500 }, { id: 2, val: 800 }];
    const gateCheck = await verifyPopulationGate(population, 'dummy_expected');
    expect(gateCheck.matches).toBe(false);
    expect(gateCheck.calculatedSha256).toBeDefined();

    // Matching hash check
    const validCheck = await verifyPopulationGate(population, gateCheck.calculatedSha256);
    expect(validCheck.matches).toBe(true);
  });

  it('Computes reproducible SIRA scores and tiers', () => {
    const highRiskEntity = computeSiraScore({
      financialMateriality: 5,
      regulatoryScrutiny: 5,
      processComplexity: 4,
      controlMaturity: 2,
      priorExceptions: 3,
    });
    expect(highRiskEntity.score).toBeGreaterThanOrEqual(70);
    expect(['High', 'Critical']).toContain(highRiskEntity.tier);

    const lowRiskEntity = computeSiraScore({
      financialMateriality: 1,
      regulatoryScrutiny: 1,
      processComplexity: 1,
      controlMaturity: 5,
      priorExceptions: 0,
    });
    expect(lowRiskEntity.score).toBeLessThanOrEqual(40);
    expect(lowRiskEntity.tier).toBe('Low');
  });
});

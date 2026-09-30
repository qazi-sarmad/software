import { computeSha256 } from './ledger';

/**
 * Deterministic PRNG using Mulberry32 algorithm.
 * Guarantees zero Math.random() usage in all audit sampling and statistical calculations.
 */
export function createDeterministicPrng(seedStr: string): () => number {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
  }
  let s = h >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically samples N items from population using seed string.
 */
export function drawSeededSample<T>(population: T[], sampleSize: number, seed: string): T[] {
  if (sampleSize <= 0) return [];
  if (sampleSize >= population.length) return [...population];

  const rng = createDeterministicPrng(seed);
  const pool = [...population];
  const sample: T[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor(rng() * pool.length);
    sample.push(pool.splice(idx, 1)[0]);
  }

  return sample;
}

/**
 * Verifies population SHA-256 gate.
 */
export async function verifyPopulationGate(
  populationData: unknown[],
  expectedSha256: string
): Promise<{ matches: boolean; calculatedSha256: string }> {
  const jsonStr = JSON.stringify(populationData);
  const calculatedSha256 = await computeSha256(jsonStr);
  return {
    matches: calculatedSha256 === expectedSha256,
    calculatedSha256,
  };
}

/**
 * Strategic Internal Risk Assessment (SIRA) composite score.
 * Formula: Inherent Risk (40%) + Velocity/Volatility (20%) - Control Quality (30%) + Prior Findings (10%)
 */
export interface SiraFactors {
  financialMateriality: number; // 1-5
  regulatoryScrutiny: number;    // 1-5
  processComplexity: number;     // 1-5
  controlMaturity: number;       // 1-5 (higher is better)
  priorExceptions: number;       // count
}

export function computeSiraScore(factors: SiraFactors): {
  score: number; // 0 - 100
  tier: 'Low' | 'Medium' | 'High' | 'Critical';
} {
  const inherent = (factors.financialMateriality * 0.4 + factors.regulatoryScrutiny * 0.35 + factors.processComplexity * 0.25) * 20; // 0-100
  const controlMitigation = (factors.controlMaturity / 5) * 40; // 0-40 reduction
  const findingsPenalty = Math.min(factors.priorExceptions * 5, 25); // 0-25 penalty

  const rawScore = Math.max(5, Math.min(100, Math.round(inherent - controlMitigation + findingsPenalty)));

  let tier: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';
  if (rawScore >= 80) tier = 'Critical';
  else if (rawScore >= 65) tier = 'High';
  else if (rawScore >= 45) tier = 'Medium';

  return { score: rawScore, tier };
}

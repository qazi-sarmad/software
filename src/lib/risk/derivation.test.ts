import { describe, expect, it } from 'vitest';
import {
  DERIVATION_RULES,
  applyOverride,
  bandedCount,
  deriveFactors,
  factorValuesOf,
  resolveFactors,
  revertOverride,
  type EntityRiskFacts,
  type FactorOverride,
} from './derivation';

const FULL_FACTS: EntityRiskFacts = {
  inherentRating: 3, complexityCount: 8, classification: 'C6',
  openFindings: 4, openFindingsSevere: 1, daysSinceLastAudit: 400,
  materialityPoint: 4, kriBreaches: 2, incidentCount: 3,
  controlTestFailures: 1, changeVelocity: 6,
};

const EMPTY_FACTS: EntityRiskFacts = {
  inherentRating: null, complexityCount: null, classification: null,
  openFindings: null, openFindingsSevere: null, daysSinceLastAudit: null,
  materialityPoint: null, kriBreaches: null, incidentCount: null,
  controlTestFailures: null, changeVelocity: null,
};

describe('D14: every auto-derived value is a named, versioned proposal', () => {
  it('names a rule and version and source for each of the ten factors', () => {
    expect(DERIVATION_RULES).toHaveLength(10);
    for (const r of DERIVATION_RULES) {
      expect(r.ruleId).toMatch(/^risk\.auto\./);
      expect(r.ruleVersion).toBeGreaterThanOrEqual(1);
      expect(r.source.length).toBeGreaterThan(0);
    }
  });

  it('derives all ten factors for a fully-specified entity, each within 1..5', () => {
    const p = deriveFactors(FULL_FACTS);
    expect(p).toHaveLength(10);
    for (const f of p) {
      expect(f.proposedValue).toBeGreaterThanOrEqual(1);
      expect(f.proposedValue).toBeLessThanOrEqual(5);
      expect(f.reason.length).toBeGreaterThan(0);
      expect(f.inputs.length).toBeGreaterThan(0);
    }
  });

  it('bad path: an unknown input yields null (unknown), NEVER 0', () => {
    const p = deriveFactors(EMPTY_FACTS);
    expect(p).toHaveLength(10);
    for (const f of p) {
      expect(f.proposedValue).toBeNull();
      expect(f.proposedValue).not.toBe(0);
    }
  });

  it('C6 regulatory exposure is the highest, C4 the lowest', () => {
    const c6 = deriveFactors({ ...EMPTY_FACTS, classification: 'C6' }).find((f) => f.factorKey === 'regulatory_exposure');
    const c4 = deriveFactors({ ...EMPTY_FACTS, classification: 'C4' }).find((f) => f.factorKey === 'regulatory_exposure');
    expect(c6?.proposedValue).toBe(5);
    expect(c4?.proposedValue).toBe(1);
  });

  it('bandedCount is a deterministic step function and never returns 0', () => {
    expect(bandedCount(0, [1, 3, 6, 10])).toBe(1);
    expect(bandedCount(1, [1, 3, 6, 10])).toBe(2);
    expect(bandedCount(100, [1, 3, 6, 10])).toBe(5);
    expect(bandedCount(-5, [1, 3, 6, 10])).toBe(1);
  });

  it('is deterministic: the same facts give byte-identical proposals', () => {
    expect(JSON.stringify(deriveFactors(FULL_FACTS))).toBe(JSON.stringify(deriveFactors(FULL_FACTS)));
  });
});

describe('D14: the manual override keeps the auto value and is revertible', () => {
  const proposals = deriveFactors(FULL_FACTS);
  const bandOf = (v: number) => (v >= 4 ? 'high' : v >= 3 ? 'medium' : 'low');

  it('records an override with the auto value preserved', () => {
    const inherent = proposals.find((f) => f.factorKey === 'inherent_risk')!;
    const o = applyOverride({
      factorKey: 'inherent_risk', overrideValue: 5, overrideReason: 'board judgement',
      overrideBy: 'u1', overrideAt: '2026-10-30T00:00:00Z', proposal: inherent,
    });
    expect(o.overrideValue).toBe(5);
    expect(o.autoValueAtOverride).toBe(inherent.proposedValue);
    expect(o.ruleId).toBe(inherent.ruleId);
  });

  it('bad path: an empty reason is refused', () => {
    const inherent = proposals.find((f) => f.factorKey === 'inherent_risk')!;
    expect(() => applyOverride({
      factorKey: 'inherent_risk', overrideValue: 5, overrideReason: '   ',
      overrideBy: 'u1', overrideAt: '2026-10-30T00:00:00Z', proposal: inherent,
    })).toThrow(/reason is required/);
  });

  it('bad path: an out-of-range override value is refused', () => {
    const inherent = proposals.find((f) => f.factorKey === 'inherent_risk')!;
    expect(() => applyOverride({
      factorKey: 'inherent_risk', overrideValue: 9, overrideReason: 'x',
      overrideBy: 'u1', overrideAt: '2026-10-30T00:00:00Z', proposal: inherent,
    })).toThrow(/outside 1\.\.5/);
  });

  it('the override wins over the auto value, and a band change is flagged', () => {
    const inherent = proposals.find((f) => f.factorKey === 'inherent_risk')!;
    const o: FactorOverride = applyOverride({
      factorKey: 'inherent_risk', overrideValue: 5, overrideReason: 'board judgement',
      overrideBy: 'u1', overrideAt: '2026-10-30T00:00:00Z', proposal: inherent,
    });
    const resolved = resolveFactors(proposals, [o], bandOf);
    const r = resolved.find((x) => x.factorKey === 'inherent_risk')!;
    expect(r.source).toBe('override');
    expect(r.value).toBe(5);
    expect(r.bandChanged).toBe(true);
  });

  it('revert keeps the record and names the revert', () => {
    const inherent = proposals.find((f) => f.factorKey === 'inherent_risk')!;
    const o = applyOverride({
      factorKey: 'inherent_risk', overrideValue: 5, overrideReason: 'board judgement',
      overrideBy: 'u1', overrideAt: '2026-10-30T00:00:00Z', proposal: inherent,
    });
    const reverted = revertOverride(o, 'u2', '2026-10-31T00:00:00Z');
    expect(reverted.overrideReason).toContain('reverted by u2');
    expect(reverted.autoValueAtOverride).toBe(o.autoValueAtOverride);
  });

  it('an unknown factor with no override stays unknown (omitted from the score values)', () => {
    const unknown = deriveFactors(EMPTY_FACTS);
    const resolved = resolveFactors(unknown, [], bandOf);
    expect(resolved.every((r) => r.source === 'unknown')).toBe(true);
    expect(factorValuesOf(resolved)).toEqual({});
  });
});

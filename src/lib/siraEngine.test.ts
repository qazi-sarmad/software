import { describe, it, expect } from 'vitest';
import fixtures from './siraFixtures.json';
import {
  siraCompute,
  siraBandFor,
  defaultSiraModel,
  SIRA_METHODS,
  type SiraMethod,
  type FactorValues,
} from './siraEngine';

interface Fixture {
  factorValues: FactorValues;
  weights: Record<string, number>;
  maxPoint: number;
  method: SiraMethod;
  expected: number;
}

// 3C parity fixtures. The same JSON is fed to public.sira_compute in
// supabase/tests/26_sira_model.sql, so the database and the app engine must agree exactly (L1).
const CASES = fixtures as Fixture[];

describe('siraCompute parity fixtures (>= 20)', () => {
  it('has at least 20 fixtures', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(CASES.map((c, i) => [i, c] as const))(
    'fixture %i (%s) matches the recorded score',
    (_i, c) => {
      expect(siraCompute(c.factorValues, c.weights, c.maxPoint, c.method)).toBe(c.expected);
    },
  );
});

describe('siraCompute properties', () => {
  const six = {
    inherent_risk: 3,
    complexity: 3,
    regulatory_exposure: 3,
    prior_findings: 3,
    time_since_audit: 3,
    materiality: 3,
  };
  const unitWeights = Object.fromEntries(Object.keys(six).map((k) => [k, 1]));

  it('is deterministic', () => {
    const a = siraCompute(six, unitWeights, 5, 'weighted_sum');
    const b = siraCompute(six, unitWeights, 5, 'weighted_sum');
    expect(a).toBe(b);
  });

  it('is monotonic in every factor for weighted_sum', () => {
    const base = siraCompute(six, unitWeights, 5, 'weighted_sum');
    for (const k of Object.keys(six)) {
      const higher = { ...six, [k]: 4 };
      expect(siraCompute(higher, unitWeights, 5, 'weighted_sum')).toBeGreaterThan(base);
    }
  });

  it('stays within 0..100 for every method', () => {
    for (const method of SIRA_METHODS) {
      const lo = siraCompute(
        Object.fromEntries(Object.keys(six).map((k) => [k, 1])),
        unitWeights,
        5,
        method,
      );
      const hi = siraCompute(
        Object.fromEntries(Object.keys(six).map((k) => [k, 5])),
        unitWeights,
        5,
        method,
      );
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(100);
    }
  });

  it('rejects a value outside 1..maxPoint', () => {
    expect(() => siraCompute({ ...six, inherent_risk: 9 }, unitWeights, 5, 'weighted_sum')).toThrow(
      /outside 1\.\.5/,
    );
    expect(() => siraCompute({ ...six, inherent_risk: 0 }, unitWeights, 5, 'weighted_sum')).toThrow();
  });

  it('rejects an unknown method', () => {
    expect(() =>
      siraCompute(six, unitWeights, 5, 'free_form' as unknown as SiraMethod),
    ).toThrow(/unknown aggregation method/);
  });

  it('ignores a factor with a null value', () => {
    const withNull = { ...six, complexity: null as unknown as number };
    expect(siraCompute(withNull, unitWeights, 5, 'weighted_sum')).toBe(
      siraCompute(
        { ...six, complexity: undefined as unknown as number },
        unitWeights,
        5,
        'weighted_sum',
      ),
    );
  });
});

describe('siraBandFor', () => {
  const model = defaultSiraModel();

  it('maps the boundaries to the documented bands', () => {
    expect(siraBandFor(0, model.bands)).toBe('Low');
    expect(siraBandFor(25, model.bands)).toBe('Medium'); // highest matching band wins
    expect(siraBandFor(50, model.bands)).toBe('High');
    expect(siraBandFor(75, model.bands)).toBe('Critical');
    expect(siraBandFor(100, model.bands)).toBe('Critical');
  });

  it('returns null outside every band', () => {
    expect(siraBandFor(-1, model.bands)).toBeNull();
    expect(siraBandFor(101, model.bands)).toBeNull();
  });
});

describe('defaultSiraModel', () => {
  it('is the six-factor, 1-5, four-band QSCorp default (§8.2)', () => {
    const m = defaultSiraModel();
    expect(m.factors.map((f) => f.key)).toEqual([
      'inherent_risk',
      'complexity',
      'regulatory_exposure',
      'prior_findings',
      'time_since_audit',
      'materiality',
    ]);
    expect(m.scales.map((s) => s.point)).toEqual([1, 2, 3, 4, 5]);
    expect(m.bands.map((b) => b.name)).toEqual(['Low', 'Medium', 'High', 'Critical']);
    expect(m.aggregation).toBe('weighted_sum');
  });
});

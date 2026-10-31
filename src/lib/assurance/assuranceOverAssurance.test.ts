import { describe, expect, it } from 'vitest';
import { IIA_STANDARDS, assuranceOverAssurance, type AssuranceMetric } from './assuranceOverAssurance';

function metric(over: Partial<AssuranceMetric> & { metricId: string }): AssuranceMetric {
  return { standard: '12.2', label: 'metric', value: 1, evidenceRef: 'EV-1', ...over };
}

describe('D9: assurance over assurance grounds in the IIA 2024 standards', () => {
  it('lists the IIA standards D9 uses, with their numbers and titles', () => {
    expect(IIA_STANDARDS.length).toBeGreaterThanOrEqual(19);
    expect(IIA_STANDARDS.find((s) => s.standard === '8.4')?.title).toBe('External Quality Assessment');
    expect(IIA_STANDARDS.find((s) => s.standard === '12.2')?.title).toBe('Performance Measurement');
    for (const s of IIA_STANDARDS) expect(s.title.length).toBeGreaterThan(0);
  });

  it('a measured metric names its value, standard and evidence', () => {
    const r = assuranceOverAssurance({ metrics: [metric({ metricId: 'M-1', value: 95, evidenceRef: 'EV-9' })], asOf: '2026-10-30' });
    expect(r.rows[0].state).toBe('measured');
    expect(r.rows[0].value).toBe(95);
    expect(r.rows[0].reason).toContain('IIA 12.2');
    expect(r.rows[0].reason).toContain('EV-9');
    expect(r.measured).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.asOf).toBe('2026-10-30');
  });

  it('BAD: a missing input is "unknown", never 0', () => {
    const r = assuranceOverAssurance({ metrics: [metric({ metricId: 'M-2', value: null })], asOf: '2026-10-30' });
    expect(r.rows[0].state).toBe('unknown');
    expect(r.rows[0].value).toBeNull();
    expect(r.rows[0].reason).toContain('unknown');
    expect(r.rows[0].reason).toContain('not zero');
    expect(r.unknown).toBe(1);
    expect(r.complete).toBe(false);
  });

  it('BAD: no metrics at all is not "complete"', () => {
    const r = assuranceOverAssurance({ metrics: [], asOf: '2026-10-30' });
    expect(r.complete).toBe(false);
    expect(r.rows).toHaveLength(0);
  });

  it('a metric measured with no evidence reference still says so', () => {
    const r = assuranceOverAssurance({ metrics: [metric({ metricId: 'M-3', evidenceRef: null })], asOf: '2026-10-30' });
    expect(r.rows[0].reason).toContain('no evidence reference');
  });
});

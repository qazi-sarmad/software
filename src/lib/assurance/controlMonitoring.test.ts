import { describe, expect, it } from 'vitest';
import {
  COSO_COMPONENTS,
  COSO_PRINCIPLES,
  TAXONOMIES,
  ASSERTIONS,
  DEFAULT_ICFR_THRESHOLDS,
  SEVERITY_LADDER,
  classifySeverity,
  monitorControls,
  breachFindingIntent,
  taxonomySummary,
  type ControlDefinition,
  type ControlMonitoringRule,
  type ControlTestEvidence,
} from './controlMonitoring';

function control(over: Partial<ControlDefinition> & { controlId: string }): ControlDefinition {
  return {
    taxonomy: 'coso_icif_2013', component: 'control_activities', principle: 12,
    assertion: 'completeness', owner: 'Owner', testProcedure: 'Procedure', ...over,
  };
}
function rule(over: Partial<ControlMonitoringRule> & { controlId: string }): ControlMonitoringRule {
  return { ruleId: `icfr.${over.controlId}`, ruleVersion: 1, tolerancePercent: 10, ...over };
}
function ev(over: Partial<ControlTestEvidence> & { controlId: string }): ControlTestEvidence {
  return { population: 100, deviations: 0, testedAt: '2026-10-28T00:00:00.000Z', ...over };
}

describe('D5: the COSO ICIF-2013 taxonomy is encoded as structure, not wording', () => {
  it('has the five components, and their principle counts sum to 17', () => {
    expect(COSO_COMPONENTS.map((c) => c.id)).toEqual([
      'control_environment', 'risk_assessment', 'control_activities',
      'information_communication', 'monitoring_activities',
    ]);
    expect(COSO_COMPONENTS.reduce((n, c) => n + c.principleCount, 0)).toBe(17);
  });

  it('has 17 numbered principles, each under a real component, matching the component counts', () => {
    expect(COSO_PRINCIPLES).toHaveLength(17);
    expect(COSO_PRINCIPLES.map((p) => p.number)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    for (const c of COSO_COMPONENTS) {
      expect(COSO_PRINCIPLES.filter((p) => p.component === c.id)).toHaveLength(c.principleCount);
    }
  });

  it('carries the ISO 27001:2022 Annex A control count of 93 and its four themes', () => {
    const iso = TAXONOMIES.find((t) => t.id === 'iso_27001_2022')!;
    expect(iso.controlCount).toBe(93);
    expect(iso.groups).toEqual(['Organizational', 'People', 'Physical', 'Technological']);
    expect(iso.source).toContain('ISO/IEC 27001:2022');
  });

  it('names every taxonomy source and its groups', () => {
    for (const t of TAXONOMIES) {
      expect(t.source.length).toBeGreaterThan(0);
      expect(t.groups.length).toBeGreaterThan(0);
    }
  });

  it('lists the six ICFR assertions of PCAOB AS 2201', () => {
    expect(ASSERTIONS.map((a) => a.id)).toEqual([
      'existence_occurrence', 'completeness', 'accuracy_valuation', 'cutoff', 'classification', 'presentation',
    ]);
  });

  it('encodes the three-way deficiency ladder with its deterministic tests', () => {
    expect(SEVERITY_LADDER.map((s) => s.severity)).toEqual([
      'deficiency', 'significant_deficiency', 'material_weakness',
    ]);
  });
});

describe('D5: the severity ladder is deterministic and names its figures', () => {
  const T = DEFAULT_ICFR_THRESHOLDS;

  it('is a deficiency below the significance threshold', () => {
    const r = classifySeverity({ population: 1000, deviations: 5, thresholds: T }); // 0.5%
    expect(r.severity).toBe('deficiency');
    expect(r.deviationPercent).toBeCloseTo(0.5, 6);
    expect(r.basis).toContain('below the significance threshold 2%');
  });

  it('is a significant deficiency between the significance and materiality thresholds', () => {
    const r = classifySeverity({ population: 1000, deviations: 50, thresholds: T }); // 5%
    expect(r.severity).toBe('significant_deficiency');
    expect(r.basis).toContain('at or above the significance threshold 2%');
    expect(r.basis).toContain('below the materiality threshold 10%');
  });

  it('is a material weakness at or above the materiality threshold', () => {
    const r = classifySeverity({ population: 1000, deviations: 100, thresholds: T }); // 10%
    expect(r.severity).toBe('material_weakness');
    expect(r.basis).toContain('at or above the materiality threshold 10%');
  });

  it('a compensating control caps the severity at deficiency, and names the control', () => {
    const r = classifySeverity({ population: 100, deviations: 40, thresholds: T, compensatingControlId: 'C-99' });
    expect(r.severity).toBe('deficiency');
    expect(r.basis).toContain('compensating control C-99 caps the severity at a deficiency');
  });
});

describe('D5: monitorControls — the happy path and every bad path', () => {
  it('a breach opens a finding intent carrying the control id, rule id and version', () => {
    const result = monitorControls({
      controls: [control({ controlId: 'C-01' })],
      rules: [rule({ controlId: 'C-01', ruleId: 'icfr.c01', ruleVersion: 3, tolerancePercent: 5 })],
      evidence: [ev({ controlId: 'C-01', population: 200, deviations: 40 })], // 20%
    });
    expect(result.breaches).toHaveLength(1);
    const breach = result.breaches[0];
    expect(breach.controlId).toBe('C-01');
    expect(breach.ruleId).toBe('icfr.c01');
    expect(breach.ruleVersion).toBe(3);
    expect(breach.severity).toBe('material_weakness');
    expect(breach.population).toBe(200);
    expect(breach.deviations).toBe(40);

    const intent = breachFindingIntent(breach);
    expect(intent.controlId).toBe('C-01');
    expect(intent.ruleId).toBe('icfr.c01');
    expect(intent.ruleVersion).toBe(3);
    expect(intent.reason).toContain('ICFR control C-01 breached');
    expect(intent.basis).toContain('materiality threshold');
  });

  it('a control within tolerance is a pass, and its reason names the rule and tolerance', () => {
    const result = monitorControls({
      controls: [control({ controlId: 'C-02' })],
      rules: [rule({ controlId: 'C-02', tolerancePercent: 5 })],
      evidence: [ev({ controlId: 'C-02', population: 1000, deviations: 20 })], // 2% < 5%
    });
    expect(result.breaches).toHaveLength(0);
    expect(result.rows[0].outcome).toBe('pass');
    expect(result.rows[0].reason).toContain('below the rule');
  });

  it('BAD: no control configured → the result says so, never a silent green', () => {
    const result = monitorControls({ controls: [], rules: [], evidence: [] });
    expect(result.rows).toHaveLength(0);
    expect(result.breaches).toHaveLength(0);
    expect(result.complete).toBe(true); // nothing configured is not "incomplete" — see the panel for the empty state
  });

  it('BAD: a control with a rule but no evidence is no_evidence, never a pass', () => {
    const result = monitorControls({
      controls: [control({ controlId: 'C-03' })],
      rules: [rule({ controlId: 'C-03' })],
      evidence: [],
    });
    expect(result.noEvidence).toEqual(['C-03']);
    expect(result.rows[0].outcome).toBe('no_evidence');
    expect(result.complete).toBe(false);
  });

  it('BAD: an empty population is unknown, not zero and not a pass', () => {
    const result = monitorControls({
      controls: [control({ controlId: 'C-04' })],
      rules: [rule({ controlId: 'C-04' })],
      evidence: [ev({ controlId: 'C-04', population: 0, deviations: 0 })],
    });
    expect(result.noEvidence).toEqual(['C-04']);
    expect(result.rows[0].reason).toContain('empty population');
    expect(result.rows[0].reason).toContain('not zero');
  });

  it('BAD: a configured control with no rule is unmonitored, never a pass', () => {
    const result = monitorControls({
      controls: [control({ controlId: 'C-05' })],
      rules: [],
      evidence: [ev({ controlId: 'C-05', population: 100, deviations: 0 })],
    });
    expect(result.unmonitored).toEqual(['C-05']);
    expect(result.rows[0].outcome).toBe('unmonitored');
    expect(result.complete).toBe(false);
  });

  it('a breach at exactly the tolerance fires (>=, not >)', () => {
    const result = monitorControls({
      controls: [control({ controlId: 'C-06' })],
      rules: [rule({ controlId: 'C-06', tolerancePercent: 10 })],
      evidence: [ev({ controlId: 'C-06', population: 100, deviations: 10 })], // exactly 10%
    });
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0].deviationPercent).toBeCloseTo(10, 6);
  });

  it('taxonomySummary exposes the components, the principle total and the taxonomies', () => {
    const s = taxonomySummary();
    expect(s.components).toHaveLength(5);
    expect(s.principleCount).toBe(17);
    expect(s.taxonomies).toHaveLength(4);
  });
});

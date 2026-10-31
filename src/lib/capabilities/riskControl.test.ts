import { describe, expect, it } from 'vitest';
import {
  controlCoverageMatrix,
  controlEffectivenessHistory,
  keyControlIndicator,
  residualRiskDrift,
  riskAppetiteBreach,
  riskRank,
  type ControlDependency,
  type RiskSnapshot,
} from './riskControl';
import type { AuditControl, AuditEntity } from '../../types';

function entity(over: Partial<AuditEntity>): AuditEntity {
  return {
    id: 'e1', universeId: 'u1', name: 'Entity One', code: 'E1', department: 'Finance',
    headOfDepartment: 'H', inherentRisk: 'medium', residualRisk: 'medium', siraScore: 50,
    controlsCount: 0, lastAuditDate: '2026-01-01', status: 'active', approvalStatus: 'approved', rejectionReason: null,
    ...over,
  };
}

function control(over: Partial<AuditControl>): AuditControl {
  return {
    id: 'c1', entityId: 'e1', engagementId: 'g1', code: 'C1', title: 'Control One', description: '',
    controlType: 'preventive', frequency: 'monthly', effectiveness: 'not_tested',
    ...over,
  };
}

describe('D1 — risk and control intelligence', () => {
  it('riskRank orders ratings on an ordinal scale and sorts an unknown lowest', () => {
    expect(riskRank('low')).toBe(0);
    expect(riskRank('critical')).toBe(3);
    expect(riskRank('nonsense')).toBe(0);
    expect(riskRank(null)).toBe(0);
  });

  it('residualRiskDrift signs the movement and flags a breach of tolerance', () => {
    const entities = [
      entity({ id: 'a', name: 'Alpha', residualRisk: 'high', siraScore: 70 }),
      entity({ id: 'b', name: 'Beta', residualRisk: 'low', siraScore: 20 }),
      entity({ id: 'c', name: 'Gamma', residualRisk: 'medium', siraScore: 50 }),
    ];
    const snapshots: RiskSnapshot[] = [
      { entityId: 'a', residualRisk: 'medium', siraScore: 50, asOf: '2026-01-01' },
      { entityId: 'b', residualRisk: 'high', siraScore: 70, asOf: '2026-01-01' },
      { entityId: 'c', residualRisk: 'medium', siraScore: 50, asOf: '2026-01-01' },
    ];
    const rows = residualRiskDrift({ entities, snapshots, tolerance: 'high' });
    // Worst drift first: Alpha +1, Gamma 0, Beta -1.
    expect(rows.map((r) => r.entityId)).toEqual(['a', 'c', 'b']);
    expect(rows[0].direction).toBe('worsened');
    expect(rows[0].step).toBe(1);
    expect(rows[0].breaches).toBe(true);
    expect(rows[2].direction).toBe('improved');
    expect(rows[1].direction).toBe('unchanged');
  });

  it('residualRiskDrift skips an entity with no prior snapshot rather than inventing a move', () => {
    const entities = [entity({ id: 'a' }), entity({ id: 'z', name: 'Zeta' })];
    const snapshots: RiskSnapshot[] = [{ entityId: 'a', residualRisk: 'medium', siraScore: 50, asOf: '2026-01-01' }];
    const rows = residualRiskDrift({ entities, snapshots, tolerance: 'high' });
    expect(rows.map((r) => r.entityId)).toEqual(['a']);
  });

  it('controlCoverageMatrix separates no-control from untested-control gaps', () => {
    const entities = [
      entity({ id: 'a', name: 'Alpha', residualRisk: 'critical' }),
      entity({ id: 'b', name: 'Beta', residualRisk: 'high' }),
      entity({ id: 'c', name: 'Gamma', residualRisk: 'low' }),
    ];
    const controls = [
      control({ id: 'c1', entityId: 'b', effectiveness: 'not_tested' }),
      control({ id: 'c2', entityId: 'c', effectiveness: 'effective' }),
    ];
    const m = controlCoverageMatrix(entities, controls);
    expect(m.total).toBe(3);
    expect(m.covered).toBe(2);
    expect(m.tested).toBe(1);
    // Alpha (no control, critical) first, then Beta (untested, high).
    expect(m.gaps.map((g) => [g.entityId, g.gap])).toEqual([
      ['a', 'no_control'],
      ['b', 'control_untested'],
    ]);
  });

  it('controlEffectivenessHistory calls a run of failures deteriorating and a recovery improving', () => {
    const controls = [control({ id: 'c1', code: 'C1' }), control({ id: 'c2', code: 'C2' }), control({ id: 'c3', code: 'C3' })];
    const rows = controlEffectivenessHistory(controls, {
      c1: ['effective', 'ineffective', 'ineffective'],
      c2: ['ineffective', 'effective'],
      c3: ['effective'],
    });
    expect(rows[0].trend).toBe('deteriorating');
    expect(rows[0].consecutiveFailures).toBe(2);
    expect(rows[1].trend).toBe('improving');
    expect(rows[2].trend).toBe('unknown');
  });

  it('keyControlIndicator counts a transitive blast radius and terminates on a cycle', () => {
    const controls = [control({ id: 'a', code: 'A' }), control({ id: 'b', code: 'B' }), control({ id: 'c', code: 'C' })];
    const edges: ControlDependency[] = [
      { controlId: 'a', exposesId: 'b' },
      { controlId: 'b', exposesId: 'c' },
      { controlId: 'c', exposesId: 'a' }, // a cycle; must terminate
    ];
    const rows = keyControlIndicator(controls, edges);
    // Every control reaches the other two through the cycle.
    expect(rows.every((r) => r.blastRadius === 2)).toBe(true);
    expect(rows[0].code).toBe('A');
    expect(rows[0].exposes).toEqual(['b', 'c']);
  });

  it('keyControlIndicator ranks the widest blast radius first', () => {
    const controls = [control({ id: 'a', code: 'A' }), control({ id: 'b', code: 'B' }), control({ id: 'c', code: 'C' })];
    const edges: ControlDependency[] = [
      { controlId: 'a', exposesId: 'b' },
      { controlId: 'a', exposesId: 'c' },
    ];
    const rows = keyControlIndicator(controls, edges);
    expect(rows[0].code).toBe('A');
    expect(rows[0].blastRadius).toBe(2);
    expect(rows[1].blastRadius).toBe(0);
  });

  it('riskAppetiteBreach lists breaches worst-first and reports the within-appetite case', () => {
    const entities = [
      entity({ id: 'a', name: 'Alpha', residualRisk: 'critical' }),
      entity({ id: 'b', name: 'Beta', residualRisk: 'high' }),
      entity({ id: 'c', name: 'Gamma', residualRisk: 'medium' }),
    ];
    const breach = riskAppetiteBreach(entities, 'high');
    expect(breach.breaches.map((b) => b.entityId)).toEqual(['a', 'b']);
    expect(breach.breaches[0].stepsPast).toBe(1);
    expect(breach.withinAppetite).toBe(false);

    const none = riskAppetiteBreach([entity({ residualRisk: 'low' })], 'critical');
    expect(none.withinAppetite).toBe(true);
    expect(none.breaches).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  DEFAULT_CONFIG_VALUES,
  evaluateCapability,
  seedPrincipals,
  type CapabilityInputs,
} from './index';

const AS_OF = '2026-10-01';

const emptyInputs: CapabilityInputs = { asOf: AS_OF };

describe('the capability library catalogue and evaluator (D1-D4)', () => {
  it('declares exactly twenty capabilities across the four families', () => {
    expect(CAPABILITY_CATALOG).toHaveLength(20);
    const kinds = new Set(CAPABILITY_CATALOG.map((c) => c.kind));
    expect(kinds).toEqual(new Set(['risk_control', 'population_evidence', 'process_governance', 'assurance_ops']));
    for (const kind of kinds) {
      expect(CAPABILITY_CATALOG.filter((c) => c.kind === kind)).toHaveLength(5);
    }
  });

  it('every catalogue id evaluates to a result (never nothing)', () => {
    for (const c of CAPABILITY_CATALOG) {
      const res = evaluateCapability(c.id, emptyInputs);
      expect(res.id).toBe(c.id);
      expect(res.rule).toBeTruthy();
      if (c.id === 'gov.sod') {
        // The SoD matrix runs off the seed role rights, so it is ready with no caller input.
        expect(res.status).toBe('ready');
      } else {
        expect(res.status).toBe('awaiting_input');
        expect(res.needs).toBeTruthy();
        expect(res.headline).toContain('Awaiting input');
      }
    }
  });

  it('an unknown id returns a benign awaiting result rather than throwing', () => {
    const res = evaluateCapability('not.a.capability', emptyInputs);
    expect(res.status).toBe('awaiting_input');
    expect(res.headline).toContain('not in the catalogue');
  });

  it('seedPrincipals exposes the seven roles with their rights', () => {
    const principals = seedPrincipals();
    expect(principals).toHaveLength(7);
    expect(principals.map((p) => p.id)).toContain('role.cia');
  });

  it('the SoD matrix runs with the seed principals and flags the audit manager', () => {
    const res = evaluateCapability('gov.sod', emptyInputs);
    expect(res.status).toBe('ready');
    // audit_manager holds perform_work + review_and_approve, so at least one conflict exists.
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it('an empty-but-present input is reported as empty, not as a finding', () => {
    const res = evaluateCapability('ops.report_consistency', { asOf: AS_OF, reportFigures: [] });
    expect(res.status).toBe('awaiting_input'); // no figures at all is awaiting, not empty
    const withFigures = evaluateCapability('ops.report_consistency', {
      asOf: AS_OF,
      reportFigures: [{ id: 'f1', label: 'Total', value: 1, location: 'a' }],
    });
    expect(withFigures.status).toBe('empty');
    expect(withFigures.headline).toContain('No figure appears');
  });

  it('evaluates the risk families with real inputs', () => {
    const entities = [{ id: 'e1', universeId: 'u1', name: 'Alpha', code: 'A', department: 'F', headOfDepartment: 'H', inherentRisk: 'medium' as const, residualRisk: 'high' as const, siraScore: 60, controlsCount: 1, lastAuditDate: '2026-01-01', status: 'active' as const }];
    const appetite = evaluateCapability('risk.appetite_breach', { asOf: AS_OF, entities });
    expect(appetite.status).toBe('ready');
    expect(appetite.headline).toContain('breach');

    const drift = evaluateCapability('risk.residual_drift', {
      asOf: AS_OF,
      entities,
      riskSnapshots: [{ entityId: 'e1', residualRisk: 'medium', siraScore: 40, asOf: '2026-01-01' }],
    });
    expect(drift.status).toBe('ready');
    expect(drift.rows[0].refs).toEqual(['e1']);

    const coverage = evaluateCapability('risk.coverage_matrix', { asOf: AS_OF, entities, controls: [] });
    expect(coverage.status).toBe('ready');
    expect(coverage.rows[0].detail).toContain('no control');
  });

  it('evaluates the assurance-ops families with real inputs', () => {
    const issues = [{ id: 'i1', entityId: 'e1', universeId: 'u1', department: 'F', title: 'Late', description: '', severity: 'high' as const, status: 'open' as const, ownerId: 'o1', identifiedDate: '2025-01-01', dueDate: '2025-06-01' }];
    const ageing = evaluateCapability('ops.finding_ageing', { asOf: AS_OF, issues });
    expect(ageing.status).toBe('ready');
    expect(ageing.headline).toContain('overdue');
  });

  it('the default config is the documented one', () => {
    expect(DEFAULT_CONFIG_VALUES).toEqual({ riskTolerance: 'high', stratificationSample: 25, reviewerAgeingDays: 14 });
  });
});

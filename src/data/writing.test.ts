/**
 * Tests for the monitor-alert enrichment mapping (Phase 5, C2).
 *
 * `alert_list` (0112) returns the resolved linkage alongside the alert; `listAlerts` maps it onto
 * `AlertRow`. The mapping is the join between the database's enrichment and what the screen shows,
 * so it is asserted here against a real row shape. With no Supabase environment the module is inert
 * and `listAlerts` returns an empty list, not a throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('./client', () => ({
  getClient: () => (clientMissing ? null : { rpc: (...args: unknown[]) => rpcMock(...args) }),
}));

let clientMissing = false;

beforeEach(() => {
  rpcMock.mockReset();
  clientMissing = false;
});

describe('alert enrichment mapping (C2)', () => {
  it('maps the enrichment columns from alert_list onto AlertRow', async () => {
    const m = await import('./writing');
    rpcMock.mockResolvedValue({
      data: [{
        alert_id: 'a1', rule_id: 'mon.c2', rule_version: 1, kind: 'threshold',
        reason: 'the highest amount is 500, which is gt the threshold 100',
        evaluated_at: '2026-10-28T00:00:00.000Z', disposition: 'open',
        lineage_hash: 'l1', hash: 'h1',
        entity_id: 'e1', department: 'Treasury', engagement_id: 'g1',
        sira_risk_id: 'r1', sira_risk_name: 'A risk', residual_risk: 80,
        residual_band: 'Critical', inherent_risk: 4, inherent_risk_label: 'High',
        control_ids: ['c1', 'c2'],
      }],
      error: null,
    });
    const rows = await m.listAlerts('org1');
    expect(rpcMock).toHaveBeenCalledWith('alert_list', { p_org: 'org1' });
    expect(rows[0]).toEqual({
      alertId: 'a1', ruleId: 'mon.c2', ruleVersion: 1, kind: 'threshold',
      reason: 'the highest amount is 500, which is gt the threshold 100',
      evaluatedAt: '2026-10-28T00:00:00.000Z', disposition: 'open',
      lineageHash: 'l1', hash: 'h1',
      entityId: 'e1', department: 'Treasury', engagementId: 'g1',
      siraRiskId: 'r1', siraRiskName: 'A risk', residualRisk: 80,
      residualBand: 'Critical', inherentRisk: 4, inherentRiskLabel: 'High',
      controlIds: ['c1', 'c2'],
    });
  });

  it('maps an unenriched alert to nulls and an empty control list, not undefined', async () => {
    const m = await import('./writing');
    rpcMock.mockResolvedValue({
      data: [{
        alert_id: 'a2', rule_id: 'mon.x', rule_version: 1, kind: 'rate', reason: 'r',
        evaluated_at: '2026-10-28T00:00:00.000Z', disposition: 'open',
        lineage_hash: 'l2', hash: 'h2',
        entity_id: null, department: null, engagement_id: null, sira_risk_id: null,
        sira_risk_name: null, inherent_risk: null, inherent_risk_label: null,
        residual_risk: null, residual_band: null, control_ids: null,
      }],
      error: null,
    });
    const rows = await m.listAlerts('org1');
    expect(rows[0].entityId).toBeNull();
    expect(rows[0].department).toBeNull();
    expect(rows[0].inherentRisk).toBeNull();
    expect(rows[0].inherentRiskLabel).toBeNull();
    expect(rows[0].residualRisk).toBeNull();
    expect(rows[0].controlIds).toEqual([]);
  });

  it('reads return empty when not configured', async () => {
    clientMissing = true;
    const m = await import('./writing');
    expect(await m.listAlerts('org1')).toEqual([]);
  });
});

describe('acting on an alert (C4/C5/C6 — migration 0114)', () => {
  it('maps the ad-hoc audit pre-fill from alert_adhoc_suggestion', async () => {
    const m = await import('./writing');
    rpcMock.mockResolvedValue({
      data: {
        alert_id: 'a1', rule_id: 'mon.c4', rule_version: 2, entity_id: 'e1', entity_name: 'Treasury',
        universe_id: 'u1', universe_name: 'Group', department: 'Treasury', engagement_id: 'g1',
        control_ids: ['c1', 'c2'], control_count: 2, residual_band: 'High', sira_risk_name: 'Liquidity',
        plan_id: 'p1', title: 'Ad-hoc audit: Treasury', justification: 'Raised from alert a1 (rule mon.c4)',
      },
    });
    const s = await m.alertAdhocSuggestion('org1', 'a1');
    expect(rpcMock).toHaveBeenCalledWith('alert_adhoc_suggestion', { p_org: 'org1', p_alert_id: 'a1' });
    expect(s).toEqual({
      alertId: 'a1', ruleId: 'mon.c4', ruleVersion: 2, entityId: 'e1', entityName: 'Treasury',
      universeId: 'u1', universeName: 'Group', department: 'Treasury', engagementId: 'g1',
      controlIds: ['c1', 'c2'], controlCount: 2, residualBand: 'High', siraRiskName: 'Liquidity',
      planId: 'p1', title: 'Ad-hoc audit: Treasury', justification: 'Raised from alert a1 (rule mon.c4)',
    });
  });

  it('returns null for the pre-fill when not configured', async () => {
    clientMissing = true;
    const m = await import('./writing');
    expect(await m.alertAdhocSuggestion('org1', 'a1')).toBeNull();
  });

  it('passes the alert id to every action and returns the new row id', async () => {
    const m = await import('./writing');
    rpcMock.mockResolvedValue({ data: 'new-id' });

    expect(await m.alertAdhocAuditRaise('org1', 'a1', 'p1', 't', 'j')).toEqual({ ok: true, id: 'new-id' });
    expect(rpcMock).toHaveBeenCalledWith('alert_adhoc_audit_raise',
      expect.objectContaining({ p_org: 'org1', p_alert_id: 'a1', p_plan: 'p1' }));

    expect(await m.alertRaiseFinding('org1', 'a1', 'g1')).toEqual({ ok: true, id: 'new-id' });
    expect(rpcMock).toHaveBeenCalledWith('alert_raise_finding',
      expect.objectContaining({ p_org: 'org1', p_alert_id: 'a1', p_engagement: 'g1' }));

    expect(await m.alertRaiseCap('org1', 'a1', 'f1', 'Treasury', '2026-12-01', null)).toEqual({ ok: true, id: 'new-id' });
    expect(rpcMock).toHaveBeenCalledWith('alert_raise_cap',
      expect.objectContaining({ p_org: 'org1', p_alert_id: 'a1', p_finding_id: 'f1' }));

    expect(await m.alertRequestEvidence('org1', 'a1', 'g1', 'Ops', 'the reconciliation')).toEqual({ ok: true, id: 'new-id' });
    expect(rpcMock).toHaveBeenCalledWith('alert_request_evidence',
      expect.objectContaining({ p_org: 'org1', p_alert_id: 'a1', p_requested_from: 'Ops' }));

    expect(await m.alertEscalate('org1', 'a1', 'g1')).toEqual({ ok: true, id: 'new-id' });
    expect(rpcMock).toHaveBeenCalledWith('alert_escalate',
      expect.objectContaining({ p_org: 'org1', p_alert_id: 'a1', p_engagement: 'g1' }));
  });

  it('reports the refusal reason from the RPC', async () => {
    const m = await import('./writing');
    rpcMock.mockResolvedValue({ data: null, error: { message: 'not allowed: caller lacks the perform_work right' } });
    const r = await m.alertRaiseFinding('org1', 'a1', 'g1');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('perform_work');
  });

  it('the writes report not-configured and the reads return empty when the client is absent', async () => {
    clientMissing = true;
    const m = await import('./writing');
    expect((await m.alertEscalate('org1', 'a1', 'g1')).ok).toBe(false);
    expect(await m.listEngagementOptions()).toEqual([]);
    expect(await m.listEvidenceRequests('org1', 'a1')).toEqual([]);
  });
});

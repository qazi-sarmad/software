/**
 * Tests for the integrity incident data module (T6). Same split as the other data-module tests: with
 * no environment variables the module is inert (reads empty, a step reports "not configured" and
 * never pretends a write happened); with a client present each function calls the right RPC and maps
 * the rows it gets back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
let clientMissing = false;

vi.mock('./client', () => ({
  getClient: () => (clientMissing ? null : { rpc: (...args: unknown[]) => rpcMock(...args) }),
}));

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: null, error: null });
  clientMissing = false;
});

describe('the incident data module (T6)', () => {
  it('calls the incident RPCs with the right parameters', async () => {
    const m = await import('./incidents');
    await m.listIntegrityIncidents();
    expect(rpcMock).toHaveBeenCalledWith('integrity_incidents_list');

    rpcMock.mockResolvedValue({ data: 'inc-1', error: null });
    expect(await m.openIntegrityIncident('al-1')).toEqual({ ok: true, id: 'inc-1' });
    expect(rpcMock).toHaveBeenCalledWith('integrity_incident_open', { p_alert_id: 'al-1' });

    rpcMock.mockResolvedValue({ data: 'still_mismatched', error: null });
    expect(await m.incidentAction('inc-1', 'restore', 'because')).toEqual({ ok: true, outcome: 'still_mismatched' });
    expect(rpcMock).toHaveBeenCalledWith('integrity_incident_action', {
      p_incident_id: 'inc-1',
      p_action: 'restore',
      p_reason: 'because',
    });

    rpcMock.mockResolvedValue({ data: 'verified', error: null });
    expect(await m.verifyIntegrityIncident('inc-1')).toEqual({ ok: true, outcome: 'verified' });
    expect(rpcMock).toHaveBeenCalledWith('integrity_incident_verify', { p_incident_id: 'inc-1' });
  });

  it('maps an incident row and its trail', async () => {
    const m = await import('./incidents');
    rpcMock.mockResolvedValue({
      data: [
        {
          id: 'inc-1',
          alert_id: 'al-1',
          kind: 'evidence_hash_mismatch',
          severity: 'warning',
          object_type: 'evidence_file',
          object_id: 'e-1',
          engagement_id: 'eng-1',
          expected_hash: 'a'.repeat(64),
          actual_hash: 'b'.repeat(64),
          detail: { filename: 'x.pdf' },
          opened_by: 'u-1',
          opened_at: '2026-10-20T00:00:00Z',
          actions: [
            { id: 'a-1', action: 'open', reason: 'opened', outcome: 'open', detail: {}, actor_id: 'u-1', created_at: '2026-10-20T00:00:00Z' },
          ],
        },
      ],
      error: null,
    });
    const rows = await m.listIntegrityIncidents();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('inc-1');
    expect(rows[0].engagementId).toBe('eng-1');
    expect(rows[0].actions).toHaveLength(1);
    expect(rows[0].actions[0].action).toBe('open');
  });

  it('is inert without a client: reads empty, a step reports not configured', async () => {
    clientMissing = true;
    const m = await import('./incidents');
    expect(await m.listIntegrityIncidents()).toEqual([]);
    expect(await m.openIntegrityIncident('al-1')).toEqual({ ok: false, reason: expect.stringContaining('not configured') });
    expect(await m.incidentAction('inc-1', 'annotate', 'x')).toEqual({
      ok: false,
      reason: expect.stringContaining('not configured'),
    });
    expect(await m.verifyIntegrityIncident('inc-1')).toEqual({
      ok: false,
      reason: expect.stringContaining('not configured'),
    });
    expect(m.incidentStorageReady()).toBe(false);
  });

  it('surfaces a database refusal as a reason, never as success', async () => {
    const m = await import('./incidents');
    rpcMock.mockResolvedValue({ data: null, error: { message: 'a_reason_is_required: every incident step must carry a reason' } });
    const res = await m.incidentAction('inc-1', 'annotate', '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('a_reason_is_required');
  });
});

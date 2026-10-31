/**
 * Tests for the capability library data module (D1-D4). Same split as the other data-module tests:
 * with no environment the module is inert (reads return the documented defaults, a write reports "not
 * configured"), and with a client present each function calls the right RPC and maps what comes back.
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

describe('the capability library data module (D1-D4)', () => {
  it('is inert with no client: defaults read back, a write reports not configured', async () => {
    clientMissing = true;
    const m = await import('./capabilities');
    expect(await m.capabilityStorageReady()).toBe(false);
    expect(await m.getCapabilityConfig()).toEqual(m.DEFAULT_CAPABILITY_CONFIG);
    expect(await m.listCapabilityRuns()).toEqual([]);
    const res = await m.saveCapabilityConfig(m.DEFAULT_CAPABILITY_CONFIG, 'a good long reason');
    expect(res.ok).toBe(false);
  });

  it('reads the config from the RPC and maps the columns', async () => {
    const m = await import('./capabilities');
    rpcMock.mockResolvedValue({
      data: [{ risk_tolerance: 'medium', stratification_sample: 40, reviewer_ageing_days: 21 }],
      error: null,
    });
    const config = await m.getCapabilityConfig();
    expect(rpcMock).toHaveBeenCalledWith('capability_config_get');
    expect(config).toEqual({ riskTolerance: 'medium', stratificationSample: 40, reviewerAgeingDays: 21 });
  });

  it('falls back to the defaults when the config RPC returns no row', async () => {
    const m = await import('./capabilities');
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await m.getCapabilityConfig()).toEqual(m.DEFAULT_CAPABILITY_CONFIG);
  });

  it('saves the config with the reason', async () => {
    const m = await import('./capabilities');
    const res = await m.saveCapabilityConfig(
      { riskTolerance: 'critical', stratificationSample: 10, reviewerAgeingDays: 7 },
      'Tightened after review'
    );
    expect(res).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith('capability_config_save', {
      p_risk_tolerance: 'critical',
      p_stratification_sample: 10,
      p_reviewer_ageing_days: 7,
      p_reason: 'Tightened after review',
    });
  });

  it('records a run and lists it back', async () => {
    const m = await import('./capabilities');
    await m.recordCapabilityRun('risk_control', 'a'.repeat(64), { breaches: 2 }, 2);
    expect(rpcMock).toHaveBeenCalledWith('capability_run_record', {
      p_kind: 'risk_control', p_inputs_hash: 'a'.repeat(64), p_findings: { breaches: 2 }, p_finding_count: 2,
    });

    rpcMock.mockResolvedValue({
      data: [{ id: 'run-1', kind: 'risk_control', inputs_hash: 'a'.repeat(64), finding_count: 2, created_at: '2026-10-01T00:00:00Z' }],
      error: null,
    });
    const rows = await m.listCapabilityRuns('risk_control');
    expect(rpcMock).toHaveBeenCalledWith('capability_runs_list', { p_kind: 'risk_control' });
    expect(rows).toEqual([{ id: 'run-1', kind: 'risk_control', inputsHash: 'a'.repeat(64), findingCount: 2, createdAt: '2026-10-01T00:00:00Z' }]);
  });

  it('hashes inputs deterministically and independently of key order', async () => {
    const m = await import('./capabilities');
    const a = await m.hashCapabilityInputs({ b: 1, a: 2 });
    const b = await m.hashCapabilityInputs({ a: 2, b: 1 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });
});

/**
 * Tests for the connector-runtime data module (S5 / F57, F58, C1/C3). Same split as the other
 * data-module tests: with no client the module is inert (a run reports "not configured" and stages
 * nothing); with a client present `runConnector` starts a run, ingests each mapped record and closes
 * the run, and every refusal is surfaced with the database's own reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
let clientMissing = false;

vi.mock('./client', () => ({
  getClient: () => (clientMissing ? null : { rpc: (...args: unknown[]) => rpcMock(...args) }),
}));

beforeEach(() => {
  rpcMock.mockReset();
  clientMissing = false;
});

import type { Connector, ConnectorInstance, Transport } from '../lib/writing/connectors';
import { browserTransport, runConnector } from './connectors';

const INSTANCE: ConnectorInstance = {
  id: 'inst-1', orgId: 'org-a', connectorId: 'http-rest',
  config: { base_url: 'https://mock.local' }, cursor: { value: null }, enabled: true,
};

/** A minimal connector: it fetches from the transport and maps each row to a staged record. */
function fixtureConnector(): Connector {
  return {
    entry: { id: 'http-rest', version: 1, label: 'HTTP REST', kind: 'http_rest', authKind: 'none',
      configSchema: [], readOnlyScopes: ['read:rows'], liveVerified: false, capabilities: ['read_only'] },
    async fetch(_instance, transport) {
      const res = await transport.request({ method: 'GET', url: 'https://mock.local/rows' });
      const parsed = JSON.parse(res.body) as { rows?: Array<Record<string, unknown>>; next_cursor?: string | null };
      return { records: parsed.rows ?? [], nextCursor: { value: parsed.next_cursor ?? null } };
    },
    async healthCheck() { return { ok: true, detail: 'reachable', checkedAt: '' }; },
    async map(row, _instance, fetchedAt, runId) {
      return { source: 'http-rest', sourceId: String(row.id), contentHash: 'h' + String(row.id),
        fetchedAt, runId, values: { amount: Number(row.amount) } };
    },
  };
}

function fixtureTransport(body: string, status = 200): Transport {
  return { async request() { return { status, headers: {}, body }; } };
}

const ROWS = JSON.stringify({ rows: [{ id: 'r1', amount: 10 }, { id: 'r2', amount: 20 }], next_cursor: 'abc' });

/** Route each RPC name to a canned reply, and record the calls. */
function routeRpc(replies: Record<string, unknown>): void {
  rpcMock.mockImplementation((name: string) => {
    if (name in replies) return Promise.resolve({ data: replies[name], error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

describe('connector runtime (S5)', () => {
  it('is inert with no client: the run reports not configured and stages nothing', async () => {
    clientMissing = true;
    const r = await runConnector({ orgId: 'org-a', connector: fixtureConnector(), instance: INSTANCE,
      transport: fixtureTransport(ROWS), fetchedAt: '2026-10-30T00:00:00.000Z' });
    expect(r.ok).toBe(false);
    expect(r.runId).toBeNull();
    expect(r.reason).toContain('not configured');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('starts a run, ingests each record, and closes it with the counts', async () => {
    routeRpc({ connector_run_start: 'run-1', staged_record_ingest: true });
    const r = await runConnector({ orgId: 'org-a', connector: fixtureConnector(), instance: INSTANCE,
      transport: fixtureTransport(ROWS), fetchedAt: '2026-10-30T00:00:00.000Z' });
    expect(r).toEqual({ ok: true, runId: 'run-1', fetched: 2, staged: 2, skipped: 0 });
    expect(rpcMock).toHaveBeenCalledWith('connector_run_start', { p_org: 'org-a', p_instance_id: 'inst-1' });
    expect(rpcMock).toHaveBeenCalledWith('staged_record_ingest', expect.objectContaining({
      p_org: 'org-a', p_instance_id: 'inst-1', p_run_id: 'run-1', p_source: 'http-rest', p_source_id: 'r1',
      p_content_hash: 'hr1', p_fetched_at: '2026-10-30T00:00:00.000Z', p_values: { amount: 10 },
    }));
    expect(rpcMock).toHaveBeenCalledWith('connector_run_finish', expect.objectContaining({
      p_org: 'org-a', p_run_id: 'run-1', p_status: 'succeeded', p_fetched: 2, p_staged: 2, p_skipped: 0,
    }));
  });

  it('counts a duplicate content hash as skipped, not staged', async () => {
    let call = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === 'connector_run_start') return Promise.resolve({ data: 'run-1', error: null });
      if (name === 'staged_record_ingest') { call++; return Promise.resolve({ data: call === 1, error: null }); }
      return Promise.resolve({ data: null, error: null });
    });
    const r = await runConnector({ orgId: 'org-a', connector: fixtureConnector(), instance: INSTANCE,
      transport: fixtureTransport(ROWS), fetchedAt: '2026-10-30T00:00:00.000Z' });
    expect(r).toEqual({ ok: true, runId: 'run-1', fetched: 2, staged: 1, skipped: 1 });
  });

  it('refuses when the start is refused and sends nothing else', async () => {
    rpcMock.mockImplementation((name: string) => name === 'connector_run_start'
      ? Promise.resolve({ data: null, error: { message: 'a run is already in progress for this connector instance' } })
      : Promise.resolve({ data: null, error: null }));
    const r = await runConnector({ orgId: 'org-a', connector: fixtureConnector(), instance: INSTANCE,
      transport: fixtureTransport(ROWS), fetchedAt: '2026-10-30T00:00:00.000Z' });
    expect(r.ok).toBe(false);
    expect(r.runId).toBeNull();
    expect(r.reason).toContain('already in progress');
    expect(rpcMock).not.toHaveBeenCalledWith('staged_record_ingest', expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith('connector_run_finish', expect.anything());
  });

  it('closes the run as failed when the fetch throws, and reports the reason', async () => {
    rpcMock.mockImplementation((name: string) => name === 'connector_run_start'
      ? Promise.resolve({ data: 'run-1', error: null })
      : Promise.resolve({ data: null, error: null }));
    const failing: Transport = { async request() { throw new Error('connection refused'); } };
    const r = await runConnector({ orgId: 'org-a', connector: fixtureConnector(), instance: INSTANCE,
      transport: failing, fetchedAt: '2026-10-30T00:00:00.000Z' });
    expect(r.ok).toBe(false);
    expect(r.runId).toBe('run-1');
    expect(r.reason).toBe('connection refused');
    expect(rpcMock).toHaveBeenCalledWith('connector_run_finish', expect.objectContaining({
      p_run_id: 'run-1', p_status: 'failed', p_error: 'connection refused',
    }));
  });

  it('closes the run as failed when an ingest is refused, and never leaves it running', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'connector_run_start') return Promise.resolve({ data: 'run-1', error: null });
      if (name === 'staged_record_ingest') return Promise.resolve({ data: null, error: { message: 'no such run for this connector instance' } });
      return Promise.resolve({ data: null, error: null });
    });
    const r = await runConnector({ orgId: 'org-a', connector: fixtureConnector(), instance: INSTANCE,
      transport: fixtureTransport(ROWS), fetchedAt: '2026-10-30T00:00:00.000Z' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no such run');
    expect(rpcMock).toHaveBeenCalledWith('connector_run_finish', expect.objectContaining({
      p_run_id: 'run-1', p_status: 'failed', p_staged: 0,
    }));
  });
});

describe('the browser transport is read-only and egress-checked', () => {
  it('refuses a write method before any request leaves', async () => {
    const t = browserTransport(['mock.local']);
    await expect(t.request({ method: 'DELETE', url: 'https://mock.local/rows' } as never))
      .rejects.toThrow('a connector transport is read-only: refused DELETE');
  });

  it('refuses a host that is not on the allow-list', async () => {
    const t = browserTransport(['mock.local']);
    await expect(t.request({ method: 'GET', url: 'https://evil.example/rows' }))
      .rejects.toThrow('the host evil.example is not on the egress allow-list');
  });

  it('reads a listed host through fetch and returns its body', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return { status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{"rows":[]}' };
    }) as unknown as typeof fetch;
    try {
      const t = browserTransport(['mock.local']);
      const res = await t.request({ method: 'GET', url: 'https://mock.local/rows' });
      expect(res.status).toBe(200);
      expect(res.body).toBe('{"rows":[]}');
      expect(calls).toEqual(['https://mock.local/rows']);
    } finally {
      globalThis.fetch = original;
    }
  });
});

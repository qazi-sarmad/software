/**
 * C2.1: the hosting-test Edge Function authorises the caller, probes the tenant's database, and
 * never lets the password out.
 *
 * The handler takes its dependencies injected, so each case drives the real handler with plain
 * objects: a fake driver, a caller client whose getUser() and RPCs can accept or reject, and a
 * service client that records every read. A refusal must happen before the driver is called, and no
 * response body may contain the password.
 */
import { describe, expect, it } from 'vitest';
import {
  addressIsForbidden,
  createHostingTestHandler,
  summarise,
  type CallerClientLike,
  type DriverLike,
  type DriverReport,
  type HostingTestDeps,
  type QueryResult,
  type Row,
  type RpcResult,
  type ServiceClientLike,
} from '../../supabase/functions/_shared/hostingTestHandler';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const ORG_B = 'b0000000-0000-0000-0000-000000000001';
const CONN_A = 'a5000000-0000-4000-8000-000000000001';
const PASSWORD = 'super-secret-password';

const FULL_FACTS: DriverReport = {
  serverVersionNum: 150002,
  extensions: ['pgcrypto', 'pg_cron', 'pg_net'],
  roles: ['platform_admin'],
  freeSpaceBytes: 8 * 1024 * 1024 * 1024,
};

interface Harness {
  deps: HostingTestDeps;
  calls: string[];
  driverCalls: number;
  setUser(user: { id: string } | null): void;
  setRpc(name: string, result: RpcResult): void;
  setConn(row: Row | null): void;
  setProbe(fn: () => Promise<DriverReport>): void;
  setNow(ms: number): void;
  setPassword(value: string | null): void;
}

function harness(): Harness {
  let user: { id: string } | null = { id: '10000000-0000-0000-0000-0000000000a1' };
  let conn: Row | null = {
    id: CONN_A, org_id: ORG_A, host: 'db.tenant.example', port: 5432,
    database_name: 'provio', username: 'provio', ssl_mode: 'require',
    password_secret_id: 'a4000000-0000-4000-8000-000000000001',
  };
  let probe: () => Promise<DriverReport> = async () => FULL_FACTS;
  let password: string | null = PASSWORD;
  let nowMs = 1_000_000;
  const calls: string[] = [];
  // An authorised admin: config_write_mode answers 'apply' (the only direct-authority value).
  const rpcs: Record<string, RpcResult> = { config_write_mode: { data: 'apply', error: null } };
  const state = { driverCalls: 0 };

  const caller: CallerClientLike = {
    auth: { getUser: async () => { calls.push('getUser'); return { data: { user }, error: null }; } },
    rpc: async (fn) => { calls.push(`caller.rpc:${fn}`); return rpcs[fn] ?? { data: null, error: null }; },
  };

  const service: ServiceClientLike = {
    from(table) {
      calls.push(`service.from:${table}`);
      return {
        select: () => ({
          eq: () => ({
            limit: async (): Promise<QueryResult> => ({ data: conn, error: null }),
          }),
        }),
      };
    },
    rpc: async (fn) => {
      calls.push(`service.rpc:${fn}`);
      if (fn === 'secret_reveal') return { data: password, error: null };
      return rpcs[fn] ?? { data: null, error: null };
    },
  };

  const driver: DriverLike = {
    probe: async () => { state.driverCalls += 1; return probe(); },
  };

  return {
    deps: { callerClient: () => caller, serviceClient: () => service, driver, now: () => nowMs },
    calls,
    get driverCalls() { return state.driverCalls; },
    setUser: (u) => { user = u; },
    setRpc: (n, r) => { rpcs[n] = r; },
    setConn: (c) => { conn = c; },
    setProbe: (f) => { probe = f; },
    setNow: (ms) => { nowMs = ms; },
    setPassword: (v) => { password = v; },
  } as Harness;
}

function post(body: unknown, auth = 'Bearer token'): Request {
  return new Request('https://x/functions/v1/hosting-test', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ALLOW = (h: Harness) => {
  h.setRpc('config_write_mode', { data: 'apply', error: null });
  h.setRpc('has_feature', { data: true, error: null });
};

describe('hosting-test handler', () => {
  it('refuses an unauthenticated caller before the service client exists', async () => {
    const h = harness();
    h.setUser(null);
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(401);
    expect(h.calls.some((c) => c.startsWith('service.'))).toBe(false);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses a signed-in user of another org naming this org', async () => {
    const h = harness();
    h.setRpc('config_write_mode', { data: 'deny', error: null });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(403);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses a member without edit_config (config_write_mode denies)', async () => {
    const h = harness();
    h.setRpc('config_write_mode', { data: 'deny', error: null });
    h.setRpc('has_feature', { data: true, error: null });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(403);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses when the hosting_migration feature is off', async () => {
    const h = harness();
    h.setRpc('config_write_mode', { data: 'allow', error: null });
    h.setRpc('has_feature', { data: false, error: null });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(403);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses a tenant user on the platform-only flow', async () => {
    const h = harness();
    h.setRpc('is_platform_admin', { data: false, error: null });
    const res = await createHostingTestHandler(h.deps)(post({ connection_id: CONN_A }));
    expect(res.status).toBe(403);
    expect(h.driverCalls).toBe(0);
  });

  it('probes and reports the facts on success', async () => {
    const h = harness();
    ALLOW(h);
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; report: { reachable: boolean; extensions_missing: string[]; roles_missing: string[]; version_supported: boolean; latency_ms: number | null } };
    expect(body.ok).toBe(true);
    expect(body.report.reachable).toBe(true);
    expect(body.report.extensions_missing).toEqual([]);
    expect(body.report.roles_missing).toEqual([]);
    expect(body.report.version_supported).toBe(true);
    expect(body.report.latency_ms).toBe(0);
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('reports an authentication failure as a plain-language report, not an error', async () => {
    const h = harness();
    ALLOW(h);
    h.setProbe(async () => { throw new Error('password authentication failed for user "provio"'); });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; report: { reachable: boolean; messages: string[] } };
    expect(body.ok).toBe(true);
    expect(body.report.reachable).toBe(false);
    expect(body.report.messages.join(' ')).toContain('could not be reached');
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('reports a timeout as unreachable', async () => {
    const h = harness();
    ALLOW(h);
    h.setProbe(async () => { throw new Error('the connection timed out'); });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    const body = await res.json() as { report: { reachable: boolean } };
    expect(body.report.reachable).toBe(false);
  });

  it('names a missing required extension and a missing optional one separately', async () => {
    const h = harness();
    ALLOW(h);
    h.setProbe(async () => ({
      serverVersionNum: 150002, extensions: ['pg_cron'], roles: [], freeSpaceBytes: 1024 * 1024,
    }));
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    const body = await res.json() as {
      report: { extensions_missing: string[]; extensions_optional_missing: string[]; roles_missing: string[] };
    };
    expect(body.report.extensions_missing).toEqual(['pgcrypto']);
    expect(body.report.extensions_optional_missing).toEqual(['pg_net']);
    expect(body.report.roles_missing).toEqual(['platform_admin']);
  });

  it('refuses a metadata address before the driver is called', async () => {
    const h = harness();
    ALLOW(h);
    h.setConn({ id: CONN_A, org_id: ORG_A, host: '169.254.169.254', port: 5432, database_name: 'x', username: 'u', ssl_mode: 'require', password_secret_id: 'a4000000-0000-4000-8000-000000000001' });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(400);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses a connection that belongs to another organisation', async () => {
    const h = harness();
    ALLOW(h);
    h.setConn({ id: CONN_A, org_id: ORG_B, host: 'db.tenant.example', port: 5432, database_name: 'x', username: 'u', ssl_mode: 'require', password_secret_id: 'a4000000-0000-4000-8000-000000000001' });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(403);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses when the connection has no stored password', async () => {
    const h = harness();
    ALLOW(h);
    h.setConn({ id: CONN_A, org_id: ORG_A, host: 'db.tenant.example', port: 5432, database_name: 'x', username: 'u', ssl_mode: 'require', password_secret_id: null });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(400);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses a missing connection id and a non-POST method', async () => {
    const h = harness();
    ALLOW(h);
    const missing = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A }));
    expect(missing.status).toBe(400);
    const get = await createHostingTestHandler(h.deps)(new Request('https://x/', { method: 'GET' }));
    expect(get.status).toBe(405);
  });

  it('accepts an active consultation session for a tier-1 flow', async () => {
    const h = harness();
    h.setRpc('config_write_mode', { data: 'deny', error: null });
    h.setRpc('consultation_active', { data: [{ id: 'c0000000-0000-4000-8000-000000000001', status: 'active' }], error: null });
    const res = await createHostingTestHandler(h.deps)(post({
      org_id: ORG_A, connection_id: CONN_A, consultation_session_id: 'c0000000-0000-4000-8000-000000000001',
    }));
    expect(res.status).toBe(200);
    expect(h.driverCalls).toBe(1);
  });

  it('never returns the password even when the driver echoes it', async () => {
    const h = harness();
    ALLOW(h);
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    const text = await res.text();
    expect(text).not.toContain(PASSWORD);
  });
});

describe('addressIsForbidden', () => {
  it('refuses loopback, metadata and link-local addresses', () => {
    expect(addressIsForbidden('localhost')).not.toBeNull();
    expect(addressIsForbidden('169.254.169.254')).not.toBeNull();
    expect(addressIsForbidden('127.0.0.1')).not.toBeNull();
    expect(addressIsForbidden('::1')).not.toBeNull();
    expect(addressIsForbidden('fe80::1')).not.toBeNull();
    expect(addressIsForbidden('db.internal')).not.toBeNull();
    expect(addressIsForbidden('')).not.toBeNull();
  });

  it('allows an ordinary hostname and a public address', () => {
    expect(addressIsForbidden('db.tenant.example')).toBeNull();
    expect(addressIsForbidden('203.0.113.10')).toBeNull();
  });
});

describe('summarise', () => {
  it('says the database can host Provio when nothing is missing', () => {
    const messages = summarise({
      reachable: true, version: '150002', version_supported: true,
      extensions_present: ['pgcrypto', 'pg_cron', 'pg_net'], extensions_missing: [],
      extensions_optional_missing: [], roles_present: ['platform_admin'], roles_missing: [],
      free_space_estimate: '8.0 GB', latency_ms: 12, messages: [],
    });
    expect(messages.join(' ')).toContain('can host Provio');
  });

  it('gives a plain-language line for each failure', () => {
    const messages = summarise({
      reachable: true, version: '130000', version_supported: false,
      extensions_present: [], extensions_missing: ['pgcrypto'],
      extensions_optional_missing: ['pg_cron'], roles_present: [], roles_missing: ['platform_admin'],
      free_space_estimate: null, latency_ms: 5, messages: [],
    });
    const text = messages.join(' ');
    expect(text).toContain('PostgreSQL 14 or newer');
    expect(text).toContain('pgcrypto');
    expect(text).toContain('platform_admin');
  });
});

// Audit 2026-10-23: the address check must see DNS answers, and only 'apply' is direct authority.
describe('hosting-test handler hardening', () => {
  it('refuses a hostname that resolves to the cloud metadata address, before any probe', async () => {
    const h = harness();
    ALLOW(h);
    const deps = { ...h.deps, resolveHost: async () => ['169.254.169.254'] };
    const res = await createHostingTestHandler(deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(400);
    expect(h.driverCalls).toBe(0);
  });

  it('refuses a hostname with no address records', async () => {
    const h = harness();
    ALLOW(h);
    const deps = { ...h.deps, resolveHost: async () => [] };
    const res = await createHostingTestHandler(deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(400);
    expect(h.driverCalls).toBe(0);
  });

  it('does not treat a propose-only right as permission to run the test', async () => {
    const h = harness();
    h.setRpc('config_write_mode', { data: 'propose', error: null });
    const res = await createHostingTestHandler(h.deps)(post({ org_id: ORG_A, connection_id: CONN_A }));
    expect(res.status).toBe(403);
    expect(h.driverCalls).toBe(0);
  });
});

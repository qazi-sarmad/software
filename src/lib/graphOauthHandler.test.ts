/**
 * C1.1: graph-oauth authorises the caller, binds the state, and returns no token.
 *
 * The handler takes its dependencies injected, so each case drives the real handler with plain
 * objects: a fake fetch, a caller client whose getUser() can accept or reject, and a service client
 * that records every table read and RPC. A refusal must happen before any secret is read, and no
 * response body may contain an access token, a refresh token or a client secret.
 */
import { describe, expect, it } from 'vitest';
import {
  createGraphOauthHandler,
  type CallerClientLike,
  type FilterChain,
  type GraphOauthDeps,
  type QueryResult,
  type Row,
  type RpcResult,
  type ServiceClientLike,
} from '../../supabase/functions/_shared/graphOauthHandler';
import { type FetchLike } from '../../supabase/functions/_shared/emailAdapters';
import { type StateCrypto } from '../../supabase/functions/_shared/graphOauthState';
import { type CryptoLike } from '../../supabase/functions/_shared/secretsCrypto';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const ORG_B = 'b0000000-0000-0000-0000-000000000001';
const USER_A = '10000000-0000-0000-0000-0000000000a1';
const USER_B = '10000000-0000-0000-0000-0000000000b1';
const PROFILE_A = 'c0000000-0000-0000-0000-0000000000a1';

const MASTER_KEY = btoa('0123456789abcdef0123456789abcdef');
const cryptoImpl = crypto as unknown as StateCrypto & CryptoLike;

function chain(result: QueryResult, log: string[], table: string): FilterChain {
  const self: FilterChain = {
    eq: () => self,
    limit: async () => result,
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  } as FilterChain;
  log.push(`read:${table}`);
  return self;
}

interface Harness {
  deps: GraphOauthDeps;
  calls: string[];
  fetchCalls: { url: string; body?: string }[];
  setUser(user: { id: string } | null): void;
  setRpc(name: string, result: RpcResult): void;
  setProfileOrg(org: string | null): void;
  setNow(ms: number): void;
}

function harness(opts: {
  user?: { id: string } | null;
  rpc?: Record<string, RpcResult>;
  profileOrg?: string | null;
  masterKey?: string | null;
}): Harness {
  const calls: string[] = [];
  const fetchCalls: { url: string; body?: string }[] = [];
  let user = opts.user === undefined ? { id: USER_A } : opts.user;
  let profileOrg: string | null = opts.profileOrg === undefined ? ORG_A : opts.profileOrg;
  let now = 1_000_000;
  const rpcResults: Record<string, RpcResult> = {
    is_platform_admin: { data: false, error: null },
    config_write_mode: { data: 'apply', error: null },
    has_feature: { data: true, error: null },
    graph_client_id: { data: 'client-id-abc', error: null },
    graph_client_secret: { data: 'client-secret-xyz', error: null },
    vault_available: { data: false, error: null },
    secret_store_ref: { data: 'dd000000-0000-0000-0000-000000000001', error: null },
    oauth_state_consume: { data: true, error: null },
    graph_app_save: { data: null, error: null },
    ...(opts.rpc ?? {}),
  };

  const caller: CallerClientLike = {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'invalid' } }) },
    rpc: async (fn) => { calls.push(`caller.rpc:${fn}`); return rpcResults[fn] ?? { data: null, error: null }; },
    from: (table: string) => ({
      select: () => chain(
        table === 'email_sender_profiles'
          ? { data: [{ id: PROFILE_A, org_id: profileOrg }], error: null }
          : { data: [], error: null },
        calls, table),
    }),
  };

  const service: ServiceClientLike = {
    from: (table: string) => ({
      select: () => chain(
        table === 'platform_email_app'
          ? { data: [{ redirect_uri: 'https://app.example/oauth/callback' }], error: null }
          : { data: [], error: null },
        calls, table),
    }),
    rpc: async (fn) => { calls.push(`service.rpc:${fn}`); return rpcResults[fn] ?? { data: null, error: null }; },
  };

  const fakeFetch: FetchLike = async (url, init) => {
    fetchCalls.push({ url, body: init?.body });
    return { status: 200, text: async () => JSON.stringify({ access_token: 'ACCESS-TOKEN-SECRET', refresh_token: 'REFRESH-TOKEN-SECRET', expires_in: 3600 }) };
  };

  return {
    calls, fetchCalls,
    deps: {
      fetch: fakeFetch,
      callerClient: () => caller,
      serviceClient: () => service,
      crypto: cryptoImpl,
      now: () => now,
      masterKey: opts.masterKey === undefined ? MASTER_KEY : opts.masterKey,
    },
    setUser: (u) => { user = u; },
    setRpc: (name, result) => { rpcResults[name] = result; },
    setProfileOrg: (o) => { profileOrg = o; },
    setNow: (ms) => { now = ms; },
  };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer good' }): Request {
  return new Request('https://example.test/graph-oauth', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

async function bodyText(res: Response): Promise<string> {
  return JSON.stringify(await res.json());
}

describe('graph-oauth authorisation and state (C1.1)', () => {
  it('a. no Authorization header is 401 and no service client is used', async () => {
    const h = harness({});
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }, {}));
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('b. a token the server rejects is 401', async () => {
    const h = harness({ user: null });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    expect(res.status).toBe(401);
    expect(h.calls.filter((c) => c.startsWith('service.'))).toHaveLength(0);
  });

  it('c. a signed-in user of another org naming this org is refused before any secret read', async () => {
    const h = harness({ user: { id: USER_B }, rpc: { config_write_mode: { data: 'deny', error: null } } });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    expect(res.status).toBe(403);
    expect(h.calls).not.toContain('service.rpc:graph_client_secret');
    expect(h.calls).not.toContain('service.rpc:secret_store_ref');
  });

  it('d. a member without edit_config is refused', async () => {
    const h = harness({ rpc: { config_write_mode: { data: 'deny', error: null } } });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    expect(res.status).toBe(403);
    expect(h.calls).not.toContain('service.rpc:graph_client_id');
  });

  it('e. the email_graph feature off refuses the flow', async () => {
    const h = harness({ rpc: { has_feature: { data: false, error: null } } });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    expect(res.status).toBe(403);
    expect(h.calls).not.toContain('service.rpc:graph_client_id');
  });

  it('f. a tenant user cannot run the platform-only flow', async () => {
    const h = harness({ rpc: { is_platform_admin: { data: false, error: null } } });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: null }));
    expect(res.status).toBe(403);
  });

  it('g. start returns a consent URL that carries state= and no secret', async () => {
    const h = harness({});
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; url: string };
    expect(body.ok).toBe(true);
    expect(body.url).toContain('state=');
    expect(body.url).toContain('response_type=code');
    const text = JSON.stringify(body);
    expect(text).not.toContain('ACCESS-TOKEN-SECRET');
    expect(text).not.toContain('REFRESH-TOKEN-SECRET');
    expect(text).not.toContain('client-secret-xyz');
    // The client id is public (it is the app registration's identifier), so it is not asserted against.
  });

  it('h. exchange with a missing state is refused', async () => {
    const h = harness({});
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'exchange', code: 'c', orgId: ORG_A }));
    expect(res.status).toBe(400);
    expect((await res.json() as { reason: string }).reason).toContain('missing');
  });

  it('i. exchange with a forged state is refused', async () => {
    const h = harness({});
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'exchange', code: 'c', state: 'Zm9yZ2Vk.Zm9yZ2Vk' }));
    expect(res.status).toBe(400);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('j. an expired state is refused', async () => {
    const h = harness({});
    // Sign a state now, then move the clock past its expiry.
    const start = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    const { url } = await start.json() as { url: string };
    const state = new URL(url).searchParams.get('state') as string;
    h.setNow(1_000_000 + 11 * 60 * 1000);
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'exchange', code: 'c', state }));
    expect(res.status).toBe(400);
    expect((await res.json() as { reason: string }).reason).toContain('expired');
  });

  it('k. a state bound to another user is refused', async () => {
    const h = harness({});
    const start = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    const { url } = await start.json() as { url: string };
    const state = new URL(url).searchParams.get('state') as string;
    h.setUser({ id: USER_B });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'exchange', code: 'c', state }));
    expect(res.status).toBe(400);
    expect((await res.json() as { reason: string }).reason).toContain('wrong_user');
  });

  it('l. a replayed state is refused', async () => {
    const h = harness({ rpc: { oauth_state_consume: { data: false, error: null } } });
    const start = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    const { url } = await start.json() as { url: string };
    const state = new URL(url).searchParams.get('state') as string;
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'exchange', code: 'c', state }));
    expect(res.status).toBe(400);
    expect((await res.json() as { reason: string }).reason).toContain('replayed');
  });

  it('m. a valid exchange stores the refresh token and returns no token', async () => {
    const h = harness({});
    const start = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    const { url } = await start.json() as { url: string };
    const state = new URL(url).searchParams.get('state') as string;
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'exchange', code: 'code-1', state }));
    expect(res.status).toBe(200);
    const text = await bodyText(res);
    expect(text).toContain('secretId');
    expect(text).not.toContain('ACCESS-TOKEN-SECRET');
    expect(text).not.toContain('REFRESH-TOKEN-SECRET');
    expect(h.calls).toContain('service.rpc:secret_store_ref');
  });

  it('n. a profile id from another org is refused', async () => {
    const h = harness({ profileOrg: ORG_B });
    const res = await createGraphOauthHandler(h.deps)(post({
      action: 'start', orgId: ORG_A, profileId: PROFILE_A,
    }));
    expect(res.status).toBe(403);
    expect(h.calls).not.toContain('service.rpc:graph_client_id');
  });

  it('o. the HTTP refresh action is not routable', async () => {
    const h = harness({});
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'refresh', profileId: PROFILE_A }));
    expect(res.status).toBe(400);
    expect((await res.json() as { reason: string }).reason).toContain('unknown action');
    expect(h.calls).not.toContain('service.rpc:secret_reveal');
  });

  it('p. no response body of any case contains a token', async () => {
    const h = harness({});
    const bodies: string[] = [];
    for (const body of [
      { action: 'start', orgId: ORG_A },
      { action: 'exchange', code: 'c', state: 'x.y' },
      { action: 'refresh', profileId: PROFILE_A },
      { action: 'unknown' },
    ]) {
      const res = await createGraphOauthHandler(h.deps)(post(body));
      bodies.push(await bodyText(res));
    }
    const all = bodies.join('\n');
    expect(all).not.toContain('ACCESS-TOKEN-SECRET');
    expect(all).not.toContain('REFRESH-TOKEN-SECRET');
    expect(all).not.toContain('client-secret-xyz');
  });

  it('q. with no master key the flow reports it is not configured', async () => {
    const h = harness({ masterKey: null });
    const res = await createGraphOauthHandler(h.deps)(post({ action: 'start', orgId: ORG_A }));
    expect(res.status).toBe(500);
  });
});

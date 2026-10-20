/**
 * R-1: the ai-gateway authorises the caller and the org before it reads any secret (F8, L2).
 *
 * The handler takes its dependencies injected, so each case drives the real handler with plain
 * objects: a fake fetch that records every call, a caller client whose getUser() can accept or
 * reject a token, and a service client that records every table read and RPC. A refusal must happen
 * before the endpoint is read and before secret_reveal is called.
 */
import { describe, expect, it } from 'vitest';
import {
  createAiGatewayHandler,
  type CallerClientLike,
  type FilterChain,
  type GatewayDeps,
  type QueryResult,
  type Row,
  type RpcResult,
  type ServiceClientLike,
} from '../../supabase/functions/_shared/aiGatewayHandler';
import { type FetchLike } from '../../supabase/functions/_shared/emailAdapters';
import { type HashCrypto } from '../../supabase/functions/_shared/aiGateway';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const ORG_B = 'b0000000-0000-0000-0000-000000000001';
const USER_A = '10000000-0000-0000-0000-0000000000a1';

const cryptoImpl = crypto as unknown as HashCrypto;

/** A chain that resolves to a fixed result, so a table read is observable. */
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
  deps: GatewayDeps;
  calls: string[];
  fetchCalls: string[];
  setUser(user: { id: string } | null): void;
  setRpc(name: string, result: RpcResult): void;
}

function harness(opts: {
  user?: { id: string } | null;
  settings?: Row | null;
  models?: Row[];
  deny?: Row[];
  rpc?: Record<string, RpcResult>;
}): Harness {
  const calls: string[] = [];
  const fetchCalls: string[] = [];
  let user = opts.user === undefined ? { id: USER_A } : opts.user;
  const rpcResults: Record<string, RpcResult> = { ...(opts.rpc ?? {}) };

  const caller: CallerClientLike = {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'invalid' } }) },
    rpc: async (fn) => { calls.push(`caller.rpc:${fn}`); return rpcResults[fn] ?? { data: null, error: null }; },
  };

  const service: ServiceClientLike = {
    from: (table: string) => {
      const result: QueryResult =
        table === 'tenant_settings' ? { data: opts.settings === undefined ? [{}] : (opts.settings ? [opts.settings] : []), error: null }
        : table === 'tenant_ai_models' ? { data: opts.models ?? [], error: null }
        : table === 'ai_endpoint_denylist' ? { data: opts.deny ?? [], error: null }
        : { data: [], error: null };
      return { select: () => chain(result, calls, table) };
    },
    rpc: async (fn) => { calls.push(`service.rpc:${fn}`); return rpcResults[fn] ?? { data: null, error: null }; },
  };

  const fakeFetch: FetchLike = async (url) => {
    fetchCalls.push(url);
    if (url.endsWith('/api/chat')) {
      return { status: 200, text: async () => JSON.stringify({ message: { content: 'Drafted.' } }) };
    }
    return { status: 200, text: async () => JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }) };
  };

  return {
    calls, fetchCalls,
    deps: {
      fetch: fakeFetch,
      callerClient: () => caller,
      serviceClient: () => service,
      crypto: cryptoImpl,
      now: () => 0,
    },
    setUser: (u) => { user = u; },
    setRpc: (name, result) => { rpcResults[name] = result; },
  };
}

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer good' }): Request {
  return new Request('https://example.test/ai-gateway', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

const enabledSettings: Row = { ai_enabled: true, ai_model_endpoint: 'https://ollama.internal.example', ai_access_mode: 'server', ai_secret_id: null };

describe('ai gateway authorisation (R-1)', () => {
  it('a. no Authorization header is 401 and no service client is used', async () => {
    const h = harness({ settings: enabledSettings });
    const res = await createAiGatewayHandler(h.deps)(post({ org_id: ORG_A, prompt: 'x' }, {}));
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it('b. a token the server rejects is 401', async () => {
    const h = harness({ user: null, settings: enabledSettings });
    const res = await createAiGatewayHandler(h.deps)(post({ org_id: ORG_A, prompt: 'x' }));
    expect(res.status).toBe(401);
    expect(h.calls.filter((c) => c.startsWith('service.'))).toHaveLength(0);
  });

  it('c. a member of org B naming org A is 403, with no endpoint read and no secret_reveal', async () => {
    const h = harness({
      user: { id: USER_A }, settings: enabledSettings,
      rpc: { ai_gateway_authorise: { data: false, error: null } },
    });
    const res = await createAiGatewayHandler(h.deps)(post({ org_id: ORG_A, prompt: 'x' }));
    expect(res.status).toBe(403);
    expect(h.calls).not.toContain('read:tenant_settings');
    expect(h.calls).not.toContain('service.rpc:secret_reveal');
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('d. a member without use_ai_assist is 403', async () => {
    const h = harness({
      settings: enabledSettings, rpc: { ai_gateway_authorise: { data: false, error: null } },
    });
    const res = await createAiGatewayHandler(h.deps)(post({ org_id: ORG_A, prompt: 'x' }));
    expect(res.status).toBe(403);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('e. an entitled member with use_ai_assist reaches the endpoint', async () => {
    const h = harness({
      settings: enabledSettings,
      models: [{ use_case: null, ai_models: { model_ref: 'llama3.1:8b' } }],
      rpc: { ai_gateway_authorise: { data: true, error: null } },
    });
    const res = await createAiGatewayHandler(h.deps)(post({ org_id: ORG_A, prompt: 'Draft an observation.' }));
    expect(res.status).toBe(200);
    expect(h.fetchCalls.some((u) => u.endsWith('/api/chat'))).toBe(true);
    expect(h.calls).toContain('read:tenant_settings');
  });
});

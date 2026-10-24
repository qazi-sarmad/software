/**
 * ai-gateway handler (M-4a, F8, F21). The body of the Edge Function, with every dependency injected
 * so it can be tested without Deno, a network or a database (the repo keeps Edge logic in
 * supabase/functions/_shared and its tests in src/lib/*.test.ts; index.ts only wires the real ones).
 *
 * The browser sends the org, the use case, the prompt and the allowed numbers with the caller's JWT.
 * The handler loads the org's endpoint and model, refuses a vendor host (L2) and a private address in
 * server mode (SSRF, F8), calls the endpoint, flags any figure the prompt did not carry, and records
 * the call through ai_call_log. It never returns a secret and never logs a prompt or a token.
 */
import { type FetchLike } from './emailAdapters.ts';
import { checkEndpoint, type AccessMode } from './aiSsrf.ts';
import { runGatewayCall, sha256Hex, testEndpoint, type HashCrypto } from './aiGateway.ts';

export interface Row {
  [key: string]: unknown;
}

export interface QueryResult {
  data: Row[] | null;
  error: unknown;
}

/** The slice of the supabase-js query builder this handler uses, so a test can supply a plain object. */
export interface FilterChain extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): FilterChain;
  limit(count: number): Promise<QueryResult>;
}

export interface RpcResult {
  data: unknown;
  error: unknown;
}

/** The user's own client: it verifies the JWT and calls RPCs as that user. */
export interface CallerClientLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

/** The service client: it bypasses RLS, so it is used only after authorisation is proven. */
export interface ServiceClientLike {
  from(table: string): { select(columns: string): FilterChain };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

export interface GatewayDeps {
  fetch: FetchLike;
  callerClient(authHeader: string): CallerClientLike;
  serviceClient(): ServiceClientLike;
  crypto: HashCrypto;
  now(): number;
}

export interface GatewayPayload {
  org_id?: string;
  use_case?: string;
  prompt?: string;
  record_type?: string;
  record_id?: string;
  allowed_numbers?: string[];
  probe?: boolean;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface EndpointConfig {
  url: string | null;
  accessMode: AccessMode;
  enabled: boolean;
  secretId: string | null;
}

async function loadEndpoint(service: ServiceClientLike, orgId: string): Promise<EndpointConfig> {
  const { data } = await service.from('tenant_settings')
    .select('ai_enabled, ai_model_endpoint, ai_access_mode, ai_secret_id')
    .eq('org_id', orgId).limit(1);
  const row = data?.[0];
  return {
    url: (row?.ai_model_endpoint as string | null) ?? null,
    accessMode: ((row?.ai_access_mode as string | null) ?? 'server') as AccessMode,
    enabled: Boolean(row?.ai_enabled),
    secretId: (row?.ai_secret_id as string | null) ?? null,
  };
}

async function loadDenyPatterns(service: ServiceClientLike): Promise<string[]> {
  const { data } = await service.from('ai_endpoint_denylist').select('pattern').limit(1000);
  return (data ?? []).map((r) => String(r.pattern));
}

/**
 * Build the request handler. Every side effect arrives through `deps`, so a test can drive the whole
 * authorisation path with plain objects and a fake fetch.
 */
export function createAiGatewayHandler(deps: GatewayDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }

    let payload: GatewayPayload;
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, reason: 'a JSON request body is required' }, 400);
    }
    const orgId = payload.org_id ?? '';
    if (!orgId) return json({ ok: false, reason: 'an organisation is required' }, 400);

    // Authorise before anything is read with the service role (R-1). The caller's own client verifies
    // the JWT and runs the check as that user; org_id from the body is only a candidate, never the
    // authority. ai_gateway_authorise answers membership, the use_ai_assist right and the ai_assist
    // entitlement in one call.
    const caller = deps.callerClient(authHeader);
    const who = await caller.auth.getUser();
    if (!who.data?.user) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }
    const allowed = await caller.rpc('ai_gateway_authorise', { p_org: orgId });
    if (allowed.data !== true) {
      return json({ ok: false, reason: 'not allowed to use AI for this organisation' }, 403);
    }

    const service = deps.serviceClient();
    const config = await loadEndpoint(service, orgId);
    if (!config.enabled) {
      return json({ ok: false, reason: 'AI is not enabled for this organisation.' }, 403);
    }
    if (!config.url) {
      return json({ ok: false, reason: 'No model endpoint is configured yet.' }, 400);
    }

    // A token is read only when the tenant set one; it is never returned or logged (F5).
    let token: string | null = null;
    if (config.secretId) {
      const { data } = await service.rpc('secret_reveal', { p_id: config.secretId });
      token = (data as string | null) ?? null;
    }

    const fetchImpl = deps.fetch;
    const crypto = deps.crypto;

    // The model this org is assigned: the per-use-case override, else the default.
    const { data: modelRows } = await service.from('tenant_ai_models')
      .select('use_case, ai_models(model_ref)').eq('org_id', orgId).limit(1000);
    const byUseCase = (modelRows ?? []).find((m) => m.use_case === (payload.use_case ?? ''));
    const byDefault = (modelRows ?? []).find((m) => m.use_case === null);
    const modelRef = ((byUseCase ?? byDefault)?.ai_models as { model_ref?: string } | null)?.model_ref;

    // The Test button: GET {base}/api/tags and report the installed models (F8).
    if (payload.probe) {
      const check = checkEndpoint(config.url, config.accessMode, await loadDenyPatterns(service));
      if (!check.ok) return json({ ok: false, reason: check.reason }, 400);
      const result = await testEndpoint(config.url, modelRef ?? '', fetchImpl, token);
      return json(result, result.ok ? 200 : 502);
    }

    if (!payload.prompt) return json({ ok: false, reason: 'a prompt is required' }, 400);

    // SSRF and the vendor deny-list. The database already refuses a vendor endpoint on save; this
    // re-checks at call time, and refuses a private address in server mode (F8, L2).
    const check = checkEndpoint(config.url, config.accessMode, await loadDenyPatterns(service));
    if (!check.ok) return json({ ok: false, reason: check.reason }, 400);

    if (!modelRef) {
      return json({ ok: false, reason: 'No model is assigned to this organisation yet.' }, 400);
    }

    const outcome = await runGatewayCall({
      baseUrl: config.url, model: modelRef, prompt: payload.prompt,
      params: { temperature: 0.2, topP: 0.9 },
      allowedNumbers: payload.allowed_numbers ?? [], token,
    }, fetchImpl, crypto);

    const promptHash = await sha256Hex(payload.prompt, crypto);

    if (!outcome.ok || !outcome.text) {
      // Record the failed call too, so the ledger keeps a trace (F8). The error text is redacted.
      await caller.rpc('ai_call_log', {
        p_org: orgId, p_use_case: payload.use_case ?? '', p_model_name: modelRef, p_model_digest: null,
        p_prompt_hash: promptHash, p_response_hash: null, p_access_mode: config.accessMode,
        p_flags: { ok: false, error: outcome.error ?? 'unknown' },
      });
      return json({ ok: false, reason: outcome.error ?? 'The model did not answer.' }, 502);
    }

    await caller.rpc('ai_call_log', {
      p_org: orgId, p_use_case: payload.use_case ?? '', p_model_name: modelRef, p_model_digest: null,
      p_prompt_hash: outcome.promptHash ?? promptHash, p_response_hash: outcome.responseHash ?? null,
      p_access_mode: config.accessMode,
      p_flags: { unverified_figures: (outcome.flags ?? []).map((f) => f.token) },
      p_prompt_text: payload.prompt, p_response_text: outcome.text,
    });

    // The suggestion is stored out of the record until a user accepts it (F8).
    const { data: suggestionId } = await caller.rpc('ai_suggestion_save', {
      p_org: orgId, p_use_case: payload.use_case ?? '', p_record_type: payload.record_type ?? 'draft',
      p_record_id: payload.record_id ?? '', p_text: outcome.text, p_flagged: outcome.flags ?? [],
    });

    return json({
      ok: true, text: outcome.text, suggestion_id: suggestionId ?? null,
      prompt_hash: outcome.promptHash ?? promptHash, response_hash: outcome.responseHash ?? null,
      unverified_figures: outcome.flags ?? [],
    });
  };
}

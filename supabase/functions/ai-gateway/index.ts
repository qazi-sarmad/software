/**
 * ai-gateway (M-4a, F8, F21). The server-mode path to a self-hosted Ollama-compatible endpoint.
 *
 * The browser sends the org, the use case, the prompt and the allowed numbers with the caller's JWT.
 * This function loads the org's endpoint and model, refuses a vendor host (L2) and a private address
 * in server mode (SSRF, F8), calls the endpoint, flags any figure the prompt did not carry, and
 * records the call through ai_call_log. It never returns a secret and never logs a prompt or a token.
 *
 * Laws that shape this file:
 *   - L2: only a tenant-controlled, self-hosted endpoint is called. No vendor-hosted model.
 *   - F8: the call is logged (hashes forever, text for the retention window); an unverified figure is
 *     flagged so the suggestion cannot be accepted until the user edits or confirms it.
 *   - F21: the service role is used here only to read the endpoint config and the credential.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type FetchLike } from '../_shared/emailAdapters.ts';
import { checkEndpoint, type AccessMode } from '../_shared/aiSsrf.ts';
import { runGatewayCall, sha256Hex, testEndpoint, type HashCrypto } from '../_shared/aiGateway.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

function callerClient(authHeader: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

interface EndpointConfig {
  url: string | null;
  accessMode: AccessMode;
  enabled: boolean;
  secretId: string | null;
}

async function loadEndpoint(sb: ReturnType<typeof serviceClient>, orgId: string): Promise<EndpointConfig> {
  const { data } = await sb.from('tenant_settings')
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

async function loadDenyPatterns(sb: ReturnType<typeof serviceClient>): Promise<string[]> {
  const { data } = await sb.from('ai_endpoint_denylist').select('pattern');
  return (data ?? []).map((r) => String(r.pattern));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ ok: false, reason: 'a signed-in session is required' }, 401);
  }

  let payload: {
    org_id?: string; use_case?: string; prompt?: string; record_type?: string;
    record_id?: string; allowed_numbers?: string[]; probe?: boolean;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, reason: 'a JSON request body is required' }, 400);
  }
  const orgId = payload.org_id ?? '';
  if (!orgId) return json({ ok: false, reason: 'an organisation is required' }, 400);

  const service = serviceClient();
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

  const fetchImpl = fetch as unknown as FetchLike;
  const crypto = crypto as unknown as HashCrypto;

  // The model this org is assigned: the per-use-case override, else the default.
  const { data: modelRows } = await service.from('tenant_ai_models')
    .select('use_case, ai_models(model_ref)').eq('org_id', orgId);
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
  const caller = callerClient(authHeader);

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
});

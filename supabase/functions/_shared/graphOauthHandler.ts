/**
 * graph-oauth handler (C1.1, F5, F6, F21). The body of the Edge Function, with every dependency
 * injected so it can be tested without Deno, a network or a database — the same pattern as
 * hostingTestHandler.ts.
 *
 * The defects this handler removes (found in review at a41d46e):
 *   - the old HTTP `refresh` action returned a LIVE Microsoft access token to any signed-in user who
 *     named any `profileId`, i.e. any tenant's sender mailbox;
 *   - `exchange` returned an access token to the browser (F5 forbids a secret reaching the browser);
 *   - the caller's right, the organisation and the `email_graph` feature were never checked;
 *   - there was no OAuth `state`, so the flow was open to CSRF and account linking.
 *
 * The handler now offers exactly two actions:
 *   - `start`    — authorise the caller, then return the consent URL carrying a signed `state`.
 *   - `exchange` — verify and single-use the state, re-authorise, exchange the code, store the
 *                  refresh token through the F5 storage path, and return `{ ok, secretId, masked }`.
 * Token refresh happens only inside the dispatcher path with the service role; an access token is
 * never returned to any client, and no response or log carries a token of any kind.
 */
import { type FetchLike } from './emailAdapters.ts';
import {
  authorizeUrl, exchangeCode, type TokenResponse,
} from './graphOAuth.ts';
import {
  deriveStateKey, newNonce, signState, verifyState, STATE_TTL_MS, type StateCrypto,
} from './graphOauthState.ts';
import { decodeMasterKey, encryptSecret, maskValue, type CryptoLike } from './secretsCrypto.ts';

export interface Row { [key: string]: unknown; }

export interface QueryResult { data: Row[] | null; error: unknown; }

export interface FilterChain extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): FilterChain;
  limit(count: number): Promise<QueryResult>;
}

export interface RpcResult { data: unknown; error: unknown; }

/** The user's own client: it verifies the JWT and calls RPCs and reads tables as that user. */
export interface CallerClientLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
  from(table: string): { select(columns: string): FilterChain };
}

/** The service client: it bypasses RLS, so it is used only after authorisation is proven. */
export interface ServiceClientLike {
  from(table: string): { select(columns: string): FilterChain };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

export interface GraphOauthDeps {
  fetch: FetchLike;
  callerClient(authHeader: string): CallerClientLike;
  serviceClient(): ServiceClientLike;
  crypto: StateCrypto & CryptoLike;
  now(): number;
  /** The Edge secret SECRETS_MASTER_KEY (base64). Absent means the flow cannot sign a state. */
  masterKey: string | null;
}

export interface GraphOauthPayload {
  action?: string;
  orgId?: string | null;
  profileId?: string;
  code?: string;
  state?: string;
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

/** The scope the flow acts for: a tenant organisation, or the literal 'platform'. */
export type FlowScope = { kind: 'tenant'; orgId: string } | { kind: 'platform' };

interface AppConfig { clientId: string | null; redirectUri: string | null; }

async function loadAppConfig(service: ServiceClientLike): Promise<AppConfig> {
  const { data: clientId } = await service.rpc('graph_client_id');
  const { data: rows } = await service.from('platform_email_app')
    .select('redirect_uri').limit(1);
  return {
    clientId: (clientId as string | null) ?? null,
    redirectUri: (rows?.[0]?.redirect_uri as string | null) ?? null,
  };
}

/**
 * Authorise the caller for the flow scope, as the caller. The org is never trusted from the body:
 * a tenant flow needs `edit_config` (or an active tier-1 consultation) and the `email_graph`
 * entitlement; a platform flow needs `is_platform_admin`.
 */
async function authorise(
  caller: CallerClientLike, scope: FlowScope
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  if (scope.kind === 'platform') {
    const { data: isAdmin } = await caller.rpc('is_platform_admin');
    if (isAdmin !== true) {
      return { ok: false, reason: 'not allowed: platform administrator only', status: 403 };
    }
    return { ok: true };
  }
  const { data: mode } = await caller.rpc('config_write_mode', {
    p_org: scope.orgId, p_right: 'edit_config',
  });
  // Only 'apply' writes directly; 'propose' is not permission to change the platform email app.
  if (mode !== 'apply') {
    return {
      ok: false,
      reason: 'not allowed: the caller cannot configure this organisation',
      status: 403,
    };
  }
  const { data: feature } = await caller.rpc('has_feature', {
    p_org: scope.orgId, p_key: 'email_graph',
  });
  if (feature !== true) {
    return { ok: false, reason: 'Microsoft Graph email is not enabled for this organisation', status: 403 };
  }
  return { ok: true };
}

/**
 * When a profile id is given it must belong to the flow scope. Read with the CALLER's authority, so
 * RLS decides what the caller may see; a profile of another organisation is simply not visible and
 * the flow is refused.
 */
async function profileBelongs(
  caller: CallerClientLike, scope: FlowScope, profileId: string
): Promise<boolean> {
  const { data } = await caller.from('email_sender_profiles')
    .select('id, org_id').eq('id', profileId).limit(1);
  const row = data?.[0];
  if (!row) return false;
  const rowOrg = (row.org_id as string | null) ?? null;
  if (scope.kind === 'platform') return rowOrg === null;
  return rowOrg === scope.orgId;
}

/**
 * Store a refresh token through the same F5 path as secrets-put: Vault when present, else
 * AES-256-GCM under SECRETS_MASTER_KEY. The value is never returned; only the secret id comes back.
 */
async function storeRefreshToken(
  deps: GraphOauthDeps, service: ServiceClientLike, scope: FlowScope, value: string
): Promise<string | null> {
  const orgId = scope.kind === 'tenant' ? scope.orgId : null;
  let ciphertext: string | null = null;
  let vaultId: string | null = null;
  const { data: vaultOk } = await service.rpc('vault_available');
  if (vaultOk === true) {
    const { data: id } = await service.rpc('secret_vault_store', {
      p_secret: value, p_name: `${orgId ?? 'platform'}:graph-refresh`,
    });
    vaultId = (id as string | null) ?? null;
  } else {
    if (!deps.masterKey) return null;
    try {
      ciphertext = await encryptSecret(value, decodeMasterKey(deps.masterKey), deps.crypto);
    } catch {
      return null;
    }
  }
  const { data: secretId } = await service.rpc('secret_store_ref', {
    p_org: orgId,
    p_label: 'graph-refresh',
    p_ciphertext: ciphertext,
    p_masked: maskValue(value),
    p_vault_id: vaultId,
  });
  return (secretId as string | null) ?? null;
}

/** Build the request handler. Every side effect arrives through `deps`. */
export function createGraphOauthHandler(deps: GraphOauthDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }

    let payload: GraphOauthPayload;
    try {
      payload = await req.json();
    } catch {
      return json({ ok: false, reason: 'a JSON body is required' }, 400);
    }

    // 1. Verify the caller BEFORE anything else. The service client is not created until a request is
    //    authorised (the caller's own client verifies the JWT).
    const caller = deps.callerClient(authHeader);
    const who = await caller.auth.getUser();
    const userId = who.data?.user?.id;
    if (!userId) return json({ ok: false, reason: 'a signed-in session is required' }, 401);

    if (payload.action === 'start') return start(deps, caller, userId, payload);
    if (payload.action === 'exchange') return exchange(deps, caller, userId, payload);

    // `refresh` is deliberately not routable: token refresh happens only in the dispatcher path.
    return json({ ok: false, reason: 'unknown action' }, 400);
  };
}

async function start(
  deps: GraphOauthDeps, caller: CallerClientLike, userId: string, payload: GraphOauthPayload
): Promise<Response> {
  const orgId = (payload.orgId ?? '').trim();
  const scope: FlowScope = orgId ? { kind: 'tenant', orgId } : { kind: 'platform' };

  const allowed = await authorise(caller, scope);
  if (!allowed.ok) return json({ ok: false, reason: allowed.reason }, allowed.status);

  if (payload.profileId && !(await profileBelongs(caller, scope, payload.profileId))) {
    return json({ ok: false, reason: 'that sender does not belong to this organisation' }, 403);
  }

  if (!deps.masterKey) {
    return json({ ok: false, reason: 'SECRETS_MASTER_KEY is not set on this deployment' }, 500);
  }

  const service = deps.serviceClient();
  const config = await loadAppConfig(service);
  if (!config.clientId || !config.redirectUri) {
    return json({ ok: false, reason: 'the Microsoft app is not configured yet' }, 400);
  }

  const key = await deriveStateKey(deps.masterKey, deps.crypto);
  const state = await signState({
    userId,
    orgId: scope.kind === 'tenant' ? scope.orgId : 'platform',
    nonce: newNonce(deps.crypto),
    expiresAt: deps.now() + STATE_TTL_MS,
  }, key, deps.crypto);

  const url = authorizeUrl(config.clientId, config.redirectUri, state);
  // Only the URL and the state travel back; no secret is ever in the response.
  return json({ ok: true, url });
}

async function exchange(
  deps: GraphOauthDeps, caller: CallerClientLike, userId: string, payload: GraphOauthPayload
): Promise<Response> {
  if (!payload.code) return json({ ok: false, reason: 'an authorization code is required' }, 400);
  if (!deps.masterKey) {
    return json({ ok: false, reason: 'SECRETS_MASTER_KEY is not set on this deployment' }, 500);
  }

  const key = await deriveStateKey(deps.masterKey, deps.crypto);
  const decision = await verifyState(payload.state, key, deps.crypto, userId, deps.now());
  if (!decision.ok) {
    return json({ ok: false, reason: `the sign-in could not be verified (${decision.reason})` }, 400);
  }

  const scope: FlowScope = decision.payload.orgId === 'platform'
    ? { kind: 'platform' }
    : { kind: 'tenant', orgId: decision.payload.orgId };

  const service = deps.serviceClient();

  // 2. Single use. The nonce is consumed through a service-role-only RPC before the code is spent, so
  //    a replay of a captured state is refused even inside its ten-minute window.
  const { data: fresh } = await service.rpc('oauth_state_consume', {
    p_nonce: decision.payload.nonce,
    p_user: userId,
    p_org: scope.kind === 'tenant' ? scope.orgId : null,
    p_expires_at: new Date(decision.payload.expiresAt).toISOString(),
  });
  if (fresh !== true) {
    return json({ ok: false, reason: 'the sign-in could not be verified (replayed)' }, 400);
  }

  // 3. Re-authorise after consuming the nonce: rights may have changed since `start`.
  const allowed = await authorise(caller, scope);
  if (!allowed.ok) return json({ ok: false, reason: allowed.reason }, allowed.status);

  if (payload.profileId && !(await profileBelongs(caller, scope, payload.profileId))) {
    return json({ ok: false, reason: 'that sender does not belong to this organisation' }, 403);
  }

  const config = await loadAppConfig(service);
  if (!config.clientId || !config.redirectUri) {
    return json({ ok: false, reason: 'the Microsoft app is not configured yet' }, 400);
  }
  const { data: clientSecret } = await service.rpc('graph_client_secret');
  if (!clientSecret) {
    return json({ ok: false, reason: 'the Microsoft app is not configured yet' }, 400);
  }

  // The redirect URI is configuration, never caller input, so it cannot be used to redirect a token.
  const result: TokenResponse = await exchangeCode(
    payload.code, config.redirectUri, config.clientId, clientSecret as string, deps.fetch
  );
  if (!result.ok) return json({ ok: false, reason: result.error }, 400);

  // 4. Store the refresh token and, for the platform flow, record it on the app registration. The
  //    access token is dropped: it is not needed by any client and must never be returned (F5).
  let secretId: string | null = null;
  if (result.refreshToken) {
    secretId = await storeRefreshToken(deps, service, scope, result.refreshToken);
    if (scope.kind === 'platform' && secretId) {
      await caller.rpc('graph_app_save', {
        p_client_id: null, p_tenant_id: null, p_redirect_uri: null,
        p_client_secret_id: null, p_refresh_secret_id: secretId,
      });
    }
  }
  if (!secretId) {
    return json({ ok: false, reason: 'the sign-in completed but its credential could not be stored' }, 500);
  }

  // 5. Only the reference and its mask come back. No token of any kind.
  return json({ ok: true, secretId, masked: maskValue(result.refreshToken ?? '') });
}

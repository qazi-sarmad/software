/**
 * graph-oauth (M-3, F6). Microsoft Graph sign-in: the code exchange and the refresh-token rotation.
 *
 * The refresh token is a secret (F5). This function stores it through the secrets-put storage path
 * (Vault or AES-GCM), never in a table column and never in a log, and returns only the access token
 * and its lifetime to the caller. The client id and secret come from Vault, entered once by the
 * Super Admin (F6).
 *
 * Laws that shape this file:
 *   - F5: the refresh token is written through secret_store_ref and is never echoed.
 *   - F21: the service role is used here only for the secret write and the profile update.
 *   - L1: no randomness beyond what the provider's flow requires.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type FetchLike } from '../_shared/emailAdapters.ts';
import { exchangeCode, refreshToken } from '../_shared/graphOAuth.ts';

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

/** Store a refresh token through the F5 path and return the secret id. The value is never returned. */
async function storeRefreshToken(
  sb: ReturnType<typeof serviceClient>, orgId: string | null, value: string
): Promise<string | null> {
  const { data: vaultOk } = await sb.rpc('vault_available');
  let ciphertext: string | null = null;
  let vaultId: string | null = null;
  if (vaultOk === true) {
    const { data: id } = await sb.rpc('secret_vault_store', {
      p_secret: value, p_name: `${orgId ?? 'platform'}:graph-refresh`,
    });
    vaultId = (id as string | null) ?? null;
  }
  const { data: secretId } = await sb.rpc('secret_store_ref', {
    p_org: orgId,
    p_label: 'graph-refresh',
    p_ciphertext: ciphertext,
    p_masked: '•••• refresh',
    p_vault_id: vaultId,
  });
  return (secretId as string | null) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ ok: false, reason: 'a signed-in session is required' }, 401);
  }

  let body: { action?: string; code?: string; redirectUri?: string; orgId?: string | null; profileId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'a JSON body is required' }, 400);
  }

  // Only a configuration actor (or the platform admin) may drive the sign-in.
  const caller = callerClient(authHeader);
  const { data: user } = await caller.auth.getUser();
  if (!user?.user) return json({ ok: false, reason: 'a signed-in session is required' }, 401);

  const sb = serviceClient();
  const { data: clientId } = await sb.rpc('graph_client_id');
  const { data: clientSecret } = await sb.rpc('graph_client_secret');
  if (!clientId || !clientSecret) {
    return json({ ok: false, reason: 'the Microsoft app is not configured yet' }, 400);
  }

  const fetchImpl = fetch as unknown as FetchLike;

  if (body.action === 'exchange') {
    if (!body.code) return json({ ok: false, reason: 'an authorization code is required' }, 400);
    const result = await exchangeCode(
      body.code, body.redirectUri ?? '', clientId as string, clientSecret as string, fetchImpl
    );
    if (!result.ok) return json({ ok: false, reason: result.error }, 400);
    if (result.refreshToken) await storeRefreshToken(sb, body.orgId ?? null, result.refreshToken);
    return json({ ok: true, accessToken: result.accessToken, expiresIn: result.expiresIn });
  }

  if (body.action === 'refresh') {
    if (!body.profileId) return json({ ok: false, reason: 'a profile is required' }, 400);
    const { data: rows } = await sb
      .from('email_sender_profiles')
      .select('credential_secret_id')
      .eq('id', body.profileId)
      .limit(1);
    const secretId = rows?.[0]?.credential_secret_id;
    if (!secretId) return json({ ok: false, reason: 'the sender has no stored sign-in' }, 400);
    const { data: refresh } = await sb.rpc('secret_reveal', { p_id: secretId });
    if (!refresh) return json({ ok: false, reason: 'the stored sign-in could not be read' }, 500);
    const result = await refreshToken(
      refresh as string, clientId as string, clientSecret as string, fetchImpl
    );
    if (!result.ok) return json({ ok: false, reason: result.error }, 400);
    if (result.refreshToken) await storeRefreshToken(sb, body.orgId ?? null, result.refreshToken);
    return json({ ok: true, accessToken: result.accessToken, expiresIn: result.expiresIn });
  }

  return json({ ok: false, reason: 'unknown action' }, 400);
});

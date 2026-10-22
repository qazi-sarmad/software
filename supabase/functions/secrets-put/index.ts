/**
 * secrets-put (M-2, F5). The only path by which a secret value enters the platform.
 *
 * The browser sends { org_id, label, value } over HTTPS with the caller's JWT. The value exists only
 * in this function's memory. The function then either stores it in Supabase Vault (preferred) or
 * encrypts it with AES-256-GCM under SECRETS_MASTER_KEY, and calls secret_store_ref — a
 * service-role-only RPC that receives a mask and, at most, ciphertext. The database never sees the
 * plaintext, and the response never contains it.
 *
 * Laws that shape this file:
 *   - F5: no value reaches a log, the ledger, an email or the response. Only the label and the
 *     outcome are logged.
 *   - F4/L5: the caller is verified before anything happens; the database re-checks edit_config.
 *   - F21: the service role is used only server-side, and only for the calls listed here.
 *   - L1: the nonce is random, which is required for AES-GCM; no audit logic depends on randomness.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  decodeMasterKey, encryptSecret, maskValue, type CryptoLike,
} from '../_shared/secretsCrypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MASTER_KEY = Deno.env.get('SECRETS_MASTER_KEY') ?? '';

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

/** The caller's client, carrying the caller's JWT, so every RPC is re-checked as that caller. */
function callerClient(authHeader: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ ok: false, reason: 'a signed-in session is required' }, 401);
  }

  let body: { org_id?: string | null; label?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: 'a JSON body is required' }, 400);
  }

  const orgId = body.org_id ?? null;
  const label = (body.label ?? '').trim();
  const value = body.value ?? '';
  if (!label) return json({ ok: false, reason: 'a secret label is required' }, 400);
  if (!value) return json({ ok: false, reason: 'a secret value is required' }, 400);

  // 1. Verify the caller and the configuration right, as the caller.
  const caller = callerClient(authHeader);
  const { data: authUser, error: authErr } = await caller.auth.getUser();
  if (authErr || !authUser?.user) {
    return json({ ok: false, reason: 'a signed-in session is required' }, 401);
  }

  if (orgId) {
    const { data: mode, error: modeErr } = await caller.rpc('config_write_mode', {
      p_org: orgId, p_right: 'edit_config',
    });
    if (modeErr) return json({ ok: false, reason: modeErr.message }, 403);
    // Only 'apply' writes directly. 'propose' (a platform admin outside an active session) must go
    // through the consultation flow, so it is refused here rather than treated as permission.
    if (mode !== 'apply') {
      return json({ ok: false, reason: 'not allowed: the caller cannot set a secret for this organisation' }, 403);
    }
  } else {
    // A platform-level secret (the platform email app, the dispatch token) is Super Admin only.
    const { data: isAdmin, error: adminErr } = await caller.rpc('is_platform_admin');
    if (adminErr) return json({ ok: false, reason: adminErr.message }, 403);
    if (!isAdmin) return json({ ok: false, reason: 'not allowed: platform administrator only' }, 403);
  }

  const masked = maskValue(value);
  const service = serviceClient();

  // 2. Prefer Vault. It stores the value and returns an id; the table keeps only that id.
  let ciphertext: string | null = null;
  let vaultId: string | null = null;
  const { data: vaultOk } = await service.rpc('vault_available');
  if (vaultOk === true) {
    const { data: id, error: vaultErr } = await service.rpc('secret_vault_store', {
      p_secret: value, p_name: `${orgId ?? 'platform'}:${label}`,
    });
    if (vaultErr) return json({ ok: false, reason: 'the secret could not be stored' }, 500);
    vaultId = id as string;
  } else {
    // 3. Fall back to AES-256-GCM under SECRETS_MASTER_KEY (D-S2-vault-fallback).
    if (!MASTER_KEY) {
      return json({ ok: false, reason: 'SECRETS_MASTER_KEY is not set on this deployment' }, 500);
    }
    try {
      ciphertext = await encryptSecret(value, decodeMasterKey(MASTER_KEY), crypto as unknown as CryptoLike);
    } catch {
      return json({ ok: false, reason: 'the secret could not be encrypted' }, 500);
    }
  }

  // 4. Store the reference. The RPC is service-role only, so no tenant role can call it directly.
  const { data: secretId, error: storeErr } = await service.rpc('secret_store_ref', {
    p_org: orgId, p_label: label, p_ciphertext: ciphertext, p_masked: masked, p_vault_id: vaultId,
  });
  if (storeErr) return json({ ok: false, reason: 'the secret could not be stored' }, 500);

  // 5. Log the outcome only: never the value, never the ciphertext.
  console.log(`secret stored label=${label} store=${vaultId ? 'vault' : 'aes-gcm'} org=${orgId ?? 'platform'}`);
  return json({ ok: true, secret_id: secretId, masked });
});

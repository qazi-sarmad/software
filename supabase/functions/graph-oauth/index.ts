/**
 * graph-oauth (C1.1, F5, F6, F21). Microsoft Graph delegated sign-in: `start` returns the consent
 * URL carrying a signed state, and `exchange` verifies the state, stores the refresh token through
 * the F5 path and returns only the secret reference. An access token is never returned to a client,
 * and there is no HTTP `refresh` action (token refresh happens only in the dispatcher path).
 *
 * This file only wires the real dependencies into the handler in _shared/graphOauthHandler.ts, where
 * the authorisation and the logic live and are unit-tested.
 *
 * Laws that shape this function:
 *   - F5: the refresh token is written through secret_store_ref (Vault or AES-GCM) and is never
 *     echoed; the access token is discarded, not returned.
 *   - F4/L5: the caller is verified before any service-role read, and the org is never trusted from
 *     the body without a right and a feature check.
 *   - F21: the service role is used here only for the app config, the code exchange and the secret
 *     write, each after authorisation.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type FetchLike } from '../_shared/emailAdapters.ts';
import {
  createGraphOauthHandler, type CallerClientLike, type ServiceClientLike,
} from '../_shared/graphOauthHandler.ts';
import { type StateCrypto } from '../_shared/graphOauthState.ts';
import { type CryptoLike } from '../_shared/secretsCrypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MASTER_KEY = Deno.env.get('SECRETS_MASTER_KEY') ?? '';

function callerClient(authHeader: string): CallerClientLike {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  }) as unknown as CallerClientLike;
}

function serviceClient(): ServiceClientLike {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  }) as unknown as ServiceClientLike;
}

Deno.serve(createGraphOauthHandler({
  fetch: fetch as unknown as FetchLike,
  callerClient,
  serviceClient,
  crypto: crypto as unknown as StateCrypto & CryptoLike,
  now: () => Date.now(),
  masterKey: MASTER_KEY || null,
}));

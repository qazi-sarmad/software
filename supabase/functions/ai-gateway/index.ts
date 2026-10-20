/**
 * ai-gateway (M-4a, F8, F21). The server-mode path to a self-hosted Ollama-compatible endpoint.
 *
 * This file only wires the real dependencies into the handler in _shared/aiGatewayHandler.ts. The
 * handler is where the logic and the authorisation live, so it is unit-tested (R-1).
 *
 * Laws that shape this function:
 *   - L2: only a tenant-controlled, self-hosted endpoint is called. No vendor-hosted model.
 *   - F8: the call is logged (hashes forever, text for the retention window); an unverified figure is
 *     flagged so the suggestion cannot be accepted until the user edits or confirms it.
 *   - F21: the service role is used here only after authorisation, to read the endpoint and the token.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type FetchLike } from '../_shared/emailAdapters.ts';
import { createAiGatewayHandler, type CallerClientLike, type ServiceClientLike } from '../_shared/aiGatewayHandler.ts';
import { type HashCrypto } from '../_shared/aiGateway.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

Deno.serve(createAiGatewayHandler({
  fetch: fetch as unknown as FetchLike,
  callerClient,
  serviceClient,
  crypto: crypto as unknown as HashCrypto,
  now: () => Date.now(),
}));

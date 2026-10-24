/**
 * email-dispatch (M-3, F6, F21). The one dispatcher. Invoked every minute by pg_cron + pg_net, and
 * by the platform admin's "Run now" button.
 *
 * The request must carry an x-dispatch-token header equal to the Vault secret; the publishable key
 * alone is not enough (F6). The function claims at most 10 pending rows, resolves each row's sender
 * profile (tenant profile, then platform default, then stub), sends through the matching adapter,
 * and writes the outcome back. It never returns a secret and never logs one.
 *
 * Laws that shape this file:
 *   - F6: one queue, one dispatcher. Batch 10. Backoff 1/5/15/60/240 minutes, max 5 attempts, then
 *     failed with the provider's redacted error. Graph 202 is 'accepted', never 'delivered'.
 *   - F5: the credential is read inside this function and passed to the adapter; it is never
 *     returned, logged or stored.
 *   - F21: the service role is used here only for the claim/complete RPCs and the credential read.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { type FetchLike } from '../_shared/emailAdapters.ts';
import {
  processRow, tokenMatches, type QueueRow, type ResolvedProfile,
} from '../_shared/emailDispatchLoop.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OUTBOUND_SMTP_ALLOWED = (Deno.env.get('OUTBOUND_SMTP_ALLOWED') ?? 'false') === 'true';

const BATCH = 10;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/** Resolve one row's sender profile through the F6 order, returning the credential for the adapter. */
async function resolveProfile(
  sb: ReturnType<typeof serviceClient>, orgId: string
): Promise<ResolvedProfile> {
  const { data: profileId } = await sb.rpc('email_resolve_profile', { p_org: orgId });
  if (!profileId) return { provider: 'stub', from_address: null, display_name: null, reply_to: null };

  const { data: rows } = await sb
    .from('email_sender_profiles')
    .select('provider, from_address, display_name, reply_to, credential_secret_id, provider_config')
    .eq('id', profileId)
    .limit(1);
  const p = rows?.[0];
  if (!p) return { provider: 'stub', from_address: null, display_name: null, reply_to: null };

  let credential: string | null = null;
  if (p.credential_secret_id) {
    const { data: value } = await sb.rpc('secret_reveal', { p_id: p.credential_secret_id });
    credential = (value as string | null) ?? null;
  }
  return {
    provider: p.provider,
    from_address: p.from_address,
    display_name: p.display_name,
    reply_to: p.reply_to,
    credential,
    config: (p.provider_config as Record<string, string> | null) ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

  const sb = serviceClient();

  // The dispatch token gate. No header, wrong header, or no token configured all refuse (F6).
  const { data: expected } = await sb.rpc('email_dispatch_token');
  const header = req.headers.get('x-dispatch-token');
  if (!tokenMatches(header, expected as string | null)) {
    return json({ ok: false, reason: 'the dispatch token is required' }, 401);
  }

  // Expire rows that have waited too long, then claim a batch (F6).
  await sb.rpc('email_expire_stale', { p_days: 7 });
  const { data: claimed, error: claimErr } = await sb.rpc('email_dispatch_claim', { p_limit: BATCH });
  if (claimErr) return json({ ok: false, reason: claimErr.message }, 500);

  const rows = (claimed ?? []) as QueueRow[];
  const fetchImpl = fetch as unknown as FetchLike;
  const outcomes: { id: string; status: string }[] = [];

  for (const row of rows) {
    const profile = await resolveProfile(sb, row.org_id);
    const outcome = await processRow(row, profile, fetchImpl, OUTBOUND_SMTP_ALLOWED);
    await sb.rpc('email_dispatch_complete', {
      p_id: row.id,
      p_status: outcome.status,
      p_provider: outcome.result.provider,
      p_response_code: outcome.result.responseCode,
      p_provider_message_id: outcome.result.providerMessageId ?? null,
      p_error: outcome.result.error ?? null,
    });
    // Log only the row id, the provider and the outcome — never the credential or the body.
    console.log(`email ${row.id} provider=${outcome.result.provider} status=${outcome.status}`);
    outcomes.push({ id: row.id, status: outcome.status });
  }

  return json({ ok: true, claimed: rows.length, outcomes });
});

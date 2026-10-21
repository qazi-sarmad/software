/**
 * Microsoft Graph delegated sign-in data module (C1.1, F6).
 *
 * The browser drives the flow through the graph-oauth Edge Function: `start` returns the consent
 * URL (with a signed state) and `exchange` trades the code for a stored refresh token. The browser
 * never receives a token of any kind — only the consent URL and, after the exchange, the secret
 * reference and its mask. The Edge Function re-checks the caller's right and the org's entitlement;
 * this module does not decide either.
 *
 * The browser uses the one Supabase client (rule M8) from src/data/client.ts to reach the function.
 */
import { getClient } from './client';

export const NOT_CONFIGURED_REASON = 'The data module is not configured.';

export type StartOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export type ExchangeOutcome =
  | { ok: true; secretId: string; masked: string }
  | { ok: false; reason: string };

/**
 * Begin the delegated sign-in. `orgId` null is the platform-level flow (Super Admin only). The
 * returned URL must be opened by the user; the flow returns to the redirect URI configured on the
 * Microsoft app registration.
 */
export async function startGraphSignIn(orgId: string | null): Promise<StartOutcome> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.functions.invoke('graph-oauth', {
    body: { action: 'start', orgId },
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as { ok?: boolean; reason?: string; url?: string } | null;
  if (!result || result.ok !== true || !result.url) {
    return { ok: false, reason: result?.reason ?? 'The sign-in could not be started.' };
  }
  return { ok: true, url: result.url };
}

/**
 * Complete the delegated sign-in. `state` is the signed token the consent redirect carries back;
 * the Edge Function refuses a missing, forged, expired, replayed or mismatched-user state, and takes
 * the organisation from the state rather than the request. On success only the secret reference and
 * its mask come back.
 */
export async function exchangeGraphCode(
  code: string, state: string
): Promise<ExchangeOutcome> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  // The organisation is carried inside the signed state, so it is never re-supplied from the URL.
  const { data, error } = await sb.functions.invoke('graph-oauth', {
    body: { action: 'exchange', code, state },
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as { ok?: boolean; reason?: string; secretId?: string; masked?: string } | null;
  if (!result || result.ok !== true || !result.secretId) {
    return { ok: false, reason: result?.reason ?? 'The sign-in could not be completed.' };
  }
  return { ok: true, secretId: result.secretId, masked: result.masked ?? '•••• set' };
}

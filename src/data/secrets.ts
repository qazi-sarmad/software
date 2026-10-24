/**
 * Secret entry through the secrets-put Edge Function (M-2, F5).
 *
 * The value never passes through a SQL function: it goes to the Edge Function over HTTPS, which
 * encrypts it or stores it in Vault. This module returns only the secret id and the mask; the value
 * is never echoed back to the browser.
 *
 * The browser uses the one Supabase client (rule M8) from src/data/client.ts to reach the function.
 */
import { getClient } from './client';

export type StoreSecretOutcome =
  | { ok: true; secretId: string; masked: string }
  | { ok: false; reason: string };

export const NOT_CONFIGURED_REASON = 'The data module is not configured.';

/**
 * Store a secret value. `orgId` is null for a platform-level secret (Super Admin only). The function
 * re-checks the caller's right; this module does not decide it.
 */
export async function storeSecret(
  orgId: string | null, label: string, value: string
): Promise<StoreSecretOutcome> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.functions.invoke('secrets-put', {
    body: { org_id: orgId, label, value },
  });
  if (error) return { ok: false, reason: error.message };
  const result = data as { ok?: boolean; reason?: string; secret_id?: string; masked?: string } | null;
  if (!result || result.ok !== true || !result.secret_id) {
    return { ok: false, reason: result?.reason ?? 'The secret could not be stored.' };
  }
  return { ok: true, secretId: result.secret_id, masked: result.masked ?? '•••• set' };
}

/** The masked display of a stored secret, safe to show. Never the value. */
export async function secretDisplay(secretId: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('secret_display', { p_id: secretId });
  if (error) return null;
  return (data as string | null) ?? null;
}

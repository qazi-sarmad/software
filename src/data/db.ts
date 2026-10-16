/**
 * Shared Supabase client for the data modules (Phase 3, task 3I).
 *
 * The same rules as src/data/admin.ts: only the publishable key is used, the client is created
 * lazily, and with no environment variables every module is inert (reads return empty, writes
 * report that the module is not configured). Components never import this file directly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type DataResult = { ok: true } | { ok: false; reason: string };

export const NOT_CONFIGURED_REASON = 'The data module is not configured.';

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key);
  return client;
}

export async function callRpc(
  name: string, args: Record<string, unknown>, reason = NOT_CONFIGURED_REASON
): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason };
  const { error } = await sb.rpc(name, args);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

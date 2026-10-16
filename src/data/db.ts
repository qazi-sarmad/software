/**
 * Shared Supabase client for the data modules (Phase 3, task 3I).
 *
 * One Supabase client for the whole browser (rule M8): src/data/client.ts creates it and exports
 * getClient(); this module re-exports it so every Phase 3 data module has one import point. Only the
 * publishable key is used. With no environment variables every module is inert (reads return empty,
 * writes report that the module is not configured). Components never import this file directly.
 */
import { getClient } from './client';

export { getClient };

export type DataResult = { ok: true } | { ok: false; reason: string };

export const NOT_CONFIGURED_REASON = 'The data module is not configured.';

export async function callRpc(
  name: string, args: Record<string, unknown>, reason = NOT_CONFIGURED_REASON
): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason };
  const { error } = await sb.rpc(name, args);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

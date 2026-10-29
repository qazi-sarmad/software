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

/**
 * Call an RPC that reports its own outcome in the returned JSON as `{ok:false, reason}` rather than
 * raising (the rule-pack save path does this deliberately: a RAISE would roll back the row that
 * records the refusal). `callRpc` would read that as success, because there is no transport error —
 * so this variant inspects the payload and turns a refusal into `{ok:false}`.
 */
export async function callRpcJson<T = Record<string, unknown>>(
  name: string, args: Record<string, unknown>, reason = NOT_CONFIGURED_REASON
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason };
  const { data, error } = await sb.rpc(name, args);
  if (error) return { ok: false, reason: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  if (d && typeof d === 'object' && d.ok === false) {
    const detail = d.detail == null ? '' : `: ${String(d.detail)}`;
    return { ok: false, reason: `${String(d.reason ?? 'refused')}${detail}` };
  }
  return { ok: true, data: d as T };
}

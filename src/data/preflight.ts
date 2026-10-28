/**
 * §11.4 central pre-flight — the data path.
 *
 * The pure checks live in `src/lib/preflight.ts`; the append-only store and the acknowledge RPC live
 * in migration 0095 (`preflight_acks`, `preflight_acknowledge`, `preflight_acks_get`). This module is
 * the only place a component reaches them. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';
import type { PreflightAcknowledgement, PreflightCheck } from '../lib/preflight';

const NOT_CONFIGURED = 'The pre-flight module is not configured.';

/** The live acknowledgements for an engagement (latest per check/item). Empty when not configured. */
export async function listPreflightAcknowledgements(engagementId: string): Promise<PreflightAcknowledgement[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('preflight_acks_get', { p_engagement_id: engagementId });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    check: row.check_key as PreflightCheck,
    itemId: row.item_id as string,
    reason: row.reason as string,
    acknowledgedBy: (row.acked_by as string) ?? '',
    acknowledgedAt: row.acked_at as string,
  }));
}

/** Record an acknowledgement with its reason. Append-only; the reason is validated in the database. */
export function acknowledgePreflight(
  engagementId: string, check: string, itemId: string, reason: string
): Promise<DataResult> {
  return callRpc('preflight_acknowledge', {
    p_engagement_id: engagementId, p_check_key: check, p_item_id: itemId, p_reason: reason,
  }, NOT_CONFIGURED);
}

/** One open pre-flight item, as the database computed it (migration 0102). */
export interface PreflightItemRow {
  check: PreflightCheck;
  itemId: string;
  detail: string;
}

/** Every open pre-flight item for an engagement, from the database. Empty when not configured. */
export async function listPreflightItems(engagementId: string): Promise<PreflightItemRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('preflight_items', { p_engagement_id: engagementId });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    check: row.check_key as PreflightCheck,
    itemId: row.item_id as string,
    detail: row.detail as string,
  }));
}

/** The open items that carry no live acknowledgement: these block the freeze. */
export async function listPreflightBlocking(engagementId: string): Promise<PreflightItemRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('preflight_blocking', { p_engagement_id: engagementId });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    check: row.check_key as PreflightCheck,
    itemId: row.item_id as string,
    detail: row.detail as string,
  }));
}

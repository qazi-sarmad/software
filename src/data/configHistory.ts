/**
 * Configuration history (OA-17, F4, L5).
 *
 * One read over the organisation's configuration history, so every change is visible in one story:
 * roles and rights, entitlements and org settings. Rows written by a QSCorp consultant
 * during a Dual Session carry `actorIsPlatform`, and the screen labels them "platform consultant".
 * Read-only: the history tables are append-only and hash-chained (L5). Components never import the
 * database client.
 */
import { getClient } from './db';

export interface ConfigHistoryRow {
  area: string;
  areaLabel: string;
  entity: string;
  entityId: string | null;
  action: string;
  summary: string;
  actor: string | null;
  actorIsPlatform: boolean;
  prevHash: string | null;
  rowHash: string | null;
  createdAt: string;
}

/** The configuration history of the caller's organisation, newest first. Empty when unconfigured. */
export async function listConfigHistory(limit = 100): Promise<ConfigHistoryRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('config_history_list', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    area: r.area as string,
    areaLabel: (r.area_label as string) ?? (r.area as string),
    entity: (r.entity as string) ?? '',
    entityId: (r.entity_id as string | null) ?? null,
    action: (r.action as string) ?? '',
    summary: (r.summary as string) ?? '',
    actor: (r.actor as string | null) ?? null,
    actorIsPlatform: Boolean(r.actor_is_platform),
    prevHash: (r.prev_hash as string | null) ?? null,
    rowHash: (r.row_hash as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

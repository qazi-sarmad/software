/**
 * Universe and entity data module (Phase 3, task 3I, spec §6).
 *
 * The only place the Universe screens talk to the database. Reads use the table select policies
 * (RLS decides visibility); every write goes through the Phase 3 RPCs in migration 0018, so the
 * database decides the right the caller needs.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';

export interface UniverseRow {
  id: string;
  name: string;
  domain: string | null;
}

export interface EntityRow {
  id: string;
  universeId: string;
  name: string;
  kind: string | null;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  approved: boolean;
  rejectionReason: string | null;
}

export interface EntityApprovalConfig {
  initiateRight: string;
  approveRight: string;
  requiredFields: string[];
}

export interface EntityHistoryEntry {
  action: string;
  actorId: string | null;
  detail: Record<string, unknown>;
  ts: string;
}

export function mapUniverse(u: Record<string, unknown>): UniverseRow {
  return {
    id: u.id as string,
    name: u.name as string,
    domain: (u.domain as string | null) ?? null,
  };
}

export function mapEntity(e: Record<string, unknown>): EntityRow {
  return {
    id: e.id as string,
    universeId: e.universe_id as string,
    name: e.name as string,
    kind: (e.kind as string | null) ?? null,
    status: (e.status as EntityRow['status']) ?? 'draft',
    approved: !!e.approved,
    rejectionReason: (e.rejection_reason as string | null) ?? null,
  };
}

export async function listUniverses(): Promise<UniverseRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('universes').select('id, name, domain').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapUniverse);
}

export async function listEntities(universeId?: string): Promise<EntityRow[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb.from('entities').select('id, universe_id, name, kind, status, approved, rejection_reason');
  if (universeId) q = q.eq('universe_id', universeId);
  const { data, error } = await q.order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapEntity);
}

export async function entityApprovalConfig(orgId: string): Promise<EntityApprovalConfig | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('entity_approval_config', { p_org: orgId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    initiateRight: row.initiate_right as string,
    approveRight: row.approve_right as string,
    requiredFields: (row.required_fields as string[]) ?? [],
  };
}

export function submitEntity(entityId: string): Promise<DataResult> {
  return callRpc('submit_entity', { p_entity_id: entityId });
}

export function decideEntity(entityId: string, approve: boolean, reason?: string): Promise<DataResult> {
  return callRpc('decide_entity', { p_entity_id: entityId, p_approve: approve, p_reason: reason ?? null });
}

export async function entityHistory(entityId: string): Promise<EntityHistoryEntry[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('entity_history', { p_entity_id: entityId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    action: r.action as string,
    actorId: (r.actor_id as string | null) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    ts: r.ts as string,
  }));
}

export { NOT_CONFIGURED_REASON };

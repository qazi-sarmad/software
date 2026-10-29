/**
 * Activity-log archival data module (7F, spec §25.4).
 *
 * The archival itself runs in the database (migration 0043, `archive_activity_period`); the physical
 * Storage upload is deferred to an edge function (NOT-DONE §archival-storage). This module starts an
 * archive job and lists what has been archived. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type ArchiveStatus = 'pending' | 'done' | 'failed';

export interface ArchiveJobRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  archivedRowCount: number;
  storagePath: string | null;
  contentHash: string | null;
  status: ArchiveStatus;
  createdAt: string | null;
  uploadedBytes: number | null;
  uploadVerifiedAt: string | null;
}

export interface IntegrityAlertRow {
  id: string;
  kind: string;
  severity: 'warning' | 'incident';
  objectType: string;
  objectId: string | null;
  expectedHash: string | null;
  actualHash: string | null;
  raisedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface PopulationArchiveRow {
  id: string;
  populationId: string;
  engagementId: string;
  contentHash: string;
  storagePath: string;
  archivedRowCount: number;
  status: ArchiveStatus;
  workingRowsRemovedAt: string | null;
  createdAt: string | null;
}

/** Archive an activity period. Requires the manage_engagements right (D-7C-right). */
export function archiveActivityPeriod(orgId: string, periodStart: string, periodEnd: string): Promise<DataResult> {
  return callRpc('archive_activity_period', {
    p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
  });
}

export async function listArchiveJobs(): Promise<ArchiveJobRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('archive_jobs')
    .select('id, period_start, period_end, archived_row_count, storage_path, content_hash, status, created_at, uploaded_bytes, upload_verified_at')
    .order('period_start', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    periodStart: a.period_start as string,
    periodEnd: a.period_end as string,
    archivedRowCount: (a.archived_row_count as number | null) ?? 0,
    storagePath: (a.storage_path as string | null) ?? null,
    contentHash: (a.content_hash as string | null) ?? null,
    status: (a.status as ArchiveStatus) ?? 'pending',
    createdAt: (a.created_at as string | null) ?? null,
    uploadedBytes: (a.uploaded_bytes as number | null) ?? null,
    uploadVerifiedAt: (a.upload_verified_at as string | null) ?? null,
  }));
}

/**
 * Upload a pending activity archive (C2.5, §25.4). The bytes are stored by the archive-upload Edge
 * Function, which computes the SHA-256 of what was stored and lets the database decide whether the
 * job is done. Nothing is marked archived on the strength of this call alone.
 */
export async function uploadArchiveJob(archiveId: string): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'not connected' };
  const { data, error } = await sb.functions.invoke('archive-upload', { body: { archiveId } });
  if (error) return { ok: false, reason: error.message };
  const status = (data as { status?: string } | null)?.status;
  if (status === 'done') return { ok: true };
  return { ok: false, reason: `the archive was not verified (status: ${status ?? 'unknown'})` };
}

/**
 * The organisation's integrity alerts (T7), incident-first. Reads through `integrity_alerts_list`,
 * which is rights-gated (an integrity owner is required) and annotates each alert with its severity
 * from the database rule — so the app never re-implements the split between a single hash mismatch
 * and a broken ledger chain. An empty list is a normal answer, not an error.
 */
export async function listIntegrityAlerts(): Promise<IntegrityAlertRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('integrity_alerts_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((a) => ({
    id: a.id as string,
    kind: a.kind as string,
    severity: (a.severity as 'warning' | 'incident' | null) ?? 'warning',
    objectType: a.object_type as string,
    objectId: (a.object_id as string | null) ?? null,
    expectedHash: (a.expected_hash as string | null) ?? null,
    actualHash: (a.actual_hash as string | null) ?? null,
    raisedAt: (a.raised_at as string | null) ?? null,
    acknowledgedAt: (a.acknowledged_at as string | null) ?? null,
    acknowledgedBy: (a.acknowledged_by as string | null) ?? null,
  }));
}

/** Record that a human has seen an integrity alert; the row is never edited and the annotation is
 *  ledgered (T7). */
export function acknowledgeIntegrityAlert(id: string): Promise<DataResult> {
  return callRpc('integrity_alert_acknowledge', { p_id: id });
}

/** Re-verify the ledger chain on demand (T7). Returns the first broken sequence, or null when the
 *  chain is intact. A break raises an integrity incident. `null` here means "verified", not "unknown",
 *  so a caller must distinguish a transport failure (thrown) from an intact chain. */
export async function ledgerContinuityCheck(orgId?: string): Promise<bigint | null> {
  const sb = getClient();
  if (!sb) throw new Error('The data module is not configured.');
  const { data, error } = await sb.rpc('ledger_continuity_check', orgId ? { p_org: orgId } : {});
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? null : BigInt(data as number | string);
}

/** Record a population's archive (C2.5, §25.4). Requires manage_engagements. Rows are not removed. */
export function archivePopulation(populationId: string): Promise<DataResult> {
  return callRpc('archive_population', { p_population_id: populationId });
}

export async function listPopulationArchives(): Promise<PopulationArchiveRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('population_archives')
    .select('id, population_id, engagement_id, content_hash, storage_path, archived_row_count, status, working_rows_removed_at, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    populationId: a.population_id as string,
    engagementId: a.engagement_id as string,
    contentHash: a.content_hash as string,
    storagePath: a.storage_path as string,
    archivedRowCount: (a.archived_row_count as number | null) ?? 0,
    status: (a.status as ArchiveStatus) ?? 'pending',
    workingRowsRemovedAt: (a.working_rows_removed_at as string | null) ?? null,
    createdAt: (a.created_at as string | null) ?? null,
  }));
}

/** The populations whose retention period has elapsed and which are not archived yet (§25.4). */
export async function listPopulationArchiveDue(orgId: string): Promise<
  { populationId: string; engagementId: string; finalisedAt: string; dueAt: string }[]
> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('population_archive_due', { p_org_id: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    populationId: r.population_id as string,
    engagementId: r.engagement_id as string,
    finalisedAt: r.finalised_at as string,
    dueAt: r.due_at as string,
  }));
}

export interface ActivityLogRow {
  id: string;
  actorId: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  detail: Record<string, unknown>;
  ts: string | null;
}

/**
 * The tenant's own activity history (spec §25.4, §26). RLS restricts the read to cia / org_admin,
 * so an ordinary member simply sees no rows. Optional since/until filter for the export range.
 */
export async function listActivityLog(since: string | null = null, until: string | null = null): Promise<ActivityLogRow[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb
    .from('activity_log')
    .select('id, actor_id, action, object_type, object_id, detail, ts')
    .order('ts', { ascending: false })
    .limit(500);
  if (since) q = q.gte('ts', since);
  if (until) q = q.lte('ts', until);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    actorId: (a.actor_id as string | null) ?? null,
    action: a.action as string,
    objectType: (a.object_type as string | null) ?? null,
    objectId: (a.object_id as string | null) ?? null,
    detail: (a.detail as Record<string, unknown> | null) ?? {},
    ts: (a.ts as string | null) ?? null,
  }));
}

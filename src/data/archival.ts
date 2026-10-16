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
    .select('id, period_start, period_end, archived_row_count, storage_path, content_hash, status, created_at')
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
  }));
}

/**
 * Exports data module (7F, spec §18).
 *
 * Every export goes through the database: `log_export` records the object, format, filters and content
 * hash, and the per-object `export_*` functions return the data to serialise. This module never builds
 * a file; the caller serialises what the RPC returns. Components never import the Supabase client.
 */
import { getClient } from './db';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'zip' | 'json' | 'docx' | 'png' | 'svg';

export interface ExportLogRow {
  id: string;
  objectType: string;
  objectId: string | null;
  format: ExportFormat;
  contentHash: string | null;
  createdAt: string | null;
  exportedBy: string | null;
}

/** Record an export; returns the new log row id so the UI can show a hash confirmation chip. */
export async function logExport(
  objectType: string, objectId: string | null, format: ExportFormat,
  filters: Record<string, unknown>, contentHash: string
): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('log_export', {
    p_object_type: objectType, p_object_id: objectId, p_format: format,
    p_filters: filters, p_content_hash: contentHash,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function listExports(): Promise<ExportLogRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('exports_log')
    .select('id, object_type, object_id, format, content_hash, created_at, exported_by')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id as string,
    objectType: e.object_type as string,
    objectId: (e.object_id as string | null) ?? null,
    format: (e.format as ExportFormat) ?? 'csv',
    contentHash: (e.content_hash as string | null) ?? null,
    createdAt: (e.created_at as string | null) ?? null,
    exportedBy: (e.exported_by as string | null) ?? null,
  }));
}

async function exportRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function exportWorkpaper(workpaperId: string): Promise<unknown> {
  return exportRpc('export_workpaper', { p_workpaper_id: workpaperId });
}

export function exportEngagementBundle(engagementId: string): Promise<unknown> {
  return exportRpc('export_engagement_bundle', { p_engagement_id: engagementId });
}

export function exportSiraResults(universeId: string, cycleId: string): Promise<unknown> {
  return exportRpc('export_sira_results', { p_universe_id: universeId, p_cycle_id: cycleId });
}

export function exportAuditPlan(universeId: string): Promise<unknown> {
  return exportRpc('export_audit_plan', { p_universe_id: universeId });
}

export function exportCapRegister(orgId: string): Promise<unknown> {
  return exportRpc('export_cap_register', { p_org_id: orgId });
}

export function exportLedger(orgId: string): Promise<unknown> {
  return exportRpc('export_ledger', { p_org_id: orgId });
}

export function exportActivityLog(orgId: string, since: string | null, until: string | null): Promise<unknown> {
  return exportRpc('export_activity_log', { p_org_id: orgId, p_since: since, p_until: until });
}

/** Full-tenant export; the database requires the manage_users right (spec §18, §26). */
export function exportFullTenant(orgId: string): Promise<unknown> {
  return exportRpc('export_full_tenant', { p_org_id: orgId });
}

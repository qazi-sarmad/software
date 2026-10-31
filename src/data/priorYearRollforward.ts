/**
 * Prior-year roll-forward data module (owner instruction 2026-10-30): the roll-forward, the export
 * check, and the prior-year-access gate.
 *
 * The only place the prior-year screens talk to the database for this flow. Every write goes through
 * the RPCs in migration 0201; the database refuses a request from a caller without prior-year access
 * to the source engagement (the scope predicate), so only those who may read last year's file can
 * raise the request.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface RollForwardManifestItem {
  workpaper_id: string;
  stage: string;
  exported: boolean;
}

export interface RollForwardBuildResult {
  rollforwardId: string;
  itemsExpected: number;
  exportComplete: boolean;
}

export interface ExportCheck {
  engagementId: string;
  sourceEngagementId: string;
  itemsExpected: number;
  itemsPresent: number;
  complete: boolean;
  missing: RollForwardManifestItem[];
}

export interface RollForwardRow {
  engagementId: string;
  engagementTitle: string;
  sourceEngagementId: string;
  itemsExpected: number;
  itemsPresent: number;
  exportComplete: boolean;
  version: number;
}

/** Whether the caller may read an engagement under the scope rules — the prior-year access. */
export async function priorYearAccessOk(engagementId: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('prior_year_access_ok', { p_engagement: engagementId });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function buildRollForward(
  engagementId: string, sourceEngagementId: string
): Promise<RollForwardBuildResult | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('prior_year_rollforward_build', {
    p_engagement: engagementId, p_source: sourceEngagementId,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    rollforwardId: String(r.rollforward_id),
    itemsExpected: Number(r.items_expected ?? 0),
    exportComplete: Boolean(r.export_complete),
  };
}

export async function exportCheck(engagementId: string): Promise<ExportCheck | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('prior_year_export_check', { p_engagement: engagementId });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    engagementId: String(r.engagement_id),
    sourceEngagementId: String(r.source_engagement_id),
    itemsExpected: Number(r.items_expected ?? 0),
    itemsPresent: Number(r.items_present ?? 0),
    complete: Boolean(r.complete),
    missing: ((r.missing ?? []) as RollForwardManifestItem[]),
  };
}

export async function listRollForwards(): Promise<RollForwardRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('prior_year_rollforwards_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    engagementId: String(r.engagement_id),
    engagementTitle: String(r.engagement_title ?? ''),
    sourceEngagementId: String(r.source_engagement_id),
    itemsExpected: Number(r.items_expected ?? 0),
    itemsPresent: Number(r.items_present ?? 0),
    exportComplete: Boolean(r.export_complete),
    version: Number(r.version ?? 1),
  }));
}

export function logExport(
  objectType: string, objectId: string, format: string, contentHash: string
): Promise<DataResult> {
  return callRpc('log_export', {
    p_object_type: objectType, p_object_id: objectId, p_format: format,
    p_filters: {}, p_content_hash: contentHash,
  });
}

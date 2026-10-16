/**
 * Row testing data module (4H, spec §11.3, §11.4).
 *
 * The row-testing RPCs from 4E (migration 0028). Named here rather than in sampling.ts because row
 * testing is its own stage: recording a tick/cross/unverifiable, signing the workpaper off and
 * reopening it with a justification. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type RowResult = 'tick' | 'cross' | 'unverifiable';

export interface WorkpaperRowRow {
  id: string;
  workpaperId: string;
  rowRef: string;
  result: RowResult | null;
  rationale: string | null;
  exceptionFlag: boolean;
  preparedBy: string | null;
  preparedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedResult: 'accepted' | 'reverted' | null;
}

export interface WorkpaperRow {
  id: string;
  engagementId: string;
  stage: string;
  status: string;
  preparedAt: string | null;
  preparedBy: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
}

export function recordRow(
  workpaperId: string, rowRef: string, result: RowResult, rationale?: string, exceptionFlag?: boolean
): Promise<DataResult> {
  return callRpc('record_workpaper_row', {
    p_workpaper_id: workpaperId, p_row_ref: rowRef, p_result: result,
    p_rationale: rationale ?? null, p_exception_flag: exceptionFlag ?? null,
  });
}

export function signOffWorkpaper(workpaperId: string): Promise<DataResult> {
  return callRpc('sign_off_workpaper', { p_workpaper_id: workpaperId });
}

export function reopenWorkpaper(workpaperId: string, justification: string): Promise<DataResult> {
  return callRpc('reopen_workpaper', { p_workpaper_id: workpaperId, p_justification: justification });
}

export async function listRows(workpaperId: string): Promise<WorkpaperRowRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('workpaper_rows')
    .select('id, workpaper_id, row_ref, result, rationale, exception_flag, prepared_by, prepared_at, reviewed_by, reviewed_at, reviewed_result')
    .eq('workpaper_id', workpaperId)
    .order('row_ref');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    workpaperId: r.workpaper_id as string,
    rowRef: r.row_ref as string,
    result: (r.result as RowResult | null) ?? null,
    rationale: (r.rationale as string | null) ?? null,
    exceptionFlag: !!r.exception_flag,
    preparedBy: (r.prepared_by as string | null) ?? null,
    preparedAt: (r.prepared_at as string | null) ?? null,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    reviewedResult: (r.reviewed_result as 'accepted' | 'reverted' | null) ?? null,
  }));
}

export async function getWorkpaper(workpaperId: string): Promise<WorkpaperRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('workpapers')
    .select('id, engagement_id, stage, status, prepared_at, prepared_by, signed_off_at, signed_off_by')
    .eq('id', workpaperId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    engagementId: data.engagement_id as string,
    stage: data.stage as string,
    status: data.status as string,
    preparedAt: (data.prepared_at as string | null) ?? null,
    preparedBy: (data.prepared_by as string | null) ?? null,
    signedOffAt: (data.signed_off_at as string | null) ?? null,
    signedOffBy: (data.signed_off_by as string | null) ?? null,
  };
}

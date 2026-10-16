/**
 * Analyst engine data module (4H, spec §12).
 *
 * The check maths lives in src/lib/analyticsEngine.ts (pure functions). This module is the only
 * database edge: it persists a check's result rows into analysis_results and raises a finding
 * observation via the raise_finding_from_result RPC. (4F used a temporary create_observation_stub;
 * 5A retired it — decision D-5A-STUB.)
 * Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface AnalysisResultRow {
  id: string;
  engagementId: string | null;
  workpaperId: string | null;
  populationId: string | null;
  ruleId: string;
  params: Record<string, unknown>;
  rowRefs: number[];
  createdAt: string;
}

/** Raise a finding from a check result: attaches the rule id, params and the flagged row refs. */
export function raiseFinding(
  engagementId: string, populationId: string, ruleId: string,
  params: Record<string, unknown>, rowRefs: number[]
): Promise<DataResult> {
  return callRpc('raise_finding_from_result', {
    p_engagement_id: engagementId, p_population_id: populationId, p_rule_id: ruleId,
    p_params: params, p_row_refs: rowRefs,
  });
}

export async function listAnalysisResults(engagementId: string): Promise<AnalysisResultRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('analysis_results')
    .select('id, engagement_id, workpaper_id, population_id, rule_id, params, row_refs, created_at')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    engagementId: (r.engagement_id as string | null) ?? null,
    workpaperId: (r.workpaper_id as string | null) ?? null,
    populationId: (r.population_id as string | null) ?? null,
    ruleId: r.rule_id as string,
    params: (r.params as Record<string, unknown>) ?? {},
    rowRefs: (r.row_refs as number[]) ?? [],
    createdAt: r.created_at as string,
  }));
}

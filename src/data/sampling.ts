/**
 * Sampling data module (4H, spec §11.2).
 *
 * The sampling engine lives in the database (migration 0027). This module reads the org sampling
 * table, asks for the floor size, computes a sample and locks or replaces one. Components never
 * import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type SamplingMethod =
  | 'random' | 'systematic' | 'mus' | 'stratified' | 'high_value' | 'low_value' | 'haphazard';

export type SampleMode = 'system' | 'auditor_paste';

export interface SamplingRuleRow {
  id: string;
  controlType: string;
  frequency: string;
  popBand: string;
  method: SamplingMethod;
  baseSize: number;
  pct: number;
}

export interface SampleRow {
  id: string;
  workpaperId: string | null;
  populationId: string | null;
  mode: SampleMode | null;
  seed: string | null;
  sizeFloor: number | null;
  sampleRows: unknown[];
  lockedAt: string | null;
  lockedBy: string | null;
}

export function computeSample(
  workpaperId: string, mode: SampleMode, items?: unknown[]
): Promise<DataResult> {
  return callRpc('compute_sample', {
    p_workpaper_id: workpaperId, p_mode: mode, p_items: items ?? null,
  });
}

export function lockSample(sampleId: string): Promise<DataResult> {
  return callRpc('lock_sample', { p_sample_id: sampleId });
}

export function replaceSample(sampleId: string, rationale: string): Promise<DataResult> {
  return callRpc('replace_sample', { p_sample_id: sampleId, p_rationale: rationale });
}

export async function getSampleSize(
  orgId: string, controlType: string, frequency: string, popBand: string, popCount: number
): Promise<number | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('get_sample_size', {
    p_org_id: orgId, p_control_type: controlType, p_frequency: frequency,
    p_pop_band: popBand, p_pop_count: popCount,
  });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? null;
}

export async function listSamplingRules(orgId: string): Promise<SamplingRuleRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('org_sampling_table')
    .select('id, control_type, frequency, pop_band, method, base_size, pct')
    .eq('org_id', orgId)
    .order('pop_band');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    controlType: r.control_type as string,
    frequency: r.frequency as string,
    popBand: r.pop_band as string,
    method: r.method as SamplingMethod,
    baseSize: r.base_size as number,
    pct: Number(r.pct),
  }));
}

export async function getSample(workpaperId: string): Promise<SampleRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('samples')
    .select('id, workpaper_id, population_id, mode, seed, size_floor, sample_rows, locked_at, locked_by')
    .eq('workpaper_id', workpaperId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    workpaperId: (data.workpaper_id as string | null) ?? null,
    populationId: (data.population_id as string | null) ?? null,
    mode: (data.mode as SampleMode | null) ?? null,
    seed: (data.seed as string | null) ?? null,
    sizeFloor: (data.size_floor as number | null) ?? null,
    sampleRows: (data.sample_rows as unknown[]) ?? [],
    lockedAt: (data.locked_at as string | null) ?? null,
    lockedBy: (data.locked_by as string | null) ?? null,
  };
}

/**
 * Org sampling-table writes (C2/C3, spec §11.2). The Org Admin portal edits the rule set through
 * these; the RPC requires edit_config and is logged in the org's configuration chain.
 */
export interface SamplingRuleInput {
  controlType: string;
  frequency: string;
  popBand: string;
  method: SamplingMethod;
  baseSize: number;
  pct: number;
  id?: string | null;
}

export function upsertSamplingRule(input: SamplingRuleInput): Promise<DataResult> {
  return callRpc('admin_upsert_sampling_row', {
    p_control_type: input.controlType, p_frequency: input.frequency, p_pop_band: input.popBand,
    p_method: input.method, p_base_size: input.baseSize, p_pct: input.pct, p_id: input.id ?? null,
  });
}

export function deleteSamplingRule(id: string): Promise<DataResult> {
  return callRpc('admin_delete_sampling_row', { p_id: id });
}

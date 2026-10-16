/**
 * SIRA data module (Phase 3, task 3I, spec §8).
 *
 * The only place the SIRA screens talk to the database. Reads use the table select policies; every
 * write goes through the Phase 3 RPCs in migrations 0019 (model) and 0020 (cycles, scores, emergent
 * risks). The deterministic scoring engine itself lives in src/lib/siraEngine.ts.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface SiraCycle {
  id: string;
  universeId: string;
  year: number;
  status: 'draft' | 'published';
  publishedAt: string | null;
}

export interface SiraScore {
  id: string;
  cycleId: string;
  entityId: string;
  riskId: string | null;
  score: number;
  band: string | null;
  factorValues: Record<string, number>;
}

export interface SiraEmergentRisk {
  id: string;
  universeId: string;
  entityId: string | null;
  title: string;
  description: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  decisionReason: string | null;
  createdAt: string;
}

export interface SiraModel {
  aggregation: string;
  version: number;
  factors: { key: string; label: string; weight: number; ordinal: number }[];
  scales: { point: number; label: string }[];
  bands: { name: string; min: number; max: number; ordinal: number }[];
}

export function createSiraCycle(universeId: string, year: number): Promise<DataResult> {
  return callRpc('create_sira_cycle', { p_universe: universeId, p_year: year });
}

export function recordSiraScore(
  cycleId: string, entityId: string, riskId: string | null, factorValues: Record<string, number>
): Promise<DataResult> {
  return callRpc('record_sira_score', {
    p_cycle: cycleId, p_entity: entityId, p_risk: riskId, p_factor_values: factorValues,
  });
}

export function publishSiraCycle(cycleId: string): Promise<DataResult> {
  return callRpc('publish_sira_cycle', { p_cycle: cycleId });
}

export function submitEmergentRisk(
  universeId: string, title: string, entityId?: string, engagementId?: string,
  targetCycleId?: string, description?: string
): Promise<DataResult> {
  return callRpc('submit_emergent_risk', {
    p_universe: universeId, p_title: title, p_entity: entityId ?? null,
    p_engagement: engagementId ?? null, p_target_cycle: targetCycleId ?? null,
    p_description: description ?? null,
  });
}

export function decideEmergentRisk(id: string, status: 'accepted' | 'rejected', reason: string): Promise<DataResult> {
  return callRpc('decide_emergent_risk', { p_id: id, p_status: status, p_reason: reason });
}

export async function listCycles(universeId?: string): Promise<SiraCycle[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb.from('sira_cycles').select('id, universe_id, year, status, published_at');
  if (universeId) q = q.eq('universe_id', universeId);
  const { data, error } = await q.order('year', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    universeId: c.universe_id as string,
    year: c.year as number,
    status: (c.status as 'draft' | 'published') ?? 'draft',
    publishedAt: (c.published_at as string | null) ?? null,
  }));
}

export async function listScores(cycleId: string): Promise<SiraScore[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('sira_scores')
    .select('id, cycle_id, entity_id, risk_id, score, band, factor_values')
    .eq('cycle_id', cycleId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id as string,
    cycleId: s.cycle_id as string,
    entityId: s.entity_id as string,
    riskId: (s.risk_id as string | null) ?? null,
    score: Number(s.score),
    band: (s.band as string | null) ?? null,
    factorValues: (s.factor_values as Record<string, number>) ?? {},
  }));
}

export async function listEmergentRisks(universeId?: string): Promise<SiraEmergentRisk[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb
    .from('sira_emergent_risks')
    .select('id, universe_id, entity_id, title, description, status, decision_reason, created_at');
  if (universeId) q = q.eq('universe_id', universeId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    universeId: r.universe_id as string,
    entityId: (r.entity_id as string | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    status: (r.status as SiraEmergentRisk['status']) ?? 'pending',
    decisionReason: (r.decision_reason as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

export async function siraModelSnapshot(orgId: string): Promise<SiraModel | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sira_model_snapshot', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data as SiraModel | null) ?? null;
}

export function setSiraAggregation(method: string): Promise<DataResult> {
  return callRpc('admin_set_sira_aggregation', { p_method: method });
}

export function upsertSiraFactor(key: string, label: string, weight: number, ordinal: number): Promise<DataResult> {
  return callRpc('admin_upsert_sira_factor', {
    p_key: key, p_label: label, p_weight: weight, p_ordinal: ordinal,
  });
}

export function setSiraBand(name: string, min: number, max: number, ordinal: number): Promise<DataResult> {
  return callRpc('admin_set_sira_band', { p_name: name, p_min: min, p_max: max, p_ordinal: ordinal });
}

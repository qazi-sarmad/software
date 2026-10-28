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
  sourceKind: string | null;
  sourceId: string | null;
  proposalReason: string | null;
}

export interface SiraCarryForward {
  id: string;
  fromCycleId: string;
  toCycleId: string | null;
  universeId: string;
  fromYear: number;
  toYear: number;
  createdAt: string | null;
}

export interface SiraAcceptanceState {
  cycleId: string;
  year: number;
  status: string;
  acceptanceStatus: 'none' | 'awaiting_acceptance' | 'accepted' | 'rejected';
  endorsedBy: string | null;
  endorsedAt: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptanceReason: string | null;
  reminderCount: number;
  pendingProposals: number;
  nextYear: number;
  canPublishNext: boolean;
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

/** S18: build the carry-forward pack for a published cycle. Read-only. */
export async function carryForwardPack(cycleId: string): Promise<Record<string, unknown> | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sira_carry_forward_pack', { p_cycle: cycleId });
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? null;
}

export interface CarryForwardEntity {
  entityId: string;
  name: string;
  priorScore: number;
  priorBand: string | null;
  scoreCount: number;
}

export interface CarryForwardPack {
  fromYear: number;
  toYear: number;
  entities: CarryForwardEntity[];
  acceptedRiskTitles: string[];
}

/** S18: shape the raw pack RPC payload. Pure — the panel renders this, never the raw JSON. */
export function parseCarryForwardPack(raw: Record<string, unknown> | null): CarryForwardPack | null {
  if (!raw) return null;
  const rows = Array.isArray(raw.entities) ? (raw.entities as Record<string, unknown>[]) : [];
  const risks = Array.isArray(raw.accepted_emergent_risks)
    ? (raw.accepted_emergent_risks as Record<string, unknown>[])
    : [];
  return {
    fromYear: Number(raw.from_year ?? 0),
    toYear: Number(raw.to_year ?? 0),
    entities: rows.map((e) => ({
      entityId: String(e.entity_id ?? ''),
      name: String(e.name ?? ''),
      priorScore: Number(e.prior_score ?? 0),
      priorBand: (e.prior_band as string | null) ?? null,
      scoreCount: Number(e.score_count ?? 0),
    })),
    acceptedRiskTitles: risks.map((r) => String(r.title ?? '')).filter((t) => t.length > 0),
  };
}

/** S18: create the next year's cycle and seed it from the pack. Requires manage_engagements. */
export async function seedNextCycle(cycleId: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('seed_sira_next_cycle', { p_cycle: cycleId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** S18: propose emergent risks from the open findings on the cycle's universe. Idempotent. */
export async function proposeEmergentRisks(cycleId: string): Promise<number> {
  const sb = getClient();
  if (!sb) return 0;
  const { data, error } = await sb.rpc('propose_emergent_risks', { p_cycle: cycleId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** S19: the finaliser's ENDORSEMENT. Visible and reminded; it does not close anything. */
export function endorseSiraCycle(cycleId: string, note: string): Promise<DataResult> {
  return callRpc('endorse_sira_cycle', { p_cycle: cycleId, p_note: note });
}

/** S19: the AUDITOR's decision. Must be a different person from the finaliser. */
export function decideSiraAcceptance(
  cycleId: string, status: 'accepted' | 'rejected', reason: string
): Promise<DataResult> {
  return callRpc('decide_sira_acceptance', { p_cycle: cycleId, p_status: status, p_reason: reason });
}

/** S19: a plain-language reason a cycle may not be published, or null when it may. */
export async function siraPublishBlock(cycleId: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sira_publish_block', { p_cycle: cycleId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** S19: remind the auditors of every outstanding acceptance and report silence as a finding. */
export async function remindSiraAcceptance(orgId: string, asOf: string, days = 14): Promise<number> {
  const sb = getClient();
  if (!sb) return 0;
  const { data, error } = await sb.rpc('remind_sira_acceptance', { p_org: orgId, p_as_of: asOf, p_days: days });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** S19: everything the SIRA screen needs to show the acceptance and gate the next cycle. */
export async function siraAcceptanceState(cycleId: string): Promise<SiraAcceptanceState | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sira_acceptance_state', { p_cycle: cycleId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    cycleId: raw.cycle_id as string,
    year: raw.year as number,
    status: raw.status as string,
    acceptanceStatus: (raw.acceptance_status as SiraAcceptanceState['acceptanceStatus']) ?? 'none',
    endorsedBy: (raw.endorsed_by as string | null) ?? null,
    endorsedAt: (raw.endorsed_at as string | null) ?? null,
    acceptedBy: (raw.accepted_by as string | null) ?? null,
    acceptedAt: (raw.accepted_at as string | null) ?? null,
    acceptanceReason: (raw.acceptance_reason as string | null) ?? null,
    reminderCount: Number(raw.reminder_count ?? 0),
    pendingProposals: Number(raw.pending_proposals ?? 0),
    nextYear: Number(raw.next_year ?? 0),
    canPublishNext: Boolean(raw.can_publish_next),
  };
}

/** S18: the carry-forward records for a universe, newest first. */
export async function listCarryForward(universeId?: string): Promise<SiraCarryForward[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb
    .from('sira_carry_forward')
    .select('id, from_cycle_id, to_cycle_id, universe_id, from_year, to_year, created_at');
  if (universeId) q = q.eq('universe_id', universeId);
  const { data, error } = await q.order('from_year', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    fromCycleId: c.from_cycle_id as string,
    toCycleId: (c.to_cycle_id as string | null) ?? null,
    universeId: c.universe_id as string,
    fromYear: c.from_year as number,
    toYear: c.to_year as number,
    createdAt: (c.created_at as string | null) ?? null,
  }));
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
    .select('id, universe_id, entity_id, title, description, status, decision_reason, created_at, source_kind, source_id, proposal_reason');
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
    sourceKind: (r.source_kind as string | null) ?? null,
    sourceId: (r.source_id as string | null) ?? null,
    proposalReason: (r.proposal_reason as string | null) ?? null,
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

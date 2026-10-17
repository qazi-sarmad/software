/**
 * Audit plan data module (Phase 3, task 3I, spec §9).
 *
 * The only place the plan screens talk to the database. Reads use the table select policies; every
 * write goes through the Phase 3 RPCs in migration 0021, so the database decides the right the
 * caller needs.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface PlanRow {
  id: string;
  universeId: string;
  period: string | null;
  status: 'draft' | 'approved';
  currentVersion: number;
  approvedAt: string | null;
}

export interface PlanItemRow {
  id: string;
  planId: string;
  entityId: string | null;
  title: string;
  isAdhoc: boolean;
  justification: string | null;
  status: 'proposed' | 'pending_adhoc' | 'approved' | 'removed';
}

export interface PlanVersionRow {
  version: number;
  reason: string | null;
  createdAt: string;
}

export interface PlanApprovalConfig {
  createRight: string;
  approveRight: string;
}

export function createPlan(universeId: string, period: string): Promise<DataResult> {
  return callRpc('create_plan', { p_universe: universeId, p_period: period });
}

export function addPlanItem(
  planId: string, title: string, entityId?: string, engagementId?: string,
  start?: string, end?: string, adhoc = false, justification?: string
): Promise<DataResult> {
  return callRpc('add_plan_item', {
    p_plan: planId, p_title: title, p_entity: entityId ?? null, p_engagement: engagementId ?? null,
    p_start: start ?? null, p_end: end ?? null, p_adhoc: adhoc, p_justification: justification ?? null,
  });
}

export function decideAdhocItem(itemId: string, approve: boolean, reason?: string): Promise<DataResult> {
  return callRpc('decide_adhoc_item', { p_item: itemId, p_approve: approve, p_reason: reason ?? null });
}

export function approvePlan(planId: string): Promise<DataResult> {
  return callRpc('approve_plan', { p_plan: planId });
}

export function setPlanApproval(createRight: string, approveRight: string): Promise<DataResult> {
  return callRpc('admin_set_plan_approval', { p_create: createRight, p_approve: approveRight });
}

export async function listPlans(universeId?: string): Promise<PlanRow[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb.from('plans').select('id, universe_id, period, status, current_version, approved_at');
  if (universeId) q = q.eq('universe_id', universeId);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    universeId: p.universe_id as string,
    period: (p.period as string | null) ?? null,
    status: (p.status as 'draft' | 'approved') ?? 'draft',
    currentVersion: p.current_version as number,
    approvedAt: (p.approved_at as string | null) ?? null,
  }));
}

export async function listPlanItems(planId: string): Promise<PlanItemRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('plan_items')
    .select('id, plan_id, entity_id, title, is_adhoc, justification, status')
    .eq('plan_id', planId)
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((i) => ({
    id: i.id as string,
    planId: i.plan_id as string,
    entityId: (i.entity_id as string | null) ?? null,
    title: i.title as string,
    isAdhoc: !!i.is_adhoc,
    justification: (i.justification as string | null) ?? null,
    status: (i.status as PlanItemRow['status']) ?? 'proposed',
  }));
}

export async function planHistory(planId: string): Promise<PlanVersionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('plan_history', { p_plan: planId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((v) => ({
    version: v.version as number,
    reason: (v.reason as string | null) ?? null,
    createdAt: v.created_at as string,
  }));
}

export async function planApprovalConfig(orgId: string): Promise<PlanApprovalConfig | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('plan_approval_config', { p_org: orgId });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  return { createRight: row.create_right as string, approveRight: row.approve_right as string };
}

/**
 * R6a: the most recent plan for a universe, or null when the universe has no plan yet. The SIRA
 * screen reads this so it can show the persisted plan and its version history instead of nothing.
 */
export async function latestPlanForUniverse(universeId: string): Promise<PlanRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('plans')
    .select('id, universe_id, period, status, current_version, approved_at')
    .eq('universe_id', universeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const p = data as Record<string, unknown> | null;
  if (!p) return null;
  return {
    id: p.id as string,
    universeId: p.universe_id as string,
    period: (p.period as string | null) ?? null,
    status: (p.status as 'draft' | 'approved') ?? 'draft',
    currentVersion: p.current_version as number,
    approvedAt: (p.approved_at as string | null) ?? null,
  };
}

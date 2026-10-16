/**
 * Deployment gate data module (Phase 3, task 3I, spec §7, §7.1).
 *
 * The only place the deployment screens talk to the database. Reads use the table select policies;
 * every write goes through the Phase 3 RPCs in migrations 0022 (gate, ethics) and 0023 (combined
 * approval), so the database decides the right the caller needs.
 */
import { callRpc, getClient, type DataResult } from './db';

export type GateOutcome =
  | 'entity_required'
  | 'entity_not_found'
  | 'entity_not_approved'
  | 'plan_change_required'
  | 'period_mismatch'
  | 'approval_required'
  | 'deployed';

export interface GateResult {
  outcome: GateOutcome;
  step: number;
  detail?: string;
  entityId?: string;
  planId?: string;
  engagementId?: string;
  requiredRight?: string;
}

export interface EthicsStatus {
  complete: boolean;
  members: { userId: string; acknowledged: boolean }[];
}

export interface DeploymentRequestRow {
  id: string;
  universeId: string;
  entityId: string;
  title: string;
  period: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'escalated';
  reason: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  planId: string | null;
}

export async function deployEngagement(
  universeId: string, entityId: string | null, planId?: string, period?: string, title?: string
): Promise<GateResult | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('deploy_engagement', {
    p_universe: universeId, p_entity: entityId, p_plan: planId ?? null,
    p_period: period ?? null, p_title: title ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    outcome: r.outcome as GateOutcome,
    step: r.step as number,
    detail: (r.detail as string | undefined) ?? undefined,
    entityId: (r.entity_id as string | undefined) ?? undefined,
    planId: (r.plan_id as string | undefined) ?? undefined,
    engagementId: (r.engagement_id as string | undefined) ?? undefined,
    requiredRight: (r.required_right as string | undefined) ?? undefined,
  };
}

export function acknowledgeEthics(engagementId: string): Promise<DataResult> {
  return callRpc('acknowledge_ethics', { p_engagement: engagementId });
}

export async function ethicsStatus(engagementId: string): Promise<EthicsStatus | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('ethics_status', { p_engagement: engagementId });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    complete: !!r.complete,
    members: ((r.members as Record<string, unknown>[]) ?? []).map((m) => ({
      userId: m.user_id as string,
      acknowledged: !!m.acknowledged,
    })),
  };
}

export function requestCombinedDeployment(
  universeId: string, entityId: string, period?: string, title?: string
): Promise<DataResult> {
  return callRpc('request_combined_deployment', {
    p_universe: universeId, p_entity: entityId, p_period: period ?? null, p_title: title ?? null,
  });
}

export function decideCombinedDeployment(requestId: string, approve: boolean, reason?: string): Promise<DataResult> {
  return callRpc('decide_combined_deployment', {
    p_request: requestId, p_approve: approve, p_reason: reason ?? null,
  });
}

export function escalateOverdueDeploymentRequests(): Promise<DataResult> {
  return callRpc('escalate_overdue_deployment_requests', {});
}

export async function listDeploymentRequests(): Promise<DeploymentRequestRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('deployment_requests')
    .select('id, universe_id, entity_id, title, period, status, decision_reason, sla_due_at, escalated_at, plan_id')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    universeId: r.universe_id as string,
    entityId: r.entity_id as string,
    title: r.title as string,
    period: (r.period as string | null) ?? null,
    status: (r.status as DeploymentRequestRow['status']) ?? 'pending',
    reason: (r.decision_reason as string | null) ?? null,
    slaDueAt: (r.sla_due_at as string | null) ?? null,
    escalatedAt: (r.escalated_at as string | null) ?? null,
    planId: (r.plan_id as string | null) ?? null,
  }));
}

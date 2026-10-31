/**
 * Plan deployment data module (owner instruction 2026-10-30): the file owner, deployment from the
 * plan, the early-deployment reason and approval, and the deterministic suggestions that follow.
 *
 * The only place the plan screens talk to the database for this flow. Reads use the table select
 * policies; every write goes through the RPCs in migration 0200, so the database decides the right
 * the caller needs (manage_engagements to deploy, the org's configured approve_right to approve).
 */
import { callRpc, getClient, type DataResult } from './db';

export type DeployOutcome =
  | 'deployed'
  | 'early_approval_required'
  | 'reason_required';

export interface PlanDeployResult {
  outcome: DeployOutcome;
  isEarly: boolean;
  detail?: string;
  engagementId?: string;
  deploymentId?: string;
  approvalRight?: string;
  dueOn?: string | null;
  deployedOn?: string | null;
  plannedStart?: string | null;
}

export interface FileOwnerRow {
  engagementId: string;
  engagementTitle: string;
  userId: string;
  planItemId: string | null;
  reason: string;
  version: number;
  assignedAt: string;
}

export interface DeploymentRow {
  id: string;
  engagementId: string | null;
  planItemId: string;
  title: string;
  dueOn: string | null;
  deployedOn: string;
  isEarly: boolean;
  reason: string;
  status: 'pending_approval' | 'approved' | 'refused' | 'deployed';
  approvalRight: string;
  decisionReason: string | null;
}

export interface DeploymentSuggestion {
  target: 'audit_calendar' | 'board_pack' | 'plan';
  suggestion: string;
  detail: Record<string, unknown>;
}

function mapDeploy(r: Record<string, unknown>): PlanDeployResult {
  return {
    outcome: r.outcome as DeployOutcome,
    isEarly: Boolean(r.is_early),
    detail: (r.detail as string | undefined) ?? undefined,
    engagementId: (r.engagement_id as string | undefined) ?? undefined,
    deploymentId: (r.deployment_id as string | undefined) ?? undefined,
    approvalRight: (r.approval_right as string | undefined) ?? undefined,
    dueOn: (r.due_on as string | null | undefined) ?? null,
    deployedOn: (r.deployed_on as string | null | undefined) ?? null,
    plannedStart: (r.planned_start as string | null | undefined) ?? null,
  };
}

/** Deploy an engagement from a plan item. On time deploys at once; early is held for approval. */
export async function deployFromPlan(
  planItemId: string, on: string | null, reason: string
): Promise<PlanDeployResult | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('engagement_deploy_from_plan', {
    p_plan_item: planItemId, p_on: on, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapDeploy(data as Record<string, unknown>);
}

/** Decide a pending early deployment. Approving deploys; refusing deploys nothing. */
export async function decideDeployment(
  deploymentId: string, approve: boolean, reason: string
): Promise<PlanDeployResult | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('engagement_deployment_decide', {
    p_deployment: deploymentId, p_approve: approve, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapDeploy(data as Record<string, unknown>);
}

export function setFileOwner(
  engagementId: string, userId: string, planItemId: string | null, reason: string
): Promise<DataResult> {
  return callRpc('engagement_file_owner_set', {
    p_engagement: engagementId, p_user: userId, p_plan_item: planItemId, p_reason: reason,
  });
}

export async function listFileOwners(): Promise<FileOwnerRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('engagement_file_owners_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    engagementId: String(r.engagement_id),
    engagementTitle: String(r.engagement_title ?? ''),
    userId: String(r.user_id),
    planItemId: (r.plan_item_id as string | null) ?? null,
    reason: String(r.reason ?? ''),
    version: Number(r.version ?? 1),
    assignedAt: String(r.assigned_at ?? ''),
  }));
}

export async function listDeployments(): Promise<DeploymentRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('engagement_deployments_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    engagementId: (r.engagement_id as string | null) ?? null,
    planItemId: String(r.plan_item_id),
    title: String(r.title ?? ''),
    dueOn: (r.due_on as string | null) ?? null,
    deployedOn: String(r.deployed_on ?? ''),
    isEarly: Boolean(r.is_early),
    reason: String(r.reason ?? ''),
    status: r.status as DeploymentRow['status'],
    approvalRight: String(r.approval_right ?? ''),
    decisionReason: (r.decision_reason as string | null) ?? null,
  }));
}

export async function listDeploymentSuggestions(deploymentId: string): Promise<DeploymentSuggestion[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('deployment_suggestions_list', { p_deployment: deploymentId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    target: r.target as DeploymentSuggestion['target'],
    suggestion: String(r.suggestion ?? ''),
    detail: (r.detail as Record<string, unknown>) ?? {},
  }));
}

/**
 * Escalation and Work Queue proposals data module (F12, S6).
 *
 * The deterministic recommendation is computed on the server (never AI, L1). This module reads the
 * escalations and proposals a caller may see, saves an escalation rule, and converts a proposal
 * through the normal plan flow. Components never import the database client.
 */
import { callRpc, getClient, type DataResult } from './db';
import type { AutomationRule, RuleAction, RuleCondition } from '../lib/automationRules';

const NOT_CONFIGURED = 'The escalation module is not configured.';

export interface EscalationEvent {
  id: string;
  ruleKey: string;
  sourceEventKey: string;
  severity: string | null;
  recommendation: string;
  reason: string;
  targetRoles: string[];
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkQueueProposal {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: 'proposed' | 'converted' | 'dismissed';
  targetRoles: string[];
  sourceEscalationId: string | null;
  createdAt: string;
  decidedAt: string | null;
  engagementId: string | null;
}

interface RawEscalation {
  id: string;
  rule_key: string;
  source_event_key: string;
  severity: string | null;
  recommendation: string;
  reason: string;
  target_roles: string[] | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface RawProposal {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  status: 'proposed' | 'converted' | 'dismissed';
  target_roles: string[] | null;
  source_escalation_id: string | null;
  created_at: string;
  decided_at: string | null;
  engagement_id: string | null;
}

/** The escalations visible to the caller (targeted roles or view_all_scopes). */
export async function listEscalations(orgId: string): Promise<EscalationEvent[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('escalation_event_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawEscalation[]).map((e) => ({
    id: e.id,
    ruleKey: e.rule_key,
    sourceEventKey: e.source_event_key,
    severity: e.severity,
    recommendation: e.recommendation,
    reason: e.reason,
    targetRoles: e.target_roles ?? [],
    payload: e.payload ?? {},
    createdAt: e.created_at,
  }));
}

/** The Work Queue proposals visible to the caller. */
export async function listProposals(orgId: string): Promise<WorkQueueProposal[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('work_queue_proposal_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawProposal[]).map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title ?? '',
    body: p.body ?? '',
    status: p.status,
    targetRoles: p.target_roles ?? [],
    sourceEscalationId: p.source_escalation_id,
    createdAt: p.created_at,
    decidedAt: p.decided_at,
    engagementId: p.engagement_id,
  }));
}

/** Save an escalation rule. The server refuses an escalate action with no recommendation template. */
export function saveEscalationRule(
  orgId: string, ruleKey: string, name: string, eventKey: string,
  conditions: RuleCondition[], actions: RuleAction[], enabled: boolean
): Promise<DataResult> {
  return callRpc('escalation_rule_save', {
    p_org: orgId, p_rule_key: ruleKey, p_name: name, p_event_key: eventKey,
    p_conditions: conditions, p_actions: actions, p_enabled: enabled,
  }, NOT_CONFIGURED);
}

/** Convert or dismiss a proposal. Conversion links the created engagement; the gate is not bypassed. */
export function decideProposal(
  proposalId: string, status: 'converted' | 'dismissed', engagementId?: string | null
): Promise<DataResult> {
  return callRpc('work_queue_proposal_decide', {
    p_id: proposalId, p_status: status, p_engagement_id: engagementId ?? null,
  }, NOT_CONFIGURED);
}

export type { AutomationRule };

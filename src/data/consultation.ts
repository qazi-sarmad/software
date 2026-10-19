/**
 * Dual Session (F4). Extends support grants with a tier: a Super Admin consultant may help an
 * organisation's configuration, live, for a bounded time. Tier 1 ("config") applies an edit_config
 * change immediately; tier 2 ("full_admin"), invited by the client, only proposes the actions it
 * cannot apply. Neither tier grants audit content. Components never import the database client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type ConsultationKind = 'config' | 'full_admin';
export type ConsultationStatus = 'requested' | 'active' | 'ended' | 'expired';
export type InitiatedBy = 'platform' | 'tenant';

export interface ConsultationSession {
  id: string;
  orgId: string;
  kind: ConsultationKind;
  status: ConsultationStatus;
  initiatedBySide: InitiatedBy;
  expiresAt: string;
}

export interface ConsultationProposal {
  id: string;
  sessionId: string;
  action: string;
  payload: Record<string, unknown>;
  status: 'proposed' | 'approved' | 'rejected';
  reason: string | null;
}

export interface ConsultationEvent {
  id: number;
  eventKey: string;
  sessionId: string;
  payload: Record<string, unknown>;
  ts: string;
}

const NOT_CONFIGURED = 'The consultation module is not configured.';

/** The active session for an org, or null. Used by the persistent banner (GL-01). */
export async function getActiveConsultation(orgId: string): Promise<ConsultationSession | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('consultation_active', { p_org: orgId });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    orgId,
    kind: row.kind as ConsultationKind,
    status: row.status as ConsultationStatus,
    initiatedBySide: row.initiated_by_side as InitiatedBy,
    expiresAt: row.expires_at as string,
  };
}

export function requestConsultation(
  orgId: string, kind: ConsultationKind, durationHours: number
): Promise<DataResult & { sessionId?: string }> {
  return callRpcWithId(
    'consultation_request',
    { p_org: orgId, p_kind: kind, p_duration_hours: durationHours }
  );
}

export function acknowledgeConsultation(sessionId: string): Promise<DataResult> {
  return callRpc('consultation_acknowledge', { p_session: sessionId }, NOT_CONFIGURED);
}

export function endConsultation(sessionId: string, reason: string | null = null): Promise<DataResult> {
  return callRpc('consultation_end', { p_session: sessionId, p_reason: reason }, NOT_CONFIGURED);
}

export function proposeChange(
  sessionId: string, action: string, payload: Record<string, unknown>
): Promise<DataResult & { proposalId?: string }> {
  return callRpcWithId(
    'consultation_propose',
    { p_session: sessionId, p_action: action, p_payload: payload }
  );
}

export function decideProposal(proposalId: string, approve: boolean, reason: string | null = null): Promise<DataResult> {
  return callRpc(
    'consultation_decide_proposal',
    { p_proposal: proposalId, p_approve: approve, p_reason: reason },
    NOT_CONFIGURED
  );
}

async function callRpcWithId(
  name: string, args: Record<string, unknown>
): Promise<DataResult & { sessionId?: string; proposalId?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.rpc(name, args);
  if (error) return { ok: false, reason: error.message };
  const id = (data as string | null) ?? undefined;
  return name.includes('propose') ? { ok: true, proposalId: id } : { ok: true, sessionId: id };
}

/** Seconds left on a session, floored at zero. Drives the banner countdown. */
export function secondsLeft(expiresAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
}

/** "1 h 12 m" style remaining time for the banner. */
export function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m`;
  return `${seconds} s`;
}

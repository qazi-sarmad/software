/**
 * Change control data module (C3.2-A, spec §21). Every call goes through a typed function here;
 * components never import the database client (rule M8).
 *
 * A routine change applies immediately with a notification; a material change waits for the
 * configured approver and, once approved, is written to the hash-chained business ledger (L5).
 */
import { getClient, type DataResult } from './db';

const NOT_CONFIGURED = 'The change-control module is not configured.';

export interface ChangeControlSettings {
  approverRight: string;
  routineClasses: string[];
  slaHours: number;
  escalateRight: string;
}

export interface ChangeRow {
  id: string;
  klass: 'routine' | 'material';
  changeClass: string;
  title: string;
  status: 'pending' | 'applied' | 'approved' | 'rejected' | 'withdrawn';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  ledgerSeq: number | null;
}

export const DEFAULT_CHANGE_CONTROL: ChangeControlSettings = {
  approverRight: 'approve_plan',
  routineClasses: ['workpaper_reassign'],
  slaHours: 48,
  escalateRight: 'view_all_scopes',
};

export async function getChangeControlSettings(orgId: string): Promise<ChangeControlSettings> {
  const sb = getClient();
  if (!sb) return { ...DEFAULT_CHANGE_CONTROL };
  const { data, error } = await sb.rpc('change_control_get', { p_org: orgId });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { ...DEFAULT_CHANGE_CONTROL };
  return {
    approverRight: (row.approver_right as string) ?? DEFAULT_CHANGE_CONTROL.approverRight,
    routineClasses: Array.isArray(row.routine_classes) ? (row.routine_classes as unknown[]).map(String)
      : [...DEFAULT_CHANGE_CONTROL.routineClasses],
    slaHours: Number(row.sla_hours ?? DEFAULT_CHANGE_CONTROL.slaHours),
    escalateRight: (row.escalate_right as string) ?? DEFAULT_CHANGE_CONTROL.escalateRight,
  };
}

export async function saveChangeControlSettings(
  orgId: string,
  fields: { approverRight?: string; routineClasses?: string[]; slaHours?: number; escalateRight?: string },
): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { error } = await sb.rpc('change_control_save', {
    p_org: orgId,
    p_approver_right: fields.approverRight ?? null,
    p_routine_classes: fields.routineClasses ?? null,
    p_sla_hours: fields.slaHours ?? null,
    p_escalate_right: fields.escalateRight ?? null,
  });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

function toChange(r: Record<string, unknown>): ChangeRow {
  return {
    id: r.id as string,
    klass: r.klass as ChangeRow['klass'],
    changeClass: (r.change_class as string) ?? '',
    title: (r.title as string) ?? '',
    status: r.status as ChangeRow['status'],
    requestedBy: (r.requested_by as string | null) ?? null,
    requestedAt: r.requested_at as string,
    decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    rejectReason: (r.reject_reason as string | null) ?? null,
    ledgerSeq: r.ledger_seq === null || r.ledger_seq === undefined ? null : Number(r.ledger_seq),
  };
}

export async function listChanges(engagementId: string | null): Promise<ChangeRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('list_changes', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => toChange(r));
}

export async function requestChange(
  engagementId: string, changeClass: string, title: string,
  payload: Record<string, unknown> = {}, klass?: 'routine' | 'material',
): Promise<DataResult & { id?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.rpc('request_change', {
    p_engagement_id: engagementId, p_change_class: changeClass, p_title: title,
    p_payload: payload, p_klass: klass ?? null,
  });
  return error ? { ok: false, reason: error.message } : { ok: true, id: data as string };
}

export async function decideChange(
  requestId: string, approve: boolean, reason: string,
): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { error } = await sb.rpc('decide_change', {
    p_request_id: requestId, p_approve: approve, p_reason: reason,
  });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

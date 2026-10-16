/**
 * CAP register data module (6G, spec §16).
 *
 * The status vocabulary is the single set from migration 0038 (D-6D-CAP): open -> unverified ->
 * verified_closed | verified_closed_delay | overdue_unverified. Reconciliation and the close action
 * live in the database. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type CapStatus =
  | 'open' | 'verified_closed' | 'verified_closed_delay' | 'unverified' | 'overdue_unverified';

export interface CapRow {
  id: string;
  reportId: string | null;
  engagementId: string | null;
  findingId: string | null;
  issueId: string | null;
  responsibleDept: string | null;
  dueDate: string | null;
  actionDescription: string | null;
  remediationEvidence: string | null;
  status: CapStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

/** Record an action / evidence update; moves 'open' to 'unverified' (awaiting review). */
export function updateCap(capId: string, actionDescription: string, remediationEvidence: string): Promise<DataResult> {
  return callRpc('update_cap', {
    p_cap_id: capId, p_action_description: actionDescription, p_remediation_evidence: remediationEvidence,
  });
}

/** Close a CAP after review. verified=false leaves it unverified; delay flags a verified late close. */
export function closeCap(capId: string, verified: boolean, delay: boolean): Promise<DataResult> {
  return callRpc('close_cap', { p_cap_id: capId, p_verified: verified, p_delay: delay });
}

/** True when every finding/issue in the report has a CAP row with matching due dates. */
export async function checkCapReconciliation(reportVersionId: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('check_cap_reconciliation', { p_report_version_id: reportVersionId });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function listCaps(engagementId: string): Promise<CapRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('caps')
    .select('id, report_id, engagement_id, finding_id, issue_id, responsible_dept, due_date, action_description, remediation_evidence, status, verified_at, verified_by')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    reportId: (c.report_id as string | null) ?? null,
    engagementId: (c.engagement_id as string | null) ?? null,
    findingId: (c.finding_id as string | null) ?? null,
    issueId: (c.issue_id as string | null) ?? null,
    responsibleDept: (c.responsible_dept as string | null) ?? null,
    dueDate: (c.due_date as string | null) ?? null,
    actionDescription: (c.action_description as string | null) ?? null,
    remediationEvidence: (c.remediation_evidence as string | null) ?? null,
    status: (c.status as CapStatus) ?? 'open',
    verifiedAt: (c.verified_at as string | null) ?? null,
    verifiedBy: (c.verified_by as string | null) ?? null,
  }));
}

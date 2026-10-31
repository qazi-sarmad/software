import { callRpc, getClient, type DataResult } from './db';

/**
 * Right-to-erasure data module (WP15). The register is append-only; an executed erasure
 * pseudonymises subject identifiers in place and never rewrites the sealed, hash-chained record.
 */

export interface ErasureRequest {
  id: string;
  subjectEmail: string;
  status: 'pending' | 'blocked' | 'executed' | 'rejected';
  legalHold: boolean;
  requestedAt: string;
  executedAt: string | null;
}

export async function listErasureRequests(orgId: string): Promise<ErasureRequest[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('erasure_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    subjectEmail: (r.subject_email as string) ?? '',
    status: (r.status as ErasureRequest['status']) ?? 'pending',
    legalHold: Boolean(r.legal_hold),
    requestedAt: (r.requested_at as string) ?? '',
    executedAt: (r.executed_at as string | null) ?? null,
  }));
}

/** Raise an erasure request. Requires manage_users; reason required in the database. */
export function requestErasure(orgId: string, subjectEmail: string, reason: string): Promise<DataResult> {
  return callRpc('erasure_request', { p_org: orgId, p_subject_email: subjectEmail, p_reason: reason },
    'The erasure module is not configured.');
}

export function setErasureLegalHold(requestId: string, hold: boolean, reason: string): Promise<DataResult> {
  return callRpc('erasure_set_legal_hold', { p_request: requestId, p_hold: hold, p_reason: reason },
    'The erasure module is not configured.');
}

export function executeErasure(requestId: string, reason: string): Promise<DataResult> {
  return callRpc('erasure_execute', { p_request: requestId, p_reason: reason },
    'The erasure module is not configured.');
}

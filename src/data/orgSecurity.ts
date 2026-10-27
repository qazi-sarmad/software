/**
 * Tenant multi-factor authentication data module (0103, spec §25.2).
 *
 * The organisation's second-factor policy, plus the session's assurance level. The enforcement lives
 * in `custom_access_token_hook`: when the organisation requires a factor and the session has not
 * completed one, the hook withholds the org claims and RLS shows the member nothing. This module only
 * reads the posture and writes the switch; components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

const NOT_CONFIGURED = 'The security module is not configured.';

export interface OrgSecurityStatus {
  requireMfa: boolean;
  aal: 'aal1' | 'aal2';
  mfaSatisfied: boolean;
}

/** The organisation's second-factor posture and this session's assurance level. */
export async function getOrgSecurityStatus(): Promise<OrgSecurityStatus | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('org_security_status');
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return { requireMfa: false, aal: 'aal1', mfaSatisfied: true };
  return {
    requireMfa: Boolean(row.require_mfa),
    aal: row.aal === 'aal2' ? 'aal2' : 'aal1',
    mfaSatisfied: Boolean(row.mfa_satisfied),
  };
}

/** Set the organisation's second-factor requirement. Requires edit_config; a reason is mandatory. */
export function setRequireMfa(required: boolean, reason: string): Promise<DataResult> {
  return callRpc('admin_set_require_mfa', { p_required: required, p_reason: reason }, NOT_CONFIGURED);
}

export interface OrgSecurityVersionRow {
  requireMfa: boolean;
  reason: string;
  createdAt: string;
  prevHash: string | null;
  rowHash: string;
}

/** The append-only history of the second-factor requirement, newest first. */
export async function listOrgSecurityVersions(limit = 20): Promise<OrgSecurityVersionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('org_security_versions')
    .select('require_mfa, reason, created_at, prev_hash, row_hash')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    requireMfa: Boolean(r.require_mfa),
    reason: (r.reason as string) ?? '',
    createdAt: (r.created_at as string) ?? '',
    prevHash: (r.prev_hash as string | null) ?? null,
    rowHash: (r.row_hash as string) ?? '',
  }));
}

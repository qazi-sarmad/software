/**
 * External auditor portal data module (F13, S9).
 *
 * Every call goes through a typed function here; components never import the database client
 * (rule M8). The read surface is the security-definer ext_* family and the tenant-admin read pair in
 * migration 0066; the invite is written through external_auditor_invite and the matrix through
 * external_auditor_grants_save. The accept call is service-role only and is reached from the
 * invite-user Edge Function, so this module never calls it.
 */
import { callRpc, getClient, type DataResult } from './db';
import type {
  AuditorEngagement,
  ExternalAccessEntry,
  ExternalAuditorGrant,
  ExpiryKind,
} from '../lib/externalAuditors';

const NOT_CONFIGURED = 'The external auditor module is not configured.';

interface RawGrant {
  user_id: string;
  email: string;
  active: boolean;
  engagement_id: string | null;
  title: string | null;
  can_view_summary: boolean;
  can_download_pack: boolean;
  can_download_certificate: boolean;
  can_verify: boolean;
  expires_at: string | null;
  revoked_at: string | null;
}

function toGrant(raw: RawGrant): ExternalAuditorGrant {
  return {
    userId: raw.user_id,
    email: raw.email,
    active: raw.active,
    engagementId: raw.engagement_id,
    title: raw.title,
    canViewSummary: raw.can_view_summary,
    canDownloadPack: raw.can_download_pack,
    canDownloadCertificate: raw.can_download_certificate,
    canVerify: raw.can_verify,
    expiresAt: raw.expires_at,
    revokedAt: raw.revoked_at,
  };
}

/** The external auditors of an organisation, with their per-engagement grants (OA-14). */
export async function listExternalAuditors(orgId: string): Promise<ExternalAuditorGrant[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('external_auditor_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawGrant[]).map(toGrant);
}

/** The access log for an organisation, newest first (OA-14). */
export async function listExternalAccessLog(
  orgId: string, limit = 100
): Promise<ExternalAccessEntry[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('external_access_log_list', { p_org: orgId, p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    userId: (r.user_id as string) ?? null,
    engagementId: (r.engagement_id as string) ?? null,
    functionName: r.function_name as string,
    outcome: r.outcome as string,
    detail: (r.detail as Record<string, unknown>) ?? {},
    ts: r.ts as string,
  }));
}

/** Invite an external auditor by email. Needs edit_config and the external_auditors feature. */
export function inviteExternalAuditor(opts: {
  email: string;
  engagementIds: string[];
  expiryKind: ExpiryKind;
  accessDays: number;
}): Promise<DataResult> {
  return callRpc('external_auditor_invite', {
    p_email: opts.email,
    p_engagement_ids: opts.engagementIds,
    p_expiry_kind: opts.expiryKind,
    p_access_days: opts.accessDays,
  }, NOT_CONFIGURED);
}

/** Save the per-engagement permission matrix. Needs edit_config and the feature. */
export function saveExternalAuditorGrants(
  orgId: string,
  grants: { userId: string; engagementId: string; canViewSummary: boolean; canDownloadPack: boolean;
    canDownloadCertificate: boolean; canVerify: boolean; revoked?: boolean }[]
): Promise<DataResult> {
  return callRpc('external_auditor_grants_save', {
    p_org: orgId,
    p_grants: grants.map((g) => ({
      user_id: g.userId,
      engagement_id: g.engagementId,
      can_view_summary: g.canViewSummary,
      can_download_pack: g.canDownloadPack,
      can_download_certificate: g.canDownloadCertificate,
      can_verify: g.canVerify,
      revoked: g.revoked ?? false,
    })),
  }, NOT_CONFIGURED);
}

/** Revoke one grant, or the whole account when p_engagement_id is null. Needs edit_config. */
export function revokeExternalAuditor(
  orgId: string, userId: string, engagementId: string | null = null
): Promise<DataResult> {
  return callRpc('external_auditor_revoke', {
    p_org: orgId, p_user_id: userId, p_engagement_id: engagementId,
  }, NOT_CONFIGURED);
}

// --- The external auditor's own read surface (EX-02/EX-03/EX-04) --------------------------------

/** The engagements an external auditor may see. Empty when access is not active. */
export async function listMyEngagements(): Promise<AuditorEngagement[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('ext_list_engagements');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    engagementId: r.engagement_id as string,
    title: r.title as string,
    orgName: r.org_name as string,
    canDownloadPack: r.can_download_pack as boolean,
    canDownloadCertificate: r.can_download_certificate as boolean,
    expiresAt: (r.expires_at as string) ?? null,
  }));
}

/** The auditor's own account state, for the portal header. */
export async function getMyAccess(): Promise<{ email: string; orgName: string; active: boolean } | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('ext_me');
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as
    | { email: string; org_name: string; active: boolean }
    | undefined;
  if (!raw) return null;
  return { email: raw.email, orgName: raw.org_name, active: raw.active };
}

/** An engagement summary the auditor may see, or null when access is not granted. */
export async function getEngagementSummary(engagementId: string): Promise<{
  title: string; orgName: string; stage: string; sealed: boolean;
  sealedWorkpapers: number; findingsCount: number;
} | null> {
  const sb = getClient();
  if (!sb || !engagementId) return null;
  const { data, error } = await sb.rpc('ext_engagement_summary', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    title: raw.title as string,
    orgName: raw.org_name as string,
    stage: raw.stage as string,
    sealed: raw.sealed as boolean,
    sealedWorkpapers: raw.sealed_workpapers as number,
    findingsCount: raw.findings_count as number,
  };
}

/** The latest Board Pack hash for a granted engagement, or null when none or not permitted. */
export async function getLatestPack(engagementId: string): Promise<
  { packId: string; dataHash: string | null; generatedAt: string } | null
> {
  const sb = getClient();
  if (!sb || !engagementId) return null;
  const { data, error } = await sb.rpc('ext_latest_board_pack', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return { packId: raw.pack_id as string, dataHash: (raw.data_hash as string) ?? null, generatedAt: raw.generated_at as string };
}

/** The latest certificate hash for a granted engagement, or null when none or not permitted. */
export async function getLatestCertificate(engagementId: string): Promise<
  { certificateId: string; certHash: string | null; status: string; issuedAt: string } | null
> {
  const sb = getClient();
  if (!sb || !engagementId) return null;
  const { data, error } = await sb.rpc('ext_latest_certificate', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    certificateId: raw.certificate_id as string,
    certHash: (raw.cert_hash as string) ?? null,
    status: raw.status as string,
    issuedAt: raw.issued_at as string,
  };
}

/** Verify a certificate hash the auditor may verify. Returns null when it is not visible. */
export async function verifyExternalCertificate(certificateId: string): Promise<
  { status: string; certHash: string | null; issuedAt: string | null } | null
> {
  const sb = getClient();
  if (!sb || !certificateId) return null;
  const { data, error } = await sb.rpc('ext_verify_certificate', { p_certificate_id: certificateId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    status: raw.status as string,
    certHash: (raw.cert_hash as string) ?? null,
    issuedAt: (raw.issued_at as string) ?? null,
  };
}

/**
 * Does the signed-in session belong to an external auditor? The database decides: ext_me returns a
 * row only for a principal with an active external access row. A signed-in account with no org
 * membership that is not platform staff may still be an external auditor, so the shell asks this
 * before showing the "not provisioned" screen.
 */
export async function isExternalAuditorSession(): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('ext_me');
  if (error) return false;
  const row = (Array.isArray(data) ? data[0] : data) as { active?: boolean } | undefined;
  return Boolean(row?.active);
}

/**
 * Accept an external-auditor invitation (EX-01). Reached from the acceptance screen; the token is
 * presented to the invite-user Edge Function, which verifies the caller's session and binds the
 * account through external_auditor_accept (service-role only). The database keeps only the token
 * hash, and the token is never logged (F5).
 */
export async function acceptExternalInvite(token: string): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.functions.invoke('invite-user', {
    body: { action: 'accept-external', token },
  });
  if (error) return { ok: false, reason: error.message };
  const r = data as { ok?: boolean; reason?: string } | null;
  if (!r || r.ok !== true) return { ok: false, reason: r?.reason ?? 'The invitation could not be accepted.' };
  return { ok: true };
}

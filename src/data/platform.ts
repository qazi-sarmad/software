/**
 * Platform data module (C3, spec §24).
 *
 * The only place the Super Admin portal talks to the platform control plane. Components never
 * import the Supabase client. Every call goes through a platform RPC in migration 0031; the
 * database decides the caller's identity from the JWT (the platform exception, D-PLATFORM-RIGHTS),
 * so a tenant user's call is refused in the database, not in the browser.
 */
import { callRpc, getClient, type DataResult } from './db';


export interface TenantRow {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  featureFlags: Record<string, boolean>;
  createdAt: string;
}

export interface TrailRow {
  id: string;
  actorId: string | null;
  action: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
  ts: string;
}

export interface InviteCapRow {
  orgId: string;
  perUserDaily: number;
}

export interface SupportGrantRow {
  id: string;
  orgId: string;
  grantedBy: string | null;
  grantedAt: string;
  expiresAt: string;
  scope: Record<string, unknown>;
  revokedAt: string | null;
  revokeReason: string | null;
  platformActorId: string | null;
}

const NOT_CONFIGURED = 'The platform module is not configured.';

/** List tenants with their control-plane state. Empty when the module is not configured. */
export async function listTenants(): Promise<TenantRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_tenants');
  if (error) throw new Error(error.message);
  return (data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: (t.name as string) ?? '',
    status: (t.status as 'active' | 'suspended') ?? 'active',
    featureFlags: (t.feature_flags as Record<string, boolean>) ?? {},
    createdAt: t.created_at as string,
  }));
}

export async function listTrail(limit = 100): Promise<TrailRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_trail', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    actorId: (t.actor_id as string | null) ?? null,
    action: t.action as string,
    tenantId: (t.tenant_id as string | null) ?? null,
    payload: (t.payload as Record<string, unknown>) ?? {},
    ts: t.ts as string,
  }));
}

export function setTenantStatus(orgId: string, status: 'active' | 'suspended'): Promise<DataResult> {
  return callRpc('platform_set_tenant_status', { p_org: orgId, p_status: status }, NOT_CONFIGURED);
}

export function setFeatureFlag(orgId: string, flag: string, value: boolean): Promise<DataResult> {
  return callRpc('platform_set_feature_flag', { p_org: orgId, p_flag: flag, p_value: value }, NOT_CONFIGURED);
}

export function setInviteCap(orgId: string, perUserDaily: number): Promise<DataResult> {
  return callRpc('platform_set_invite_cap', { p_org: orgId, p_per_user_daily: perUserDaily }, NOT_CONFIGURED);
}

/** Create a tenant (WP3). Returns the new org id on success, or a DataResult with the refusal. */
export async function createTenant(
  name: string, initialAdminEmail: string, reason: string
): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await sb.rpc('platform_create_tenant', {
    p_name: name, p_initial_admin_email: initialAdminEmail, p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, orgId: data as string };
}

export function seedOrgRoles(orgId: string): Promise<DataResult> {
  return callRpc('platform_seed_org_roles', { p_org: orgId }, NOT_CONFIGURED);
}

export function configurePlatformEmailSender(
  displayName: string, fromAddress: string, replyTo: string | null, provider: string, reason: string
): Promise<DataResult> {
  return callRpc(
    'platform_configure_email_sender',
    {
      p_display_name: displayName, p_from_address: fromAddress, p_reply_to: replyTo,
      p_provider: provider, p_reason: reason,
    },
    NOT_CONFIGURED
  );
}

/** The structured readiness report for one tenant (WP3). Counts and booleans only. */
export interface ProvisioningStatus {
  orgId: string;
  rolesSeeded: number;
  rolesReady: boolean;
  status: string;
  active: boolean;
  entitlementsEnabled: number;
  inviteCap: number;
  invitesSent: number;
  hasInitialInvite: boolean;
  platformSenderReady: boolean;
  engagementCount: number;
  canCreateEngagement: boolean;
  ready: boolean;
}

export async function provisioningStatus(orgId: string): Promise<ProvisioningStatus | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('platform_provisioning_status', { p_org: orgId });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    orgId: (r.org_id as string) ?? orgId,
    rolesSeeded: Number(r.roles_seeded ?? 0),
    rolesReady: Boolean(r.roles_ready),
    status: (r.status as string) ?? 'active',
    active: Boolean(r.active),
    entitlementsEnabled: Number(r.entitlements_enabled ?? 0),
    inviteCap: Number(r.invite_cap ?? 0),
    invitesSent: Number(r.invites_sent ?? 0),
    hasInitialInvite: Boolean(r.has_initial_invite),
    platformSenderReady: Boolean(r.platform_sender_ready),
    engagementCount: Number(r.engagement_count ?? 0),
    canCreateEngagement: Boolean(r.can_create_engagement),
    ready: Boolean(r.ready),
  };
}

export function grantSupportAccess(
  orgId: string, scope: Record<string, unknown>, durationHours: number
): Promise<DataResult> {
  return callRpc(
    'platform_grant_support_access',
    { p_org: orgId, p_scope: scope, p_duration_hours: durationHours },
    NOT_CONFIGURED
  );
}

export function revokeSupportAccess(grantId: string, reason: string): Promise<DataResult> {
  return callRpc(
    'platform_revoke_support_access',
    { p_grant_id: grantId, p_reason: reason },
    NOT_CONFIGURED
  );
}

/** The signed-in session's platform identity, read from the JWT by the database. */
export async function platformWhoami(): Promise<{ userId: string | null; isPlatformAdmin: boolean }> {
  const sb = getClient();
  if (!sb) return { userId: null, isPlatformAdmin: false };
  const { data, error } = await sb.rpc('platform_whoami');
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return {
    userId: (row?.user_id as string | null) ?? null,
    isPlatformAdmin: Boolean(row?.is_platform_admin),
  };
}

export async function listInviteCaps(): Promise<InviteCapRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_get_invite_caps');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    orgId: r.org_id as string,
    perUserDaily: r.per_user_daily as number,
  }));
}

export async function listSupportGrants(): Promise<SupportGrantRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_support_grants');
  if (error) throw new Error(error.message);
  return (data ?? []).map((g: Record<string, unknown>) => ({
    id: g.id as string,
    orgId: g.org_id as string,
    grantedBy: (g.granted_by as string | null) ?? null,
    grantedAt: g.granted_at as string,
    expiresAt: g.expires_at as string,
    scope: (g.scope as Record<string, unknown>) ?? {},
    revokedAt: (g.revoked_at as string | null) ?? null,
    revokeReason: (g.revoke_reason as string | null) ?? null,
    platformActorId: (g.platform_actor_id as string | null) ?? null,
  }));
}

/** One scheduled job and its last run (C2.2, SA-02). */
export interface JobHealthRow {
  jobId: number;
  jobName: string;
  schedule: string;
  active: boolean;
  command: string;
  lastStart: string | null;
  lastEnd: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
}

/**
 * Every scheduled job and its last run. Platform administrators only; the database refuses anyone
 * else. When pg_cron is absent the reader returns an empty list, which the screen shows as
 * "no scheduled jobs" rather than an error.
 */
export async function listJobHealth(): Promise<JobHealthRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_job_health');
  if (error) throw new Error(error.message);
  return (data ?? []).map((j: Record<string, unknown>) => ({
    jobId: Number(j.job_id),
    jobName: (j.job_name as string) ?? '',
    schedule: (j.schedule as string) ?? '',
    active: Boolean(j.active),
    command: (j.command as string) ?? '',
    lastStart: (j.last_start as string | null) ?? null,
    lastEnd: (j.last_end as string | null) ?? null,
    lastStatus: (j.last_status as string | null) ?? null,
    lastMessage: (j.last_message as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// C2.9: the tenant-granted, read-only support session (spec §24).
// ---------------------------------------------------------------------------

/** One object a support session read, as returned by support_read_object. */
export interface SupportObject {
  objectKind: string;
  objectId: string;
  label: string;
  detail: Record<string, unknown>;
}

/** One engagement a support session may read, as returned by support_list_engagements. */
export interface SupportEngagement {
  engagementId: string;
  title: string;
  stage: string;
  sealed: boolean;
  orgName: string;
}

/** One row of a tenant's own support trail, as returned by support_access_log_list. */
export interface SupportAccessLogRow {
  id: string;
  grantId: string | null;
  actorId: string | null;
  functionName: string;
  objectKind: string | null;
  objectId: string | null;
  outcome: 'ok' | 'denied';
  createdAt: string;
}

/**
 * True when the signed-in platform administrator holds a live content_read grant for the org. Reads
 * support_grant_active, which is null for everyone else and for an expired or revoked grant.
 */
export async function supportGrantActive(orgId: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('support_grant_active', { p_org: orgId });
  if (error) throw new Error(error.message);
  return data != null;
}

/** The engagements of an org the caller holds a live content_read grant for. Empty otherwise. */
export async function supportListEngagements(orgId: string): Promise<SupportEngagement[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('support_list_engagements', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: Record<string, unknown>) => ({
    engagementId: e.engagement_id as string,
    title: (e.title as string) ?? '',
    stage: (e.stage as string) ?? '',
    sealed: Boolean(e.sealed),
    orgName: (e.org_name as string) ?? '',
  }));
}

/** Read one object (engagement, workpaper, population, finding) inside the grant's org. */
export async function supportReadObject(
  kind: string, objectId: string, orgId: string
): Promise<SupportObject[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('support_read_object', {
    p_kind: kind, p_id: objectId, p_org: orgId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((o: Record<string, unknown>) => ({
    objectKind: (o.object_kind as string) ?? '',
    objectId: o.object_id as string,
    label: (o.label as string) ?? '',
    detail: (o.detail as Record<string, unknown>) ?? {},
  }));
}

/** The tenant's own support trail: who read what, and every refusal. */
export async function supportAccessLog(orgId: string, limit = 100): Promise<SupportAccessLogRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('support_access_log_list', { p_org: orgId, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data ?? []).map((l: Record<string, unknown>) => ({
    id: l.id as string,
    grantId: (l.grant_id as string | null) ?? null,
    actorId: (l.actor_id as string | null) ?? null,
    functionName: (l.function_name as string) ?? '',
    objectKind: (l.object_kind as string | null) ?? null,
    objectId: (l.object_id as string | null) ?? null,
    outcome: (l.outcome as 'ok' | 'denied') ?? 'denied',
    createdAt: (l.created_at as string) ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Security & enterprise posture (WP9, WP14, WP15, WP16). All platform-scope: every RPC checks the
// platform role and the second factor (require_platform_admin) in the database.
// ---------------------------------------------------------------------------

export interface SecurityStatus {
  requirePlatformMfa: boolean;
  adminPath: string;
  sessionMaxAgeMinutes: number;
  aal: string;
  mfaSatisfied: boolean;
}

/** The platform security posture. Readable at any AAL so the console can tell an admin to enrol. */
export async function getSecurityStatus(): Promise<SecurityStatus | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('platform_security_status');
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    requirePlatformMfa: Boolean(row.require_platform_mfa),
    adminPath: (row.admin_path as string) ?? '/superadmin',
    sessionMaxAgeMinutes: Number(row.session_max_age_minutes ?? 60),
    aal: (row.aal as string) ?? 'aal1',
    mfaSatisfied: Boolean(row.mfa_satisfied),
  };
}

/** Change one platform security setting. The database requires AAL2 and a reason. */
export function setSecuritySetting(
  key: 'require_platform_mfa' | 'admin_path' | 'session_max_age_minutes',
  value: unknown,
  reason: string
): Promise<DataResult> {
  return callRpc('platform_set_security_setting', { p_key: key, p_value: value, p_reason: reason }, NOT_CONFIGURED);
}

export interface DrSettings {
  pitrEnabled: boolean;
  backupFrequency: string;
  retentionDays: number;
  recoveryTestIntervalDays: number;
  lastRecoveryTestAt: string | null;
  nextRecoveryTestDue: string | null;
  rpoMinutes: number;
  rtoMinutes: number;
  notes: string | null;
}

export async function getDrSettings(): Promise<DrSettings | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('platform_get_dr_settings');
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    pitrEnabled: Boolean(r.pitr_enabled),
    backupFrequency: (r.backup_frequency as string) ?? 'daily',
    retentionDays: Number(r.retention_days ?? 7),
    recoveryTestIntervalDays: Number(r.restore_test_interval_days ?? 90),
    lastRecoveryTestAt: (r.last_restore_test_at as string | null) ?? null,
    nextRecoveryTestDue: (r.next_restore_test_due as string | null) ?? null,
    rpoMinutes: Number(r.rpo_minutes ?? 1440),
    rtoMinutes: Number(r.rto_minutes ?? 240),
    notes: (r.notes as string | null) ?? null,
  };
}

export function setDrSetting(key: string, value: unknown, reason: string): Promise<DataResult> {
  return callRpc('platform_set_dr_setting', { p_key: key, p_value: value, p_reason: reason }, NOT_CONFIGURED);
}

export function logRecoveryTest(note: string, at: string): Promise<DataResult> {
  return callRpc('platform_record_restore_test', { p_note: note, p_at: at }, NOT_CONFIGURED);
}

export interface ResidencyRegion {
  code: string;
  label: string;
  enabled: boolean;
}

export async function listResidencyRegions(): Promise<ResidencyRegion[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_residency_regions');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    code: r.code as string,
    label: (r.label as string) ?? '',
    enabled: Boolean(r.enabled),
  }));
}

export function setResidency(orgId: string, region: string | null, reason: string): Promise<DataResult> {
  return callRpc('platform_set_residency', { p_org: orgId, p_region: region, p_reason: reason }, NOT_CONFIGURED);
}

export interface SigningAlgorithm {
  code: string;
  label: string;
  status: 'active' | 'deprecated' | 'planned';
  rotationDays: number;
  isDefault: boolean;
}

export async function listSigningAlgorithms(): Promise<SigningAlgorithm[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_signing_algorithms');
  if (error) throw new Error(error.message);
  return (data ?? []).map((a: Record<string, unknown>) => ({
    code: a.code as string,
    label: (a.label as string) ?? '',
    status: (a.status as SigningAlgorithm['status']) ?? 'planned',
    rotationDays: Number(a.rotation_days ?? 365),
    isDefault: Boolean(a.is_default),
  }));
}

export interface DueKey {
  keyId: string;
  scope: string;
  orgId: string | null;
  algorithm: string;
  keyVersion: number;
  rotateAfter: string;
}

/** The keys whose rotation is due at `at`. Time is an argument, never the clock. */
export async function signingKeysDue(at: string): Promise<DueKey[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_signing_keys_due', { p_now: at });
  if (error) throw new Error(error.message);
  return (data ?? []).map((k: Record<string, unknown>) => ({
    keyId: k.key_id as string,
    scope: (k.scope as string) ?? 'org',
    orgId: (k.org_id as string | null) ?? null,
    algorithm: (k.algorithm as string) ?? 'Ed25519',
    keyVersion: Number(k.key_version ?? 1),
    rotateAfter: (k.rotate_after as string) ?? '',
  }));
}

export function rotateSigningKey(
  keyId: string, newKeyId: string, newPublicKey: string, algorithm: string, reason: string, at: string
): Promise<DataResult> {
  return callRpc(
    'platform_rotate_signing_key',
    { p_key_id: keyId, p_new_key_id: newKeyId, p_new_public_key: newPublicKey, p_algorithm: algorithm, p_reason: reason, p_now: at },
    NOT_CONFIGURED
  );
}

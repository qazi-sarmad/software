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
  aiEnabled: boolean;
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
    aiEnabled: Boolean(t.ai_enabled),
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

export function enableAi(orgId: string, enabled: boolean, endpoint: string | null = null): Promise<DataResult> {
  return callRpc('platform_enable_ai', { p_org: orgId, p_enabled: enabled, p_endpoint: endpoint }, NOT_CONFIGURED);
}

export function setInviteCap(orgId: string, perUserDaily: number): Promise<DataResult> {
  return callRpc('platform_set_invite_cap', { p_org: orgId, p_per_user_daily: perUserDaily }, NOT_CONFIGURED);
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

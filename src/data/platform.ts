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

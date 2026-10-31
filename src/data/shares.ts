/**
 * Group / joint-audit sharing data module (§2, SCALE-1 WP2).
 *
 * The corrected §2 model: a joint audit may span associated (group) companies and is shared with
 * edit rights to both. Association is platform-owned; a share needs the `manage_engagements` right
 * and a recorded association. Every rule is enforced in the database (migration 0102); this module
 * is the only place the UI reaches them. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

/** A joint-audit share this organisation has granted out. */
export interface JointShareRow {
  id: string;
  engagementId: string;
  engagementTitle: string;
  ownerOrgId: string;
  counterpartyOrgId: string;
  counterpartyName: string;
  rights: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  live: boolean;
}

/** A joint-audit share granted to this organisation. */
export interface JointShareWithMeRow {
  id: string;
  engagementId: string;
  engagementTitle: string;
  ownerOrgId: string;
  ownerName: string;
  rights: string;
  grantedAt: string;
  expiresAt: string | null;
  live: boolean;
}

/** A configuration distribution from the group parent to a member. */
export interface ConfigDistributionRow {
  id: string;
  parentOrgId: string;
  parentName: string;
  memberOrgId: string;
  memberName: string;
  keys: string[];
  distributedAt: string;
  revokedAt: string | null;
}

const NOT_CONFIGURED = 'The data module is not configured.';

function mapShare(row: Record<string, unknown>): JointShareRow {
  return {
    id: row.id as string,
    engagementId: row.engagement_id as string,
    engagementTitle: (row.engagement_title as string) ?? '',
    ownerOrgId: row.owner_org_id as string,
    counterpartyOrgId: row.counterparty_org_id as string,
    counterpartyName: (row.counterparty_name as string) ?? '',
    rights: (row.rights as string) ?? 'edit',
    grantedAt: row.granted_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    revokeReason: (row.revoke_reason as string | null) ?? null,
    live: row.live === true,
  };
}

/** The joint-audit shares this organisation has granted. Empty when the module is not configured. */
export async function listJointShares(): Promise<JointShareRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('joint_shares_get');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map(mapShare);
}

/** The joint-audit shares granted to this organisation. */
export async function listJointSharesWithMe(): Promise<JointShareWithMeRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('joint_shares_with_me');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    engagementId: row.engagement_id as string,
    engagementTitle: (row.engagement_title as string) ?? '',
    ownerOrgId: row.owner_org_id as string,
    ownerName: (row.owner_name as string) ?? '',
    rights: (row.rights as string) ?? 'edit',
    grantedAt: row.granted_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    live: row.live === true,
  }));
}

/** Share one engagement with an associated counterparty, with edit rights to both. */
export async function grantJointShare(
  engagementId: string, counterpartyOrgId: string, expiresAt: string | null
): Promise<DataResult & { id?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.rpc('joint_share_grant', {
    p_engagement_id: engagementId, p_counterparty_org_id: counterpartyOrgId, p_expires_at: expiresAt,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: (data as string) ?? undefined };
}

/** Revoke a joint-audit share. The reason is recorded. */
export async function revokeJointShare(shareId: string, reason: string): Promise<DataResult> {
  return callRpc('joint_share_revoke', { p_share_id: shareId, p_reason: reason }, NOT_CONFIGURED);
}

/** An engagement this organisation may share into a joint audit (an RLS-scoped read). */
export interface ShareableEngagement {
  id: string;
  title: string;
}

/**
 * The engagements the caller may start a joint audit on. This reads the `engagements` table directly,
 * so the row set is exactly what RLS admits for the session (own org, or a live joint share). The
 * listbox must offer real database ids: a client-side demo id is not a uuid and the grant RPC
 * refuses it.
 */
export async function listShareableEngagements(): Promise<ShareableEngagement[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('engagements').select('id, title').order('title');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    title: (r.title as string) ?? '',
  }));
}

/** An organisation associated with the caller's org (a group company). */
export interface AssociatedOrg {
  id: string;
  name: string;
}

/** The associated organisations (group companies) of the caller's org. */
export async function listAssociatedOrgs(): Promise<AssociatedOrg[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('my_associated_orgs');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? '',
  }));
}

/** The configuration distributions this organisation has sent or received. */
export async function listConfigDistributions(): Promise<ConfigDistributionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('group_config_distributions');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    parentOrgId: row.parent_org_id as string,
    parentName: (row.parent_name as string) ?? '',
    memberOrgId: row.member_org_id as string,
    memberName: (row.member_name as string) ?? '',
    keys: (row.keys as string[]) ?? [],
    distributedAt: row.distributed_at as string,
    revokedAt: (row.revoked_at as string | null) ?? null,
  }));
}

/** Distribute the current configuration snapshot to a member of the caller's group (parent only). */
export async function distributeConfig(
  memberOrgId: string, keys: string[] | null
): Promise<DataResult & { id?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.rpc('group_distribute_config', {
    p_member_org_id: memberOrgId, p_keys: keys,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: (data as string) ?? undefined };
}

/** Adopt a distribution into this organisation's own configuration history. Returns the key count. */
export async function adoptConfig(distributionId: string): Promise<DataResult & { keys?: number }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.rpc('group_adopt_config', { p_distribution_id: distributionId });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, keys: (data as number) ?? 0 };
}

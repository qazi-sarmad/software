/**
 * Cross-universe view-only sharing (§2, SCALE-1 WP2).
 *
 * A share is granted by a Level-1 or Level-2 Head, carries an optional expiry, and is revocable by
 * the granting Head, a higher Head or an Org Admin. Every rule is enforced in the database
 * (migration 0095): this module is the only place the UI reaches them. Components never import the
 * Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface ShareRow {
  id: string;
  universeId: string;
  universeName: string;
  granteeUserId: string;
  grantedBy: string | null;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

/** A share granted to the caller: the grantee's own view. */
export interface ShareWithMeRow {
  id: string;
  universeId: string;
  universeName: string;
  grantedBy: string | null;
  grantedAt: string;
  expiresAt: string | null;
  live: boolean;
}

export interface SharedUniverseView {
  universeId: string;
  live: boolean;
  entities: Array<{ id: string; name: string; status: string }>;
  engagements: Array<{ id: string; title: string; stage: string }>;
}

function toShare(row: Record<string, unknown>): ShareRow {
  return {
    id: row.id as string,
    universeId: row.universe_id as string,
    universeName: (row.universe_name as string) ?? '',
    granteeUserId: row.grantee_user_id as string,
    grantedBy: (row.granted_by as string | null) ?? null,
    grantedAt: row.granted_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    revokeReason: (row.revoke_reason as string | null) ?? null,
  };
}

/** The shares this organisation has granted. Empty when the module is not configured. */
export async function listShares(): Promise<ShareRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('shares_get');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map(toShare);
}

/** The shares granted to the signed-in user. */
export async function listSharesWithMe(): Promise<ShareWithMeRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('shares_with_me');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    universeId: row.universe_id as string,
    universeName: (row.universe_name as string) ?? '',
    grantedBy: (row.granted_by as string | null) ?? null,
    grantedAt: row.granted_at as string,
    expiresAt: (row.expires_at as string | null) ?? null,
    live: row.live === true,
  }));
}

/** Grant a view-only share. Returns the new share id, or a reason. */
export async function grantShare(
  universeId: string, granteeUserId: string, expiresAt: string | null
): Promise<DataResult & { id?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'The data module is not configured.' };
  const { data, error } = await sb.rpc('share_grant', {
    p_universe_id: universeId, p_grantee_user_id: granteeUserId, p_expires_at: expiresAt,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: (data as string) ?? undefined };
}

/** Revoke a share. The reason is required by the database. */
export async function revokeShare(shareId: string, reason: string): Promise<DataResult> {
  return callRpc('share_revoke', { p_share_id: shareId, p_reason: reason });
}

/** The read-only projection of a shared universe. Throws nothing; returns an empty view on refusal. */
export async function viewSharedUniverse(shareId: string): Promise<SharedUniverseView | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('shared_universe_view', { p_share_id: shareId });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    universeId: d.universe_id as string,
    live: d.live === true,
    entities: (d.entities as SharedUniverseView['entities']) ?? [],
    engagements: (d.engagements as SharedUniverseView['engagements']) ?? [],
  };
}

/** Set the Head flag on a member (none, 1 or 2). Org Admin only, enforced in the database. */
export async function setHeadLevel(userId: string, level: number | null): Promise<DataResult> {
  return callRpc('admin_set_head_level', { p_user: userId, p_level: level });
}

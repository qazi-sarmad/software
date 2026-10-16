/**
 * Administration data module (2H-UI, spec §23).
 *
 * The only place the People & Roles pages talk to the database. Components never import the
 * Supabase client (spec §25.1). Every write goes through an RPC in migration 0017, so the
 * database decides the right the caller needs; this module only carries the request.
 */
import { getClient } from './client';
import type { Right } from '../lib/rights';

export interface MemberRow {
  userId: string;
  displayName: string;
  roleSlug: string;
  roleName: string;
  hierarchyLevel: number | null;
  managerId: string | null;
}

export interface RoleRow {
  id: string;
  slug: string;
  name: string;
  isSeed: boolean;
  rights: Partial<Record<Right, boolean>>;
}

export interface ScopeRow {
  id: string;
  userId: string;
  universeId: string | null;
  entityId: string | null;
  engagementId: string | null;
}

export type AdminResult = { ok: true } | { ok: false; reason: string };

const NOT_CONFIGURED: AdminResult = { ok: false, reason: 'Administration is not configured.' };

/** The rights keys a role row carries, as a plain boolean map for the matrix UI. */
export function rightsOfRoleRow(row: RoleRow): Record<string, boolean> {
  return { ...(row.rights ?? {}) };
}

export async function listMembers(): Promise<MemberRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('org_members')
    .select('user_id, display_name, hierarchy_level, manager_id, roles(slug, name)')
    .order('display_name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((m) => {
    const role = m.roles as unknown as { slug: string; name: string } | null;
    return {
      userId: m.user_id as string,
      displayName: (m.display_name as string) ?? '',
      roleSlug: role?.slug ?? '',
      roleName: role?.name ?? '',
      hierarchyLevel: (m.hierarchy_level as number | null) ?? null,
      managerId: (m.manager_id as string | null) ?? null,
    };
  });
}

export async function listRoles(): Promise<RoleRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('roles')
    .select('id, slug, name, is_seed, rights')
    .order('is_seed', { ascending: false })
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    isSeed: !!r.is_seed,
    rights: (r.rights as Record<string, boolean>) ?? {},
  }));
}

export async function listScopes(): Promise<ScopeRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('user_scopes')
    .select('id, user_id, universe_id, entity_id, engagement_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id as string,
    userId: s.user_id as string,
    universeId: (s.universe_id as string | null) ?? null,
    entityId: (s.entity_id as string | null) ?? null,
    engagementId: (s.engagement_id as string | null) ?? null,
  }));
}

async function callRpc(name: string, args: Record<string, unknown>): Promise<AdminResult> {
  const sb = getClient();
  if (!sb) return NOT_CONFIGURED;
  const { error } = await sb.rpc(name, args);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export function provisionMember(
  userId: string, displayName: string, roleSlug: string, hierarchyLevel: number | null = null
): Promise<AdminResult> {
  return callRpc('admin_provision_member', {
    p_user: userId, p_display_name: displayName, p_role_slug: roleSlug, p_hierarchy_level: hierarchyLevel,
  });
}

export function setMemberRole(userId: string, roleSlug: string): Promise<AdminResult> {
  return callRpc('admin_set_member_role', { p_user: userId, p_role_slug: roleSlug });
}

export function setMemberManager(userId: string, managerId: string | null): Promise<AdminResult> {
  return callRpc('admin_set_member_manager', { p_user: userId, p_manager: managerId });
}

export function grantScope(
  userId: string, universeId: string | null, entityId: string | null, engagementId: string | null
): Promise<AdminResult> {
  return callRpc('admin_grant_scope', {
    p_user: userId, p_universe: universeId, p_entity: entityId, p_engagement: engagementId,
  });
}

export function revokeScope(scopeId: string): Promise<AdminResult> {
  return callRpc('admin_revoke_scope', { p_scope: scopeId });
}

export function createRole(name: string, slug: string, rights: Record<string, boolean>): Promise<AdminResult> {
  return callRpc('admin_create_role', { p_name: name, p_slug: slug, p_rights: rights });
}

export function updateRoleRights(slug: string, rights: Record<string, boolean>): Promise<AdminResult> {
  return callRpc('admin_update_role_rights', { p_slug: slug, p_rights: rights });
}

export function deleteRole(slug: string): Promise<AdminResult> {
  return callRpc('admin_delete_role', { p_slug: slug });
}

export function setInviteCap(perUserDaily: number): Promise<AdminResult> {
  return callRpc('admin_set_invite_cap', { p_per_user_daily: perUserDaily });
}

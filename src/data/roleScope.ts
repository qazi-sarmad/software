/**
 * Scoped role and access data module (owner instruction 2026-10-30).
 *
 * The only place the scoped-roles screen talks to the database. The pure model lives in
 * `src/lib/roleAccess.ts`; this module carries the reads and the writes to the RPCs in migration 0199.
 * Every write goes through an RPC, so the database decides the right the caller needs (manage_roles to
 * configure a default, manage_users to assign a role) and pins the row to the session org.
 *
 * With no Supabase environment every function is inert: reads return empty, a write reports that the
 * module is not configured. A component never imports the client.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import type { RoleAssignment, ScopeDefault, ScopeKind } from '../lib/roleAccess';

export type ScopeResult = DataResult;

interface DefaultRow {
  id: string;
  scope_kind: string;
  universe_id: string | null;
  universe_name: string | null;
  engagement_id: string | null;
  engagement_title: string | null;
  role_slug: string;
  role_name: string | null;
  is_default: boolean;
  version: number;
}

interface AssignmentRow {
  id: string;
  user_id: string;
  scope_kind: string;
  universe_id: string | null;
  universe_name: string | null;
  engagement_id: string | null;
  engagement_title: string | null;
  role_slug: string;
  role_name: string | null;
  is_default: boolean;
  reason: string | null;
}

/** A default as the screen shows it: the configured row plus the names the reader resolved. */
export interface ScopeDefaultView extends ScopeDefault {
  universeName: string | null;
  engagementTitle: string | null;
  roleName: string;
  version: number;
}

/** An assignment as the screen shows it. */
export interface RoleAssignmentView extends RoleAssignment {
  universeName: string | null;
  engagementTitle: string | null;
  roleName: string;
  reason: string;
}

function asScopeKind(kind: string): ScopeKind {
  return kind === 'universe' || kind === 'engagement' ? kind : 'org';
}

export async function listScopeDefaults(): Promise<ScopeDefaultView[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('role_scope_defaults_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as DefaultRow[]).map((d) => ({
    id: d.id,
    scopeKind: asScopeKind(d.scope_kind),
    universeId: d.universe_id,
    engagementId: d.engagement_id,
    roleSlug: d.role_slug,
    isDefault: !!d.is_default,
    universeName: d.universe_name,
    engagementTitle: d.engagement_title,
    roleName: d.role_name ?? d.role_slug,
    version: d.version,
  }));
}

export async function listRoleAssignments(): Promise<RoleAssignmentView[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('role_assignments_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as AssignmentRow[]).map((a) => ({
    id: a.id,
    userId: a.user_id,
    scopeKind: asScopeKind(a.scope_kind),
    universeId: a.universe_id,
    engagementId: a.engagement_id,
    roleSlug: a.role_slug,
    isDefault: !!a.is_default,
    universeName: a.universe_name,
    engagementTitle: a.engagement_title,
    roleName: a.role_name ?? a.role_slug,
    reason: a.reason ?? '',
  }));
}

/** Configure (or re-configure) the default role at a scope. Requires manage_roles. */
export function setScopeDefault(
  scopeKind: ScopeKind, universeId: string | null, engagementId: string | null,
  roleSlug: string, isDefault = true, reason = '',
): Promise<ScopeResult> {
  return callRpc('role_scope_default_set', {
    p_scope_kind: scopeKind, p_universe: universeId, p_engagement: engagementId,
    p_role_slug: roleSlug, p_is_default: isDefault, p_reason: reason,
  });
}

export function clearScopeDefault(id: string): Promise<ScopeResult> {
  return callRpc('role_scope_default_clear', { p_id: id });
}

/**
 * Give a person a role at a scope. With no `roleSlug` the scope's configured default is applied —
 * the database resolves the nearest enabled default and reports how many roles it applied.
 */
export function assignRole(
  userId: string, scopeKind: ScopeKind, universeId: string | null, engagementId: string | null,
  roleSlug: string | null = null, reason = '',
): Promise<ScopeResult> {
  return callRpc('role_assign', {
    p_user: userId, p_scope_kind: scopeKind, p_universe: universeId, p_engagement: engagementId,
    p_role_slug: roleSlug, p_reason: reason,
  });
}

export function unassignRole(id: string): Promise<ScopeResult> {
  return callRpc('role_unassign', { p_id: id });
}

/** The effective access of a person at an engagement, as the database resolves it. */
export async function effectiveAccess(userId: string, engagementId: string | null): Promise<{ source: string; roleSlugs: string[]; rights: Record<string, boolean> } | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('role_effective', { p_user: userId, p_engagement: engagementId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { source?: string; role_slugs?: unknown; rights?: unknown };
  return {
    source: d.source ?? 'none',
    roleSlugs: Array.isArray(d.role_slugs) ? (d.role_slugs as string[]) : [],
    rights: (d.rights ?? {}) as Record<string, boolean>,
  };
}

export { NOT_CONFIGURED_REASON };

/**
 * The universes and engagements a scope can name, in one read. Kept here rather than reusing the
 * universe reader so the scoped-roles screen makes exactly one call per concern; the engagement read
 * carries its universe id, which the pure model needs to walk the fallback chain.
 */
export async function listScopeTargets(): Promise<{
  universes: { id: string; name: string }[];
  engagements: { id: string; title: string; universeId: string }[];
}> {
  const sb = getClient();
  if (!sb) return { universes: [], engagements: [] };
  const [u, e] = await Promise.all([
    sb.from('universes').select('id, name').order('name'),
    sb.from('engagements').select('id, title, universe_id').order('title'),
  ]);
  if (u.error) throw new Error(u.error.message);
  if (e.error) throw new Error(e.error.message);
  return {
    universes: ((u.data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name })),
    engagements: ((e.data ?? []) as { id: string; title: string; universe_id: string }[]).map((r) => ({
      id: r.id, title: r.title, universeId: r.universe_id,
    })),
  };
}

/**
 * The scoped role and access model (owner instruction 2026-10-30).
 *
 * A role is not one property of a membership. The same person is a Reviewer on one engagement, the
 * Preparer on another, and a read-only Observer on a third, and each organisation chooses the default
 * it applies at the org, at a universe and at a single engagement. This module is the pure arithmetic
 * that turns configured rows into that answer, so the screen can explain a decision without asking the
 * database to re-derive it and without comparing a role name anywhere (the 2F-2b rule).
 *
 * The resolution is the database's, restated in TypeScript for the screen and the unit tests:
 * the most specific scope that has a grant wins (engagement, then universe, then org), the rights of
 * every role granted at that scope are unioned, and with no scoped grant the membership role stands.
 * `src/lib/roleAccess.test.ts` and `supabase/tests/143_role_scope_config.sql` prove the two agree.
 *
 * Pure: no clock, no randomness, no DOM, no network.
 */
import type { Role } from '../types';
import { RIGHTS, rightsForRole, type Right } from './rights';

export type ScopeKind = 'org' | 'universe' | 'engagement';

export const SCOPE_KINDS: readonly ScopeKind[] = ['org', 'universe', 'engagement'];

export const SCOPE_LABELS: Record<ScopeKind, string> = {
  org: 'Whole organisation',
  universe: 'A universe',
  engagement: 'One engagement',
};

/** A configured default: which role applies at which scope. */
export interface ScopeDefault {
  id: string;
  scopeKind: ScopeKind;
  universeId: string | null;
  engagementId: string | null;
  roleSlug: string;
  isDefault: boolean;
}

/** A role a named person holds at a scope. */
export interface RoleAssignment {
  id: string;
  userId: string;
  scopeKind: ScopeKind;
  universeId: string | null;
  engagementId: string | null;
  roleSlug: string;
  isDefault: boolean;
}

/** The rights map for a role slug, resolved against the org's own role definitions. */
export type RightsByRole = Record<string, Partial<Record<Right, boolean>>>;

export interface EffectiveAccess {
  /** Which scope supplied the answer: `engagement`, `universe`, `org`, `membership` or `none`. */
  source: ScopeKind | 'membership' | 'none';
  /** The role slugs that produced the rights, in a stable order. */
  roleSlugs: string[];
  /** The union of those roles' rights. */
  rights: Partial<Record<Right, boolean>>;
}

/** True when the scope row's target matches the query's target. */
function matches(a: { universeId: string | null; engagementId: string | null }, universeId: string | null, engagementId: string | null): boolean {
  return a.universeId === universeId && a.engagementId === engagementId;
}

/**
 * The roles a person holds at a scope. Only the exact scope is considered; the fallback between
 * scopes is the caller's (`resolveAccess`), so each step is legible.
 */
export function rolesAt(
  assignments: readonly RoleAssignment[], userId: string, scopeKind: ScopeKind,
  universeId: string | null = null, engagementId: string | null = null,
): string[] {
  return assignments
    .filter((a) => a.userId === userId && a.scopeKind === scopeKind && matches(a, universeId, engagementId))
    .map((a) => a.roleSlug)
    .sort();
}

/** The union of the rights of a set of roles, from the org's own role definitions. */
export function unionRights(roleSlugs: readonly string[], rightsByRole: RightsByRole): Partial<Record<Right, boolean>> {
  const out: Partial<Record<Right, boolean>> = {};
  for (const slug of roleSlugs) {
    const map = rightsByRole[slug] ?? {};
    for (const right of RIGHTS) if (map[right] === true) out[right] = true;
  }
  return out;
}

/**
 * Resolve a person's effective access at an engagement (or at the org when `engagementId` is null).
 *
 * `universeId` is the engagement's universe; the caller supplies it because this module holds no
 * database. When it is unknown and an engagement is given, the universe step is skipped, which is
 * correct: a scope the caller cannot name cannot be consulted.
 */
export function resolveAccess(
  assignments: readonly RoleAssignment[],
  membershipRole: Role | null,
  rightsByRole: RightsByRole,
  userId: string,
  universeId: string | null,
  engagementId: string | null,
): EffectiveAccess {
  if (engagementId) {
    const slugs = rolesAt(assignments, userId, 'engagement', null, engagementId);
    if (slugs.length > 0) return { source: 'engagement', roleSlugs: slugs, rights: unionRights(slugs, rightsByRole) };
  }
  if (universeId) {
    const slugs = rolesAt(assignments, userId, 'universe', universeId, null);
    if (slugs.length > 0) return { source: 'universe', roleSlugs: slugs, rights: unionRights(slugs, rightsByRole) };
  }
  const orgSlugs = rolesAt(assignments, userId, 'org');
  if (orgSlugs.length > 0) return { source: 'org', roleSlugs: orgSlugs, rights: unionRights(orgSlugs, rightsByRole) };

  if (membershipRole) {
    const slugs = [membershipRole];
    return { source: 'membership', roleSlugs: slugs, rights: unionRights(slugs, rightsByRole) };
  }
  return { source: 'none', roleSlugs: [], rights: {} };
}

/**
 * The defaults that would apply at a scope, nearest first. Used by the screen to show what a new
 * assignment would inherit, and to explain why an applied default chose the role it did.
 */
export function applicableDefaults(
  defaults: readonly ScopeDefault[],
  universeId: string | null,
  engagementId: string | null,
): { source: ScopeKind; roleSlugs: string[] } | null {
  const enabled = defaults.filter((d) => d.isDefault);
  if (engagementId) {
    const slugs = enabled
      .filter((d) => d.scopeKind === 'engagement' && matches(d, null, engagementId))
      .map((d) => d.roleSlug).sort();
    if (slugs.length > 0) return { source: 'engagement', roleSlugs: slugs };
  }
  if (universeId) {
    const slugs = enabled
      .filter((d) => d.scopeKind === 'universe' && matches(d, universeId, null))
      .map((d) => d.roleSlug).sort();
    if (slugs.length > 0) return { source: 'universe', roleSlugs: slugs };
  }
  const slugs = enabled.filter((d) => d.scopeKind === 'org').map((d) => d.roleSlug).sort();
  if (slugs.length > 0) return { source: 'org', roleSlugs: slugs };
  return null;
}

/**
 * A one-line reason a person holds what they hold, for the screen. It names the scope that won and
 * the roles it supplied, never a bare verdict — the same ethic the rule engine follows.
 */
export function explainAccess(access: EffectiveAccess, labelFor: (slug: string) => string): string {
  const roles = access.roleSlugs.map(labelFor).join(', ');
  switch (access.source) {
    case 'engagement': return `Held at this engagement: ${roles}.`;
    case 'universe': return `Held at the engagement's universe: ${roles}.`;
    case 'org': return `The organisation default: ${roles}.`;
    case 'membership': return `No scoped role is configured, so the membership role applies: ${roles}.`;
    default: return 'No role is held and no default applies.';
  }
}

/** The rights a role confers, from the org's own definitions, falling back to the shipped matrix. */
export function rightsForSlug(slug: string, rightsByRole: RightsByRole): Partial<Record<Right, boolean>> {
  const own = rightsByRole[slug];
  if (own) return own;
  return rightsForRole(slug as Role);
}

/**
 * Which right keys a scope configuration touches, so the screen can group a matrix by effect rather
 * than by alphabet. Deterministic: the order is the closed `RIGHTS` list.
 */
export function rightsInOrder(roleSlugs: readonly string[], rightsByRole: RightsByRole): Right[] {
  const held = unionRights(roleSlugs, rightsByRole);
  return RIGHTS.filter((r) => held[r] === true);
}

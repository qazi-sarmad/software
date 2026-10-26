/**
 * Rights model (Phase 2, task 2F-2b).
 *
 * Every permission decision in the app is made against a *right* held by the session, never
 * against a role name. A role is only a bag of rights: the role→rights mapping below is data
 * that seeds a session, and the database keeps the same mapping in `roles.rights`
 * (migration 0050_rights_extended.sql, which grew the list from 0012_rights_closed.sql; migration
 * 0087_remove_ai.sql removed use_ai_assist, so the list is fourteen keys). The fourteen keys are the
 * closed vocabulary the database accepts (rights_keys_valid).
 *
 * Defaults are chosen to reproduce, right for right, the behaviour the app had when it compared
 * role names, so this task changes no observable behaviour (recorded in docs/ROLE-CHECKS.md).
 */
import type { Role, User } from '../types';

export const RIGHTS = [
  'manage_users',
  'manage_roles',
  'edit_config',
  'manage_engagements',
  'approve_plan',
  'review_and_approve',
  'perform_work',
  'can_reopen',
  'view_all_scopes',
  'read_only',
  'manage_team',
  'view_board_pack',
  'generate_board_pack',
  'view_insights',
] as const;

export type Right = (typeof RIGHTS)[number];

export type RightsMap = Partial<Record<Right, boolean>>;

/**
 * Default rights per role slug. This is the fallback for a session that carries no explicit rights
 * (demo data, tests). A live session takes its rights from `roles.rights`. The keys reproduce the
 * previous role-name behaviour: e.g. an auditee is read-only but, unlike an observer, has no
 * view_all_scopes, which is what let an auditee see the Audit Universe tab and its own entity.
 */
const RIGHTS_BY_ROLE: Record<Role, RightsMap> = {
  org_admin: { manage_users: true, manage_roles: true, edit_config: true },
  cia: {
    manage_roles: true,
    edit_config: true,
    manage_engagements: true,
    approve_plan: true,
    review_and_approve: true,
    perform_work: true,
    can_reopen: true,
    view_all_scopes: true,
    view_board_pack: true,
    generate_board_pack: true,
    view_insights: true,
  },
  audit_manager: {
    manage_engagements: true,
    review_and_approve: true,
    perform_work: true,
    view_all_scopes: true,
    view_board_pack: true,
    view_insights: true,
  },
  reviewer: { review_and_approve: true, perform_work: true },
  preparer: { perform_work: true },
  observer: { read_only: true, view_all_scopes: true, view_board_pack: true },
  auditee: { read_only: true },
};

export function rightsForRole(role: Role): RightsMap {
  return RIGHTS_BY_ROLE[role] ?? {};
}

/**
 * The effective rights of a session. A session's explicit rights are unioned over the defaults for
 * its role, so a right a role always holds cannot be dropped by an incomplete map.
 */
export function rightsOf(user: User | null | undefined): RightsMap {
  if (!user) return {};
  return { ...rightsForRole(user.role), ...(user.rights ?? {}) };
}

/** True when the session holds the right. The single gate every caller uses. */
export function hasRight(user: User | null | undefined, right: Right): boolean {
  return rightsOf(user)[right] === true;
}

/** Audit-content rights. A session that holds none of them is a configuration-only principal. */
const AUDIT_RIGHTS: readonly Right[] = [
  'manage_engagements',
  'approve_plan',
  'review_and_approve',
  'perform_work',
  'can_reopen',
  'view_all_scopes',
  'read_only',
];

export function hasAnyAuditRight(user: User | null | undefined): boolean {
  return AUDIT_RIGHTS.some((r) => hasRight(user, r));
}

/** A principal that may only read: it holds read_only and no working right. */
export function isReadOnly(user: User | null | undefined): boolean {
  return hasRight(user, 'read_only') && !hasRight(user, 'perform_work') && !hasRight(user, 'review_and_approve');
}

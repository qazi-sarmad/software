/**
 * Org-configurable designations → capabilities.
 * Catalog is fixed by Provio; assignments are org data (defaults seed the demo).
 */
import { CapCapability, OrgRoleConfig, Role, User } from '../types';
import type { ActionGateResult } from '../types';

export const DEFAULT_ORG_ID = 'org-default';

/** Default designation matrix = current product intent for demo tenants. */
export function buildDefaultOrgRoleConfig(orgId: string = DEFAULT_ORG_ID): OrgRoleConfig {
  return {
    orgId,
    policy: {
      capJustificationMinChars: 10,
      capRequireEvidenceOnSubmit: true,
    },
    designations: [
      {
        id: 'des-preparer',
        label: 'Preparer',
        capabilities: ['cap_mark_in_progress', 'cap_submit_validation'],
      },
      {
        id: 'des-auditee',
        label: 'Auditee',
        capabilities: ['cap_mark_in_progress', 'cap_submit_validation'],
      },
      {
        id: 'des-reviewer',
        label: 'Reviewer',
        capabilities: ['cap_verify_close', 'cap_reject'],
      },
      {
        id: 'des-audit-manager',
        label: 'Audit Manager',
        capabilities: [
          'cap_mark_in_progress',
          'cap_submit_validation',
          'cap_verify_close',
          'cap_reject',
          'cap_fail_retest',
          'cap_change_due_date',
        ],
      },
      {
        id: 'des-cia',
        label: 'Chief Internal Auditor',
        capabilities: [
          'cap_mark_in_progress',
          'cap_submit_validation',
          'cap_verify_close',
          'cap_reject',
          'cap_fail_retest',
          'cap_change_due_date',
        ],
      },
      { id: 'des-observer', label: 'Observer', capabilities: [] },
      { id: 'des-org-admin', label: 'Organization Administrator', capabilities: [] },
    ],
    // Empty map → fall back to role enum → default designation id
    userDesignationIds: {},
  };
}

const ROLE_TO_DESIGNATION: Record<Role, string> = {
  preparer: 'des-preparer',
  auditee: 'des-auditee',
  reviewer: 'des-reviewer',
  audit_manager: 'des-audit-manager',
  cia: 'des-cia',
  observer: 'des-observer',
  org_admin: 'des-org-admin',
};

export function designationIdsForUser(user: User, config: OrgRoleConfig): string[] {
  const assigned = config.userDesignationIds?.[user.id];
  if (assigned && assigned.length > 0) return assigned;
  const fallback = ROLE_TO_DESIGNATION[user.role];
  return fallback ? [fallback] : [];
}

export function capabilitiesForUser(user: User, config: OrgRoleConfig): Set<CapCapability> {
  const ids = designationIdsForUser(user, config);
  const set = new Set<CapCapability>();
  for (const id of ids) {
    const d = config.designations.find((x) => x.id === id);
    d?.capabilities.forEach((c) => set.add(c));
  }
  return set;
}

export function canPerformCapability(
  user: User,
  capability: CapCapability,
  config: OrgRoleConfig,
  context?: { submitterUserId?: string }
): ActionGateResult {
  if (!user) return { allowed: false, reason: 'Unauthenticated' };
  if (user.role === 'org_admin') {
    return {
      allowed: false,
      reason: 'Organization administrators manage configuration and have no access to audit content',
    };
  }
  const caps = capabilitiesForUser(user, config);
  if (!caps.has(capability)) {
    return { allowed: false, reason: `Your designation cannot perform ${capability.replace(/_/g, ' ')}` };
  }
  // Four-eyes: cannot verify/reject own submission
  if (
    (capability === 'cap_verify_close' || capability === 'cap_reject') &&
    context?.submitterUserId &&
    context.submitterUserId === user.id
  ) {
    return {
      allowed: false,
      reason: 'Four-eyes policy: you cannot verify or reject a CAP you submitted',
    };
  }
  return { allowed: true };
}

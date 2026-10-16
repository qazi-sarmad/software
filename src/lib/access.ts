import {
  ActionGateResult,
  ActionType,
  AuditControl,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  AuditUniverse,
  ReviewComment,
  User,
  WorkingPaper,
} from '../types';
import { hasAnyAuditRight, hasRight, isReadOnly } from './rights';

export type { ActionType, ActionGateResult };

/**
 * Scoped visibility and permission gating.
 *
 * Every decision here is made against a *right* the session holds (src/lib/rights.ts), never
 * against a role name. A role is only a bag of rights. Message strings are display text chosen
 * from the same rights, so no branch compares a role name.
 */

/**
 * Checks if a user has access to a given universe.
 * If user.universeIds is empty or contains '*', user has access to all universes.
 * A principal with no audit right (a configuration-only role) sees no audit universes.
 */
export function canAccessUniverse(user: User, universeId: string): boolean {
  if (!user) return false;
  if (!hasAnyAuditRight(user)) return false;
  if (hasRight(user, 'view_all_scopes')) return true;
  if (!user.universeIds || user.universeIds.length === 0 || user.universeIds.includes('*')) {
    return true;
  }
  return user.universeIds.includes(universeId);
}

/**
 * Checks if a user has access to a given entity.
 * Must first have access to the entity's universe.
 * If user.entityIds is empty or contains '*', user has access to all entities in permitted universes.
 */
export function canAccessEntity(
  user: User,
  entity: { id: string; universeId: string }
): boolean {
  if (!user || !entity) return false;
  if (!hasAnyAuditRight(user)) return false;
  if (!canAccessUniverse(user, entity.universeId)) {
    return false;
  }
  if (hasRight(user, 'view_all_scopes')) return true;
  if (!user.entityIds || user.entityIds.length === 0 || user.entityIds.includes('*')) {
    return true;
  }
  return user.entityIds.includes(entity.id);
}

/**
 * Filters universes list to only those accessible by the user.
 * A configuration-only principal (no audit right) sees 0 audit universes.
 */
export function filterUniverses(universes: AuditUniverse[], user: User): AuditUniverse[] {
  if (!user || !hasAnyAuditRight(user)) return [];
  return universes.filter((u) => canAccessUniverse(user, u.id));
}

/**
 * Filters entities to only those accessible by the user and within the selected universe (if specified).
 */
export function filterEntities(
  entities: AuditEntity[],
  user: User,
  selectedUniverseId?: string
): AuditEntity[] {
  if (!user || !hasAnyAuditRight(user)) return [];
  return entities.filter((entity) => {
    if (selectedUniverseId && entity.universeId !== selectedUniverseId) {
      return false;
    }
    return canAccessEntity(user, entity);
  });
}

/**
 * Filters engagements to those belonging to accessible entities.
 */
export function filterEngagements(
  engagements: AuditEngagement[],
  user: User,
  allowedEntityIds: Set<string>
): AuditEngagement[] {
  if (!user || !hasAnyAuditRight(user)) return [];
  return engagements.filter((e) => {
    if (!canAccessUniverse(user, e.universeId)) return false;
    return allowedEntityIds.has(e.entityId);
  });
}

/**
 * A principal that sees no working-level records: a configuration-only principal, or a pure
 * read-only observer (read-only and all-scope). A scoped read-only principal (an auditee
 * responding to findings) still sees its own entity's records.
 */
function seesNoWorkingRecords(user: User): boolean {
  return !hasAnyAuditRight(user) || (isReadOnly(user) && hasRight(user, 'view_all_scopes'));
}

/**
 * Filters controls to those belonging to accessible entities.
 * A configuration-only or pure observer principal sees 0 controls.
 */
export function filterControls(
  controls: AuditControl[],
  user: User,
  allowedEntityIds: Set<string>
): AuditControl[] {
  if (!user || seesNoWorkingRecords(user)) return [];
  return controls.filter((c) => allowedEntityIds.has(c.entityId));
}

/**
 * Filters working papers to those belonging to accessible entities.
 */
export function filterWorkpapers(
  workpapers: WorkingPaper[],
  user: User,
  allowedEntityIds: Set<string>
): WorkingPaper[] {
  if (!user || seesNoWorkingRecords(user)) return [];
  return workpapers.filter((w) => {
    if (w.universeId && !canAccessUniverse(user, w.universeId)) return false;
    return allowedEntityIds.has(w.entityId);
  });
}

/**
 * Filters observations to those belonging to accessible entities.
 */
export function filterObservations(
  observations: AuditObservation[],
  user: User,
  allowedEntityIds: Set<string>
): AuditObservation[] {
  if (!user || seesNoWorkingRecords(user)) return [];
  return observations.filter((o) => {
    if (o.universeId && !canAccessUniverse(user, o.universeId)) return false;
    return allowedEntityIds.has(o.entityId);
  });
}

/**
 * Filters issues to those belonging to accessible entities.
 * A pure observer (read-only and all-scope) sees ONLY issued issues.
 */
export function filterIssues(
  issues: AuditIssue[],
  user: User,
  allowedEntityIds: Set<string>
): AuditIssue[] {
  if (!user || !hasAnyAuditRight(user)) return [];
  const pureObserver = isReadOnly(user) && hasRight(user, 'view_all_scopes');
  return issues.filter((i) => {
    if (i.universeId && !canAccessUniverse(user, i.universeId)) return false;
    if (!allowedEntityIds.has(i.entityId)) return false;
    if (pureObserver) {
      return i.isIssued === true || i.status === 'open' || i.status === 'action_plan_agreed' || i.status === 'identified';
    }
    return true;
  });
}

/**
 * Filters review comments to those associated with accessible workpapers.
 */
export function filterComments(
  comments: ReviewComment[],
  user: User,
  allowedWorkpaperIds: Set<string>
): ReviewComment[] {
  if (!user || seesNoWorkingRecords(user)) return [];
  return comments.filter((c) => allowedWorkpaperIds.has(c.workpaperId));
}

/**
 * The right each action requires. A single source of truth for both the decision and the message.
 */
const ACTION_RIGHT: Partial<Record<ActionType, 'manage_engagements' | 'approve_plan' | 'review_and_approve' | 'perform_work' | 'can_reopen' | 'edit_config'>> = {
  create_workpaper: 'perform_work',
  edit_workpaper: 'perform_work',
  run_test: 'perform_work',
  finalize_test: 'perform_work',
  raise_finding: 'perform_work',
  raise_observation: 'perform_work',
  review_sign_off: 'review_and_approve',
  sign_off: 'review_and_approve',
  close_issue: 'review_and_approve',
  audit_sign_off: 'manage_engagements',
  propose_ad_hoc: 'manage_engagements',
  approve_plan: 'approve_plan',
  approve: 'review_and_approve',
  issue_report: 'approve_plan',
  reopen: 'can_reopen',
};

/**
 * Display text for a denied action, chosen from the rights the session holds. No branch compares
 * a role name: the wording is picked from read_only, view_all_scopes and the other rights.
 */
function denialReason(user: User, action: ActionType): string {
  const readOnly = isReadOnly(user);
  const seesAll = hasRight(user, 'view_all_scopes');
  const reviews = hasRight(user, 'review_and_approve');

  switch (action) {
    case 'create_workpaper':
    case 'edit_workpaper':
    case 'run_test':
    case 'finalize_test':
    case 'raise_finding':
    case 'raise_observation':
      if (readOnly) return seesAll ? 'Observers have read-only access' : 'Auditees have read-only access';
      if (action === 'run_test' || action === 'finalize_test') return 'This principal cannot run or finalize audit tests';
      return 'This principal cannot create or edit working papers';

    case 'review_sign_off':
    case 'sign_off':
      if (readOnly) return seesAll ? 'Observers cannot perform sign-offs' : 'Auditees cannot perform sign-offs';
      return 'Preparers cannot perform sign-offs';

    case 'close_issue':
      if (readOnly) return seesAll ? 'Observers cannot close issues' : 'Auditees cannot close issues; management can only propose remediation';
      return 'Preparers cannot close issues';

    case 'audit_sign_off':
      if (reviews) return 'Reviewers cannot perform audit sign-off; requires Audit Manager or CIA';
      return 'Only Audit Managers or CIAs can perform audit sign-off';

    case 'propose_ad_hoc':
      return 'Only Audit Managers or CIAs can propose ad-hoc engagements';

    case 'approve_plan':
      return 'Only Chief Internal Auditor (CIA) can approve the audit plan or ad-hoc engagements';

    case 'approve':
      return 'Only Reviewers, CIAs, or Admins can approve';

    case 'issue_report':
      return 'Only Chief Internal Auditor (CIA) can issue final audit reports';

    case 'reopen':
      if (readOnly) return seesAll ? 'Preparers and observers cannot reopen signed records' : 'Auditees cannot reopen signed records';
      return 'Only Chief Internal Auditor (CIA) can reopen sealed audit records';

    default:
      return 'Action not permitted';
  }
}

/**
 * Permission gating (Part 2.B). Every branch is a rights check; no branch reads a role name.
 *
 * Always: sealed = read-only; reopen needs a note of 10+ characters.
 * Every disallowed action returns an explicit reason string.
 */
export function canPerformAction(
  user: User,
  action: ActionType,
  context?: {
    preparerId?: string;
    leadAuditorId?: string;
    isLocked?: boolean;
    reopenJustification?: string;
  }
): ActionGateResult {
  if (!user) {
    return { allowed: false, reason: 'Unauthenticated' };
  }

  // 1. A principal with no audit right manages configuration only and sees NO audit content.
  if (!hasAnyAuditRight(user)) {
    return {
      allowed: false,
      reason: 'Organization administrators manage configuration and have no access to audit content',
    };
  }

  // 2. Sealed / Locked records are immutable read-only; only reopen and ledger verification are permitted.
  if (context?.isLocked && action !== 'reopen' && action !== 'view_ledger') {
    return {
      allowed: false,
      reason: 'This audit record is sealed and signed-off. Reopen with justification to make changes.',
    };
  }

  switch (action) {
    case 'view_ledger':
    case 'view_audit_content':
    case 'view_executive_summary':
    case 'view_issues':
    case 'view_reports':
      return { allowed: true };

    case 'review_sign_off':
    case 'sign_off': {
      // Four-eyes policy: a reviewer cannot sign off work they prepared themselves.
      if (context?.preparerId && context.preparerId === user.id) {
        return {
          allowed: false,
          reason: 'Four-eyes policy: Reviewers cannot sign off their own prepared workpapers',
        };
      }
      if (!hasRight(user, 'review_and_approve')) {
        return { allowed: false, reason: denialReason(user, action) };
      }
      return { allowed: true };
    }

    case 'approve':
      if (!hasRight(user, 'review_and_approve') && !hasRight(user, 'approve_plan')) {
        return { allowed: false, reason: denialReason(user, action) };
      }
      return { allowed: true };

    case 'reopen': {
      if (!hasRight(user, 'can_reopen')) {
        return { allowed: false, reason: denialReason(user, action) };
      }
      if (
        context?.reopenJustification !== undefined &&
        context.reopenJustification.trim().length < 10
      ) {
        return {
          allowed: false,
          reason: 'Reopen requires a justification note of at least 10 characters',
        };
      }
      return { allowed: true };
    }

    default: {
      const required = ACTION_RIGHT[action];
      if (!required) {
        return { allowed: false, reason: 'Action not permitted' };
      }
      if (!hasRight(user, required)) {
        return { allowed: false, reason: denialReason(user, action) };
      }
      return { allowed: true };
    }
  }
}

/** @deprecated Prefer canPerformCapability(user, 'cap_change_due_date', orgConfig) */
export const canChangeCapDueDate = (user: User) => hasRight(user, 'manage_engagements');

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
  Role,
  User,
  WorkingPaper,
} from '../types';

export type { ActionType, ActionGateResult };

/**
 * Checks if a user has access to a given universe.
 * If user.universeIds is empty or contains '*', user has access to all universes.
 * Note: org_admin manages system configuration only and has NO access to audit universes.
 */
export function canAccessUniverse(user: User, universeId: string): boolean {
  if (!user) return false;
  if (user.role === 'org_admin') return false;
  if (user.role === 'cia' || user.role === 'observer') return true;
  if (!user.universeIds || user.universeIds.length === 0 || user.universeIds.includes('*')) {
    return true;
  }
  return user.universeIds.includes(universeId);
}

/**
 * Checks if a user has access to a given entity.
 * Must first have access to the entity's universe.
 * If user.entityIds is empty or contains '*', user has access to all entities in permitted universes.
 * Note: org_admin has NO access to audit entities.
 */
export function canAccessEntity(
  user: User,
  entity: { id: string; universeId: string }
): boolean {
  if (!user || !entity) return false;
  if (user.role === 'org_admin') return false;
  if (!canAccessUniverse(user, entity.universeId)) {
    return false;
  }
  if (user.role === 'cia' || user.role === 'observer') return true;
  if (!user.entityIds || user.entityIds.length === 0 || user.entityIds.includes('*')) {
    return true;
  }
  return user.entityIds.includes(entity.id);
}

/**
 * Filters universes list to only those accessible by the user.
 * org_admin sees 0 audit universes.
 */
export function filterUniverses(universes: AuditUniverse[], user: User): AuditUniverse[] {
  if (!user || user.role === 'org_admin') return [];
  return universes.filter((u) => canAccessUniverse(user, u.id));
}

/**
 * Filters entities to only those accessible by the user and within the selected universe (if specified).
 * org_admin sees 0 audit entities.
 */
export function filterEntities(
  entities: AuditEntity[],
  user: User,
  selectedUniverseId?: string
): AuditEntity[] {
  if (!user || user.role === 'org_admin') return [];
  return entities.filter((entity) => {
    if (selectedUniverseId && entity.universeId !== selectedUniverseId) {
      return false;
    }
    return canAccessEntity(user, entity);
  });
}

/**
 * Filters engagements to those belonging to accessible entities.
 * org_admin sees 0 audit engagements.
 */
export function filterEngagements(
  engagements: AuditEngagement[],
  user: User,
  allowedEntityIds: Set<string>
): AuditEngagement[] {
  if (!user || user.role === 'org_admin') return [];
  return engagements.filter((e) => {
    if (!canAccessUniverse(user, e.universeId)) return false;
    return allowedEntityIds.has(e.entityId);
  });
}

/**
 * Filters controls to those belonging to accessible entities.
 * org_admin and observer see 0 controls.
 */
export function filterControls(
  controls: AuditControl[],
  user: User,
  allowedEntityIds: Set<string>
): AuditControl[] {
  if (!user || user.role === 'org_admin' || user.role === 'observer') return [];
  return controls.filter((c) => allowedEntityIds.has(c.entityId));
}

/**
 * Filters working papers to those belonging to accessible entities.
 * org_admin and observer see 0 working papers.
 */
export function filterWorkpapers(
  workpapers: WorkingPaper[],
  user: User,
  allowedEntityIds: Set<string>
): WorkingPaper[] {
  if (!user || user.role === 'org_admin' || user.role === 'observer') return [];
  return workpapers.filter((w) => {
    if (w.universeId && !canAccessUniverse(user, w.universeId)) return false;
    return allowedEntityIds.has(w.entityId);
  });
}

/**
 * Filters observations to those belonging to accessible entities.
 * org_admin and observer see 0 observations.
 */
export function filterObservations(
  observations: AuditObservation[],
  user: User,
  allowedEntityIds: Set<string>
): AuditObservation[] {
  if (!user || user.role === 'org_admin' || user.role === 'observer') return [];
  return observations.filter((o) => {
    if (o.universeId && !canAccessUniverse(user, o.universeId)) return false;
    return allowedEntityIds.has(o.entityId);
  });
}

/**
 * Filters issues to those belonging to accessible entities.
 * org_admin sees 0 issues.
 * observer sees ONLY issued issues (isIssued: true or status open/action_plan_agreed).
 */
export function filterIssues(
  issues: AuditIssue[],
  user: User,
  allowedEntityIds: Set<string>
): AuditIssue[] {
  if (!user || user.role === 'org_admin') return [];
  return issues.filter((i) => {
    if (i.universeId && !canAccessUniverse(user, i.universeId)) return false;
    if (!allowedEntityIds.has(i.entityId)) return false;
    if (user.role === 'observer') {
      return i.isIssued === true || i.status === 'open' || i.status === 'action_plan_agreed' || i.status === 'identified';
    }
    return true;
  });
}

/**
 * Filters review comments to those associated with accessible workpapers.
 * org_admin and observer see 0 comments.
 */
export function filterComments(
  comments: ReviewComment[],
  user: User,
  allowedWorkpaperIds: Set<string>
): ReviewComment[] {
  if (!user || user.role === 'org_admin' || user.role === 'observer') return [];
  return comments.filter((c) => allowedWorkpaperIds.has(c.workpaperId));
}

/**
 * Role-based capability and ownership gating (Part 2.B).
 *
 * Rules:
 * - preparer: create/edit workpapers, run tests, raise findings; cannot approve anything
 * - reviewer: raise findings, review sign-off (NOT on work they prepared), close issues
 * - audit_manager: preparer + reviewer powers, audit sign-off, propose ad-hoc engagement
 * - cia: everything above + approve plan/ad-hoc, issue report, reopen sealed audit
 * - observer: read-only; sees Executive Summary, Issues, issued reports only
 * - org_admin: manages users/config; sees NO audit content
 * - auditee: read-only on workpapers; can respond to observations/issues
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

  // 1. org_admin manages system/users only and sees NO audit content
  if (user.role === 'org_admin') {
    return {
      allowed: false,
      reason: 'Organization administrators manage configuration and have no access to audit content',
    };
  }

  // 2. Sealed / Locked records are immutable read-only; only reopen and ledger verification are permitted
  if (context?.isLocked && action !== 'reopen' && action !== 'view_ledger') {
    return {
      allowed: false,
      reason: 'This audit record is sealed and signed-off. Reopen with justification to make changes.',
    };
  }

  switch (action) {
    // --- WORKPAPERS: Create & Edit ---
    case 'create_workpaper':
    case 'edit_workpaper':
      if (user.role === 'observer') {
        return { allowed: false, reason: 'Observers have read-only access' };
      }
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees have read-only access' };
      }
      return { allowed: true };

    // --- TESTS: Run & Finalize ---
    case 'run_test':
    case 'finalize_test':
      if (user.role === 'observer') {
        return { allowed: false, reason: 'Observers have read-only access' };
      }
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot run or finalize audit tests' };
      }
      return { allowed: true };

    // --- FINDINGS & OBSERVATIONS: Raise ---
    case 'raise_finding':
    case 'raise_observation':
      if (user.role === 'observer') {
        return { allowed: false, reason: 'Observers have read-only access' };
      }
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot raise audit observations or findings' };
      }
      return { allowed: true };

    // --- REVIEW SIGN-OFF (Workpaper Level, Four-Eyes Principle) ---
    case 'review_sign_off':
    case 'sign_off':
      if (user.role === 'observer') {
        return { allowed: false, reason: 'Observers cannot perform sign-offs' };
      }
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot perform sign-offs' };
      }
      if (user.role === 'preparer') {
        return { allowed: false, reason: 'Preparers cannot perform sign-offs' };
      }
      // Four-eyes policy: Reviewer cannot sign off on work they prepared themselves
      if (context?.preparerId && context.preparerId === user.id) {
        return {
          allowed: false,
          reason: 'Four-eyes policy: Reviewers cannot sign off their own prepared workpapers',
        };
      }
      return { allowed: true };

    // --- CLOSE ISSUES ---
    case 'close_issue':
      if (user.role === 'observer') {
        return { allowed: false, reason: 'Observers cannot close issues' };
      }
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot close issues; management can only propose remediation' };
      }
      if (user.role === 'preparer') {
        return { allowed: false, reason: 'Preparers cannot close issues' };
      }
      return { allowed: true };

    // --- AUDIT SIGN-OFF (Engagement Level) ---
    case 'audit_sign_off':
      if (user.role === 'observer' || user.role === 'auditee' || user.role === 'preparer') {
        return { allowed: false, reason: 'Only Audit Managers or CIAs can perform audit sign-off' };
      }
      if (user.role === 'reviewer') {
        return { allowed: false, reason: 'Reviewers cannot perform audit sign-off; requires Audit Manager or CIA' };
      }
      return { allowed: true };

    // --- PROPOSE AD-HOC ENGAGEMENT ---
    case 'propose_ad_hoc':
      if (user.role === 'observer' || user.role === 'auditee' || user.role === 'preparer' || user.role === 'reviewer') {
        return { allowed: false, reason: 'Only Audit Managers or CIAs can propose ad-hoc engagements' };
      }
      return { allowed: true };

    // --- APPROVE PLAN / AD-HOC (CIA Only) ---
    case 'approve_plan':
      if (user.role !== 'cia') {
        return { allowed: false, reason: 'Only Chief Internal Auditor (CIA) can approve the audit plan or ad-hoc engagements' };
      }
      return { allowed: true };

    case 'approve':
      // Backwards compatible approve check
      if (user.role === 'preparer' || user.role === 'auditee' || user.role === 'observer') {
        return { allowed: false, reason: 'Only Reviewers, CIAs, or Admins can approve' };
      }
      return { allowed: true };

    // --- ISSUE FINAL REPORT (CIA Only) ---
    case 'issue_report':
      if (user.role !== 'cia') {
        return { allowed: false, reason: 'Only Chief Internal Auditor (CIA) can issue final audit reports' };
      }
      return { allowed: true };

    // --- REOPEN SEALED AUDIT ---
    case 'reopen':
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot reopen signed records' };
      }
      if (user.role === 'preparer' || user.role === 'observer') {
        return { allowed: false, reason: 'Preparers and observers cannot reopen signed records' };
      }
      if (user.role !== 'cia') {
        return { allowed: false, reason: 'Only Chief Internal Auditor (CIA) can reopen sealed audit records' };
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

    // --- VIEW LEDGER & VIEWS ---
    case 'view_ledger':
      return { allowed: true };

    case 'view_audit_content':
      return { allowed: true };

    case 'view_executive_summary':
    case 'view_issues':
    case 'view_reports':
      return { allowed: true };

    default:
      return { allowed: false, reason: 'Action not permitted' };
  }
}

/** @deprecated Prefer canPerformCapability(user, 'cap_change_due_date', orgConfig) */
export const canChangeCapDueDate = (role: Role) => role === 'audit_manager' || role === 'cia';


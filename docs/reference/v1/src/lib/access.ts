import {
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

/**
 * Checks if a user has access to a given universe.
 * If user.universeIds is empty or contains '*', user has access to all universes.
 */
export function canAccessUniverse(user: User, universeId: string): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'cia') return true;
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
  if (user.role === 'admin' || user.role === 'cia') return true;
  if (!canAccessUniverse(user, entity.universeId)) {
    return false;
  }
  if (!user.entityIds || user.entityIds.length === 0 || user.entityIds.includes('*')) {
    return true;
  }
  return user.entityIds.includes(entity.id);
}

/**
 * Filters universes list to only those accessible by the user.
 */
export function filterUniverses(universes: AuditUniverse[], user: User): AuditUniverse[] {
  if (!user) return [];
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
  if (!user) return [];
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
  if (!user) return [];
  return engagements.filter((e) => {
    if (!canAccessUniverse(user, e.universeId)) return false;
    return allowedEntityIds.has(e.entityId);
  });
}

/**
 * Filters controls to those belonging to accessible entities.
 */
export function filterControls(
  controls: AuditControl[],
  user: User,
  allowedEntityIds: Set<string>
): AuditControl[] {
  if (!user) return [];
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
  if (!user) return [];
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
  if (!user) return [];
  return observations.filter((o) => {
    if (o.universeId && !canAccessUniverse(user, o.universeId)) return false;
    return allowedEntityIds.has(o.entityId);
  });
}

/**
 * Filters issues to those belonging to accessible entities.
 */
export function filterIssues(
  issues: AuditIssue[],
  user: User,
  allowedEntityIds: Set<string>
): AuditIssue[] {
  if (!user) return [];
  return issues.filter((i) => {
    if (i.universeId && !canAccessUniverse(user, i.universeId)) return false;
    return allowedEntityIds.has(i.entityId);
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
  if (!user) return [];
  return comments.filter((c) => allowedWorkpaperIds.has(c.workpaperId));
}

export type ActionType =
  | 'sign_off'
  | 'approve'
  | 'reopen'
  | 'finalize_test'
  | 'edit_workpaper'
  | 'raise_observation'
  | 'view_ledger';

export interface ActionGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Role-based and ownership-based capability gating.
 * Rules:
 * - Reviewer cannot sign off their own work (four-eyes principle).
 * - Preparer cannot approve audits, plans, or sign-offs.
 * - Locked / signed-off items cannot be edited without reopening.
 * - Reopen requires admin or cia (or authorized reviewer) with a valid reason.
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

  // If item is locked / signed-off, no modification actions allowed except reopen
  if (context?.isLocked && action !== 'reopen' && action !== 'view_ledger') {
    return {
      allowed: false,
      reason: 'This audit record is sealed and signed-off. Reopen with justification to make changes.',
    };
  }

  switch (action) {
    case 'sign_off':
      if (user.role === 'preparer') {
        return { allowed: false, reason: 'Preparers cannot perform sign-offs' };
      }
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot perform sign-offs' };
      }
      // Reviewer cannot sign off own work
      if (context?.preparerId && context.preparerId === user.id) {
        return {
          allowed: false,
          reason: 'Four-eyes policy: Reviewers cannot sign off their own prepared workpapers',
        };
      }
      return { allowed: true };

    case 'approve':
      if (user.role === 'preparer' || user.role === 'auditee') {
        return { allowed: false, reason: 'Only Reviewers, CIAs, or Admins can approve' };
      }
      return { allowed: true };

    case 'reopen':
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot reopen signed records' };
      }
      if (user.role === 'preparer') {
        return { allowed: false, reason: 'Preparers cannot reopen signed records' };
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

    case 'finalize_test':
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot finalize tests' };
      }
      return { allowed: true };

    case 'edit_workpaper':
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees have read-only access' };
      }
      return { allowed: true };

    case 'raise_observation':
      if (user.role === 'auditee') {
        return { allowed: false, reason: 'Auditees cannot raise audit observations' };
      }
      return { allowed: true };

    case 'view_ledger':
      return { allowed: true };

    default:
      return { allowed: false, reason: 'Action not permitted' };
  }
}

import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { useFilterStore } from '../context/FilterStore';
import {
  ActionType,
  canAccessEntity,
  canAccessUniverse,
  canPerformAction,
  filterComments,
  filterControls,
  filterEngagements,
  filterEntities,
  filterIssues,
  filterObservations,
  filterUniverses,
  filterWorkpapers,
} from '../lib/access';
import { isCapOverdue } from '../lib/orgDate';
import {
  AuditCapItem,
  AuditControl,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  AuditUniverse,
  ReviewComment,
  WorkingPaper,
} from '../types';

export function useScopedData() {
  const {
    currentUser,
    rawUniverses,
    rawEntities,
    rawEngagements,
    rawControls,
    rawWorkpapers,
    rawObservations,
    rawIssues,
    rawComments,
    rawCapItems,
    selectedUniverseId,
    setSelectedUniverseId,
    ledger,
    ledgerAsOf,
  } = useApp();

  const filter = useFilterStore();

  // 1. Scoped Universes
  const scopedUniverses = useMemo(() => {
    return filterUniverses(rawUniverses, currentUser);
  }, [rawUniverses, currentUser]);

  // Universe assignment rule: if tagged to exactly 1 universe, user sees only that universe and no switcher
  const hasMultipleUniverses = scopedUniverses.length > 1;
  const effectiveUniverseId = useMemo(() => {
    if (scopedUniverses.length === 1) return scopedUniverses[0].id;
    if (selectedUniverseId && scopedUniverses.some((u) => u.id === selectedUniverseId)) {
      return selectedUniverseId;
    }
    return scopedUniverses[0]?.id || null;
  }, [scopedUniverses, selectedUniverseId]);

  // 2. Scoped Entities (within effective universe if selected)
  const scopedEntities = useMemo(() => {
    return filterEntities(rawEntities, currentUser, effectiveUniverseId || undefined);
  }, [rawEntities, currentUser, effectiveUniverseId]);

  const allowedEntityIds = useMemo(() => {
    return new Set(scopedEntities.map((e) => e.id));
  }, [scopedEntities]);

  // 3. Scoped Engagements
  const scopedEngagements = useMemo(() => {
    return filterEngagements(rawEngagements, currentUser, allowedEntityIds);
  }, [rawEngagements, currentUser, allowedEntityIds]);

  // 4. Scoped Controls
  const scopedControls = useMemo(() => {
    return filterControls(rawControls, currentUser, allowedEntityIds);
  }, [rawControls, currentUser, allowedEntityIds]);

  // 5. Scoped Workpapers
  const scopedWorkpapers = useMemo(() => {
    return filterWorkpapers(rawWorkpapers, currentUser, allowedEntityIds);
  }, [rawWorkpapers, currentUser, allowedEntityIds]);

  const allowedWorkpaperIds = useMemo(() => {
    return new Set(scopedWorkpapers.map((w) => w.id));
  }, [scopedWorkpapers]);

  // 6. Scoped Observations
  const scopedObservations = useMemo(() => {
    return filterObservations(rawObservations, currentUser, allowedEntityIds);
  }, [rawObservations, currentUser, allowedEntityIds]);

  // 7. Scoped Issues
  const scopedIssues = useMemo(() => {
    return filterIssues(rawIssues, currentUser, allowedEntityIds);
  }, [rawIssues, currentUser, allowedEntityIds]);

  // 8. Scoped Comments
  const scopedComments = useMemo(() => {
    return filterComments(rawComments, currentUser, allowedWorkpaperIds);
  }, [rawComments, currentUser, allowedWorkpaperIds]);

  // 9. Scoped CAP Items (§ 3.4)
  const scopedCapItems = useMemo(() => {
    if (currentUser.role === 'org_admin') return [];
    return rawCapItems.filter((cap) => {
      return allowedEntityIds.has(cap.entityId);
    });
  }, [rawCapItems, currentUser.role, allowedEntityIds]);

  // --- Cross-Filtered Data (applying reactive filters on top of scoped data) ---
  const filteredEngagements = useMemo(() => {
    return scopedEngagements.filter((eng) => {
      if (filter.status && eng.status !== filter.status && eng.stage !== filter.status) return false;
      if (filter.ownerId && eng.leadAuditorId !== filter.ownerId && eng.reviewerId !== filter.ownerId) return false;
      if (filter.department) {
        const entity = scopedEntities.find((e) => e.id === eng.entityId);
        if (entity && entity.department.toLowerCase() !== filter.department.toLowerCase()) {
          return false;
        }
      }
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        const matchesTitle = eng.title.toLowerCase().includes(q);
        const matchesId = eng.id.toLowerCase().includes(q);
        if (!matchesTitle && !matchesId) return false;
      }
      return true;
    });
  }, [scopedEngagements, scopedEntities, filter.status, filter.ownerId, filter.department, filter.searchQuery]);

  const filteredIssues = useMemo(() => {
    return scopedIssues.filter((iss) => {
      if (filter.department && iss.department.toLowerCase() !== filter.department.toLowerCase()) return false;
      if (filter.severity && iss.severity !== filter.severity) return false;
      if (filter.status && iss.status !== filter.status) return false;
      if (filter.ownerId && iss.ownerId !== filter.ownerId) return false;
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        if (!iss.title.toLowerCase().includes(q) && !iss.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [scopedIssues, filter.department, filter.severity, filter.status, filter.ownerId, filter.searchQuery]);

  const filteredWorkpapers = useMemo(() => {
    return scopedWorkpapers.filter((wp) => {
      if (filter.status && wp.status !== filter.status) return false;
      if (filter.ownerId && wp.preparerId !== filter.ownerId && wp.reviewerId !== filter.ownerId) return false;
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        if (!wp.title.toLowerCase().includes(q) && !wp.refCode.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [scopedWorkpapers, filter.status, filter.ownerId, filter.searchQuery]);

  const filteredCapItems = useMemo(() => {
    return scopedCapItems.filter((cap) => {
      if (filter.department && cap.department.toLowerCase() !== filter.department.toLowerCase()) return false;
      if (filter.severity && cap.severity !== filter.severity) return false;
      if (filter.status && cap.status !== filter.status) return false;
      if (filter.searchQuery.trim()) {
        const q = filter.searchQuery.toLowerCase();
        if (
          !cap.title.toLowerCase().includes(q) &&
          !cap.action.toLowerCase().includes(q) &&
          !cap.id.toLowerCase().includes(q) &&
          !cap.owner.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [scopedCapItems, filter.department, filter.severity, filter.status, filter.searchQuery]);

  // Derived Statistics (strictly calculated on scoped data)
  const stats = useMemo(() => {
    const totalEntities = scopedEntities.length;
    const highRiskEntities = scopedEntities.filter((e) => e.inherentRisk === 'high' || e.residualRisk === 'high').length;
    const inProgressEngagements = scopedEngagements.filter((e) => e.status === 'in_progress').length;
    const completedEngagements = scopedEngagements.filter((e) => e.status === 'signed_off').length;
    const openObservations = scopedObservations.filter((o) => o.status === 'open' || o.status === 'draft').length;
    const openIssues = scopedIssues.filter((i) => i.status !== 'closed' && i.status !== 'remediated').length;
    const criticalIssues = scopedIssues.filter((i) => i.severity === 'critical' && i.status !== 'closed').length;
    const sealedWorkpapers = scopedWorkpapers.filter((w) => w.sealed).length;

    // CAP statistics (strictly scoped)
    const totalCapCount = scopedCapItems.length;
    const openCapCount = scopedCapItems.filter((c) => c.status !== 'Closed').length;
    const overdueCapCount = scopedCapItems.filter(
      (c) => isCapOverdue(c.status, c.dueDate)
    ).length;

    // Greeting subtitle based strictly on scoped items
    const greetingSubtitle = `${inProgressEngagements} engagement${inProgressEngagements === 1 ? '' : 's'} in progress • ${openIssues} open finding${openIssues === 1 ? '' : 's'} • ${criticalIssues} critical`;

    // Department breakdown for Sunburst
    const deptMap: Record<string, { total: number; issues: AuditIssue[] }> = {};
    scopedEntities.forEach((ent) => {
      if (!deptMap[ent.department]) {
        deptMap[ent.department] = { total: 0, issues: [] };
      }
      deptMap[ent.department].total += 1;
    });
    scopedIssues.forEach((iss) => {
      if (!deptMap[iss.department]) {
        deptMap[iss.department] = { total: 0, issues: [] };
      }
      deptMap[iss.department].issues.push(iss);
    });

    // CAP Department Map for D3 Radial Tracker (§ 3.4)
    const capDeptMap: Record<
      string,
      {
        department: string;
        total: number;
        overdueCount: number;
        caps: AuditCapItem[];
        severityCounts: Record<string, number>;
      }
    > = {};

    scopedCapItems.forEach((cap) => {
      if (!capDeptMap[cap.department]) {
        capDeptMap[cap.department] = {
          department: cap.department,
          total: 0,
          overdueCount: 0,
          caps: [],
          severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
        };
      }
      const d = capDeptMap[cap.department];
      d.total += 1;
      d.caps.push(cap);
      if (isCapOverdue(cap.status, cap.dueDate)) {
        d.overdueCount += 1;
      }
      d.severityCounts[cap.severity] = (d.severityCounts[cap.severity] || 0) + 1;
    });

    return {
      totalEntities,
      highRiskEntities,
      inProgressEngagements,
      completedEngagements,
      openObservations,
      openIssues,
      criticalIssues,
      sealedWorkpapers,
      totalCapCount,
      openCapCount,
      overdueCapCount,
      greetingSubtitle,
      deptMap,
      capDeptMap,
    };
  }, [scopedEntities, scopedEngagements, scopedObservations, scopedIssues, scopedWorkpapers, scopedCapItems]);

  // Scoped Ledger: only entries belonging to accessible entities
  const scopedLedger = useMemo(() => {
    if (currentUser.role === 'org_admin') return [];
    const accessible = ledger.filter((entry) => {
      return allowedEntityIds.has(entry.entityId);
    });

    if (ledgerAsOf !== null) {
      return accessible.filter((entry) => entry.seq <= ledgerAsOf);
    }
    return accessible;
  }, [ledger, allowedEntityIds, currentUser.role, ledgerAsOf]);

  // Deep-link safe resolver: resolves an ID or returns null if not accessible
  const resolveEntity = (id: string): AuditEntity | null => {
    return scopedEntities.find((e) => e.id === id) || null;
  };

  const resolveEngagement = (id: string): AuditEngagement | null => {
    return scopedEngagements.find((e) => e.id === id) || null;
  };

  const resolveWorkpaper = (id: string): WorkingPaper | null => {
    return scopedWorkpapers.find((w) => w.id === id) || null;
  };

  const resolveObservation = (id: string): AuditObservation | null => {
    return scopedObservations.find((o) => o.id === id) || null;
  };

  const resolveIssue = (id: string): AuditIssue | null => {
    return scopedIssues.find((i) => i.id === id) || null;
  };

  const resolveCap = (id: string): AuditCapItem | null => {
    return scopedCapItems.find((c) => c.id === id) || null;
  };

  // Action gate helper bound to current user
  const can = (
    action: ActionType,
    context?: {
      preparerId?: string;
      leadAuditorId?: string;
      isLocked?: boolean;
      reopenJustification?: string;
    }
  ) => {
    return canPerformAction(currentUser, action, context);
  };

  return {
    currentUser,
    scopedUniverses,
    hasMultipleUniverses,
    selectedUniverseId: effectiveUniverseId,
    setSelectedUniverseId,
    scopedEntities,
    scopedEngagements,
    scopedControls,
    scopedWorkpapers,
    scopedObservations,
    scopedIssues,
    scopedComments,
    scopedCapItems,
    scopedLedger,
    // Filtered
    filteredEngagements,
    filteredIssues,
    filteredWorkpapers,
    filteredCapItems,
    // Stats & counts
    stats,
    // Deep-link resolvers
    resolveEntity,
    resolveEngagement,
    resolveWorkpaper,
    resolveObservation,
    resolveIssue,
    resolveCap,
    // Role action gate
    can,
  };
}

// Supabase projections are already restricted by RLS. Keep the component read boundary here.
export { useAuditData as useScopedAuditData } from '../context/AuditDataContext';

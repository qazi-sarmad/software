/**
 * Audit File v1 helpers (pure, deterministic, no I/O, no AI).
 *
 *  - Three in-file tabs: planning | execution | review (the engagement stage itself stays
 *    planning | testing | conclusion; tabs are a navigation aid, not a new stage enum).
 *  - Planning coverage: for the engagement's entity, every control (RCM row) is listed with the
 *    working papers of THIS engagement that test it. No linked paper = a visible gap.
 *  - Gate summary: sealed vs total working papers.
 *  - Sign-off state: mirrors the access gates (sign_off + audit_sign_off) so the UI never offers
 *    a button the context would refuse.
 */
import { AuditControl, AuditEngagement, User, WorkingPaper } from '../types';
import { canPerformAction } from './access';

export type AuditFileTab = 'planning' | 'execution' | 'review';

export const AUDIT_FILE_TABS: ReadonlyArray<{ id: AuditFileTab; label: string; caption: string }> = [
  { id: 'planning', label: 'Planning', caption: 'SIRA / RCM' },
  { id: 'execution', label: 'Execution', caption: 'Working papers' },
  { id: 'review', label: 'Review', caption: 'Review & sign-off' },
];

/** Opening from a comment (a specific paper) lands on Execution; everything else on Planning. */
export function getInitialAuditFileTab(data?: { workpaper?: unknown } | null): AuditFileTab {
  return data?.workpaper ? 'execution' : 'planning';
}

export type PlanningRow = {
  control: AuditControl;
  workpapers: WorkingPaper[];
  sealedCount: number;
  /** True when no working paper of this engagement tests the control. */
  gap: boolean;
};

export type PlanningCoverage = {
  rows: PlanningRow[];
  controlCount: number;
  coveredCount: number;
  gapCount: number;
};

export function buildPlanningCoverage(
  engagement: Pick<AuditEngagement, 'id' | 'entityId'>,
  controls: readonly AuditControl[],
  workpapers: readonly WorkingPaper[]
): PlanningCoverage {
  const wps = workpapers.filter((w) => w.engagementId === engagement.id);
  const rows: PlanningRow[] = controls
    .filter((c) => c.entityId === engagement.entityId)
    .map((control) => {
      const linked = wps.filter((w) => w.controlId === control.id);
      return {
        control,
        workpapers: linked,
        sealedCount: linked.filter((w) => w.sealed).length,
        gap: linked.length === 0,
      };
    });
  const gapCount = rows.filter((r) => r.gap).length;
  return { rows, controlCount: rows.length, coveredCount: rows.length - gapCount, gapCount };
}

export type GateSummary = { total: number; sealed: number; unsealed: number; allSealed: boolean };

export function getGateSummary(workpapers: readonly WorkingPaper[]): GateSummary {
  const sealed = workpapers.filter((w) => w.sealed).length;
  return {
    total: workpapers.length,
    sealed,
    unsealed: workpapers.length - sealed,
    allSealed: workpapers.length > 0 && sealed === workpapers.length,
  };
}

export type SignOffState = { visible: boolean; enabled: boolean; reason?: string };

export function getSignOffState(user: User, engagement: AuditEngagement, gate: GateSummary): SignOffState {
  if (engagement.status === 'signed_off') return { visible: false, enabled: false };
  const ctx = {
    leadAuditorId: engagement.leadAuditorId,
    preparerId: engagement.leadAuditorId,
    isLocked: engagement.isLocked,
  };
  const base = canPerformAction(user, 'sign_off', ctx);
  if (!base.allowed) return { visible: true, enabled: false, reason: base.reason };
  const audit = canPerformAction(user, 'audit_sign_off', ctx);
  if (!audit.allowed) return { visible: true, enabled: false, reason: audit.reason };
  if (!gate.allSealed) {
    return {
      visible: true,
      enabled: false,
      reason:
        gate.total === 0
          ? 'There are no working papers yet; at least one sealed paper is required.'
          : `${gate.unsealed} working paper${gate.unsealed === 1 ? '' : 's'} still need to be sealed.`,
    };
  }
  return { visible: true, enabled: true };
}

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
import { AuditControl, AuditEngagement, AuditObservation, ReviewComment, User, WorkingPaper } from '../types';
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

/**
 * Everything underneath an audit must be finished before it can be signed off and sealed,
 * regardless of who the signer is: every paper sealed, every finding complete (all five parts),
 * and no review comment still waiting for a response.
 */
export function getSignOffBlockers(
  workpapers: readonly WorkingPaper[],
  observations: readonly AuditObservation[],
  comments: readonly ReviewComment[]
): string[] {
  const out: string[] = [];
  const g = getGateSummary(workpapers);
  if (g.total === 0) out.push('No working papers exist yet.');
  else if (g.unsealed > 0) out.push(`${g.unsealed} working paper${g.unsealed === 1 ? '' : 's'} not yet sealed.`);
  const ids = new Set(workpapers.map((w) => w.id));
  const incomplete = observations.filter(
    (o) => ids.has(o.workpaperId) && !(o.condition?.trim() && o.criteria?.trim() && o.cause?.trim() && o.consequence?.trim() && o.recommendation?.trim())
  );
  if (incomplete.length) out.push(`${incomplete.length} finding${incomplete.length === 1 ? '' : 's'} missing one of the five parts (report not ready).`);
  const open = comments.filter((c) => ids.has(c.workpaperId) && (c.status ? c.status === 'open' : !c.resolved));
  if (open.length) out.push(`${open.length} review comment${open.length === 1 ? '' : 's'} still awaiting a response.`);
  return out;
}

export type SignOffState = { visible: boolean; enabled: boolean; reason?: string };

export function getSignOffState(user: User, engagement: AuditEngagement, gate: GateSummary, blockers: readonly string[] = []): SignOffState {
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
  if (blockers.length) return { visible: true, enabled: false, reason: blockers.join(' ') };
  return { visible: true, enabled: true };
}

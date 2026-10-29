/**
 * D3 — Process and governance intelligence (docs/SYSTELIGON.md §11.1a).
 *
 * Five deterministic capabilities over the governance data the app already holds or is handed:
 *
 *   - segregation-of-duties matrix — who can do what, from the roles and rights data, with conflicting
 *     combinations flagged. The rights model already exists (src/lib/rights.ts).
 *   - delegation-of-authority breach — approvals above the approver's own limit.
 *   - policy exception register      — exceptions granted, to whom, by whom, for how long, expired?
 *   - meeting-governance score       — quorum present, actions assigned, prior actions closed.
 *   - regulatory change impact       — every policy that references a changed regulation, now stale.
 *
 * Pure: every input is an argument, no clock, no client, no model. The SoD rule is the product's, as
 * data, so an external reviewer can read exactly which combination is forbidden and why.
 */
import type { Right } from '../rights';

/** A right pair that must never sit with the same principal — the SoD rule, as data. */
export interface SodRule {
  id: string;
  /** The two rights that conflict. */
  a: Right;
  b: Right;
  /** Why the combination is a control weakness, in plain words. */
  reason: string;
}

/**
 * The forbidden combinations, as data. These are the classic incompatible duties: a principal who
 * can both perform and review their own work, who can both propose and approve, or who can both
 * administer users and work the audit.
 */
export const SOD_RULES: SodRule[] = [
  { id: 'sod.perform_review', a: 'perform_work', b: 'review_and_approve', reason: 'A principal who performs the work and also reviews it can approve their own output (the independent review is defeated).' },
  { id: 'sod.propose_approve', a: 'approve_plan', b: 'review_and_approve', reason: 'Proposing and approving the same plan concentrates both halves of the approval in one principal.' },
  { id: 'sod.admin_work', a: 'manage_users', b: 'perform_work', reason: 'Administering users and also working the audit lets a principal grant themselves access to the work.' },
  { id: 'sod.admin_roles', a: 'manage_roles', b: 'manage_users', reason: 'Changing role rights and assigning roles lets a principal escalate their own rights.' },
  { id: 'sod.reopen_review', a: 'can_reopen', b: 'review_and_approve', reason: 'Reopening a sealed record and reviewing it lets a principal undo a control and then pass it.' },
];

/** A principal (a role or a member) and the rights it holds. */
export interface PrincipalRights {
  id: string;
  label: string;
  rights: Partial<Record<Right, boolean>>;
}

export interface SodConflict {
  principalId: string;
  principalLabel: string;
  ruleId: string;
  reason: string;
  a: Right;
  b: Right;
}

export interface SodMatrix {
  conflicts: SodConflict[];
  /** Ids of the principals that hold at least one conflicting combination. */
  conflictedPrincipals: string[];
  /** True when no principal holds a conflicting combination. */
  clean: boolean;
}

/**
 * Segregation-of-duties matrix. For each principal, every forbidden pair it holds is a conflict.
 * Deterministic and total: the same principals and the same rule set always produce the same list,
 * ordered by principal then rule.
 */
export function segregationOfDuties(principals: PrincipalRights[], rules: SodRule[] = SOD_RULES): SodMatrix {
  const conflicts: SodConflict[] = [];
  for (const p of principals) {
    for (const r of rules) {
      if (p.rights[r.a] === true && p.rights[r.b] === true) {
        conflicts.push({
          principalId: p.id,
          principalLabel: p.label,
          ruleId: r.id,
          reason: r.reason,
          a: r.a,
          b: r.b,
        });
      }
    }
  }
  conflicts.sort((x, y) => x.principalLabel.localeCompare(y.principalLabel) || x.ruleId.localeCompare(y.ruleId));
  const conflictedPrincipals = [...new Set(conflicts.map((c) => c.principalId))].sort();
  return { conflicts, conflictedPrincipals, clean: conflicts.length === 0 };
}

/** One approver's authority limit. */
export interface DelegationLimit {
  principalId: string;
  label: string;
  /** The highest value (cents) this principal may approve on their own. */
  limitCents: number;
}

/** One recorded approval. */
export interface ApprovalRecord {
  id: string;
  principalId: string;
  amountCents: number;
  subject: string;
}

export interface DelegationBreach {
  approvalId: string;
  principalId: string;
  principalLabel: string;
  amountCents: number;
  limitCents: number;
  /** How far over the limit, in cents. */
  overByCents: number;
  subject: string;
}

export interface DelegationBreachResult {
  breaches: DelegationBreach[];
  /** Approvals by a principal with no recorded limit are reported as `unlimited` (they cannot breach). */
  unlimitedApprovals: number;
  clean: boolean;
}

/**
 * Delegation-of-authority breach: an approval above the approver's own limit. An approver with no
 * recorded limit is counted, not silently ignored — an absence of a limit is itself worth seeing.
 * Ordered worst-first, then by id, so two runs agree.
 */
export function delegationOfAuthorityBreach(
  limits: DelegationLimit[],
  approvals: ApprovalRecord[]
): DelegationBreachResult {
  const byId = new Map(limits.map((l) => [l.principalId, l]));
  const breaches: DelegationBreach[] = [];
  let unlimitedApprovals = 0;
  for (const a of approvals) {
    const limit = byId.get(a.principalId);
    if (!limit) {
      unlimitedApprovals++;
      continue;
    }
    if (a.amountCents > limit.limitCents) {
      breaches.push({
        approvalId: a.id,
        principalId: a.principalId,
        principalLabel: limit.label,
        amountCents: a.amountCents,
        limitCents: limit.limitCents,
        overByCents: a.amountCents - limit.limitCents,
        subject: a.subject,
      });
    }
  }
  breaches.sort((x, y) => y.overByCents - x.overByCents || x.approvalId.localeCompare(y.approvalId));
  return { breaches, unlimitedApprovals, clean: breaches.length === 0 };
}

/** One granted policy exception. */
export interface PolicyException {
  id: string;
  policy: string;
  grantedTo: string;
  grantedBy: string;
  grantedAt: string;
  /** When it expires, or null for an open-ended exception. */
  expiresAt: string | null;
}

export interface PolicyExceptionRow extends PolicyException {
  /** True when the exception has expired as at `asOf`. */
  expired: boolean;
  /** Days until expiry as at `asOf`; negative when expired, null when open-ended. */
  daysToExpiry: number | null;
}

export interface PolicyExceptionRegister {
  rows: PolicyExceptionRow[];
  expired: PolicyExceptionRow[];
  /** Exceptions still in force, or open-ended. */
  active: PolicyExceptionRow[];
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Policy exception register. Lists every exception with whether it is expired as at `asOf` (time is
 * an argument). Expired exceptions come first, so the ones needing action are visible.
 */
export function policyExceptionRegister(exceptions: PolicyException[], asOf: string): PolicyExceptionRegister {
  const rows: PolicyExceptionRow[] = exceptions.map((e) => {
    const daysToExpiry = e.expiresAt ? daysBetweenIso(asOf, e.expiresAt) : null;
    return { ...e, expired: daysToExpiry !== null && daysToExpiry < 0, daysToExpiry };
  });
  const expired = rows.filter((r) => r.expired).sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0) || a.id.localeCompare(b.id));
  const active = rows.filter((r) => !r.expired).sort((a, b) => a.id.localeCompare(b.id));
  return { rows, expired, active };
}

/** One recorded meeting, with the facts the score is built from. */
export interface MeetingRecord {
  id: string;
  title: string;
  date: string;
  membersExpected: number;
  membersPresent: number;
  /** Actions assigned at THIS meeting. */
  actionsAssigned: number;
  /** Actions carried from prior meetings. */
  priorActionsTotal: number;
  priorActionsClosed: number;
}

export interface MeetingGovernanceRow {
  id: string;
  title: string;
  date: string;
  /** Quorum held: at least half the expected members present (and at least one). */
  quorumMet: boolean;
  /** Fraction of prior actions closed, 0..1; 1 when there were none. */
  priorCloseRate: number;
  /** Actions assigned is recorded (a meeting that assigns nothing is noted). */
  actionsRecorded: boolean;
  /** 0..3: quorum, actions assigned, prior actions closed — one point each. */
  score: number;
}

export interface MeetingGovernance {
  rows: MeetingGovernanceRow[];
  /** Mean score across meetings, or null when there are none. */
  averageScore: number | null;
  /** Meetings failing quorum. */
  failingQuorum: string[];
}

/**
 * Meeting-governance score. Three deterministic points per meeting: quorum held, at least one action
 * assigned, and every prior action closed. Reuses the same shape §3.3 describes for minutes. Ordered
 * oldest-first so a trend reads left to right.
 */
export function meetingGovernance(meetings: MeetingRecord[]): MeetingGovernance {
  const rows: MeetingGovernanceRow[] = meetings
    .map((m) => {
      const quorumMet = m.membersPresent >= Math.max(1, Math.ceil(m.membersExpected / 2));
      const priorCloseRate = m.priorActionsTotal === 0 ? 1 : m.priorActionsClosed / m.priorActionsTotal;
      const actionsRecorded = m.actionsAssigned > 0;
      const score = (quorumMet ? 1 : 0) + (actionsRecorded ? 1 : 0) + (priorCloseRate >= 1 ? 1 : 0);
      return { id: m.id, title: m.title, date: m.date, quorumMet, priorCloseRate, actionsRecorded, score };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const averageScore = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : null;
  const failingQuorum = rows.filter((r) => !r.quorumMet).map((r) => r.id).sort();
  return { rows, averageScore, failingQuorum };
}

/** A regulation and the version in force. */
export interface Regulation {
  id: string;
  title: string;
  /** The version identifier in force. */
  version: string;
  /** When this version came into force (ISO). */
  effectiveFrom: string;
}

/** A policy that references a regulation. */
export interface PolicyReference {
  id: string;
  title: string;
  regulationId: string;
  /** The regulation version the policy was last aligned to. */
  alignedVersion: string;
  /** When the policy was last reviewed (ISO), or null when never reviewed. */
  lastReviewedAt: string | null;
}

export interface RegulatoryImpactRow {
  policyId: string;
  policyTitle: string;
  regulationId: string;
  regulationTitle: string;
  alignedVersion: string;
  currentVersion: string;
  effectiveFrom: string;
  /** True when the policy is aligned to an older version than the one in force. */
  outOfDate: boolean;
}

export interface RegulatoryChangeImpact {
  rows: RegulatoryImpactRow[];
  /** Policies now out of date, most recent regulation change first. */
  stale: RegulatoryImpactRow[];
  /** True when every policy is aligned to the version in force. */
  clean: boolean;
}

/**
 * Regulatory change impact: when a regulation's version changes, every policy that references it and
 * is still aligned to an older version is now out of date. Reuses the same reference shape the
 * comparison engine uses; the arithmetic is a version-string comparison, never a guess.
 */
export function regulatoryChangeImpact(regulations: Regulation[], policies: PolicyReference[]): RegulatoryChangeImpact {
  const byId = new Map(regulations.map((r) => [r.id, r]));
  const rows: RegulatoryImpactRow[] = [];
  for (const p of policies) {
    const reg = byId.get(p.regulationId);
    if (!reg) continue;
    rows.push({
      policyId: p.id,
      policyTitle: p.title,
      regulationId: reg.id,
      regulationTitle: reg.title,
      alignedVersion: p.alignedVersion,
      currentVersion: reg.version,
      effectiveFrom: reg.effectiveFrom,
      outOfDate: p.alignedVersion !== reg.version,
    });
  }
  const stale = rows
    .filter((r) => r.outOfDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.policyId.localeCompare(b.policyId));
  return { rows, stale, clean: stale.length === 0 };
}

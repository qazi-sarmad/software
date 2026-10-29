/**
 * D4 — Assurance operations (docs/SYSTELIGON.md §11.1a).
 *
 * Five deterministic capabilities over the operational data the app already holds:
 *
 *   - engagement health      — behind, over budget or blocked, from its own timestamps and status
 *   - reviewer load and ageing — how long items sit in review, by reviewer
 *   - finding ageing and recurrence — findings open too long, and findings recurring across periods
 *   - report consistency     — the same figure in two places with different values, caught before issue
 *   - audit trail completeness — every required event present for an engagement, with the gap named
 *
 * Pure: every input is an argument (including the day), no clock, no client, no model. Deterministic
 * arithmetic only; every output names the records it used.
 */
import type { AuditEngagement, AuditIssue, WorkingPaper } from '../../types';

/** Days between two ISO days. Negative differences clamp to zero (a due date in the future is not late). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Signed day difference: positive when `toIso` is after `fromIso`. Used where direction matters. */
export function signedDaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export type HealthStatus = 'healthy' | 'at_risk' | 'blocked';

export interface EngagementHealthRow {
  engagementId: string;
  title: string;
  status: AuditEngagement['status'];
  stage: AuditEngagement['stage'];
  /** Days until the due date as at `asOf`; negative when overdue. */
  daysToDue: number;
  overdue: boolean;
  /** Completion shortfall against elapsed time: >0 means the work is behind the clock. */
  scheduleGapPercent: number;
  /** True when a frozen or locked record blocks progress. */
  blocked: boolean;
  health: HealthStatus;
  reasons: string[];
}

export interface EngagementHealthInput {
  engagements: AuditEngagement[];
  asOf: string;
  /** The engagement's start day, by id; used for the elapsed-time comparison. */
  startedAt?: Record<string, string>;
}

/**
 * Engagement health. A closed or signed-off engagement is healthy by definition (it is done). For an
 * open one, three signals: overdue, behind the clock (completion percent lower than elapsed share of
 * the period), and blocked (frozen/locked). Two or more signals, or overdue alone, is `at_risk`; a
 * blocked record is `blocked`; otherwise `healthy`.
 */
export function engagementHealth(input: EngagementHealthInput): EngagementHealthRow[] {
  const rows: EngagementHealthRow[] = input.engagements.map((e) => {
    const reasons: string[] = [];
    const daysToDue = signedDaysBetween(input.asOf, e.dueDate);
    const overdue = daysToDue < 0 && e.status !== 'closed' && e.status !== 'signed_off';
    if (overdue) reasons.push('overdue');

    const start = input.startedAt?.[e.id] ?? e.periodStart;
    const elapsed = daysBetween(start, input.asOf);
    const total = Math.max(1, daysBetween(start, e.dueDate));
    const elapsedShare = Math.min(100, Math.round((elapsed / total) * 100));
    const scheduleGapPercent = elapsedShare - e.completionPercent;
    const behind = scheduleGapPercent > 10 && e.status !== 'closed' && e.status !== 'signed_off';
    if (behind) reasons.push('behind_schedule');

    const blocked = Boolean(e.isLocked) || e.status === 'reopened';
    if (blocked) reasons.push('blocked');

    let health: HealthStatus = 'healthy';
    if (blocked) health = 'blocked';
    else if (overdue || reasons.length >= 2) health = 'at_risk';

    return {
      engagementId: e.id,
      title: e.title,
      status: e.status,
      stage: e.stage,
      daysToDue,
      overdue,
      scheduleGapPercent,
      blocked,
      health,
      reasons,
    };
  });
  // Blocked first, then at_risk, then healthy; within a band, most overdue first.
  const band: Record<HealthStatus, number> = { blocked: 0, at_risk: 1, healthy: 2 };
  return rows.sort((a, b) => band[a.health] - band[b.health] || a.daysToDue - b.daysToDue || a.title.localeCompare(b.title));
}

export interface ReviewerLoadRow {
  reviewerId: string;
  /** Items currently awaiting this reviewer. */
  inReview: number;
  /** Mean days in review across those items, or 0 when none. */
  meanAgeDays: number;
  /** The oldest item's age in days. */
  oldestDays: number;
  /** Ids of items older than `ageingThresholdDays`. */
  ageing: string[];
}

export interface ReviewerLoadInput {
  workpapers: WorkingPaper[];
  asOf: string;
  /** A workpaper in this status is "in review" for the load count. */
  reviewStatus?: WorkingPaper['status'];
  /** Age at which an item is flagged as ageing. */
  ageingThresholdDays?: number;
}

/**
 * Reviewer load and ageing: how many items sit with each reviewer and how long they have sat there.
 * Age is measured from the paper's prepared date (when it entered the queue) to `asOf`. Ordered by
 * load, then by mean age, then by reviewer id, so the most loaded and slowest reviewers surface.
 */
export function reviewerLoadAndAgeing(input: ReviewerLoadInput): ReviewerLoadRow[] {
  const reviewStatus = input.reviewStatus ?? 'ready_for_review';
  const threshold = input.ageingThresholdDays ?? 14;
  const byReviewer = new Map<string, WorkingPaper[]>();
  for (const w of input.workpapers) {
    if (w.status !== reviewStatus) continue;
    const list = byReviewer.get(w.reviewerId);
    if (list) list.push(w);
    else byReviewer.set(w.reviewerId, [w]);
  }
  const rows: ReviewerLoadRow[] = [];
  for (const [reviewerId, items] of byReviewer) {
    const ages = items.map((w) => daysBetween(w.preparedDate ?? w.reviewedDate ?? input.asOf, input.asOf));
    rows.push({
      reviewerId,
      inReview: items.length,
      meanAgeDays: ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
      oldestDays: ages.length ? Math.max(...ages) : 0,
      ageing: items.filter((_, i) => ages[i] > threshold).map((w) => w.id).sort(),
    });
  }
  return rows.sort((a, b) => b.inReview - a.inReview || b.meanAgeDays - a.meanAgeDays || a.reviewerId.localeCompare(b.reviewerId));
}

export interface FindingAgeingRow {
  issueId: string;
  title: string;
  severity: AuditIssue['severity'];
  /** Age in days from identified to asOf. */
  ageDays: number;
  overdue: boolean;
  /** True when a finding with the same title exists in an earlier period — a recurrence. */
  recurring: boolean;
  /** The ids of the earlier findings it repeats. */
  recursOf: string[];
}

export interface FindingAgeingResult {
  rows: FindingAgeingRow[];
  /** Findings open too long (overdue). */
  overdue: FindingAgeingRow[];
  /** Findings recurring across periods. */
  recurring: FindingAgeingRow[];
}

/**
 * Finding ageing and recurrence. Ageing is deterministic arithmetic; recurrence is exact-title
 * matching against an earlier `identifiedDate` — a deterministic signal, not a semantic judgement.
 * Ordered oldest-first, then by title.
 */
export function findingAgeingAndRecurrence(issues: AuditIssue[], asOf: string): FindingAgeingResult {
  const byTitle = new Map<string, AuditIssue[]>();
  for (const i of issues) {
    const key = i.title.trim().toLowerCase();
    const list = byTitle.get(key);
    if (list) list.push(i);
    else byTitle.set(key, [i]);
  }
  const rows: FindingAgeingRow[] = issues.map((i) => {
    const key = i.title.trim().toLowerCase();
    const earlier = (byTitle.get(key) ?? []).filter((o) => o.id !== i.id && o.identifiedDate.slice(0, 10) < i.identifiedDate.slice(0, 10));
    const open = i.status !== 'closed' && i.status !== 'remediated';
    const overdue = open && daysBetween(i.dueDate, asOf) > 0;
    return {
      issueId: i.id,
      title: i.title,
      severity: i.severity,
      ageDays: daysBetween(i.identifiedDate, asOf),
      overdue,
      recurring: earlier.length > 0,
      recursOf: earlier.map((o) => o.id).sort(),
    };
  });
  rows.sort((a, b) => b.ageDays - a.ageDays || a.title.localeCompare(b.title));
  return {
    rows,
    overdue: rows.filter((r) => r.overdue),
    recurring: rows.filter((r) => r.recurring),
  };
}

/** A figure as it appears somewhere in a report: a label and a value. */
export interface ReportFigure {
  id: string;
  label: string;
  value: number;
  /** Where it appears, e.g. "section 3, table 2". */
  location: string;
}

export interface ReportInconsistency {
  label: string;
  values: Array<{ value: number; location: string; id: string }>;
  /** The spread between the highest and lowest value. */
  spread: number;
}

export interface ReportConsistency {
  inconsistencies: ReportInconsistency[];
  consistent: boolean;
}

/**
 * Report consistency: the same figure (by normalised label) appearing in two places with different
 * values — caught before issue. Values are compared exactly (minor units), so a rounding difference
 * is a real difference and is reported. Ordered by spread, then label.
 */
export function reportConsistency(figures: ReportFigure[]): ReportConsistency {
  const byLabel = new Map<string, ReportFigure[]>();
  for (const f of figures) {
    const key = f.label.trim().toLowerCase().replace(/\s+/g, ' ');
    const list = byLabel.get(key);
    if (list) list.push(f);
    else byLabel.set(key, [f]);
  }
  const inconsistencies: ReportInconsistency[] = [];
  for (const [label, group] of byLabel) {
    if (group.length < 2) continue;
    const values = group.map((g) => g.value);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread !== 0) {
      inconsistencies.push({
        label,
        values: group
          .map((g) => ({ value: g.value, location: g.location, id: g.id }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        spread,
      });
    }
  }
  inconsistencies.sort((a, b) => b.spread - a.spread || a.label.localeCompare(b.label));
  return { inconsistencies, consistent: inconsistencies.length === 0 };
}

/** A required event and whether the engagement's trail holds it. */
export interface TrailRequirement {
  key: string;
  label: string;
  present: boolean;
}

export interface TrailCompleteness {
  engagementId: string;
  requirements: TrailRequirement[];
  /** Keys that are missing. */
  missing: string[];
  complete: boolean;
}

/**
 * Audit-trail completeness: every required event present for an engagement, with the gap named. The
 * caller supplies which event keys the trail holds (from the ledger/activity log); this reports the
 * set difference. The required set is the caller's, so an org can widen it without changing the rule.
 */
export function auditTrailCompleteness(
  engagementId: string,
  presentKeys: string[],
  required: Array<{ key: string; label: string }>
): TrailCompleteness {
  const held = new Set(presentKeys);
  const requirements: TrailRequirement[] = required.map((r) => ({
    key: r.key,
    label: r.label,
    present: held.has(r.key),
  }));
  const missing = requirements.filter((r) => !r.present).map((r) => r.key);
  return { engagementId, requirements, missing, complete: missing.length === 0 };
}

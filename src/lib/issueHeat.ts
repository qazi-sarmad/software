/**
 * The issues heat matrix (WP-V slice 1). A pure projection of the issue register into a
 * severity × aging grid, so the register can show a picture beside its table. Time is always an
 * argument (`asOf`), never read from the clock, so the same issues and the same day always produce
 * the same grid.
 */
import type { AuditIssue, Severity } from '../types';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/** Aging buckets, in display order, with the inclusive day range each covers. */
export const AGE_BUCKETS: { key: string; label: string; minDays: number; maxDays: number }[] = [
  { key: '0-30', label: '0–30 days', minDays: 0, maxDays: 30 },
  { key: '31-60', label: '31–60 days', minDays: 31, maxDays: 60 },
  { key: '61-90', label: '61–90 days', minDays: 61, maxDays: 90 },
  { key: '90+', label: 'over 90 days', minDays: 91, maxDays: Number.POSITIVE_INFINITY },
];

export interface HeatCell {
  severity: Severity;
  bucket: string;
  count: number;
  /** True when this cell holds an overdue, unresolved issue — the cell the eye should find. */
  overdue: boolean;
}

export interface HeatMatrix {
  cells: HeatCell[];
  rowTotals: Record<Severity, number>;
  columnTotals: Record<string, number>;
  max: number;
  total: number;
}

/** Whole days between two ISO dates (date-only). Negative differences clamp to zero. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** The aging bucket key for a given number of days. */
export function bucketFor(days: number): string {
  const bucket = AGE_BUCKETS.find((b) => days >= b.minDays && days <= b.maxDays);
  return bucket ? bucket.key : AGE_BUCKETS[AGE_BUCKETS.length - 1].key;
}

/** An issue is open (unresolved) unless it is closed or remediated. */
export function isOpenIssue(issue: AuditIssue): boolean {
  return issue.status !== 'closed' && issue.status !== 'remediated';
}

/** An issue is overdue when it is open and its due date is before the as-of day. */
export function isOverdue(issue: AuditIssue, asOf: string): boolean {
  if (!isOpenIssue(issue)) return false;
  return daysBetween(issue.dueDate, asOf) > 0;
}

/**
 * Build the severity × aging matrix. Aging is measured from the issue's identified date to the
 * as-of day. Only open issues are counted; a closed or remediated issue has left the register's
 * active picture.
 */
export function buildHeatMatrix(issues: AuditIssue[], asOf: string): HeatMatrix {
  const cells: HeatCell[] = [];
  const rowTotals = { critical: 0, high: 0, medium: 0, low: 0 } as Record<Severity, number>;
  const columnTotals: Record<string, number> = {};
  for (const b of AGE_BUCKETS) columnTotals[b.key] = 0;

  let max = 0;
  let total = 0;

  for (const severity of SEVERITY_ORDER) {
    for (const bucket of AGE_BUCKETS) {
      const members = issues.filter(
        (i) => isOpenIssue(i) && i.severity === severity && bucketFor(daysBetween(i.identifiedDate, asOf)) === bucket.key,
      );
      const count = members.length;
      const overdue = members.some((i) => isOverdue(i, asOf));
      cells.push({ severity, bucket: bucket.key, count, overdue });
      rowTotals[severity] += count;
      columnTotals[bucket.key] += count;
      total += count;
      if (count > max) max = count;
    }
  }

  return { cells, rowTotals, columnTotals, max, total };
}

import { describe, expect, it } from 'vitest';
import { AGE_BUCKETS, bucketFor, buildHeatMatrix, daysBetween, isOpenIssue, isOverdue } from './issueHeat';
import type { AuditIssue, Severity } from '../types';

const AS_OF = '2026-10-26';

function issue(over: Partial<AuditIssue>): AuditIssue {
  return {
    id: 'i1', entityId: 'e1', universeId: 'u1', department: 'Finance', title: 'T', description: 'D',
    severity: 'medium', status: 'open', ownerId: 'o1', identifiedDate: '2026-10-01', dueDate: '2026-12-01',
    ...over,
  };
}

describe('WP-V slice 1: the issues heat matrix', () => {
  it('daysBetween counts whole days and clamps negatives to zero', () => {
    expect(daysBetween('2026-10-01', '2026-10-26')).toBe(25);
    expect(daysBetween('2026-10-26', '2026-10-01')).toBe(0);
    expect(daysBetween('not-a-date', '2026-10-26')).toBe(0);
  });

  it('bucketFor maps a day count to the right aging bucket', () => {
    expect(bucketFor(0)).toBe('0-30');
    expect(bucketFor(30)).toBe('0-30');
    expect(bucketFor(31)).toBe('31-60');
    expect(bucketFor(60)).toBe('31-60');
    expect(bucketFor(90)).toBe('61-90');
    expect(bucketFor(91)).toBe('90+');
    expect(bucketFor(999)).toBe('90+');
  });

  it('isOpenIssue treats closed and remediated as resolved', () => {
    expect(isOpenIssue(issue({ status: 'open' }))).toBe(true);
    expect(isOpenIssue(issue({ status: 'closed' }))).toBe(false);
    expect(isOpenIssue(issue({ status: 'remediated' }))).toBe(false);
  });

  it('isOverdue is true only for open issues past their due date', () => {
    expect(isOverdue(issue({ dueDate: '2026-10-01' }), AS_OF)).toBe(true);
    expect(isOverdue(issue({ dueDate: '2026-11-01' }), AS_OF)).toBe(false);
    expect(isOverdue(issue({ dueDate: '2026-10-01', status: 'closed' }), AS_OF)).toBe(false);
  });

  it('places issues in the severity × aging grid and totals them', () => {
    const issues = [
      issue({ id: 'a', severity: 'critical', identifiedDate: '2026-10-20' }), // 6 days -> 0-30
      issue({ id: 'b', severity: 'critical', identifiedDate: '2026-09-10' }), // 46 days -> 31-60
      issue({ id: 'c', severity: 'high', identifiedDate: '2026-07-01' }),     // 117 days -> 90+
      issue({ id: 'd', severity: 'high', identifiedDate: '2026-09-01' }),     // 55 days -> 31-60
      issue({ id: 'e', severity: 'medium', identifiedDate: '2026-08-15' }),   // 72 days -> 61-90
      issue({ id: 'f', severity: 'medium', identifiedDate: '2026-08-15', status: 'closed' }), // excluded
    ];
    const m = buildHeatMatrix(issues, AS_OF);
    expect(m.total).toBe(5);
    expect(m.rowTotals.critical).toBe(2);
    expect(m.rowTotals.high).toBe(2);
    expect(m.rowTotals.medium).toBe(1);
    expect(m.columnTotals['0-30']).toBe(1);
    expect(m.columnTotals['31-60']).toBe(2);
    expect(m.columnTotals['61-90']).toBe(1);
    expect(m.columnTotals['90+']).toBe(1);
    expect(m.max).toBe(1);
    const cell = (sev: Severity, bucket: string) => m.cells.find((c) => c.severity === sev && c.bucket === bucket)!;
    expect(cell('critical', '0-30').count).toBe(1);
    expect(cell('critical', '31-60').count).toBe(1);
    expect(cell('high', '90+').count).toBe(1);
  });

  it('flags a cell as overdue when it holds an overdue open issue', () => {
    const m = buildHeatMatrix([
      issue({ id: 'a', severity: 'critical', identifiedDate: '2026-10-20', dueDate: '2026-10-22' }), // overdue
      issue({ id: 'b', severity: 'critical', identifiedDate: '2026-10-21', dueDate: '2026-12-01' }), // not
    ], AS_OF);
    const cell = m.cells.find((c) => c.severity === 'critical' && c.bucket === '0-30')!;
    expect(cell.count).toBe(2);
    expect(cell.overdue).toBe(true);
  });

  it('is deterministic: the same issues and as-of day give the same matrix', () => {
    const issues = [issue({ id: 'a' }), issue({ id: 'b', severity: 'high' })];
    expect(buildHeatMatrix(issues, AS_OF)).toEqual(buildHeatMatrix(issues, AS_OF));
  });

  it('produces a cell for every severity × bucket combination', () => {
    const m = buildHeatMatrix([], AS_OF);
    expect(m.cells.length).toBe(4 * AGE_BUCKETS.length);
    expect(m.total).toBe(0);
    expect(m.max).toBe(0);
  });
});

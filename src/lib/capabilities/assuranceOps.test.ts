import { describe, expect, it } from 'vitest';
import {
  auditTrailCompleteness,
  daysBetween,
  engagementHealth,
  findingAgeingAndRecurrence,
  reportConsistency,
  reviewerLoadAndAgeing,
  type ReportFigure,
} from './assuranceOps';
import type { AuditEngagement, AuditIssue, WorkingPaper } from '../../types';

const AS_OF = '2026-10-01';

function engagement(over: Partial<AuditEngagement>): AuditEngagement {
  return {
    id: 'g1', universeId: 'u1', entityId: 'e1', title: 'Engagement One', stage: 'testing',
    status: 'in_progress', leadAuditorId: 'a1', reviewerId: 'r1', periodStart: '2026-01-01',
    periodEnd: '2026-12-31', dueDate: '2026-12-01', completionPercent: 50,
    ...over,
  };
}

function issue(over: Partial<AuditIssue>): AuditIssue {
  return {
    id: 'i1', entityId: 'e1', universeId: 'u1', department: 'Finance', title: 'Late reconciliation',
    description: '', severity: 'medium', status: 'open', ownerId: 'o1', identifiedDate: '2026-01-01',
    dueDate: '2026-03-01', ...over,
  };
}

function workpaper(over: Partial<WorkingPaper>): WorkingPaper {
  return {
    id: 'w1', engagementId: 'g1', controlId: 'c1', entityId: 'e1', refCode: 'W1', title: 'Paper',
    status: 'ready_for_review', preparerId: 'p1', reviewerId: 'r1', preparedDate: '2026-09-01',
    testSteps: [], populationCount: 0, sampleCount: 0, exceptionsIdentified: 0, conclusion: '',
    evidenceItems: [], ...over,
  };
}

describe('D4 — assurance operations', () => {
  it('daysBetween counts whole days and clamps negatives', () => {
    expect(daysBetween('2026-10-01', '2026-10-11')).toBe(10);
    expect(daysBetween('2026-10-11', '2026-10-01')).toBe(0);
  });

  it('engagementHealth flags an overdue open engagement as at risk', () => {
    const rows = engagementHealth({ engagements: [engagement({ dueDate: '2026-09-01' })], asOf: AS_OF });
    expect(rows[0].overdue).toBe(true);
    expect(rows[0].health).toBe('at_risk');
    expect(rows[0].reasons).toContain('overdue');
  });

  it('engagementHealth calls a closed engagement healthy and a locked one blocked', () => {
    const rows = engagementHealth({
      engagements: [
        engagement({ id: 'a', status: 'signed_off', dueDate: '2026-01-01' }),
        engagement({ id: 'b', title: 'Locked', isLocked: true }),
      ],
      asOf: AS_OF,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.engagementId, r]));
    expect(byId.a.health).toBe('healthy');
    expect(byId.b.health).toBe('blocked');
    expect(rows[0].engagementId).toBe('b'); // blocked sorts first
  });

  it('reviewerLoadAndAgeing groups by reviewer and flags ageing items', () => {
    const wps = [
      workpaper({ id: 'w1', reviewerId: 'r1', preparedDate: '2026-09-01' }), // 30 days
      workpaper({ id: 'w2', reviewerId: 'r1', preparedDate: '2026-09-28' }), // 3 days
      workpaper({ id: 'w3', reviewerId: 'r2', preparedDate: '2026-09-30' }), // 1 day
    ];
    const rows = reviewerLoadAndAgeing({ workpapers: wps, asOf: AS_OF, ageingThresholdDays: 14 });
    expect(rows[0].reviewerId).toBe('r1');
    expect(rows[0].inReview).toBe(2);
    expect(rows[0].oldestDays).toBe(30);
    expect(rows[0].ageing).toEqual(['w1']);
  });

  it('findingAgeingAndRecurrence reports age, overdue and a recurrence', () => {
    const issues = [
      issue({ id: 'old', identifiedDate: '2025-06-01', dueDate: '2025-12-01' }),
      issue({ id: 'new', identifiedDate: '2026-08-01', dueDate: '2026-12-01' }),
    ];
    const res = findingAgeingAndRecurrence(issues, AS_OF);
    const byId = Object.fromEntries(res.rows.map((r) => [r.issueId, r]));
    expect(byId.new.recurring).toBe(true);
    expect(byId.new.recursOf).toEqual(['old']);
    expect(byId.old.overdue).toBe(true);
    expect(res.overdue.map((r) => r.issueId)).toEqual(['old']);
    expect(res.recurring.map((r) => r.issueId)).toEqual(['new']);
  });

  it('reportConsistency catches the same figure with two values', () => {
    const figures: ReportFigure[] = [
      { id: 'f1', label: 'Total revenue', value: 1000, location: 'summary' },
      { id: 'f2', label: 'total   REVENUE', value: 1200, location: 'section 3' },
      { id: 'f3', label: 'Net assets', value: 500, location: 'summary' },
    ];
    const res = reportConsistency(figures);
    expect(res.consistent).toBe(false);
    expect(res.inconsistencies[0].label).toBe('total revenue');
    expect(res.inconsistencies[0].spread).toBe(200);
    expect(res.inconsistencies[0].values.map((v) => v.id)).toEqual(['f1', 'f2']);
  });

  it('reportConsistency is clean when labels agree', () => {
    const res = reportConsistency([
      { id: 'f1', label: 'Total', value: 10, location: 'a' },
      { id: 'f2', label: 'Total', value: 10, location: 'b' },
    ]);
    expect(res.consistent).toBe(true);
  });

  it('auditTrailCompleteness names the missing event', () => {
    const res = auditTrailCompleteness('g1', ['plan_approved', 'test_finalized'], [
      { key: 'plan_approved', label: 'Plan approved' },
      { key: 'test_finalized', label: 'Test finalised' },
      { key: 'reviewer_sign_off', label: 'Reviewer sign-off' },
    ]);
    expect(res.complete).toBe(false);
    expect(res.missing).toEqual(['reviewer_sign_off']);
    expect(res.requirements.find((r) => r.key === 'plan_approved')?.present).toBe(true);
  });
});

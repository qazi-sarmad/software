import { describe, expect, it } from 'vitest';
import { buildFrontDoor, frontDoorSummary, CONSEQUENCE_RANK } from './frontDoor';
import type {
  AuditCapItem,
  AuditEngagement,
  ReviewComment,
  User,
  WorkingPaper,
} from '../types';

const TODAY = '2026-09-30';

const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  name: 'Ayesha',
  email: 'a@example.com',
  avatar: 'AY',
  role: 'preparer',
  universeIds: ['un1'],
  entityIds: ['e1'],
  ...over,
});

const eng = (over: Partial<AuditEngagement> = {}): AuditEngagement => ({
  id: 'g1',
  universeId: 'un1',
  entityId: 'e1',
  title: 'Treasury cycle',
  stage: 'testing',
  status: 'in_progress',
  leadAuditorId: 'u1',
  reviewerId: 'r1',
  periodStart: '2026-01-01',
  periodEnd: '2026-06-30',
  dueDate: '2026-12-31',
  completionPercent: 40,
  ...over,
});

const wp = (over: Partial<WorkingPaper> = {}): WorkingPaper =>
  ({
    id: 'w1',
    engagementId: 'g1',
    controlId: 'c1',
    entityId: 'e1',
    refCode: 'WP-01',
    title: 'Cash reconciliation',
    status: 'in_progress',
    preparerId: 'u1',
    reviewerId: 'r1',
    testSteps: [],
    populationCount: 10,
    sampleCount: 2,
    exceptionsIdentified: 0,
    conclusion: '',
    evidenceItems: [],
    ...over,
  }) as WorkingPaper;

const cap = (over: Partial<AuditCapItem> = {}): AuditCapItem => ({
  id: 'CAP-1',
  action: 'a',
  title: 'Fix the pipeline',
  owner: 'owner',
  department: 'Treasury',
  severity: 'high',
  dueDate: '2026-12-31',
  status: 'Open',
  identifiedDate: '2026-01-01',
  entityId: 'e1',
  engagementId: 'g1',
  ...over,
});

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 'cm1',
  workpaperId: 'w1',
  authorId: 'r1',
  authorName: 'Rashid',
  authorRole: 'audit_manager',
  text: 'Please attach the bank statement.',
  createdAt: '2026-09-01',
  ...over,
});

const base = {
  user: user(),
  todayIso: TODAY,
  engagements: [] as AuditEngagement[],
  workpapers: [] as WorkingPaper[],
  capItems: [] as AuditCapItem[],
  comments: [] as ReviewComment[],
};

describe('front door (U3)', () => {
  it('orders by consequence, not by input order', () => {
    const items = buildFrontDoor({
      ...base,
      user: user({ role: 'audit_manager' }),
      // Deliberately supplied in reverse consequence order.
      workpapers: [wp({ status: 'in_progress' })],
      comments: [comment()],
      engagements: [eng({ approvalStatus: 'pending_approval' })],
      capItems: [cap({ dueDate: '2026-01-01', status: 'Open' })],
    });
    const kinds = items.map((i) => i.kind);
    // cap_overdue (1) before approval (3) before comment (5) before workpaper (6)
    expect(kinds).toEqual(['cap_overdue', 'approval', 'comment', 'workpaper']);
  });

  it('is deterministic: same rows, same order, twice', () => {
    const input = {
      ...base,
      capItems: [cap({ id: 'CAP-B', dueDate: '2026-01-01' }), cap({ id: 'CAP-A', dueDate: '2026-01-01' })],
    };
    expect(buildFrontDoor(input).map((i) => i.id)).toEqual(buildFrontDoor(input).map((i) => i.id));
  });

  it('ranks every kind it can emit', () => {
    const items = buildFrontDoor({
      ...base,
      capItems: [cap({ dueDate: '2026-01-01' })],
      engagements: [eng({ dueDate: '2026-01-01', approvalStatus: 'pending_approval' })],
      workpapers: [wp({ status: 'ready_for_review', reviewerId: 'u1' })],
      comments: [comment()],
    });
    for (const item of items) expect(CONSEQUENCE_RANK[item.kind]).toBeGreaterThan(0);
  });

  it('gates approval rows on the right, not a role name', () => {
    const withRight = buildFrontDoor({
      ...base,
      user: user({ rights: { review_and_approve: true } }),
      engagements: [eng({ approvalStatus: 'pending_approval' })],
    });
    const withoutRight = buildFrontDoor({
      ...base,
      user: user(),
      engagements: [eng({ approvalStatus: 'pending_approval' })],
    });
    expect(withRight.some((i) => i.kind === 'approval')).toBe(true);
    expect(withoutRight.some((i) => i.kind === 'approval')).toBe(false);
  });

  it('treats an overdue CAP as most consequential, using the supplied day', () => {
    // dueDate after today → not overdue, so no cap row.
    const notYet = buildFrontDoor({ ...base, capItems: [cap({ dueDate: '2026-12-31', status: 'Open' })] });
    expect(notYet.some((i) => i.kind === 'cap_overdue')).toBe(false);
    const late = buildFrontDoor({ ...base, capItems: [cap({ dueDate: '2026-01-01', status: 'Open' })] });
    expect(late.some((i) => i.kind === 'cap_overdue')).toBe(true);
  });

  it('never surfaces another user’s workpaper or their comments', () => {
    const items = buildFrontDoor({
      ...base,
      workpapers: [wp({ preparerId: 'other', reviewerId: 'other' })],
      comments: [comment()],
    });
    expect(items).toHaveLength(0);
  });

  it('summarises in the spec’s shape', () => {
    const items = buildFrontDoor({
      ...base,
      workpapers: [wp({ status: 'in_progress' })],
      capItems: [cap({ dueDate: '2026-01-01' })],
      comments: [comment()],
    });
    const summary = frontDoorSummary(items);
    expect(summary).toMatch(/1 CAP overdue/);
    expect(summary).toMatch(/1 comment unanswered/);
  });

  it('says so honestly when nothing needs the user', () => {
    expect(frontDoorSummary([])).toMatch(/Nothing needs you/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  awaitingMyApproval,
  awaitingMySignOff,
  buildWorkQueue,
  myTeamWork,
  myWorkpapers,
} from './workQueue';
import { AuditCapItem, AuditEngagement, ReviewComment, Role, User, WorkingPaper } from '../types';

const user = (role: Role, id?: string): User => ({
  id: id ?? `u-${role}`,
  name: role,
  email: `${role}@x`,
  avatar: '',
  role,
  universeIds: [],
  entityIds: [],
});

const wp = (over: Partial<WorkingPaper>): WorkingPaper =>
  ({
    id: 'w1',
    engagementId: 'e1',
    controlId: 'c1',
    entityId: 'ent1',
    refCode: 'WP-01',
    title: 'Control test',
    status: 'draft',
    preparerId: 'u-preparer',
    reviewerId: 'u-reviewer',
    testSteps: [],
    ...over,
  }) as WorkingPaper;

const eng = (over: Partial<AuditEngagement>): AuditEngagement =>
  ({
    id: 'e1',
    universeId: 'u1',
    entityId: 'ent1',
    title: 'Q3 audit',
    stage: 'testing',
    status: 'in_progress',
    leadAuditorId: 'u-preparer',
    reviewerId: 'u-reviewer',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    dueDate: '2026-10-31',
    completionPercent: 50,
    ...over,
  }) as AuditEngagement;

const cap = (over: Partial<AuditCapItem>): AuditCapItem =>
  ({
    id: 'CAP-1',
    action: 'Fix it',
    title: 'Remediate',
    owner: 'Owner',
    department: 'Ops',
    severity: 'high',
    dueDate: '2026-10-01',
    status: 'Pending validation',
    identifiedDate: '2026-09-01',
    entityId: 'ent1',
    engagementId: 'e1',
    ...over,
  }) as AuditCapItem;

const comment = (over: Partial<ReviewComment>): ReviewComment =>
  ({
    id: 'c1',
    workpaperId: 'w1',
    authorId: 'u-reviewer',
    authorName: 'Reviewer',
    authorRole: 'reviewer',
    text: 'Please clarify',
    createdAt: '2026-10-01',
    ...over,
  }) as ReviewComment;

describe('Work Queue personalisation (§5)', () => {
  it('my workpapers: only rows this user prepares or reviews, not sealed', () => {
    const me = user('preparer');
    const items = myWorkpapers({
      user: me,
      engagements: [eng({})],
      workpapers: [
        wp({ id: 'mine', preparerId: me.id, status: 'in_progress' }),
        wp({ id: 'sealed', preparerId: me.id, status: 'signed_off' }),
        wp({ id: 'other', preparerId: 'someone', reviewerId: 'someone' }),
      ],
      capItems: [],
      comments: [],
    });
    expect(items.map((i) => i.id)).toEqual(['mine']);
  });

  it('awaiting my sign-off: ready workpapers and engagements this user reviews', () => {
    const me = user('reviewer');
    const items = awaitingMySignOff({
      user: me,
      engagements: [eng({ reviewerId: me.id }), eng({ id: 'e2', reviewerId: 'other' })],
      workpapers: [wp({ id: 'ready', reviewerId: me.id, status: 'ready_for_review' })],
      capItems: [],
      comments: [],
    });
    expect(items.map((i) => i.id)).toEqual(['ready', 'e1']);
  });

  it('awaiting my approval: pending engagements and CAPs, gated by rights not role', () => {
    const preparer = user('preparer');
    expect(
      awaitingMyApproval({
        user: preparer,
        engagements: [eng({ approvalStatus: 'pending_approval' })],
        workpapers: [],
        capItems: [cap({})],
        comments: [],
      }),
    ).toEqual([]);

    const reviewer = user('reviewer');
    const items = awaitingMyApproval({
      user: reviewer,
      engagements: [eng({ approvalStatus: 'pending_approval' })],
      workpapers: [],
      capItems: [cap({}), cap({ id: 'CAP-2', status: 'Closed' })],
      comments: [],
    });
    expect(items.map((i) => i.id).sort()).toEqual(['CAP-1', 'e1']);
  });

  it("my team's work: only a manager sees other people's open workpapers", () => {
    const preparer = user('preparer');
    const input = {
      user: preparer,
      engagements: [eng({})],
      workpapers: [wp({ id: 'other', preparerId: 'someone', reviewerId: 'someone' })],
      capItems: [],
      comments: [],
    };
    expect(myTeamWork(input)).toEqual([]);

    const manager = user('audit_manager');
    expect(myTeamWork({ ...input, user: manager }).map((i) => i.id)).toEqual(['other']);
  });

  it('builds the four sections in spec order', () => {
    const me = user('audit_manager');
    const sections = buildWorkQueue({
      user: me,
      engagements: [eng({ approvalStatus: 'pending_approval' })],
      workpapers: [wp({ id: 'mine', preparerId: me.id })],
      capItems: [cap({})],
      comments: [comment({ authorId: 'someone-else' })],
    });
    expect(sections.map((s) => s.key)).toEqual(['workpapers', 'signoff', 'approval', 'team']);
    expect(sections[0].items.length).toBe(1);
  });
});

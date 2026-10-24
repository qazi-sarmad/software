/**
 * Work Queue (SPEC-v10 §5) — user-specific work.
 *
 * The queue answers one question: what needs *this* user. It is a pure function over the scoped
 * data the app already holds, so it is deterministic and unit-testable without a database. The
 * caller (PendingTasksTab) passes the scoped rows and the signed-in user; nothing here reads the
 * Supabase client or the clock.
 *
 * Rights, not role names: "manager" work is gated by the review_and_approve right, not by a role
 * string (Laws; §30.1).
 */
import type { AuditCapItem, AuditEngagement, ReviewComment, User, WorkingPaper } from '../types';
import { hasRight } from './rights';

export type WorkQueueSection = {
  key: 'workpapers' | 'signoff' | 'approval' | 'team';
  title: string;
  items: WorkQueueItem[];
};

export type WorkQueueItem = {
  id: string;
  title: string;
  subtitle: string;
  engagementId?: string;
  workpaperId?: string;
};

export type WorkQueueInput = {
  user: User;
  engagements: AuditEngagement[];
  workpapers: WorkingPaper[];
  capItems: AuditCapItem[];
  comments: ReviewComment[];
};

const isOpenWorkpaper = (w: WorkingPaper) => w.status !== 'signed_off';

/** Workpapers this user prepares or reviews and that are not yet sealed. */
export function myWorkpapers(input: WorkQueueInput): WorkQueueItem[] {
  const { user, workpapers, engagements } = input;
  return workpapers
    .filter((w) => (w.preparerId === user.id || w.reviewerId === user.id) && isOpenWorkpaper(w))
    .map((w) => ({
      id: w.id,
      title: `${w.refCode} · ${w.title}`,
      subtitle: engagements.find((e) => e.id === w.engagementId)?.title ?? '',
      engagementId: w.engagementId,
    }));
}

/** Records waiting on this user's sign-off: workpapers they review that are ready, and engagements
 *  they lead that are staged for review. */
export function awaitingMySignOff(input: WorkQueueInput): WorkQueueItem[] {
  const { user, workpapers, engagements } = input;
  const fromWorkpapers = workpapers
    .filter((w) => w.reviewerId === user.id && w.status === 'ready_for_review')
    .map((w) => ({
      id: w.id,
      title: `${w.refCode} · ${w.title}`,
      subtitle: 'Ready for review',
      engagementId: w.engagementId,
    }));
  const fromEngagements = engagements
    .filter((e) => e.reviewerId === user.id && e.status !== 'signed_off')
    .map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: `${e.stage} · awaiting your sign-off`,
      engagementId: e.id,
    }));
  return [...fromWorkpapers, ...fromEngagements];
}

/** Items awaiting this user's approval: engagements pending approval (when the user may approve)
 *  and CAPs pending validation (when the user may verify and close). */
export function awaitingMyApproval(input: WorkQueueInput): WorkQueueItem[] {
  const { user, engagements, capItems } = input;
  const items: WorkQueueItem[] = [];
  if (hasRight(user, 'review_and_approve') || hasRight(user, 'approve_plan')) {
    engagements
      .filter((e) => e.approvalStatus === 'pending_approval')
      .forEach((e) =>
        items.push({
          id: e.id,
          title: e.title,
          subtitle: 'Engagement awaiting approval',
          engagementId: e.id,
        }),
      );
  }
  if (hasRight(user, 'review_and_approve')) {
    capItems
      .filter((c) => c.status === 'Pending validation')
      .forEach((c) =>
        items.push({
          id: c.id,
          title: `${c.id} · ${c.title}`,
          subtitle: 'CAP awaiting verification',
          engagementId: c.engagementId,
        }),
      );
  }
  return items;
}

/** The team's open work, shown only to a manager (review_and_approve right) and never to the
 *  individual members' private queues. */
export function myTeamWork(input: WorkQueueInput): WorkQueueItem[] {
  const { user, workpapers, engagements } = input;
  if (!hasRight(user, 'review_and_approve')) return [];
  return workpapers
    .filter((w) => isOpenWorkpaper(w) && w.preparerId !== user.id && w.reviewerId !== user.id)
    .map((w) => ({
      id: w.id,
      title: `${w.refCode} · ${w.title}`,
      subtitle: engagements.find((e) => e.id === w.engagementId)?.title ?? '',
      engagementId: w.engagementId,
    }));
}

/** Comments addressed to this user's work that are still awaiting a response. */
export function myComments(input: WorkQueueInput): WorkQueueItem[] {
  const { user, comments, workpapers, engagements } = input;
  return comments
    .filter((c) => {
      if (c.authorId === user.id) return false;
      const wp = workpapers.find((w) => w.id === c.workpaperId);
      return !!wp && (wp.preparerId === user.id || wp.reviewerId === user.id);
    })
    .map((c) => {
      const wp = workpapers.find((w) => w.id === c.workpaperId);
      const eng = engagements.find((e) => e.id === wp?.engagementId);
      return {
        id: c.id,
        title: c.text,
        subtitle: `${c.authorName}${wp ? ` · on ${wp.refCode}` : ''}${eng ? ` · ${eng.title}` : ''}`,
        engagementId: eng?.id,
        workpaperId: wp?.id,
      };
    });
}

/** Build the four sections in the order the spec lists them. */
export function buildWorkQueue(input: WorkQueueInput): WorkQueueSection[] {
  return [
    { key: 'workpapers', title: 'My workpapers', items: myWorkpapers(input) },
    { key: 'signoff', title: 'Awaiting my sign-off', items: awaitingMySignOff(input) },
    { key: 'approval', title: 'Awaiting my approval', items: awaitingMyApproval(input) },
    { key: 'team', title: "My team's work", items: myTeamWork(input) },
  ];
}

/**
 * The front door (U3; SPEC-v10 §5, docs/SYSTELIGON.md §11.1c Tier 1 item 3).
 *
 * What needs THIS user, today, ordered by consequence — a rule over rows the app already holds, not
 * a chart. The ordering is a property of the rule, not of the data, so it is deterministic: two
 * runs over the same rows give the same list in the same order.
 *
 * Time is an argument (`todayIso`), never read from the clock here (Laws). Rights decide the
 * approval and sign-off rows, never a role name.
 */
import type { AuditCapItem, AuditEngagement, ReviewComment, User, WorkingPaper } from '../types';
import { hasRight } from './rights';
import { isCapOverdue } from './orgDate';

/** The kinds of work the front door can surface, most consequential first. */
export type FrontDoorKind =
  | 'cap_overdue'
  | 'audit_overdue'
  | 'approval'
  | 'signoff'
  | 'comment'
  | 'workpaper';

/**
 * Consequence rank per kind. Lower is more consequential, and the list is sorted by it, so an
 * overdue control remediation always outranks an unanswered comment. This table IS the ordering
 * rule; changing the product's priorities means changing this table, not the data.
 */
export const CONSEQUENCE_RANK: Record<FrontDoorKind, number> = {
  cap_overdue: 1,
  audit_overdue: 2,
  approval: 3,
  signoff: 4,
  comment: 5,
  workpaper: 6,
};

export interface FrontDoorItem {
  id: string;
  kind: FrontDoorKind;
  title: string;
  detail: string;
  /** The verb the row offers, e.g. "Validate the CAP". */
  actionLabel: string;
  engagementId?: string;
  workpaperId?: string;
}

export interface FrontDoorInput {
  user: User;
  todayIso: string;
  engagements: AuditEngagement[];
  workpapers: WorkingPaper[];
  capItems: AuditCapItem[];
  comments: ReviewComment[];
}

/**
 * Build the consequence-ordered list. Every row is something the user can act on; the caller wires
 * `actionLabel` to the existing inspector. Nothing here reads the clock or the database.
 */
export function buildFrontDoor(input: FrontDoorInput): FrontDoorItem[] {
  const { user, todayIso, engagements, workpapers, capItems, comments } = input;
  const items: FrontDoorItem[] = [];

  // 1. Overdue corrective actions: an agreed remediation has slipped. Most consequential.
  for (const cap of capItems) {
    if (isCapOverdue(cap.status, cap.dueDate, todayIso)) {
      items.push({
        id: `cap:${cap.id}`,
        kind: 'cap_overdue',
        title: cap.title,
        detail: `${cap.department} · was due ${cap.dueDate}`,
        actionLabel: 'Validate the CAP',
        engagementId: cap.engagementId,
      });
    }
  }

  // 2. Audits past their due date that this user leads or reviews and that are not sealed.
  for (const eng of engagements) {
    const mine = eng.leadAuditorId === user.id || eng.reviewerId === user.id;
    if (mine && eng.status !== 'signed_off' && eng.dueDate < todayIso) {
      items.push({
        id: `eng:${eng.id}`,
        kind: 'audit_overdue',
        title: eng.title,
        detail: `${eng.stage} · was due ${eng.dueDate}`,
        actionLabel: 'Open the audit file',
        engagementId: eng.id,
      });
    }
  }

  // 3. Approvals waiting on this user, gated by the right, never a role name.
  if (hasRight(user, 'review_and_approve') || hasRight(user, 'approve_plan')) {
    for (const eng of engagements) {
      if (eng.approvalStatus === 'pending_approval') {
        items.push({
          id: `appr:${eng.id}`,
          kind: 'approval',
          title: eng.title,
          detail: 'Awaiting your approval',
          actionLabel: 'Review and decide',
          engagementId: eng.id,
        });
      }
    }
    for (const cap of capItems) {
      if (cap.status === 'Pending validation') {
        items.push({
          id: `appr:cap:${cap.id}`,
          kind: 'approval',
          title: cap.title,
          detail: 'Corrective action awaiting validation',
          actionLabel: 'Validate the CAP',
          engagementId: cap.engagementId,
        });
      }
    }
  }

  // 4. Records waiting on this user's sign-off.
  for (const wp of workpapers) {
    if (wp.reviewerId === user.id && wp.status === 'ready_for_review') {
      items.push({
        id: `sign:${wp.id}`,
        kind: 'signoff',
        title: `${wp.refCode} · ${wp.title}`,
        detail: 'Ready for your review',
        actionLabel: 'Open the workbench',
        workpaperId: wp.id,
        engagementId: wp.engagementId,
      });
    }
  }
  for (const eng of engagements) {
    if (eng.reviewerId === user.id && eng.status !== 'signed_off') {
      items.push({
        id: `sign:eng:${eng.id}`,
        kind: 'signoff',
        title: eng.title,
        detail: `${eng.stage} · awaiting your sign-off`,
        actionLabel: 'Open the audit file',
        engagementId: eng.id,
      });
    }
  }

  // 5. Review comments on this user's work awaiting a response.
  for (const comment of comments) {
    if (comment.authorId === user.id) continue;
    const wp = workpapers.find((w) => w.id === comment.workpaperId);
    if (!wp) continue;
    if (wp.preparerId !== user.id && wp.reviewerId !== user.id) continue;
    items.push({
      id: `cmt:${comment.id}`,
      kind: 'comment',
      title: comment.text,
      detail: `${comment.authorName} · on ${wp.refCode}`,
      actionLabel: 'Answer the comment',
      workpaperId: wp.id,
      engagementId: wp.engagementId,
    });
  }

  // 6. Workpapers this user prepares that are still open.
  for (const wp of workpapers) {
    if (wp.preparerId === user.id && wp.status !== 'signed_off') {
      items.push({
        id: `wp:${wp.id}`,
        kind: 'workpaper',
        title: `${wp.refCode} · ${wp.title}`,
        detail: 'Your working paper, still open',
        actionLabel: 'Open the workbench',
        workpaperId: wp.id,
        engagementId: wp.engagementId,
      });
    }
  }

  return items.sort(
    (a, b) => CONSEQUENCE_RANK[a.kind] - CONSEQUENCE_RANK[b.kind] || a.id.localeCompare(b.id)
  );
}

/** A one-line summary of what the front door holds, in the spec's own shape. */
export function frontDoorSummary(items: FrontDoorItem[]): string {
  const count = (kind: FrontDoorKind) => items.filter((i) => i.kind === kind).length;
  const parts: string[] = [];
  const caps = count('cap_overdue');
  if (caps) parts.push(`${caps} CAP${caps === 1 ? '' : 's'} overdue`);
  const overdue = count('audit_overdue');
  if (overdue) parts.push(`${overdue} audit${overdue === 1 ? '' : 's'} overdue`);
  const approvals = count('approval');
  if (approvals) parts.push(`${approvals} awaiting your approval`);
  const signoffs = count('signoff');
  if (signoffs) parts.push(`${signoffs} awaiting your sign-off`);
  const comments = count('comment');
  if (comments) parts.push(`${comments} comment${comments === 1 ? '' : 's'} unanswered`);
  const papers = count('workpaper');
  if (papers) parts.push(`${papers} working paper${papers === 1 ? '' : 's'} open`);
  if (parts.length === 0) return 'Nothing needs you right now.';
  return parts.join('. ') + '.';
}

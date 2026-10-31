/**
 * The review-comment popout model (S21; docs/EXPLAIN-LAYER.md, Law L2).
 *
 * A review comment is a dialogue record: who asked, how long ago, on which working paper and
 * engagement, whether it is still open, and what has to happen for it to close. The popout shows
 * exactly that, and it is a PURE function of the rows the host screen already held, so the popout
 * cannot surface a field the host filtered.
 *
 * The host screen has already scoped the comment through `src/lib/access.ts`; this module re-checks
 * the caller's rights and redacts (Law L2). Time is an argument (`todayIso`), never read here.
 */
import type { AuditEngagement, ReviewComment, User, WorkingPaper } from '../types';
import { hasAnyAuditRight, hasRight, isReadOnly } from './rights';
import { daysBetween } from './boardPackVisuals';

/** The states the popout can render. `redacted` is not a comment state; it is the viewer's. */
export type CommentPopoutStatus = 'open' | 'addressed' | 'cleared' | 'redacted';

export interface CommentPopoutModel {
  /** The comment id, so a drilldown can name the exact record. */
  id: string;
  status: CommentPopoutStatus;
  /** Human label for the status chip. */
  statusLabel: string;
  /** Who wrote it and in what capacity. */
  author: string;
  authorRole: string;
  /** Whole days since the comment was created, at `todayIso`. */
  ageDays: number;
  ageLabel: string;
  /** The working paper the comment is on, when the host could resolve it. */
  workpaperRef: string | null;
  workpaperTitle: string | null;
  /** The engagement that owns the working paper, when the host could resolve it. */
  engagementTitle: string | null;
  /** The comment body, or null when the viewer may not read it. */
  text: string | null;
  /** What has to happen for this comment to close, in plain words. */
  resolutionPath: string;
  /** When the viewer may not read the comment at all, the reason (never empty). */
  redactedReason: string | null;
}

export interface CommentPopoutInput {
  comment: ReviewComment;
  workpaper?: WorkingPaper;
  engagement?: AuditEngagement;
  /** The org-local today, so the age is deterministic. */
  todayIso: string;
  viewer: User;
}

/**
 * Whether this viewer may read a review comment at all. Mirrors `filterComments` in
 * `src/lib/access.ts`: a configuration-only principal, and an observer (read-only with
 * view-all-scopes), see no comments — so the popout must redact rather than reveal.
 */
export function canViewComment(user: User | null | undefined): boolean {
  if (!user || !hasAnyAuditRight(user)) return false;
  if (isReadOnly(user) && hasRight(user, 'view_all_scopes')) return false;
  return true;
}

/** A plain-language label for the comment's lifecycle state. */
function statusOf(c: ReviewComment): { status: CommentPopoutStatus; label: string } {
  if (c.status === 'cleared') return { status: 'cleared', label: 'Cleared' };
  if (c.status === 'addressed') return { status: 'addressed', label: 'Addressed' };
  if (c.status === 'open') return { status: 'open', label: 'Open' };
  // Seed records carry no status: resolved ⇒ cleared, otherwise open.
  return c.resolved ? { status: 'cleared', label: 'Cleared' } : { status: 'open', label: 'Open' };
}

/** What closes this comment, stated as a rule, not a guess. */
function resolutionPathFor(status: CommentPopoutStatus, c: ReviewComment): string {
  if (status === 'cleared') {
    const by = c.resolvedBy ? ` by ${c.resolvedBy}` : '';
    return `Cleared${by}. No further action is required.`;
  }
  if (status === 'addressed') {
    return 'The preparer has responded; a reviewer must clear it to close.';
  }
  return "Awaiting the preparer's response. Only a reviewer holding review rights can clear it.";
}

/** Whole days between the comment's creation and today, never negative. */
export function commentAgeDays(createdAt: string, todayIso: string): number {
  return daysBetween(createdAt.slice(0, 10), todayIso.slice(0, 10));
}

/** The age, said the way a person would say it. */
export function ageLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

/**
 * Build the popout model. It NEVER returns null and NEVER leaves the status unstated: a viewer who
 * may not read the comment gets `redacted` plus the reason, so a missing popout never looks like a
 * bug (the same rule the explain catalogue follows).
 */
export function commentPopout(input: CommentPopoutInput): CommentPopoutModel {
  const { comment: c, workpaper, engagement, todayIso, viewer } = input;
  const ageDays = commentAgeDays(c.createdAt, todayIso);
  const base = {
    id: c.id,
    author: c.authorName,
    authorRole: c.authorRole,
    ageDays,
    ageLabel: ageLabel(ageDays),
    workpaperRef: workpaper?.refCode ?? null,
    workpaperTitle: workpaper?.title ?? null,
    engagementTitle: engagement?.title ?? null,
  };

  if (!canViewComment(viewer)) {
    return {
      ...base,
      status: 'redacted',
      statusLabel: 'Restricted',
      text: null,
      resolutionPath: 'This comment is not visible to your role.',
      redactedReason: 'Your session cannot read review comments on working papers.',
    };
  }

  const { status, label } = statusOf(c);
  return {
    ...base,
    status,
    statusLabel: label,
    text: c.text,
    resolutionPath: resolutionPathFor(status, c),
    redactedReason: null,
  };
}

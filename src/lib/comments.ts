import type { ReviewComment, AuditEngagement, WorkingPaper } from '../types';

/**
 * A review comment is "open" (awaiting a response) when its status says so,
 * or, for older seed records without a status, when it is not resolved.
 * Replies from the reviewee never close it; only clearing/resolving does.
 */
export function isCommentOpen(c: ReviewComment): boolean {
  if (c.status) return c.status === 'open';
  return !c.resolved;
}

/** True when the audit the comment belongs to is still live (not signed off / concluded). */
export function isLiveWorkingPaper(wp: WorkingPaper | undefined, eng: AuditEngagement | undefined): boolean {
  if (!wp) return false;
  if (eng && eng.status === 'signed_off') return false;
  return !wp.sealed && wp.status !== 'completed';
}

export function pendingComments(
  comments: ReviewComment[],
  workpapers: WorkingPaper[],
  engagements: AuditEngagement[]
): ReviewComment[] {
  const wpById = new Map(workpapers.map((w) => [w.id, w]));
  const engById = new Map(engagements.map((e) => [e.id, e]));
  return comments.filter((c) => {
    if (!isCommentOpen(c)) return false;
    const wp = wpById.get(c.workpaperId);
    return isLiveWorkingPaper(wp, wp ? engById.get(wp.engagementId) : undefined);
  });
}

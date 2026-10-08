/**
 * Workpaper lock rules (pure, deterministic). A workpaper is read-only once it has been
 * submitted for review, completed, signed off, sealed, or when its engagement is signed off,
 * closed or locked. Reopening (with justification) clears these flags upstream.
 */
import { AuditEngagement, WorkingPaper } from '../types';

export type WorkpaperLock = { locked: boolean; reason?: string };

export function getWorkpaperLock(
  wp: Pick<WorkingPaper, 'sealed' | 'isLocked' | 'signedOffAt' | 'status'>,
  eng?: Pick<AuditEngagement, 'status' | 'isLocked' | 'signedOffAt'> | null
): WorkpaperLock {
  if (wp.sealed) return { locked: true, reason: 'Sealed workpaper: read-only. Reopen with a justification to edit.' };
  if (wp.isLocked || wp.signedOffAt || wp.status === 'signed_off')
    return { locked: true, reason: 'Signed off: read-only. Reopen with a justification to edit.' };
  if (wp.status === 'completed' || wp.status === 'ready_for_review')
    return { locked: true, reason: 'Submitted for review: read-only until the reviewer returns it.' };
  if (eng && (eng.isLocked || eng.signedOffAt || eng.status === 'signed_off' || eng.status === 'closed'))
    return { locked: true, reason: 'Audit is signed off: everything is read-only.' };
  return { locked: false };
}

import { describe, expect, it } from 'vitest';
import {
  ageLabel,
  canViewComment,
  commentAgeDays,
  commentPopout,
  type CommentPopoutInput,
} from './commentPopout';
import type { ReviewComment, User, WorkingPaper, AuditEngagement } from '../types';

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 'cmt-1',
  workpaperId: 'wp-1',
  authorId: 'usr-rev',
  authorName: 'Sarah Jenkins',
  authorRole: 'reviewer',
  text: 'Recheck the haircut table.',
  createdAt: '2026-09-20T10:15:00Z',
  resolved: false,
  ...over,
});

const workpaper = (over: Partial<WorkingPaper> = {}): WorkingPaper =>
  ({ id: 'wp-1', engagementId: 'eng-1', refCode: 'TREAS-01', title: 'Sovereign bonds', ...over } as WorkingPaper);

const engagement = (): AuditEngagement => ({ id: 'eng-1', title: 'Treasury 2026' } as AuditEngagement);

const user = (role: User['role'], rights?: User['rights']): User =>
  ({ id: 'u1', name: 'Viewer', role, rights } as User);

const input = (over: Partial<CommentPopoutInput> = {}): CommentPopoutInput => ({
  comment: comment(),
  workpaper: workpaper(),
  engagement: engagement(),
  todayIso: '2026-09-30',
  viewer: user('cia'),
  ...over,
});

describe('commentAgeDays / ageLabel', () => {
  it('counts whole days between creation and today', () => {
    expect(commentAgeDays('2026-09-20T10:15:00Z', '2026-09-30')).toBe(10);
  });
  it('never goes negative when today precedes creation', () => {
    expect(commentAgeDays('2026-10-05T00:00:00Z', '2026-09-30')).toBe(0);
    expect(ageLabel(0)).toBe('today');
  });
  it('says the age the way a person would', () => {
    expect(ageLabel(1)).toBe('1 day ago');
    expect(ageLabel(12)).toBe('12 days ago');
    expect(ageLabel(45)).toBe('1 month ago');
    expect(ageLabel(75)).toBe('2 months ago');
  });
});

describe('canViewComment (Law L2)', () => {
  it('lets a reviewer read', () => {
    expect(canViewComment(user('reviewer'))).toBe(true);
  });
  it('refuses a configuration-only principal', () => {
    expect(canViewComment(user('org_admin', { edit_config: true }))).toBe(false);
  });
  it('refuses an observer (read-only with view_all_scopes)', () => {
    expect(canViewComment(user('observer'))).toBe(false);
  });
  it('lets an auditee read (read-only but no view_all_scopes)', () => {
    expect(canViewComment(user('auditee'))).toBe(true);
  });
});

describe('commentPopout', () => {
  it('never returns nothing and states the status', () => {
    const m = commentPopout(input());
    expect(m.status).toBe('open');
    expect(m.statusLabel).toBe('Open');
    expect(m.text).toBe('Recheck the haircut table.');
    expect(m.redactedReason).toBeNull();
  });

  it('carries author, role, age, workpaper and engagement', () => {
    const m = commentPopout(input());
    expect(m.author).toBe('Sarah Jenkins');
    expect(m.authorRole).toBe('reviewer');
    expect(m.ageDays).toBe(10);
    expect(m.ageLabel).toBe('10 days ago');
    expect(m.workpaperRef).toBe('TREAS-01');
    expect(m.workpaperTitle).toBe('Sovereign bonds');
    expect(m.engagementTitle).toBe('Treasury 2026');
  });

  it('reports a resolved seed comment as cleared', () => {
    const m = commentPopout(input({ comment: comment({ resolved: true }) }));
    expect(m.status).toBe('cleared');
    expect(m.statusLabel).toBe('Cleared');
  });

  it('honours an explicit status over resolved', () => {
    expect(commentPopout(input({ comment: comment({ status: 'addressed' }) })).status).toBe('addressed');
    expect(commentPopout(input({ comment: comment({ status: 'cleared', resolved: false }) })).status).toBe('cleared');
  });

  it('states the resolution path as a rule', () => {
    expect(commentPopout(input()).resolutionPath).toMatch(/reviewer holding review rights/);
    expect(commentPopout(input({ comment: comment({ status: 'addressed' }) })).resolutionPath).toMatch(/reviewer must clear/);
    expect(commentPopout(input({ comment: comment({ resolved: true, resolvedBy: 'Ravi' }) })).resolutionPath).toMatch(/Cleared by Ravi/);
  });

  it('redacts the text for a viewer who may not read it, and gives a reason', () => {
    const m = commentPopout(input({ viewer: user('observer') }));
    expect(m.status).toBe('redacted');
    expect(m.statusLabel).toBe('Restricted');
    expect(m.text).toBeNull();
    expect(m.redactedReason).toBeTruthy();
    // The safe metadata (author, age) is still present; only the body is withheld.
    expect(m.author).toBe('Sarah Jenkins');
    expect(m.ageLabel).toBe('10 days ago');
  });

  it('does not leak the body to a configuration-only principal', () => {
    const m = commentPopout(input({ viewer: user('org_admin', { edit_config: true }) }));
    expect(m.text).toBeNull();
    expect(m.status).toBe('redacted');
  });

  it('tolerates a comment whose workpaper the host could not resolve', () => {
    const m = commentPopout(input({ workpaper: undefined, engagement: undefined }));
    expect(m.workpaperRef).toBeNull();
    expect(m.engagementTitle).toBeNull();
    expect(m.text).toBe('Recheck the haircut table.');
  });
});

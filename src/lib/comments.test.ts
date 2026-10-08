import { describe, it, expect } from 'vitest';
import { isCommentOpen, pendingComments } from './comments';

const base = { id: 'c', workpaperId: 'w1', authorId: 'u', authorName: 'A', authorRole: 'reviewer', text: 't', createdAt: '2026-09-01' } as any;

describe('isCommentOpen', () => {
  it('treats seed comments with resolved:false and no status as open', () => {
    expect(isCommentOpen({ ...base, resolved: false })).toBe(true);
  });
  it('respects explicit status', () => {
    expect(isCommentOpen({ ...base, status: 'cleared' })).toBe(false);
    expect(isCommentOpen({ ...base, status: 'open', resolved: true })).toBe(true);
  });
  it('resolved comments are not open', () => {
    expect(isCommentOpen({ ...base, resolved: true })).toBe(false);
  });
});

describe('pendingComments', () => {
  const wps = [{ id: 'w1', engagementId: 'e1', status: 'ready_for_review', sealed: false }, { id: 'w2', engagementId: 'e1', status: 'completed', sealed: true }] as any;
  const engs = [{ id: 'e1', status: 'in_progress' }] as any;
  it('keeps open comments on live papers only', () => {
    const r = pendingComments([base, { ...base, id: 'c2', workpaperId: 'w2' }], wps, engs);
    expect(r.map((c) => c.id)).toEqual(['c']);
  });
});

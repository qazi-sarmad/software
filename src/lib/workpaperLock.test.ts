import { describe, it, expect } from 'vitest';
import { getWorkpaperLock } from './workpaperLock';

const wp = (o: any = {}) => ({ status: 'in_progress', ...o });

describe('getWorkpaperLock', () => {
  it('is open for an in-progress, unsealed paper', () => {
    expect(getWorkpaperLock(wp() as any, { status: 'in_progress' } as any).locked).toBe(false);
  });
  it.each([
    ['sealed', { sealed: true }],
    ['isLocked', { isLocked: true }],
    ['signed off', { status: 'signed_off' }],
    ['completed', { status: 'completed' }],
    ['ready for review', { status: 'ready_for_review' }],
  ])('locks when %s', (_n, o) => {
    const r = getWorkpaperLock(wp(o) as any, null);
    expect(r.locked).toBe(true);
    expect(r.reason).toBeTruthy();
  });
  it('locks when the engagement is signed off', () => {
    expect(getWorkpaperLock(wp() as any, { status: 'signed_off' } as any).locked).toBe(true);
    expect(getWorkpaperLock(wp() as any, { status: 'closed' } as any).locked).toBe(true);
  });
});

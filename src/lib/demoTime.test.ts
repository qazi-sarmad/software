import { describe, expect, it, afterEach } from 'vitest';
import { getDemoNow, getDemoTodayISO, DEMO_TODAY_ISO } from './demoTime';

afterEach(() => {
  delete (window as unknown as { __DEMO_NOW__?: unknown }).__DEMO_NOW__;
});

describe('demo clock (D5)', () => {
  it('uses the injected clock when window.__DEMO_NOW__ is set', () => {
    window.__DEMO_NOW__ = '2026-10-18T09:00:00Z';
    expect(getDemoNow().toISOString()).toBe('2026-10-18T09:00:00.000Z');
    expect(getDemoTodayISO()).toBe('2026-10-18');
  });

  it('accepts a numeric epoch and a Date', () => {
    window.__DEMO_NOW__ = Date.parse('2026-10-18T00:00:00Z');
    expect(getDemoTodayISO()).toBe('2026-10-18');
    window.__DEMO_NOW__ = new Date('2026-10-19T12:00:00Z');
    expect(getDemoTodayISO()).toBe('2026-10-19');
  });

  it('falls back to real time when nothing is injected', () => {
    const before = Date.now();
    const now = getDemoNow().getTime();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('ignores an unparseable injection rather than throwing', () => {
    window.__DEMO_NOW__ = 'not-a-date';
    const now = getDemoNow().getTime();
    expect(Number.isNaN(now)).toBe(false);
  });

  it('keeps the demo day constant available for fixtures', () => {
    expect(DEMO_TODAY_ISO).toBe('2026-09-30');
  });
});

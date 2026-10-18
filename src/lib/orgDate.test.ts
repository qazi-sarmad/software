import { it, expect, describe, afterEach } from 'vitest';
import {
  toOrgLocalIsoDate,
  getOrgLocalToday,
  isCapOverdue,
  DEMO_TODAY_ISO,
  DEFAULT_ORG_TIME_ZONE,
} from './orgDate';

afterEach(() => {
  delete (window as unknown as { __DEMO_NOW__?: unknown }).__DEMO_NOW__;
});

describe('toOrgLocalIsoDate', () => {
  it('uses the org time zone, not UTC', () => {
    const d = new Date('2026-10-15T22:30:00Z');
    expect(toOrgLocalIsoDate(d, 'UTC')).toBe('2026-10-15');
    expect(toOrgLocalIsoDate(d, 'Asia/Karachi')).toBe('2026-10-16');
  });
});

describe('getOrgLocalToday', () => {
  it('returns the injected clock day by default', () => {
    window.__DEMO_NOW__ = '2026-09-30T07:00:00Z'; // noon PKT
    expect(getOrgLocalToday()).toBe(DEMO_TODAY_ISO);
    expect(getOrgLocalToday(DEFAULT_ORG_TIME_ZONE)).toBe('2026-09-30');
  });

  it('respects an explicit now + time zone', () => {
    const eveningUtc = new Date('2026-10-15T22:30:00Z');
    expect(getOrgLocalToday('UTC', eveningUtc)).toBe('2026-10-15');
    expect(getOrgLocalToday('Asia/Karachi', eveningUtc)).toBe('2026-10-16');
  });
});

describe('isCapOverdue', () => {
  it('treats status Overdue as overdue regardless of due date', () => {
    expect(isCapOverdue('Overdue', '2099-01-01', '2026-09-30')).toBe(true);
  });

  it('does not mark Closed as overdue even if due date is past', () => {
    expect(isCapOverdue('Closed', '2020-01-01', '2026-09-30')).toBe(false);
  });

  it('marks open CAPs past due as overdue', () => {
    expect(isCapOverdue('Open', '2026-09-29', '2026-09-30')).toBe(true);
    expect(isCapOverdue('Pending validation', '2026-09-15', '2026-09-30')).toBe(true);
  });

  it('does not mark open CAPs due today or later as overdue', () => {
    expect(isCapOverdue('Open', '2026-09-30', '2026-09-30')).toBe(false);
    expect(isCapOverdue('Open', '2026-10-01', '2026-09-30')).toBe(false);
  });

  it('uses getOrgLocalToday when todayIso is omitted', () => {
    window.__DEMO_NOW__ = '2026-09-30T07:00:00Z'; // noon PKT
    expect(isCapOverdue('Open', '2026-09-29')).toBe(true);
    expect(isCapOverdue('Open', '2026-09-30')).toBe(false);
  });
});

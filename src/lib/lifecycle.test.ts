/**
 * §10.1 grace-period predicates. These mirror the database lock (migration 0095) so the number the
 * SQL tests prove and the number the UI shows cannot drift. No clock is read here; `now` is injected.
 */
import { describe, expect, it } from 'vitest';
import {
  GRACE_HOURS_MAX,
  GRACE_HOURS_MIN,
  graceHoursInRange,
  graceWindowEnd,
  testingGraceWindowActive,
  testingLockActive,
} from './lifecycle';

const START = new Date('2026-01-01T00:00:00.000Z');

describe('graceHoursInRange', () => {
  it('accepts the documented endpoints and rejects outside them', () => {
    expect(graceHoursInRange(GRACE_HOURS_MIN)).toBe(true);
    expect(graceHoursInRange(GRACE_HOURS_MAX)).toBe(true);
    expect(graceHoursInRange(GRACE_HOURS_MIN - 1)).toBe(false);
    expect(graceHoursInRange(GRACE_HOURS_MAX + 1)).toBe(false);
  });

  it('rejects a fractional hour', () => {
    expect(graceHoursInRange(2.5)).toBe(false);
  });
});

describe('graceWindowEnd', () => {
  it('adds the grace period to the planning start', () => {
    expect(graceWindowEnd(START, 24).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('testingGraceWindowActive', () => {
  it('a zero grace period has an empty window at all times', () => {
    expect(testingGraceWindowActive(START, 0, START)).toBe(false);
    expect(testingGraceWindowActive(START, 0, new Date('2025-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('is active strictly before the window closes and inactive at or after it', () => {
    expect(testingGraceWindowActive(START, 24, new Date('2026-01-01T12:00:00.000Z'))).toBe(true);
    expect(testingGraceWindowActive(START, 24, graceWindowEnd(START, 24))).toBe(false);
    expect(testingGraceWindowActive(START, 24, new Date('2026-01-03T00:00:00.000Z'))).toBe(false);
  });
});

describe('testingLockActive', () => {
  it('sign-off lifts the lock regardless of grace', () => {
    expect(testingLockActive({ planningSignedOff: true, createdAt: START, graceHours: 0 }, START)).toBe(false);
    expect(testingLockActive({ planningSignedOff: true, createdAt: START, graceHours: 24 }, START)).toBe(false);
  });

  it('with a zero grace period the lock is the original hard lock', () => {
    expect(testingLockActive({ planningSignedOff: false, createdAt: START, graceHours: 0 }, START)).toBe(true);
  });

  it('inside a live grace window the lock is inactive; after it, active again', () => {
    const input = { planningSignedOff: false, createdAt: START, graceHours: 24 };
    expect(testingLockActive(input, new Date('2026-01-01T06:00:00.000Z'))).toBe(false);
    expect(testingLockActive(input, new Date('2026-01-02T06:00:00.000Z'))).toBe(true);
  });
});

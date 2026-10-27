/**
 * §10.1 configurable grace period before the Testing hard lock — pure predicates.
 *
 * The hard lock itself lives in the database (`guard_testing_lock()` and `testing_lock_active()`,
 * migration 0095). These functions mirror its arithmetic exactly so the UI can explain, and tests can
 * pin, when the lock is active without reading a clock or a database. Time is always an argument.
 */

/** The platform range for the testing grace period, in hours (§10.1). */
export const GRACE_HOURS_MIN = 0;
export const GRACE_HOURS_MAX = 336;

/** True when `graceHours` is a whole number inside the platform range. */
export function graceHoursInRange(graceHours: number): boolean {
  return Number.isInteger(graceHours) && graceHours >= GRACE_HOURS_MIN && graceHours <= GRACE_HOURS_MAX;
}

/** The instant the grace window closes: the engagement's planning start plus the grace period. */
export function graceWindowEnd(createdAt: Date, graceHours: number): Date {
  return new Date(createdAt.getTime() + graceHours * 3_600_000);
}

/**
 * True while the grace window is still open: the engagement exists and `now` is strictly before
 * `createdAt + graceHours`. A zero grace period yields an empty window at all times.
 */
export function testingGraceWindowActive(createdAt: Date, graceHours: number, now: Date): boolean {
  if (graceHours <= 0) return false;
  return graceWindowEnd(createdAt, graceHours).getTime() > now.getTime();
}

/**
 * The §10.1 lock, mirroring `public.testing_lock_active()`. Planning sign-off lifts the lock
 * outright; otherwise the lock is inactive only inside the grace window. With a zero grace period
 * the behaviour is the original hard lock: locked until sign-off.
 */
export function testingLockActive(
  input: { planningSignedOff: boolean; createdAt: Date; graceHours: number },
  now: Date
): boolean {
  if (input.planningSignedOff) return false;
  return !testingGraceWindowActive(input.createdAt, input.graceHours, now);
}

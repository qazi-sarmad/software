/**
 * Org-local calendar dates for due/overdue checks.
 * Never compare CAP due dates to UTC midnight — use the organization's zone.
 */
import { getDemoNow } from './demoTime';

export const DEFAULT_ORG_TIME_ZONE = 'Asia/Karachi';

/**
 * The day the seeded demo data was authored around. Kept as a named constant for fixtures and
 * tests; the live clock now comes from src/lib/demoTime.ts (D5), which injects a fixed instant in
 * test runs and returns real time otherwise.
 */
export const DEMO_TODAY_ISO = '2026-09-30';

export function toOrgLocalIsoDate(d: Date, timeZone: string): string {
  // 'en-CA' formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Organization-local calendar date for "now".
 * Defaults to the application clock (src/lib/demoTime.ts), which is real time outside tests and an
 * injected instant inside them, so CAP overdue UI stays deterministic without a frozen product day.
 */
export function getOrgLocalToday(
  timeZone: string = DEFAULT_ORG_TIME_ZONE,
  now: Date = getDemoNow()
): string {
  return toOrgLocalIsoDate(now, timeZone);
}

/**
 * CAP is overdue when status is already Overdue, or when it is still open
 * and the due date is strictly before the org-local today.
 */
export function isCapOverdue(
  status: string,
  dueDate: string,
  todayIso: string = getOrgLocalToday()
): boolean {
  return status === 'Overdue' || (status !== 'Closed' && dueDate < todayIso);
}

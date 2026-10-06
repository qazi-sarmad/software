/**
 * Org-local calendar dates for due/overdue checks.
 * Never compare CAP due dates to UTC midnight — use the organization's zone.
 */

export const DEFAULT_ORG_TIME_ZONE = 'Asia/Karachi';

/**
 * Demo clock freeze: product screens treat this calendar day as "today"
 * so sample data and overdue counts stay stable. Unfreeze by changing
 * getOrgLocalToday's default `now` to `new Date()`.
 */
export const DEMO_TODAY_ISO = '2026-09-30';

/** Fixed instant whose org-local date is DEMO_TODAY_ISO in Asia/Karachi (noon PKT). */
const DEMO_NOW = new Date('2026-09-30T12:00:00+05:00');

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
 * Defaults to the demo freeze so CAP overdue UI stays deterministic.
 * Pass a real `now` (and org timeZone) when the freeze is lifted.
 */
export function getOrgLocalToday(
  timeZone: string = DEFAULT_ORG_TIME_ZONE,
  now: Date = DEMO_NOW
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

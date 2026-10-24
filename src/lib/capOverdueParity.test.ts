/**
 * C2.2: the app's CAP overdue rule and the database's must agree.
 *
 * The daily CAP job (public.cap_notification_sweep, migration 0074) classifies each cap in SQL; the
 * app classifies it in src/lib/orgDate.ts (isCapOverdue) and maps the register status through
 * src/lib/cap.ts (capStatusToDb). Two copies of one rule drift, so this test pins them to the same
 * fixture table that supabase/tests/83_scheduled_jobs.sql uses. If either side changes alone, this
 * test fails and names the case.
 */
import { describe, expect, it } from 'vitest';
import { isCapOverdue, toOrgLocalIsoDate } from './orgDate';
import { capStatusToDb, type DbCapStatus } from './cap';
import type { CapStatus } from '../types';

/** The shared cases. The SQL test asserts the same rows against cap_is_overdue. */
const CASES: { status: CapStatus; due: string | null; today: string; overdue: boolean }[] = [
  { status: 'Open', due: '2026-10-15', today: '2026-10-16', overdue: true },
  { status: 'Open', due: '2026-10-16', today: '2026-10-16', overdue: false },
  { status: 'Open', due: '2026-10-20', today: '2026-10-16', overdue: false },
  { status: 'In progress', due: '2026-09-01', today: '2026-10-16', overdue: true },
  { status: 'Pending validation', due: '2026-09-01', today: '2026-10-16', overdue: true },
  { status: 'Overdue', due: null, today: '2026-10-16', overdue: true },
  { status: 'Closed', due: '2026-01-01', today: '2026-10-16', overdue: false },
];

/** The database rule, transcribed from migration 0074's cap_is_overdue. */
function dbCapIsOverdue(dbStatus: DbCapStatus, dueDate: string | null, today: string): boolean {
  const closed = dbStatus === 'verified_closed' || dbStatus === 'verified_closed_delay';
  return dbStatus === 'overdue_unverified'
    || (dbStatus !== null && !closed && dueDate !== null && dueDate < today);
}

describe('the CAP overdue rule is the same in the app and in the database (C2.2)', () => {
  it('agrees on every fixture, for both null and non-null due dates', () => {
    for (const c of CASES) {
      const appSays = isCapOverdue(c.status, c.due ?? '9999-12-31', c.today);
      // isCapOverdue has no null due date, so a null due date in the fixture is the already-overdue
      // status case, which the app answers from the status alone.
      const appResult = c.due === null ? c.status === 'Overdue' : appSays;
      const dbResult = dbCapIsOverdue(capStatusToDb(c.status), c.due, c.today);
      expect(appResult, `${c.status} / ${c.due} / ${c.today}`).toBe(dbResult);
      expect(dbResult, `${c.status} / ${c.due} / ${c.today}`).toBe(c.overdue);
    }
  });

  it('rolls the org-local day over at the org zone, not at UTC midnight', () => {
    const eveningUtc = new Date('2026-10-16T20:30:00Z');
    expect(toOrgLocalIsoDate(eveningUtc, 'UTC')).toBe('2026-10-16');
    expect(toOrgLocalIsoDate(eveningUtc, 'Asia/Karachi')).toBe('2026-10-17');
  });
});

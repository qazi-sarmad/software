/**
 * The application clock (D5).
 *
 * Until D5 the product compared due dates against a hard-coded day (2026-09-30), so "today" and
 * "overdue" drifted as real time moved past it. This module is now the single source of "now".
 *
 * In a test run the clock can be pinned: Vitest and Playwright both run with MODE === 'test', so a
 * suite sets `window.__DEMO_NOW__` (or VITE_DEMO_NOW) to keep due/overdue assertions deterministic.
 * In a normal run it is real time.
 */

declare global {
  interface Window {
    __DEMO_NOW__?: string | number | Date;
  }
}

/** The fixed day the seeded demo data was authored around; the fallback pin for test runs. */
export const DEMO_TODAY_ISO = '2026-09-30';

function injectedNow(): Date | null {
  if (import.meta.env.MODE !== 'test') return null;
  const raw =
    (typeof window !== 'undefined' ? window.__DEMO_NOW__ : undefined) ??
    import.meta.env.VITE_DEMO_NOW;
  if (raw === undefined || raw === null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The current instant: the injected test clock when set, otherwise real time in the user's zone. */
export function getDemoNow(): Date {
  return injectedNow() ?? new Date();
}

/** The current calendar day (UTC), YYYY-MM-DD. */
export function getDemoTodayISO(): string {
  return getDemoNow().toISOString().split('T')[0];
}

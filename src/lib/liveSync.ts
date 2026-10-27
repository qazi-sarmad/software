/**
 * Live-sync policy (SCALE-1, spec §17.1, §22).
 *
 * A pop-out window (a real same-origin browser window opened from the floating-window chrome) and
 * the in-app notification surface both stay current through one of two transports:
 *
 *   - `realtime`: a Supabase Realtime subscription on the published tables. Postgres change events
 *     arrive as they are committed. RLS still applies, so a subscriber only ever receives rows its
 *     own policy permits.
 *   - `poll`: a bounded interval re-read through the ordinary data modules, used when Realtime is
 *     unavailable (no socket, no network, a project with Realtime disabled).
 *
 * This module is the deterministic policy: WHICH transport a given surface should use, and WHEN a
 * poll is due. It holds no timers and reads no clock — every decision takes the elapsed time as an
 * argument (Laws: "Time is always an argument"). The React hooks own the timers; this owns the
 * decision, so it is unit-testable without a browser or a database.
 */

export type LiveTransport = 'realtime' | 'poll';

export interface LiveSyncOptions {
  /** True when the Realtime client connected and the channel reached `SUBSCRIBED`. */
  realtimeAvailable: boolean;
  /** The poll interval, in milliseconds, used when Realtime is unavailable. */
  pollIntervalMs?: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * The transport a surface should use. Realtime when it is available, otherwise the poll fallback.
 * This is the documented fallback (NOT-DONE §17.1/§22): the surface must still converge on the
 * latest data even when no socket can be opened.
 */
export function chooseTransport(opts: LiveSyncOptions): LiveTransport {
  return opts.realtimeAvailable ? 'realtime' : 'poll';
}

/** The effective poll interval: the caller's value, or the default, and never below one second. */
export function pollInterval(opts: LiveSyncOptions): number {
  const raw = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  return raw < 1000 ? 1000 : raw;
}

/**
 * Whether a poll is due, given how long has elapsed since the last one. Pure: the caller supplies
 * `elapsedMs`. A negative elapsed (a clock that went backwards) never triggers a poll.
 */
export function pollDue(elapsedMs: number, opts: LiveSyncOptions): boolean {
  if (elapsedMs < 0) return false;
  return elapsedMs >= pollInterval(opts);
}

/**
 * The change filter a Realtime channel subscribes with. Supabase postgres_changes filters are
 * `column=eq.value`; a tenant surface always filters on `org_id` so the socket asks only for its own
 * organisation's rows. Realtime still enforces RLS, so this filter is a scope hint, never the guard.
 */
export function orgChangeFilter(orgId: string): string {
  return `org_id=eq.${orgId}`;
}

/**
 * The Realtime channel name for one notifications subscription. supabase-js returns an EXISTING
 * channel when the requested name matches one it already tracks, and adding a `postgres_changes`
 * callback to an already-subscribed channel throws ("cannot add postgres_changes callbacks after
 * subscribe()"). Two surfaces subscribe for the same org at once (the header bell and the Work Queue
 * card), so the name MUST be unique per subscription. The monotonic `seq` is what makes it unique;
 * this is the regression guard for that defect.
 */
export function notificationChannelName(orgId: string, seq: number): string {
  return `notifications:${orgId}:${seq}`;
}

/**
 * Whether a received change belongs to the caller's organisation. A defensive re-check in the
 * browser: even if a malformed event slipped through, a row from another org is ignored. The
 * database is the real guard (RLS); this keeps a bug in the client from rendering a foreign row.
 */
export function changeBelongsToOrg(
  payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
  orgId: string
): boolean {
  const row = payload.new ?? payload.old ?? {};
  return row.org_id === orgId;
}

/**
 * A same-origin pop-out shares `localStorage` with the window that opened it, and a write there
 * fires a `storage` event in every other window of the origin. That is the second half of §17.1:
 * a local edit (a filter, a selection, a saved view) made in one window is visible in the pop-out
 * without a server round-trip. The key is namespaced per record so two records never collide.
 */
export function recordRevisionKey(recordType: string, recordId: string): string {
  return `provio.live.${recordType}.${recordId}`;
}

/** Read the current revision for a key. A missing or unparseable value reads as 0. */
export function readRecordRevision(storage: Pick<Storage, 'getItem'>, key: string): number {
  const raw = storage.getItem(key);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** The next revision. Time is an argument (the caller passes the stamp), never read here. */
export function nextRecordRevision(current: number, _now: number): number {
  return (Number.isFinite(current) ? current : 0) + 1;
}

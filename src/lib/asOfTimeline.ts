/**
 * Time-Travel: the as-of timeline logic (F14, S10).
 *
 * Pure and deterministic (L1). It turns the events `engagement_as_of_events` returns into the list of
 * snap points the AsOfTimeline handle snaps to, and compares two reconstructions ("compare with now":
 * added / changed / removed). Nothing here calls the network; the reconstruction itself is the
 * database function `engagement_as_of` (0068).
 */

/** One recorded event, as `engagement_as_of_events` returns it. */
export interface AsOfEvent {
  seq: string;
  kind: 'ledger' | 'activity';
  action: string;
  at: string;
  objectType: string | null;
  objectId: string | null;
  detail: Record<string, unknown>;
}

/** A reconstruction, as `engagement_as_of` returns it. */
export interface AsOfState {
  status: 'ok' | 'not_recorded_before' | 'earliest_available';
  asOf: string;
  earliestRecorded?: string | null;
  earliestAvailable?: string | null;
  note?: string;
  workpapers?: { id: string; status: string; at: string }[];
  findings?: { id: string; at: string; observationId?: string | null }[];
  seal?: { sealed: boolean; at: string | null };
  statuses?: { action: string; at: string; objectType: string | null; objectId: string | null; detail: Record<string, unknown> }[];
}

/** The events a timeline handle snaps to: the ones that change recorded state. */
const SNAP_ACTIONS = new Set([
  'workpaper_signed_off', 'workpaper_reopened', 'finding_promoted', 'conclusion_signed_off',
  'engagement_reopen', 'engagement_deployed', 'plan_approved', 'combined_approval',
  'sira_cycle_published', 'board_pack_generated', 'certificate_issued', 'certificate_revoked',
]);

/** The snap points, in time order, one per state-changing event (F14). */
export function snapPoints(events: AsOfEvent[]): { at: string; action: string; label: string }[] {
  return events
    .filter((e) => SNAP_ACTIONS.has(e.action))
    .map((e) => ({ at: e.at, action: e.action, label: eventLabel(e) }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.action < b.action ? -1 : 1)));
}

/** A plain-language label for one event. */
export function eventLabel(e: AsOfEvent): string {
  switch (e.action) {
    case 'workpaper_signed_off': return 'Sign-off recorded';
    case 'workpaper_reopened': return 'Workpaper reopened';
    case 'finding_promoted': return 'Finding promoted';
    case 'conclusion_signed_off': return 'Engagement sealed';
    case 'engagement_reopen': return 'Engagement reopened';
    case 'engagement_deployed': return 'Engagement deployed';
    case 'plan_approved': return 'Plan approved';
    case 'combined_approval': return 'Combined approval';
    case 'sira_cycle_published': return 'SIRA cycle published';
    case 'board_pack_generated': return 'Board Pack generated';
    case 'certificate_issued': return 'Certificate issued';
    case 'certificate_revoked': return 'Certificate revoked';
    default: return e.action.replace(/_/g, ' ');
  }
}

/**
 * The next snap point strictly after `at`, or null when `at` is at or after the last snap. The
 * previous/next buttons use this, so the handle always lands on a real recorded moment.
 */
export function nextSnap(points: { at: string }[], at: string): string | null {
  for (const p of points) if (p.at > at) return p.at;
  return null;
}

/** The previous snap point strictly before `at`, or null when `at` is at or before the first snap. */
export function previousSnap(points: { at: string }[], at: string): string | null {
  let found: string | null = null;
  for (const p of points) {
    if (p.at < at) found = p.at; else break;
  }
  return found;
}

/**
 * The snap point nearest `at` (the handle SNAPS to events). Ties go to the earlier point. Returns
 * null when there are no points.
 */
export function nearestSnap(points: { at: string }[], at: string): string | null {
  if (points.length === 0) return null;
  const t = Date.parse(at);
  let best = points[0].at;
  let bestDist = Math.abs(Date.parse(best) - t);
  for (const p of points) {
    const dist = Math.abs(Date.parse(p.at) - t);
    if (dist < bestDist) { best = p.at; bestDist = dist; }
  }
  return best;
}

export type DiffKind = 'added' | 'changed' | 'removed' | 'unchanged';

export interface DiffRow {
  id: string;
  kind: DiffKind;
  before: string | null;
  after: string | null;
  label: string;
}

/**
 * Compare two reconstructions (F14 "compare with now"): what was added, changed or removed between
 * the earlier state and the later one. Workpapers and the seal are compared; the result is sorted by
 * id, so the diff is stable.
 */
export function diffStates(before: AsOfState, after: AsOfState): DiffRow[] {
  const rows: DiffRow[] = [];
  const beforeWp = new Map((before.workpapers ?? []).map((w) => [w.id, w.status]));
  const afterWp = new Map((after.workpapers ?? []).map((w) => [w.id, w.status]));
  for (const id of [...new Set([...beforeWp.keys(), ...afterWp.keys()])].sort()) {
    const b = beforeWp.get(id) ?? null;
    const a = afterWp.get(id) ?? null;
    rows.push({
      id,
      kind: b === null ? 'added' : a === null ? 'removed' : b === a ? 'unchanged' : 'changed',
      before: b, after: a, label: `Workpaper ${id}`,
    });
  }

  const beforeSealed = before.seal?.sealed ?? false;
  const afterSealed = after.seal?.sealed ?? false;
  rows.push({
    id: 'seal',
    kind: beforeSealed === afterSealed ? 'unchanged' : (afterSealed ? 'added' : 'changed'),
    before: String(beforeSealed), after: String(afterSealed), label: 'Engagement seal',
  });

  return rows;
}

/** The banner text: a persistent "As of <date time>" label (F14). */
export function asOfBanner(state: AsOfState): string {
  if (state.status === 'not_recorded_before') {
    return state.earliestRecorded
      ? `Not recorded before ${formatWhen(state.earliestRecorded)}`
      : 'This engagement has no recorded history.';
  }
  if (state.status === 'earliest_available') {
    return `Activity before ${formatWhen(state.earliestAvailable ?? state.asOf)} was archived; the earliest available view starts there.`;
  }
  return `As of ${formatWhen(state.asOf)}`;
}

/** A short, plain date-time. Deterministic: the same string always formats the same way. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

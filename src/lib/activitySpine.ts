/**
 * The live activity spine (U4; SYSTELIGON.md §11.1c Tier 1 item 4, spec §17.1).
 *
 * A quiet, non-intrusive stream of what is happening in the organisation — "Ayesha approved the SIRA
 * cycle", "Report R-2026-014 was sealed". The transport already exists (`src/lib/liveSync.ts`:
 * Realtime when a socket is available, a bounded poll otherwise); this module is the PURE layer that
 * turns a raw activity row into the one sentence the spine shows, and merges a stream of rows without
 * duplicates or reordering.
 *
 * Determinism (Law L1): a row maps to its sentence by a fixed table, not by a model. An unknown action
 * still produces a sentence (the verbatim action, made legible), so the spine is never silent about a
 * real event. Time is an argument (`nowMs`) — relative ages are computed from it, never from the clock
 * inside this module.
 *
 * Law L2: this layer only ever sees the REDUCED summary the RPC returns (title/period/stage/kind/
 * severity), never arbitrary tenant content. Nothing here reads the Supabase client.
 */

/** One row as the spine receives it: the reduced summary, the actor name, and the timestamp. */
export interface ActivitySpineRow {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  objectType: string | null;
  objectId: string | null;
  summary: Record<string, unknown>;
  ts: string | null;
}

/** The kinds of stream entry, so the icon/colour is a property of the rule, not of the row. */
export type ActivityKind = 'approval' | 'seal' | 'publish' | 'create' | 'change' | 'notice';

/**
 * The action → (kind, sentence) table. The sentence is built from the actor and the reduced summary.
 * An action not in this table still renders (see `activitySentence`), so a new event is never dropped
 * from the stream — it simply reads a little plainer until the table is extended.
 */
export interface ActivityRule {
  kind: ActivityKind;
  verb: string;
}

export const ACTIVITY_RULES: Record<string, ActivityRule> = {
  report_frozen: { kind: 'seal', verb: 'sealed report' },
  report_issued: { kind: 'seal', verb: 'issued report' },
  report_composed: { kind: 'create', verb: 'composed report' },
  workpaper_signed_off: { kind: 'approval', verb: 'signed off workpaper' },
  conclusion_signed_off: { kind: 'approval', verb: 'signed off the conclusion' },
  planning_signed_off: { kind: 'approval', verb: 'signed off the plan' },
  plan_approved: { kind: 'approval', verb: 'approved the audit plan' },
  sira_cycle_created: { kind: 'create', verb: 'created the SIRA cycle' },
  sira_cycle_published: { kind: 'publish', verb: 'published the SIRA cycle' },
  sira_cycle_endorsed: { kind: 'approval', verb: 'endorsed the SIRA cycle' },
  sira_acceptance_decided: { kind: 'approval', verb: 'accepted the SIRA cycle' },
  sira_model_published: { kind: 'publish', verb: 'published the SIRA model' },
  sample_locked: { kind: 'create', verb: 'locked a sample' },
  population_locked: { kind: 'create', verb: 'locked a population' },
  entity_approved: { kind: 'approval', verb: 'approved an entity' },
  entity_rejected: { kind: 'notice', verb: 'rejected an entity' },
  cap_closed: { kind: 'approval', verb: 'closed a CAP' },
  cap_updated: { kind: 'change', verb: 'updated a CAP' },
  stage_changed: { kind: 'change', verb: 'advanced an engagement stage' },
  notification_emit: { kind: 'notice', verb: 'sent a notification' },
  engagement_deployed: { kind: 'create', verb: 'deployed an engagement' },
  workpaper_reopened: { kind: 'notice', verb: 'reopened a workpaper' },
  preflight_acknowledged: { kind: 'notice', verb: 'acknowledged a pre-flight item' },
};

/**
 * The kind of a row. An unknown action is a `change`, the least alarming bucket, so a new event never
 * masquerades as an approval or a seal.
 */
export function activityKind(action: string): ActivityKind {
  return ACTIVITY_RULES[action]?.kind ?? 'change';
}

/** The human subject of a row: the summary's title, then period, then a plain object label. */
function activitySubject(row: ActivitySpineRow): string {
  const title = row.summary?.title;
  if (typeof title === 'string' && title.trim() !== '') return title;
  const period = row.summary?.period;
  if (typeof period === 'string' && period.trim() !== '') return period;
  return row.objectType ?? '';
}

/**
 * The one sentence the spine shows. Deterministic: actor + verb + subject. An unknown action falls
 * back to its verbatim action string with the underscores spaced, so nothing is hidden.
 */
export function activitySentence(row: ActivitySpineRow): string {
  const actor = row.actorName && row.actorName.trim() !== '' ? row.actorName : 'System';
  const rule = ACTIVITY_RULES[row.action];
  const verb = rule?.verb ?? row.action.replace(/_/g, ' ');
  const subject = activitySubject(row);
  return subject ? `${actor} ${verb} · ${subject}` : `${actor} ${verb}`;
}

/** Relative age, from an explicit `nowMs`. Pure: the caller passes the clock reading. */
export function activityAgeMs(ts: string | null, nowMs: number): number | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  const diff = nowMs - t;
  return diff < 0 ? 0 : diff;
}

/** A compact age label ("now", "3m", "2h", "4d"). Time is an argument. */
export function activityAgeLabel(ts: string | null, nowMs: number): string {
  const ms = activityAgeMs(ts, nowMs);
  if (ms === null) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Merge an incoming row into the current stream. Newest-first; an id already present is replaced in
 * place (a re-read or a Realtime UPDATE never duplicates a row). A row with no timestamp sorts last,
 * so a malformed event cannot jump to the top of the stream. Pure: returns a new array.
 */
export function mergeSpineRow(rows: ActivitySpineRow[], incoming: ActivitySpineRow, cap = 40): ActivitySpineRow[] {
  const without = rows.filter((r) => r.id !== incoming.id);
  const next = [incoming, ...without];
  next.sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : -Infinity;
    const tb = b.ts ? Date.parse(b.ts) : -Infinity;
    return tb - ta;
  });
  return next.slice(0, cap);
}

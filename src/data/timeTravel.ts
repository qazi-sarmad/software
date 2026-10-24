/**
 * Time-Travel data module (F14, S10). Every call goes through a typed function here; components
 * never import the database client (rule M8). The reconstruction and the event list are both
 * database functions (0068), so the app replays exactly the recorded history and never guesses.
 */
import { getClient } from './db';
import type { AsOfEvent, AsOfState } from '../lib/asOfTimeline';

const NOT_CONFIGURED = 'The Time-Travel module is not configured.';

interface RawEvent {
  seq: string;
  kind: string;
  action: string;
  at: string;
  object_type: string | null;
  object_id: string | null;
  detail: Record<string, unknown> | null;
}

function toEvent(raw: RawEvent): AsOfEvent {
  return {
    seq: String(raw.seq),
    kind: raw.kind === 'ledger' ? 'ledger' : 'activity',
    action: raw.action,
    at: raw.at,
    objectType: raw.object_type,
    objectId: raw.object_id,
    detail: raw.detail ?? {},
  };
}

/** The recorded events for one engagement up to a moment, in sequence. */
export async function listAsOfEvents(engagementId: string, ts: string): Promise<AsOfEvent[]> {
  const sb = getClient();
  if (!sb || !engagementId) return [];
  const { data, error } = await sb.rpc('engagement_as_of_events', { p_engagement_id: engagementId, p_ts: ts });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawEvent[]).map(toEvent);
}

/**
 * Reconstruct the engagement as of a moment. The function returns a JSON document; on a server
 * refusal (feature off, out of scope, no right) the error is surfaced to the caller.
 */
export async function getEngagementAsOf(engagementId: string, ts: string): Promise<AsOfState> {
  const sb = getClient();
  if (!sb) throw new Error(NOT_CONFIGURED);
  const { data, error } = await sb.rpc('engagement_as_of', { p_engagement_id: engagementId, p_ts: ts });
  if (error) throw new Error(error.message);
  const raw = data as Record<string, unknown> | null;
  if (!raw) throw new Error('The engagement could not be reconstructed.');
  return {
    status: (raw.status as AsOfState['status']) ?? 'not_recorded_before',
    asOf: String(raw.as_of ?? ts),
    earliestRecorded: (raw.earliest_recorded as string | null) ?? null,
    earliestAvailable: (raw.earliest_available as string | null) ?? null,
    note: (raw.note as string | undefined) ?? undefined,
    workpapers: ((raw.workpapers ?? []) as { id: string; status: string; at: string }[]),
    findings: ((raw.findings ?? []) as { id: string; at: string; observation_id?: string | null }[])
      .map((f) => ({ id: f.id, at: f.at, observationId: f.observation_id ?? null })),
    seal: (raw.seal as { sealed: boolean; at: string | null } | undefined) ?? { sealed: false, at: null },
    statuses: ((raw.statuses ?? []) as { action: string; at: string; object_type: string | null; object_id: string | null; detail: Record<string, unknown> }[])
      .map((s) => ({ action: s.action, at: s.at, objectType: s.object_type, objectId: s.object_id, detail: s.detail ?? {} })),
  };
}

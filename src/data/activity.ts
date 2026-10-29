/**
 * The live activity spine data module (U4).
 *
 * Reads the org's recent activity as a summary stream through the gated `activity_spine_list` RPC
 * (migration 0116), and subscribes to further changes on the existing Realtime transport. A component
 * never imports the Supabase client (rule M8). With no Supabase environment every function is inert:
 * the read returns an empty stream and the subscribe returns null, so the surface polls and shows its
 * quiet empty state rather than an error.
 */
import { getClient } from './db';
import {
  changeBelongsToOrg,
  notificationChannelName,
  orgChangeFilter,
  type LiveTransport,
} from '../lib/liveSync';
import type { ActivitySpineRow } from '../lib/activitySpine';

export type { ActivitySpineRow };

/** A monotonically increasing suffix so two subscriptions never share a channel name (see liveSync). */
let channelSeq = 0;

/**
 * The organisation's recent activity as a summary stream, newest first. Rights-gated in the database:
 * a scoped member gets an empty stream, never an error. Inert (empty) with no client.
 */
export async function listActivitySpine(limit = 40, since: string | null = null): Promise<ActivitySpineRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('activity_spine_list', { p_limit: limit, p_since: since });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ''),
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? 'System',
    action: String(r.action ?? ''),
    objectType: (r.object_type as string | null) ?? null,
    objectId: (r.object_id as string | null) ?? null,
    summary: (r.summary as Record<string, unknown> | null) ?? {},
    ts: (r.ts as string | null) ?? null,
  }));
}

export interface ActivitySubscription {
  close: () => void;
  isLive: () => boolean;
}

/**
 * Subscribe to further activity rows for one organisation on the existing Realtime transport.
 *
 * Returns `null` when there is no client (the surface then polls through `listActivitySpine`). The
 * channel name carries the org so two orgs in one browser never share a channel; a foreign row is
 * ignored as a defensive client-side check (the database's RLS is the real guard). Only the reduced
 * summary is delivered — the publication carries `activity_log`, but a subscriber still receives a
 * row it is permitted to read.
 */
export function subscribeActivity(
  orgId: string,
  onChange: (row: ActivitySpineRow) => void
): ActivitySubscription | null {
  const sb = getClient();
  if (!sb || !orgId) return null;

  let live = false;
  const channelName = notificationChannelName(`spine:${orgId}`, ++channelSeq);
  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_log', filter: orgChangeFilter(orgId) },
      (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        if (!changeBelongsToOrg(payload, orgId)) return;
        const row = payload.new ?? {};
        onChange({
          id: String(row.id ?? ''),
          actorId: (row.actor_id as string | null) ?? null,
          // The Realtime payload carries the raw row, not the RPC's joined actor name; the spine
          // resolves the name from its own in-memory map or shows "Someone" until the next poll.
          actorName: 'Someone',
          action: String(row.action ?? ''),
          objectType: (row.object_type as string | null) ?? null,
          objectId: (row.object_id as string | null) ?? null,
          summary: (row.detail as Record<string, unknown> | null) ?? {},
          ts: (row.ts as string | null) ?? null,
        });
      }
    )
    .subscribe((status: string) => {
      live = status === 'SUBSCRIBED';
    });

  return {
    close: () => {
      live = false;
      void sb.removeChannel(channel);
    },
    isLive: () => live,
  };
}

/** Re-exported so a surface can name its transport without importing liveSync directly. */
export type { LiveTransport };

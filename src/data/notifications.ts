/**
 * In-app notifications and the Realtime subscription (SCALE-1, spec §22, §17.1).
 *
 * The `notifications` table is the durable record; this module reads the caller's own rows through
 * `notifications_list` (RLS-bounded) and acknowledges one through `notification_mark_read`. Delivery
 * is live: `subscribeNotifications` opens a Supabase Realtime channel on the table, filtered to the
 * caller's organisation, and calls back on every change. When Realtime is unavailable the caller
 * falls back to the poll interval (see src/lib/liveSync.ts). Components never import the client.
 */
import { callRpc, getClient, type DataResult } from './db';
import { changeBelongsToOrg, notificationChannelName, orgChangeFilter } from '../lib/liveSync';

const NOT_CONFIGURED = 'The notifications module is not configured.';

/** Monotonic suffix so two subscribers for one org never collide on a channel name. */
let channelSeq = 0;

export interface AppNotification {
  id: string;
  kind: string;
  body: string;
  read: boolean;
  payload: Record<string, unknown>;
  ts: string;
}

interface RawNotification {
  id: string;
  kind: string | null;
  body: string | null;
  read: boolean | null;
  payload: Record<string, unknown> | null;
  ts: string;
}

/** The caller's own notifications, unread first. Reads through the RLS-bounded RPC. */
export async function listNotifications(): Promise<AppNotification[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('notifications_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawNotification[]).map((n) => ({
    id: n.id,
    kind: n.kind ?? 'notice',
    body: n.body ?? '',
    read: n.read === true,
    payload: n.payload ?? {},
    ts: n.ts,
  }));
}

/** Acknowledge one of the caller's own notifications. */
export function markNotificationRead(id: string): Promise<DataResult> {
  return callRpc('notification_mark_read', { p_id: id }, NOT_CONFIGURED);
}

/** Raise an in-app notification for a member of the caller's own organisation. */
export function emitNotification(
  orgId: string, userId: string, kind: string, body: string, payload: Record<string, unknown> = {}
): Promise<DataResult> {
  return callRpc('notification_emit', {
    p_org: orgId, p_user_id: userId, p_kind: kind, p_body: body, p_payload: payload,
  }, NOT_CONFIGURED);
}

export interface NotificationSubscription {
  /** Unsubscribe and close the channel. Safe to call more than once. */
  close: () => void;
  /** True once the channel reported SUBSCRIBED. */
  isLive: () => boolean;
}

/**
 * Subscribe to in-app notification changes for one organisation.
 *
 * Returns `null` when there is no client (the surface then polls). The channel name carries the org
 * so two orgs in one browser never share a channel. `onChange` fires on INSERT and UPDATE; a foreign
 * row is ignored as a defensive client-side check (the database's RLS is the real guard).
 */
export function subscribeNotifications(
  orgId: string, onChange: (notification: AppNotification) => void
): NotificationSubscription | null {
  const sb = getClient();
  if (!sb || !orgId) return null;

  let live = false;
  // The channel name must be unique per subscription. supabase-js returns an EXISTING channel when
  // the name matches, and adding a `postgres_changes` callback to an already-subscribed channel
  // throws. Two surfaces subscribe for the same org (the header bell and the Work Queue card), so a
  // shared name would break the second subscriber.
  const channelName = notificationChannelName(orgId, ++channelSeq);
  const channel = sb
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: orgChangeFilter(orgId) },
      (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
        if (!changeBelongsToOrg(payload, orgId)) return;
        const row = payload.new ?? payload.old ?? {};
        onChange({
          id: String(row.id ?? ''),
          kind: String(row.kind ?? 'notice'),
          body: String(row.body ?? ''),
          read: row.read === true,
          payload: (row.payload as Record<string, unknown>) ?? {},
          ts: String(row.ts ?? ''),
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

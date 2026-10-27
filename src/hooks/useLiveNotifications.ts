import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications, subscribeNotifications, type AppNotification } from '../data/notifications';
import { chooseTransport, pollDue } from '../lib/liveSync';

export interface UseLiveNotifications {
  notifications: AppNotification[];
  unread: number;
  /** 'realtime' once the channel is subscribed, else 'poll'. */
  transport: 'realtime' | 'poll';
  refresh: () => Promise<void>;
}

/**
 * Live in-app notifications (SCALE-1, §22). Subscribes to Realtime when it connects and falls back
 * to a bounded poll otherwise, so the Work Queue converges on the latest rows either way. The poll
 * is deliberately slow; Realtime is the primary transport. All timing decisions live in
 * src/lib/liveSync.ts (pure) so this hook only owns the timers.
 */
export function useLiveNotifications(orgId: string | undefined, pollIntervalMs = 5000): UseLiveNotifications {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [transport, setTransport] = useState<'realtime' | 'poll'>('poll');
  const lastPollRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      const rows = await listNotifications();
      setNotifications(rows);
    } catch {
      // A read failure leaves the last known list in place; the surface shows what it had.
    }
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    void refresh();

    const sub = subscribeNotifications(orgId, (n) => {
      if (!live) return;
      // Upsert by id: an UPDATE (mark-read) replaces the row, an INSERT prepends it.
      setNotifications((prev) => {
        const rest = prev.filter((p) => p.id !== n.id);
        return [n, ...rest];
      });
    });

    if (sub) {
      setTransport(chooseTransport({ realtimeAvailable: sub.isLive(), pollIntervalMs }));
    }

    // The poll fallback. It also re-reads once after the channel reports live, so a change that
    // arrived before SUBSCRIBED is not missed. The interval is bounded by the pure policy.
    const id = window.setInterval(() => {
      const now = Date.now();
      const opts = { realtimeAvailable: sub?.isLive() ?? false, pollIntervalMs };
      const due = pollDue(now - lastPollRef.current, opts);
      const liveNow = sub?.isLive() ?? false;
      if (liveNow) setTransport('realtime');
      if (due) {
        lastPollRef.current = now;
        void refresh();
      }
    }, 1000);

    return () => {
      live = false;
      window.clearInterval(id);
      sub?.close();
    };
  }, [orgId, pollIntervalMs, refresh]);

  const unread = notifications.filter((n) => !n.read).length;
  return { notifications, unread, transport, refresh };
}

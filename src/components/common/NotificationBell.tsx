import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useLiveNotifications } from '../../hooks/useLiveNotifications';
import { markNotificationRead } from '../../data/notifications';
import { AlertCircle, CheckCircle2 } from '../common/Icons';

/**
 * Header notification bell (SCALE-1, §22).
 *
 * A non-blocking popover (never a modal, never a scrim) that lists the caller's own in-app
 * notifications. Delivery is live through Realtime with a poll fallback, so a notification raised
 * elsewhere appears here without a reload. The badge counts unread rows; clicking one acknowledges
 * it through `notification_mark_read`, which is bounded to the caller's own row.
 *
 * The same notifications are also surfaced in the Work Queue; this bell is the always-visible entry
 * point so a delivery is provable from any screen.
 */
export const NotificationBell: React.FC = () => {
  const { currentUser } = useApp();
  const { notifications, unread, transport, refresh } = useLiveNotifications(currentUser.orgId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const acknowledge = async (id: string) => {
    await markNotificationRead(id);
    await refresh();
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="notification-bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className={`relative p-2 rounded-xl transition-colors border ${
          open
            ? 'bg-accent-subtle text-accent border-accent'
            : 'bg-surface-elevated hover:bg-surface-hover text-secondary hover:text-primary border-hairline'
        }`}
      >
        <AlertCircle className="w-4 h-4 stroke-[1.5]" />
        {unread > 0 && (
          <span
            data-testid="notification-bell-count"
            className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-cinnabar text-white text-apple-11 font-semibold flex items-center justify-center tabular-nums"
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="complementary"
          aria-label="Notifications"
          data-testid="notification-panel"
          data-transport={transport}
          className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-hairline bg-surface shadow-apple z-[70] overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
            <span className="text-apple-13 font-semibold text-primary">Notifications</span>
            <span className="text-apple-11 text-tertiary" data-testid="notification-transport">
              {transport === 'realtime' ? 'Live' : 'Polling'}
            </span>
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-apple-12 text-tertiary" data-testid="notification-empty">
              Nothing new.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-hairline" data-testid="notification-list">
              {notifications.map((n) => (
                <li key={n.id} data-testid={`notification-${n.id}`} className="px-4 py-3 flex items-start gap-3">
                  <span className={n.read ? 'text-tertiary' : 'text-accent'}>
                    <CheckCircle2 className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-apple-12 ${n.read ? 'text-secondary' : 'text-primary font-medium'}`}>
                      {n.body}
                    </p>
                    <p className="text-apple-11 text-tertiary">{n.kind}</p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => void acknowledge(n.id)}
                      data-testid={`notification-mark-read-${n.id}`}
                      className="text-apple-11 text-accent hover:underline shrink-0"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

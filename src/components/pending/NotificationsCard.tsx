import React from 'react';
import { useApp } from '../../context/AppContext';
import { useLiveNotifications } from '../../hooks/useLiveNotifications';
import { markNotificationRead } from '../../data/notifications';
import { AlertCircle } from '../common/Icons';

/**
 * WK-11 in-app notifications (SCALE-1, §22).
 *
 * The caller's own notifications, delivered live through Realtime with a bounded poll fallback, so
 * a notification raised elsewhere reaches the Work Queue without a reload. The block renders its
 * designed empty state when there is nothing, so it is never a blank area.
 */
export const NotificationsCard: React.FC = () => {
  const { currentUser } = useApp();
  const { notifications, unread, transport, refresh } = useLiveNotifications(currentUser.orgId);

  return (
    <div
      className="rounded-2xl bg-surface border border-hairline shadow-apple p-5 space-y-3"
      data-testid="wk-notifications"
      data-transport={transport}
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-accent" />
        <h2 className="text-apple-15 font-semibold text-primary">Notifications</h2>
        <span className="text-apple-11 text-tertiary" data-testid="wk-notifications-transport">
          {transport === 'realtime' ? 'Live' : 'Polling'}
        </span>
        {unread > 0 && (
          <span
            data-testid="wk-notifications-unread"
            className="ml-auto px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-accent-subtle text-accent tabular-nums"
          >
            {unread} new
          </span>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-apple-12 text-tertiary" data-testid="wk-notifications-empty">
          Nothing new.
        </p>
      ) : (
        <ul className="divide-y divide-hairline" data-testid="wk-notifications-list">
          {notifications.map((n) => (
            <li key={n.id} className="py-2.5 flex items-start gap-3" data-testid={`wk-notification-${n.id}`}>
              <div className="min-w-0 flex-1">
                <p className={`text-apple-13 ${n.read ? 'text-secondary' : 'text-primary font-medium'}`}>{n.body}</p>
                <p className="text-apple-11 text-tertiary">{n.kind}</p>
              </div>
              {!n.read && (
                <button
                  type="button"
                  onClick={() => void markNotificationRead(n.id).then(() => refresh())}
                  data-testid={`wk-notification-mark-read-${n.id}`}
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
  );
};

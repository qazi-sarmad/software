import { describe, expect, it } from 'vitest';
import {
  emitNotification,
  listNotifications,
  markNotificationRead,
  subscribeNotifications,
} from './notifications';
import { notificationChannelName } from '../lib/liveSync';

/** With no Supabase environment variables the module is inert. No request leaves the process. */
describe('notifications data module (not configured)', () => {
  it('reads return empty', async () => {
    expect(await listNotifications()).toEqual([]);
  });

  it('writes report not configured', async () => {
    expect(await markNotificationRead('id')).toEqual({ ok: false, reason: 'The notifications module is not configured.' });
    expect(await emitNotification('org', 'user', 'kind', 'body')).toEqual({
      ok: false, reason: 'The notifications module is not configured.',
    });
  });

  it('there is no subscription without a client, so the surface polls instead', () => {
    expect(subscribeNotifications('org', () => {})).toBeNull();
  });
});

/**
 * Regression guard for the §22 channel-name defect.
 *
 * Two surfaces subscribe for the same organisation at once (the header bell and the Work Queue
 * card). supabase-js returns an existing channel when the requested name matches one it already
 * tracks, and adding a `postgres_changes` callback to an already-subscribed channel THROWS. A shared
 * name therefore broke the second subscriber and the Work Queue never rendered. The name must differ
 * for every subscription; this test would have caught the original defect.
 */
describe('notification channel names are unique per subscription', () => {
  it('two subscriptions for the same org get different names', () => {
    const a = notificationChannelName('org-1', 1);
    const b = notificationChannelName('org-1', 2);
    expect(a).not.toBe(b);
  });

  it('the org is still encoded in the name so channels are not shared across orgs', () => {
    expect(notificationChannelName('org-1', 1)).toContain('org-1');
    expect(notificationChannelName('org-2', 1)).not.toContain('org-1');
  });
});

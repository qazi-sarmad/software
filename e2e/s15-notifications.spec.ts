import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { passwordFor } from './password';

/**
 * §22 Realtime in-app notification delivery (SCALE-1).
 *
 * Proves a notification raised in the database reaches the signed-in member's in-app surface
 * WITHOUT a reload. The surface is the header bell (GL-02) and the Work Queue card (WK-11); both are
 * fed by `useLiveNotifications`, which subscribes to Realtime and falls back to a bounded poll
 * (`src/lib/liveSync.ts`). The assertion therefore holds on either transport: the notification must
 * appear within the poll window even if the websocket is unavailable.
 *
 * The notification is raised through the REAL emitter (`notification_emit`, granted to the service
 * role) rather than an insert, because the `notifications` table is read-only for tenants by design
 * (migration 0055, D-S2-notifications). The recipient is looked up by email so the id is never
 * hard-coded.
 */

const PREPARER = 'bilal.ahmed@provio-test.invalid';
const ORG_A = '02af9314-9781-5bde-b8a7-d46bfee07783';

function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('§22 spec needs SUPABASE_URL and SUPABASE_SECRET_KEY');
  return createClient(url, secret, { auth: { persistSession: false } });
}

async function recipientId(sb: SupabaseClient, email: string): Promise<string> {
  const list = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = list.data?.users.find((u) => u.email === email);
  if (!user) throw new Error(`no such user: ${email}`);
  return user.id;
}

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('[§22] a notification raised in the database reaches the Work Queue and the bell without a reload', async ({ page }) => {
  const sb = serviceClient();
  const uid = await recipientId(sb, PREPARER);

  // Start clean for this recipient so the assertion is about the new row.
  await sb.from('notifications').delete().eq('org_id', ORG_A).eq('user_id', uid);

  await signIn(page, PREPARER);
  await page.getByTitle('Work Queue').click();
  await expect(page.getByTestId('tab-pending')).toBeVisible();
  await expect(page.getByTestId('wk-notifications')).toBeVisible();

  // The block starts in its designed empty state.
  await expect(page.getByTestId('wk-notifications-empty')).toBeVisible();

  // Raise the notification through the real emitter, as an in-database event would.
  const body = 'Escalation: the procurement sample is below the floor.';
  const emitted = await sb.rpc('notification_emit', {
    p_org: ORG_A, p_user_id: uid, p_kind: 'escalation.triggered', p_body: body, p_payload: { source: 's15' },
  });
  expect(emitted.error, emitted.error?.message).toBeNull();
  expect(emitted.data).toBeTruthy();

  // The delivery arrives without a reload, on Realtime or the poll fallback. The unread badge and
  // the row body must both appear; the transport indicator says which path delivered it.
  await expect(page.getByTestId('wk-notifications-unread')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('wk-notifications-list')).toContainText(body, { timeout: 20000 });

  // The header bell mirrors the same delivery.
  await expect(page.getByTestId('notification-bell-count')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('notification-bell').click();
  await expect(page.getByTestId('notification-panel')).toBeVisible();
  await expect(page.getByTestId('notification-list')).toContainText(body);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[§22] the recipient acknowledges the notification and it leaves the unread set', async ({ page }) => {
  const sb = serviceClient();
  const uid = await recipientId(sb, PREPARER);
  await sb.from('notifications').delete().eq('org_id', ORG_A).eq('user_id', uid);
  const body = 'Acknowledge me.';
  await sb.rpc('notification_emit', {
    p_org: ORG_A, p_user_id: uid, p_kind: 'notice', p_body: body, p_payload: {},
  });

  await signIn(page, PREPARER);
  await page.getByTitle('Work Queue').click();
  await expect(page.getByTestId('wk-notifications-list')).toContainText(body, { timeout: 20000 });

  // Mark it read from the Work Queue; the unread badge clears.
  const row = page.locator('[data-testid^="wk-notification-"]').filter({ hasText: body }).first();
  await row.locator('[data-testid^="wk-notification-mark-read-"]').click();
  await expect(page.getByTestId('wk-notifications-unread')).toHaveCount(0, { timeout: 20000 });

  // The row is durably read in the database.
  const stored = await sb.from('notifications').select('read').eq('org_id', ORG_A).eq('user_id', uid).eq('body', body).single();
  expect(stored.data?.read).toBe(true);
});

test('[§22] a member never sees another member’s notification', async ({ page }) => {
  const sb = serviceClient();
  const uid = await recipientId(sb, PREPARER);
  // A same-org colleague (the audit manager) is the recipient; the Preparer must not see its row.
  const otherUid = await recipientId(sb, 'zara.malik@provio-test.invalid');
  await sb.from('notifications').delete().in('user_id', [uid, otherUid]);
  const secret = 'Only the other member should see this.';
  await sb.rpc('notification_emit', {
    p_org: ORG_A, p_user_id: otherUid, p_kind: 'notice', p_body: secret, p_payload: {},
  });

  await signIn(page, PREPARER);
  await page.getByTitle('Work Queue').click();
  await expect(page.getByTestId('wk-notifications')).toBeVisible();
  // The Preparer is not the recipient, so its block stays empty and never shows the other row.
  await expect(page.getByTestId('wk-notifications-empty')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('wk-notifications')).not.toContainText(secret);
});

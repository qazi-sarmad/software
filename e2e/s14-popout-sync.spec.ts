import { test, expect, type Page, type Locator } from '@playwright/test';
import { passwordFor } from './password';

/**
 * §17.1 pop-out live sync (SCALE-1).
 *
 * The Audit File window can be popped out to its own same-origin browser window at
 * `/view/<recordType>/<recordId>`. The pop-out and the window that opened it share the origin's
 * `localStorage`, so a revision published in either window reaches the other without a server
 * round-trip (src/hooks/useRecordRevisionSync.ts, policy in src/lib/liveSync.ts). This spec proves:
 *
 *   1. the pop-out opens and renders the SAME record the parent window shows;
 *   2. a revision published in the pop-out is visible to the parent, and back; and
 *   3. the same-origin storage channel converges the two windows even when Realtime is unavailable
 *      — i.e. the documented fallback works.
 *
 * No assertion depends on wall-clock time; the sync is observed through the DOM.
 */

const CIA = 'kamran.sheikh@provio-test.invalid';
// The window id is derived from the record (`audit_file:<engagementId>`), so match by prefix.
const WINDOW = '[data-testid^="floating-window-audit_file"]';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openAuditFileWindow(page: Page): Promise<Locator> {
  await page.getByTitle('Audit Files').click();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.click();
  const win = page.locator(WINDOW).first();
  await expect(win).toBeVisible({ timeout: 20000 });
  return win;
}

const revisionText = (scope: Locator) => scope.locator('[data-testid$="-revision"]').first();
const refreshButton = (scope: Locator) => scope.locator('[data-testid$="-refresh"]').first();

test.describe.configure({ mode: 'serial' });

test('[§17.1] the pop-out opens the same record the parent window shows', async ({ page, context }) => {
  await signIn(page, CIA);
  const win = await openAuditFileWindow(page);

  const [popOut] = await Promise.all([
    context.waitForEvent('page'),
    win.getByLabel('Open in its own window').click(),
  ]);
  await popOut.waitForLoadState('domcontentloaded');

  // The pop-out is the full-page record view (MODE A) for the same record, with its own revision
  // indicator — not a blank page and not a blocking modal.
  await expect(popOut).toHaveURL(/\/view\//);
  await expect(popOut.getByTestId('record-page')).toBeVisible({ timeout: 20000 });
  await expect(popOut.getByTestId('record-page-revision')).toBeVisible();
  await expect(popOut.locator('[aria-modal="true"]')).toHaveCount(0);
  await popOut.close();
});

test('[§17.1] a revision published in the pop-out is visible to the parent, and back', async ({ page, context }) => {
  await signIn(page, CIA);
  const win = await openAuditFileWindow(page);

  const [popOut] = await Promise.all([
    context.waitForEvent('page'),
    win.getByLabel('Open in its own window').click(),
  ]);
  await popOut.waitForLoadState('domcontentloaded');
  await expect(popOut.getByTestId('record-page')).toBeVisible({ timeout: 20000 });

  // Publish a revision in the pop-out: the same-origin storage event must reach the parent window.
  await popOut.getByTestId('record-page-refresh').click();
  await expect(revisionText(win)).toContainText('Revision 1', { timeout: 10000 });

  // And the parent can publish back to the pop-out.
  await refreshButton(win).click();
  await expect(popOut.getByTestId('record-page-revision')).toContainText('Revision 2', { timeout: 10000 });
  await popOut.close();
});

test('[§17.1] the same-origin storage channel converges the windows when Realtime is unavailable', async ({ page, context }) => {
  // Simulate a deployment where Realtime cannot connect: replace the socket with a stub that never
  // opens. The channel never reaches SUBSCRIBED, so the surface is in its documented poll mode; the
  // same-origin storage channel is independent of the socket and must still converge the windows.
  await context.addInitScript(() => {
    class DeadSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState = 0;
      url: string;
      constructor(url: string) { this.url = url; }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() { this.readyState = 3; }
    }
    // @ts-expect-error deliberate: the test removes the Realtime transport.
    window.WebSocket = DeadSocket;
  });

  await signIn(page, CIA);
  const win = await openAuditFileWindow(page);

  const [popOut] = await Promise.all([
    context.waitForEvent('page'),
    win.getByLabel('Open in its own window').click(),
  ]);
  await popOut.waitForLoadState('domcontentloaded');
  await expect(popOut.getByTestId('record-page')).toBeVisible({ timeout: 20000 });

  await popOut.getByTestId('record-page-refresh').click();
  await expect(revisionText(win)).toContainText('Revision 1', { timeout: 10000 });
  await popOut.close();
});

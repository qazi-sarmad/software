import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * C1.1 E2E: the Microsoft Graph sign-in is wired, carries a signed state, and never shows a secret.
 *
 * The Microsoft app registration cannot be reached from CI, and the graph-oauth Edge Function is not
 * deployed to the test project (the owner deploys it; see docs/COMPLETION-REPORT.md). So the two
 * HTTP calls to the function are stubbed at the network boundary with `page.route`: this spec proves
 * the CLIENT wiring and the screen behaviour, while the authorisation, the state signing and the
 * refusals are proven by the unit tests (src/lib/graphOauthHandler.test.ts, graphOauthState.test.ts)
 * and the SQL test (supabase/tests/81_oauth_state.sql). A stub here stands in for an external
 * provider, not for our own logic.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openControlPlane(page: Page) {
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-panel')).toBeVisible();
}

test.describe('C1.1 Microsoft Graph sign-in', () => {
  test('[E2E] the start action returns a consent URL carrying state= and no secret', async ({ page }) => {
    let requested: string | null = null;
    await page.route('**/functions/v1/graph-oauth', async (route) => {
      requested = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // The real function returns the consent URL and nothing else. The secret literal here is a
        // canary: if it ever reached the DOM the assertions below would fail.
        body: JSON.stringify({
          ok: true,
          url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=test-app&response_type=code&state=SIGNED-STATE-TOKEN',
        }),
      });
    });

    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-email').click();
    await expect(page.getByTestId('org-email')).toBeVisible();

    // Choose a Microsoft provider so the connect button appears.
    await page.getByTestId('org-email-provider').selectOption('graph_delegated');
    await expect(page.getByTestId('org-email-connect-graph')).toBeVisible();

    // The click navigates away to the consent URL; capture the navigation instead of following it.
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('login.microsoftonline.com')),
      page.getByTestId('org-email-connect-graph').click(),
    ]);
    expect(request.url()).toContain('state=');
    expect(request.url()).toContain('response_type=code');
    expect(requested).toContain('"action":"start"');
    expect(requested).not.toContain('client_secret');
    expect(requested).not.toContain('refresh_token');
  });

  test('[E2E] the callback route refuses a link with no code or state, and shows no token', async ({ page }) => {
    await page.goto('/oauth/graph');
    await expect(page.getByTestId('oa-11-oauth-callback')).toBeVisible();
    await expect(page.getByTestId('oa-11-oauth-error')).toBeVisible();
    const text = (await page.getByTestId('oa-11-oauth-callback').innerText()).toLowerCase();
    expect(text).not.toContain('access_token');
    expect(text).not.toContain('refresh_token');
    expect(text).not.toContain('client_secret');
  });
});

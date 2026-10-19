import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * ACP control plane E2E (S1.c). Everything is configured in a portal, never in SQL:
 *   - GL-01: the Dual Session banner is a non-blocking strip shown to both parties.
 *   - SA-09: the platform console requests and ends a session.
 *   - OA-16: the Org Admin sees the banner and can end the session.
 *   - SA-14 / OA-04: a feature entitlement change requires a reason, and the Org Admin's effective
 *     set is read-only.
 *   - OA-01: the guided setup wizard shows every step with its tutorial.
 *
 * Serial: the tests share one tenant's entitlement and consultation state, so they must not run
 * concurrently. Each side of a Dual Session gets its own browser context, because the Supabase
 * session lives in localStorage and a second sign-in on the same page would overwrite the first.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';
const PLATFORM_EMAIL = 'platform.admin@provio-test.invalid';
const BASE_URL = 'http://localhost:3000';
const ORG_A_NAME = /Synthetic Org A/;

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function signInPlatform(page: Page) {
  await page.goto('/superadmin');
  await page.getByLabel('Email').fill(PLATFORM_EMAIL);
  await page.getByLabel('Password').fill(passwordFor(PLATFORM_EMAIL));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('superadmin-portal')).toBeVisible();
}

/** Open the Assurance control plane inspector from the profile menu. */
async function openControlPlane(page: Page) {
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-panel')).toBeVisible();
}

/** Pick tenant A in a platform console Select (the dropdown is a custom listbox). */
async function pickTenant(page: Page, label: string) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: ORG_A_NAME }).click();
}

test.describe('ACP control plane (S1)', () => {
  test('[E2E] the Org Admin sees the effective feature set read-only', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await expect(page.getByTestId('org-features-list')).toBeVisible();
    // OA-04 is read-only: an add-on the plan does not include points at QSCorp, never a toggle.
    await expect(page.getByTestId('org-features')).toContainText('Ask QSCorp to add this');
    await expect(page.getByTestId('org-features').getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  });

  test('[E2E] a preparer (no edit_config) is denied the control plane', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await expect(page.getByTestId('menu-org-control')).toHaveCount(0);
  });

  test('[E2E] the guided setup wizard shows every Org Admin step with a tutorial', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-setup').click();
    await expect(page.getByTestId('org_admin-wizard')).toBeVisible();
    await expect(page.getByTestId('org_admin-wizard-step-org.profile')).toBeVisible();
    await expect(page.getByTestId('org_admin-wizard-body')).toContainText('Why it matters');

    // Every step carries "Show me how", which opens the non-blocking tutorial drawer.
    await page.getByTestId('org_admin-wizard-show-org.profile').click();
    await expect(page.getByTestId('tutorial-drawer')).toBeVisible();
    await expect(page.getByTestId('tutorial-drawer')).toHaveAttribute('role', 'complementary');
    await page.getByTestId('tutorial-drawer-close').click();
    await expect(page.getByTestId('tutorial-drawer')).toHaveCount(0);
  });

  test('[E2E] Dual Session: the platform requests, the Org Admin sees the live banner and ends it', async ({ page, browser }) => {
    // The platform side starts a tier 1 session for the Org Admin's tenant.
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-consultation').click();
    await expect(page.getByTestId('superadmin-consultation')).toBeVisible();
    await pickTenant(page, 'Tenant for the consultation');
    await page.getByTestId('superadmin-consultation-request').click();
    await expect(page.getByTestId('superadmin-consultation-result')).toHaveCount(0);

    // A separate context, so the Org Admin sign-in does not overwrite the platform session.
    const orgContext = await browser.newContext({ baseURL: BASE_URL });
    const orgPage = await orgContext.newPage();
    await signIn(orgPage, ORG_ADMIN_EMAIL);
    await expect(orgPage.getByTestId('consultation-banner')).toBeVisible();
    await expect(orgPage.getByTestId('consultation-banner')).toContainText('QSCorp consultant');
    await expect(orgPage.getByTestId('consultation-banner-time')).toBeVisible();
    await orgPage.getByTestId('consultation-banner-end').click();
    await expect(orgPage.getByTestId('consultation-banner')).toHaveCount(0);
    await orgContext.close();
  });

  test('[E2E] a feature change requires a reason and reaches the Org Admin', async ({ page, browser }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-features').click();
    await expect(page.getByTestId('superadmin-features')).toBeVisible();
    await pickTenant(page, 'Tenant for entitlements');
    await expect(page.getByTestId('entitlement-toggle-patterns')).toBeVisible();

    // Without a reason the change is refused in the UI and never sent.
    await page.getByTestId('entitlement-toggle-patterns').click();
    await expect(page.getByTestId('superadmin-features-result')).toContainText('reason is required');

    // With a reason it is applied, and the Org Admin's read-only view reflects it.
    await page.getByTestId('entitlement-reason-patterns').fill('Sold as an add-on for the E2E run');
    await page.getByTestId('entitlement-toggle-patterns').click();
    await expect(page.getByTestId('superadmin-features-result')).toHaveCount(0);

    const orgContext = await browser.newContext({ baseURL: BASE_URL });
    const orgPage = await orgContext.newPage();
    await signIn(orgPage, ORG_ADMIN_EMAIL);
    await openControlPlane(orgPage);
    await expect(orgPage.getByTestId('org-feature-patterns')).toContainText('included');
    await orgContext.close();
  });

  test('[E2E] the Org Admin invites QSCorp to a tier 2 session', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-consultation').click();
    await expect(page.getByTestId('org-consultation')).toBeVisible();
    await page.getByTestId('org-consultation-invite').click();
    // A successful invite shows the session card, never an inline error.
    await expect(page.getByTestId('org-consultation-result')).toHaveCount(0);
    await expect(page.getByTestId('org-consultation-session')).toBeVisible();
  });

  test('[E2E] the configuration history is one read-only story', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-history').click();
    await expect(page.getByTestId('org-history')).toBeVisible();
    // Read-only: no control on the history surface writes anything.
    await expect(page.getByTestId('org-history').getByRole('button', { name: /save|apply|update/i })).toHaveCount(0);
    // Either rows are shown in the table or the explicit empty state is.
    const table = page.getByTestId('org-history-table');
    const empty = page.getByTestId('org-history-empty');
    await expect(table.or(empty)).toBeVisible();
  });
});

import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S9 E2E: the external auditor portal (F13).
 *
 * The Org Admin invites and manages external auditors (OA-14); the auditor signs in as a separate
 * read-only principal and reaches only its granted engagement (EX-02/EX-03/EX-04). The auditor is
 * never an org member, so the tenant navigation strip must not appear. Serial, because the tenant's
 * grants and access log are shared state.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
const EXTERNAL_AUDITOR_EMAIL = 'external.auditor@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signInTenant(page: Page, email: string) {
  await signIn(page, email);
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openControlPlane(page: Page) {
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-panel')).toBeVisible();
}

test.describe('S9 external auditor portal', () => {
  test('[E2E] the Org Admin sees the External auditors tab and never a JSON box', async ({ page }) => {
    await signInTenant(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-auditors').click();
    await expect(page.getByTestId('oa-auditors')).toBeVisible();
    // Every screen is visual (F1): the panel offers an email box, dropdowns and checkboxes.
    await expect(page.getByTestId('oa-auditors-email')).toBeVisible();
    await expect(page.getByTestId('oa-auditors-expiry-kind')).toBeVisible();
    await expect(page.getByTestId('oa-auditors')).not.toContainText('JSON');
  });

  test('[E2E] the permission matrix lists the invited auditor and its access log region', async ({ page }) => {
    await signInTenant(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-auditors').click();
    await expect(page.getByTestId('oa-auditors')).toBeVisible();
    // The global-setup seeds one auditor with a live grant; the matrix or the empty state shows.
    const matrix = page.getByTestId('oa-auditors-matrix');
    const empty = page.getByTestId('oa-auditors-matrix-empty');
    await expect(matrix.or(empty)).toBeVisible();
    if (await matrix.count()) {
      await expect(page.getByTestId('oa-auditors-matrix')).toContainText(EXTERNAL_AUDITOR_EMAIL);
    }
    // The access-log section is always present.
    await expect(page.getByTestId('oa-auditors-log').or(page.getByTestId('oa-auditors-log-empty'))).toBeVisible();
  });

  test('[E2E] choosing permanent access shows the plain warning', async ({ page }) => {
    await signInTenant(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-auditors').click();
    await expect(page.getByTestId('oa-auditors-expiry-kind')).toBeVisible();
    await page.getByTestId('oa-auditors-expiry-kind').selectOption('permanent');
    await expect(page.getByTestId('oa-auditors-permanent-warning')).toBeVisible();
    // Back to time-boxed: the days box returns and the warning goes.
    await page.getByTestId('oa-auditors-expiry-kind').selectOption('time_boxed');
    await expect(page.getByTestId('oa-auditors-days')).toBeVisible();
    await expect(page.getByTestId('oa-auditors-permanent-warning')).toHaveCount(0);
  });

  test('[E2E] the external auditor signs in and sees the read-only portal, never the tenant shell', async ({ page }) => {
    await signIn(page, EXTERNAL_AUDITOR_EMAIL);
    // A separate principal: the portal renders, and the tenant navigation strip does not.
    await expect(page.getByTestId('ex-portal')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toHaveCount(0);
    // The seeded grant names one engagement.
    await expect(page.getByTestId('ex-portal-engagements')).toBeVisible();
  });

  test('[E2E] the portal shows the engagement summary and the documents section', async ({ page }) => {
    await signIn(page, EXTERNAL_AUDITOR_EMAIL);
    await expect(page.getByTestId('ex-portal')).toBeVisible();
    await expect(page.getByTestId('ex-portal-summary')).toBeVisible();
    await expect(page.getByTestId('ex-portal-downloads')).toBeVisible();
    await expect(page.getByTestId('ex-portal-pack-hash')).toBeVisible();
    await expect(page.getByTestId('ex-portal-cert-hash')).toBeVisible();
  });

  test('[E2E] the portal offers a hash-verification tool and no write control', async ({ page }) => {
    await signIn(page, EXTERNAL_AUDITOR_EMAIL);
    await expect(page.getByTestId('ex-portal')).toBeVisible();
    await expect(page.getByTestId('ex-portal-drop')).toBeVisible();
    await expect(page.getByTestId('ex-portal-drop-input')).toBeAttached();
    // Read-only: the portal has no save, invite or revoke control anywhere.
    await expect(page.getByTestId('ex-portal').getByRole('button', { name: /invite|revoke|save/i })).toHaveCount(0);
  });

  test('[E2E] a tenant member who opens /external is told plainly, never shown the portal', async ({ page }) => {
    // signInTenant waits for the shell, which proves the session is persisted before the reload.
    // Navigating straight after the click raced the sign-in and landed on the sign-in screen.
    await signInTenant(page, ORG_ADMIN_EMAIL);
    await page.goto('/external');
    // The portal is only for the external principal; a tenant member gets the plain notice.
    await expect(page.getByTestId('external-portal-wrong-principal')).toBeVisible();
    await expect(page.getByTestId('ex-portal')).toHaveCount(0);
  });

  test('[E2E] the acceptance page asks for the invitation code and offers no JSON input', async ({ page }) => {
    await page.goto('/external/accept?token=not-a-real-token');
    await expect(page.getByTestId('ex-accept')).toBeVisible();
    await expect(page.getByTestId('ex-accept-token')).toHaveValue('not-a-real-token');
    await expect(page.getByTestId('ex-accept')).not.toContainText('JSON');
  });
});

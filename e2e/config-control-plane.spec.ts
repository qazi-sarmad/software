import { test, expect, type Page } from '@playwright/test';

/**
 * Config control plane E2E (C4/C5). Configuration lives in portals, not SQL:
 *   - The Super Admin portal (/superadmin) is data-blind and only admits platform staff.
 *   - Org Admin settings are gated by the edit_config right, not a role name.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';
const PLATFORM_EMAIL = 'platform.admin@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

/** Platform staff have no org, so the tenant navigation strip never appears; wait on the portal. */
async function signInPlatform(page: Page) {
  await page.goto('/superadmin');
  await page.getByLabel('Email').fill(PLATFORM_EMAIL);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('superadmin-portal')).toBeVisible();
}

test.describe('Config control plane', () => {
  test('[E2E] a tenant session is denied the platform portal', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await page.goto('/superadmin');
    await expect(page.getByTestId('superadmin-denied')).toBeVisible();
    await expect(page.getByTestId('superadmin-portal')).toHaveCount(0);
  });

  test('[E2E] platform staff reach the tenants panel', async ({ page }) => {
    await signInPlatform(page);
    await expect(page.getByTestId('superadmin-tabs')).toBeVisible();
    await expect(page.getByTestId('superadmin-tenants')).toBeVisible();
  });

  test('[E2E] the org admin opens Organisation settings and sees the sampling table', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByText('Organisation settings').click();
    await expect(page.getByTestId('org-settings-panel')).toBeVisible();
    await expect(page.getByTestId('org-settings-sampling')).toBeVisible();
  });

  test('[E2E] a preparer (no edit_config) has no Organisation settings entry', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await expect(page.getByText('Sign out')).toBeVisible();
    await expect(page.getByText('Organisation settings')).toHaveCount(0);
  });
});

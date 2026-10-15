import { test, expect, type Page } from '@playwright/test';

/**
 * 2H-UI: People & Roles is reached from the profile menu and is gated by rights, not a role name.
 * The org_admin account holds manage_users/manage_roles; the preparer account holds neither, so the
 * entry is absent for it.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

test.describe('2H-UI: People & Roles', () => {
  test('[E2E] the org admin opens People & Roles and sees the rights matrix', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByText('People & Roles').click();

    await expect(page.getByTestId('people-admin-panel')).toBeVisible();
    await expect(page.getByTestId('admin-people')).toBeVisible();

    // The rights matrix lists every seed role.
    await page.getByRole('tab', { name: /Roles/ }).click();
    await expect(page.getByTestId('role-org_admin')).toBeVisible();
    await expect(page.getByTestId('role-cia')).toBeVisible();
    await expect(page.getByTestId('role-observer')).toBeVisible();
  });

  test('[E2E] the org admin can toggle a role right and it persists', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByText('People & Roles').click();
    await page.getByRole('tab', { name: /Roles/ }).click();

    const box = page.getByRole('button', { name: 'Manage team for Observer' });
    const before = await box.getAttribute('aria-pressed');
    await box.click();
    // A successful write reloads the panel; the toggle reflects the new value.
    await expect(page.getByRole('button', { name: 'Manage team for Observer' })).toHaveAttribute(
      'aria-pressed',
      before === 'true' ? 'false' : 'true'
    );

    // Restore, so the run leaves no residue.
    await page.getByRole('button', { name: 'Manage team for Observer' }).click();
    await expect(page.getByRole('button', { name: 'Manage team for Observer' })).toHaveAttribute('aria-pressed', before!);
  });

  test('[E2E] a preparer (no manage_users) has no People & Roles entry', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await expect(page.getByText('Sign out')).toBeVisible();
    await expect(page.getByText('People & Roles')).toHaveCount(0);
  });
});

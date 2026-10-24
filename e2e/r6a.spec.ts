import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * R6a: the SIRA and Audit Plan screens now read persisted SIRA cycles, plan versions and gate
 * outcomes through src/data (no direct client calls). NOT-DONE #8.
 *
 * The org_admin account sees no audit tabs (it holds no audit right), so the flows use the preparer
 * account, which holds perform_work. Recorded as decision D-R6a-users.
 */
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByRole('button', { name }).click();
}

test.describe('R6a: persisted SIRA and plan records', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
  });

  test('[E2E] the SIRA screen shows the persisted model, cycles and plan', async ({ page }) => {
    await openTab(page, 'SIRA');
    const persisted = page.getByTestId('sira-persisted');
    await expect(persisted).toBeVisible();
    // The org seeds a default SIRA model, so the model card reports its factor count.
    await expect(page.getByTestId('sira-persisted-model')).toContainText('factors');
    // Cycles and plan render a designed empty state when the universe has none yet.
    await expect(page.getByTestId('sira-persisted-cycles')).toBeVisible();
    await expect(page.getByTestId('sira-persisted-plan')).toBeVisible();
    await expect(page.getByTestId('sira-load-error')).toHaveCount(0);
  });

  test('[E2E] the Audit Plan screen shows the persisted plan items, versions and gates', async ({ page }) => {
    await openTab(page, 'Audit Plan');
    const records = page.getByTestId('plan-records');
    await expect(records).toBeVisible();
    await expect(page.getByTestId('plan-records-items')).toBeVisible();
    await expect(page.getByTestId('plan-records-versions')).toBeVisible();
    await expect(page.getByTestId('plan-records-gates')).toBeVisible();
    await expect(page.getByTestId('plan-records-error')).toHaveCount(0);
  });
});

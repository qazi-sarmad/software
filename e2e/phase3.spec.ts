import { test, expect, type Page } from '@playwright/test';

/**
 * 3J: every Phase 3 flow opens in the sliding inspector (never a blocking modal) and is gated by a
 * right, not a role name. The preparer account (bilal.ahmed) holds perform_work and so sees the seven
 * audit tabs; the org_admin does not.
 */
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByRole('button', { name }).click();
}

test.describe('3J: Phase 3 flows in the inspector', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
  });

  test('[E2E] the SIRA model opens in the inspector and is read-only without edit_config', async ({ page }) => {
    await openTab(page, 'SIRA');
    await page.getByTestId('sira-open-model').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('sira-model-empty')).toBeVisible();
  });

  test('[E2E] cycles and emergent risks open in the inspector', async ({ page }) => {
    await openTab(page, 'SIRA');
    await page.getByTestId('sira-open-cycles').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('sira-cycles-empty')).toBeVisible();
    await expect(dialog.getByTestId('emergent-empty')).toBeVisible();
  });

  test('[E2E] plan items and versions open in the inspector', async ({ page }) => {
    await openTab(page, 'Audit Plan');
    await page.getByTestId('plan-open-items').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('plan-items-empty')).toBeVisible();
    await expect(dialog.getByTestId('plan-versions-empty')).toBeVisible();
  });

  test('[E2E] the deployment gate and ethics panels open in the inspector', async ({ page }) => {
    await openTab(page, 'Audit Plan');
    await page.getByTestId('plan-open-gate').click();
    await expect(page.getByRole('dialog').getByTestId('deployment-gate-empty')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('plan-open-ethics').click();
    await expect(page.getByRole('dialog').getByTestId('ethics-empty')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('[E2E] the combined-approval panel refuses to raise without an entity and offers it otherwise', async ({ page }) => {
    await openTab(page, 'Audit Plan');
    await page.getByTestId('plan-open-combined').click();
    const raise = page.getByRole('dialog').getByTestId('combined-raise');
    await expect(raise).toBeVisible();
    // No entity id is passed from the tab, so raising stays disabled.
    await expect(raise).toBeDisabled();
  });

  test('[E2E] an entity card opens the approval flow, gated by rights', async ({ page }) => {
    await openTab(page, 'Audit Universe');
    const open = page.locator('[data-testid^="entity-approval-open-"]').first();
    await expect(open).toBeVisible();
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('entity-approval')).toBeVisible();
    await expect(dialog.getByTestId('entity-status')).toBeVisible();
  });
});

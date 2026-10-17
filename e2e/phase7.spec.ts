import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 7 UI (7G). The export panel lives in the Audit File window; the import wizard and activity
 * log are non-blocking record views opened from the account menu. Prior-year material sits in the
 * Planning tab. Every screen is right-gated and uses no blocking modal.
 */
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';
const ADMIN_EMAIL = 'zara.malik@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openFirstEngagement(page: Page) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Files').click();
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId('audit-file')).toBeVisible();
}

test.describe('Phase 7 UI', () => {
  test('[E2E] the export panel renders the format controls and export history', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-export').click();
    await expect(page.getByTestId('export-panel')).toBeVisible();
    await expect(page.getByTestId('export-controls')).toBeVisible();
    await expect(page.getByTestId('export-history')).toBeVisible();
  });

  test('[E2E] the prior-year panel appears in the Planning tab', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-workspace').click();
    await expect(page.getByTestId('planning-panel')).toBeVisible();
    await expect(page.getByTestId('prior-year-panel')).toBeVisible();
  });

  test('[E2E] the import wizard opens as a non-blocking record view with a designed empty history', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByTestId('menu-import').click();
    await expect(page.getByTestId('import-wizard')).toBeVisible();
    await expect(page.getByTestId('import-upload')).toBeVisible();
    await expect(page.getByTestId('import-history-empty')).toBeVisible();
  });

  test('[E2E] the activity log view renders with filters or a designed empty state', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByTestId('menu-activity-log').click();
    await expect(page.getByTestId('activity-log-panel')).toBeVisible();
    await expect(page.getByTestId('activity-empty').or(page.getByTestId('activity-table'))).toBeVisible();
  });

  test('[E2E] the phase 7 views use no blocking modal', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.getByLabel('Open user profile menu').click();
    await page.getByTestId('menu-activity-log').click();
    await expect(page.getByTestId('activity-log-panel')).toBeVisible();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });
});

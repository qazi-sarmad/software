import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 4 UI (4I). The testing workspace is the database-backed half of the Audit File: planning with
 * SIRA pre-fill and a reconciliation gate, population upload, sampling, row testing and the analyst
 * engine. Every screen is non-blocking (no modal) and gated by a right, not a role name.
 */
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openFirstEngagementWorkspace(page: Page) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Files').click();
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId('audit-file')).toBeVisible();
  await page.getByTestId('audit-file-view-workspace').click();
  await expect(page.getByTestId('audit-file-workspace')).toBeVisible();
}

test.describe('Phase 4 UI', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
  });

  test('[E2E] the testing workspace renders every Phase 4 panel', async ({ page }) => {
    await openFirstEngagementWorkspace(page);
    await expect(page.getByTestId('planning-panel')).toBeVisible();
    await expect(page.getByTestId('population-panel')).toBeVisible();
    await expect(page.getByTestId('analyst-panel')).toBeVisible();
    await expect(page.getByTestId('sampling-panel')).toBeVisible();
    await expect(page.getByTestId('rowtesting-panel')).toBeVisible();
  });

  test('[E2E] the planning reconciliation banner is shown and sign-off is refused without the right', async ({ page }) => {
    await openFirstEngagementWorkspace(page);
    await expect(page.getByTestId('planning-reconciliation')).toBeVisible();
    const signoff = page.getByTestId('planning-signoff');
    await expect(signoff).toBeVisible();
    // A preparer holds perform_work but not review_and_approve, so sign-off is refused in place.
    await expect(signoff).toBeDisabled();
    await expect(page.getByTestId('planning-signoff-reason')).toContainText('review_and_approve');
  });

  test('[E2E] the workspace uses no blocking modal', async ({ page }) => {
    await openFirstEngagementWorkspace(page);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });

  test('[E2E] the full-page record view renders a breadcrumb and no overlay', async ({ page }) => {
    await page.goto('/view/engagement/eng-treas-1');
    await expect(page.getByTestId('record-page')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });
});

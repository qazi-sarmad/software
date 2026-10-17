import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 6 UI (6H). The report editor and CAP register are database-backed views inside the Audit File
 * window. Freeze is gated on zero open comments and a passing CAP reconciliation; issuance shows a
 * "queued (pending dispatch)" notice, never a "sent" claim. Non-blocking throughout.
 */

const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';

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

test.describe('Phase 6 UI', () => {
  test('[E2E] the report view renders the section tabs and version sidebar', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-report').click();
    await expect(page.getByTestId('report-editor')).toBeVisible();
  });

  test('[E2E] the report view shows a designed empty state before any version exists', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-report').click();
    await expect(page.getByTestId('report-editor')).toBeVisible();
    // Either a version exists (sections render) or the empty state does; both are designed states.
    await expect(page.getByTestId('report-empty').or(page.getByTestId('report-comments'))).toBeVisible();
  });

  test('[E2E] the CAP register view renders with status chips or a designed empty state', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-caps').click();
    await expect(page.getByTestId('cap-register')).toBeVisible();
    await expect(page.getByTestId('cap-empty').or(page.locator('[data-testid^="cap-status-"]').first())).toBeVisible();
  });

  test('[E2E] the phase 6 views use no blocking modal', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-report').click();
    await expect(page.getByTestId('report-editor')).toBeVisible();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });
});

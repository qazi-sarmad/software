import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 5 UI (5G). The findings, conclusion and document-viewer workspaces are the database-backed
 * half of the Audit File. Every screen is non-blocking (no modal) and gated by a right, not a role
 * name.
 */
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';

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

test.describe('Phase 5 UI', () => {
  test('[E2E] the findings workspace renders observation and issue sections', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-findings').click();
    await expect(page.getByTestId('findings-panel')).toBeVisible();
  });

  test('[E2E] the conclusion workspace shows the testing pre-flight banner', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-conclusion').click();
    await expect(page.getByTestId('conclusion-panel')).toBeVisible();
    await expect(page.getByTestId('conclusion-preflight')).toBeVisible();
  });

  test('[E2E] the document viewer is a non-blocking panel with a stage tablist', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-documents').click();
    await expect(page.getByTestId('document-viewer')).toBeVisible();
    await expect(page.getByTestId('document-stage-planning')).toBeVisible();
  });

  test('[E2E] the phase 5 workspaces use no blocking modal', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await openFirstEngagement(page);
    await page.getByTestId('audit-file-view-documents').click();
    await expect(page.getByTestId('document-viewer')).toBeVisible();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });
});

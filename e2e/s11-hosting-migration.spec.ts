import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S11 E2E: hosting fit (SA-10), hosting rules (SA-11), the migration jobs view (SA-12) and the Org
 * Admin hosting panel (OA-15) (F16).
 *
 * The Hosting Fit Check is deterministic: the same answers always produce the same Red / Amber /
 * Green verdict. The Super Admin catalogue is platform-only; the Org Admin reaches only its own
 * connection. Neither surface ever renders a JSON box (F1). No blocking modal (spec §27.5).
 */
const PLATFORM_EMAIL = 'platform.admin@provio-test.invalid';
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signInPlatform(page: Page) {
  await page.goto('/superadmin');
  await page.getByLabel('Email').fill(PLATFORM_EMAIL);
  await page.getByLabel('Password').fill(passwordFor(PLATFORM_EMAIL));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('superadmin-portal')).toBeVisible();
}

async function openOrgHosting(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(ORG_ADMIN_EMAIL);
  await page.getByLabel('Password').fill(passwordFor(ORG_ADMIN_EMAIL));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
  await page.getByLabel('Open user profile menu').click();
  // The hosting panel lives in the Assurance control plane, not Organisation settings.
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-panel')).toBeVisible();
  await page.getByTestId('org-control-tab-hosting').click();
  await expect(page.getByTestId('oa-hosting')).toBeVisible();
}

test.describe('S11 hosting fit check (SA-10)', () => {
  test('[E2E] the fit check produces a deterministic verdict', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-hosting').click();
    await expect(page.getByTestId('sa-hosting')).toBeVisible();
    await expect(page.getByTestId('sa-hosting-verdict-value')).toBeVisible();
    // Default answers are a Supabase cloud project: Green.
    await expect(page.getByTestId('sa-hosting-verdict-value')).toHaveText('GREEN');
  });

  test('[E2E] a non-PostgreSQL engine turns the verdict red', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-hosting').click();
    await page.getByTestId('sa-hosting-field-engine').selectOption('mysql');
    await expect(page.getByTestId('sa-hosting-verdict-value')).toHaveText('RED');
    await expect(page.getByTestId('sa-hosting-cost')).toContainText('custom_quote');
  });

  test('[E2E] the stack search matches on an alias and shows an empty state', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-hosting').click();
    await page.getByTestId('sa-hosting-search').fill('aurora');
    await expect(page.getByTestId('sa-hosting-search-results')).toBeVisible();
    await page.getByTestId('sa-hosting-search').fill('no-such-stack-xyz');
    await expect(page.getByTestId('sa-hosting-search-empty')).toBeVisible();
  });

  test('[E2E] the rules editor has no JSON box (F1)', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-hosting').click();
    await page.getByTestId('sa-hosting-tab-rules').click();
    await expect(page.getByTestId('sa-hosting-rules')).toBeVisible();
    await expect(page.getByTestId('sa-hosting-rules')).not.toContainText('JSON');
  });
});

test.describe('S11 migration jobs (SA-12)', () => {
  test('[E2E] the migration view lists tenants and a jobs area', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-migration').click();
    await expect(page.getByTestId('sa-migration')).toBeVisible();
    await expect(page.getByTestId('sa-migration-tenant')).toBeVisible();
    await expect(page.getByTestId('sa-deployment-kit')).toBeVisible();
  });

  test('[E2E] the deployment kit carries no JSON box (F1)', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-migration').click();
    await expect(page.getByTestId('sa-deployment-kit')).not.toContainText('JSON');
  });
});

test.describe('S11 org hosting panel (OA-15)', () => {
  test('[E2E] the Org Admin reaches a hosting tab with a connection form', async ({ page }) => {
    await openOrgHosting(page);
    await expect(page.getByTestId('oa-hosting-host')).toBeVisible();
    await expect(page.getByTestId('oa-hosting-password')).toBeVisible();
  });

  test('[E2E] an incomplete connection is refused inline, with no modal', async ({ page }) => {
    await openOrgHosting(page);
    await page.getByTestId('oa-hosting-save').click();
    await expect(page.getByTestId('oa-hosting-action-error')).toBeVisible();
    // The error is an inline alert, not a blocking modal.
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  });

  test('[E2E] the hosting panel renders no JSON box (F1)', async ({ page }) => {
    await openOrgHosting(page);
    await expect(page.getByTestId('oa-hosting')).not.toContainText('JSON');
  });
});

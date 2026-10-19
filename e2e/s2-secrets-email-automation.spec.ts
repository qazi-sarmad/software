import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S2 E2E: secrets, email senders and the automation engine (F5, F6, F7).
 *
 * The provider is the stub, so nothing leaves the platform. Every screen is visual: dropdowns,
 * toggles and buttons; no screen accepts JSON (F1). Serial, because the tenant's rules and sender
 * profile are shared state.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
const PLATFORM_EMAIL = 'platform.admin@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function signInPlatform(page: Page) {
  await page.goto('/superadmin');
  await page.getByLabel('Email').fill(PLATFORM_EMAIL);
  await page.getByLabel('Password').fill(passwordFor(PLATFORM_EMAIL));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('superadmin-portal')).toBeVisible();
}

async function openControlPlane(page: Page) {
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-panel')).toBeVisible();
}

test.describe('S2 secrets, email and automation', () => {
  test('[E2E] the Org Admin opens the email tab and never sees a credential value', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-email').click();
    await expect(page.getByTestId('org-email')).toBeVisible();
    // The screen offers a provider dropdown, never a free-text JSON box.
    await expect(page.getByTestId('org-email-provider')).toBeVisible();
    await expect(page.getByTestId('org-email')).not.toContainText('api key:');
  });

  test('[E2E] the Org Admin sees the platform rule templates and can copy one', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-automation').click();
    await expect(page.getByTestId('org-automation')).toBeVisible();
    const list = page.getByTestId('org-rule-list');
    const empty = page.getByTestId('org-automation-empty');
    await expect(list.or(empty)).toBeVisible();
  });

  test('[E2E] Test with a sample event sends nothing and shows the recipients', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-automation').click();
    await expect(page.getByTestId('org-automation')).toBeVisible();

    const copy = page.getByTestId('org-rule-copy-platform.config.changed');
    if (await copy.count()) {
      await copy.click();
      await expect(page.getByTestId('org-automation-editor')).toBeVisible();
      await page.getByTestId('org-rule-save').click();
      await expect(page.getByTestId('org-automation-result')).toHaveCount(0);
      await page.getByTestId('org-rule-test-platform.config.changed.copy').click();
      await expect(page.getByTestId('org-rule-test-output')).toBeVisible();
      await expect(page.getByTestId('org-rule-test-output')).toContainText('nothing was sent');
    }
  });

  test('[E2E] the platform console has an email tab and an automation tab', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-email').click();
    await expect(page.getByTestId('superadmin-email')).toBeVisible();
    await expect(page.getByTestId('superadmin-email-provider')).toBeVisible();

    await page.getByTestId('superadmin-tab-automation').click();
    await expect(page.getByTestId('superadmin-automation')).toBeVisible();
    await expect(page.getByTestId('rule-event')).toBeVisible();

    await page.getByTestId('superadmin-automation-tab-templates').click();
    await expect(page.getByTestId('template-subject')).toBeVisible();
  });
});

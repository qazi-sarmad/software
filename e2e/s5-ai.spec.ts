import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S5 E2E: AI assist, the model registry and the endpoint deny-list (F8).
 *
 * Every screen is visual: dropdowns, toggles and buttons; no screen accepts JSON (F1). The Org
 * Admin sets the endpoint and the use cases and can never touch the model registry. Serial, because
 * the tenant's AI settings are shared state.
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

test.describe('S5 AI assist', () => {
  test('[E2E] the Org Admin opens the AI tab and sees the use cases and the voice library', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-ai').click();
    await expect(page.getByTestId('org-ai-panel')).toBeVisible();
    await expect(page.getByTestId('oa-ai-usecases')).toBeVisible();
    await expect(page.getByTestId('oa-voice')).toBeVisible();
    // The screen never offers a JSON box (F1).
    await expect(page.getByTestId('org-ai-panel')).not.toContainText('JSON');
  });

  test('[E2E] a vendor-hosted endpoint is refused with the L2 message', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-ai').click();
    await expect(page.getByTestId('org-ai-panel')).toBeVisible();
    await page.getByTestId('oa-ai-endpoint-url').fill('https://api.openai.com/v1');
    await page.getByTestId('oa-ai-endpoint-save').click();
    // Unconditional: the panel always renders a result after a save. The earlier `if (count())`
    // guard let the assertion pass when nothing rendered at all, which is exactly what happened
    // while the fixture left ai_assist unentitled and ai_enabled false: the plan refusal fired
    // before the deny-list and the L2 rule was never exercised.
    const result = page.getByTestId('oa-ai-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('vendor-hosted AI service');
  });

  test('[E2E] the Super Admin sees the model registry and the deny-list and no tenant data', async ({ page }) => {
    await signInPlatform(page);
    await page.getByTestId('superadmin-tab-ai').click();
    await expect(page.getByTestId('superadmin-ai')).toBeVisible();
    await expect(page.getByTestId('sa-ai-models')).toBeVisible();
    await expect(page.getByTestId('sa-ai-denylist')).toBeVisible();
    // The seeded deny-list is visible to the Super Admin.
    await expect(page.getByTestId('sa-ai-denylist')).toContainText('api.openai.com');
  });
});

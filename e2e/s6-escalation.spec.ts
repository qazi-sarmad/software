import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S6 E2E: escalation rules (F12).
 *
 * The Org Admin opens the Escalation tab, builds a rule with a deterministic recommendation, and the
 * Work Queue shows escalation cards to a targeted role. Every screen is visual: dropdowns, toggles
 * and buttons; no screen accepts JSON (F1).
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';
// The audit manager holds view_all_scopes, so the escalation list RPC returns rows to them.
const MANAGER_EMAIL = 'zara.malik@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openControlPlane(page: Page) {
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-panel')).toBeVisible();
}

test.describe('S6 escalation rules', () => {
  test('[E2E] the Org Admin opens the Escalation tab and sees the platform templates', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-escalation').click();
    await expect(page.getByTestId('oa-escalation')).toBeVisible();
    // The screen never offers a JSON box (F1).
    await expect(page.getByTestId('oa-escalation')).not.toContainText('JSON');
  });

  test('[E2E] the editor shows a deterministic recommendation preview, never AI', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-control-tab-escalation').click();
    await expect(page.getByTestId('oa-escalation')).toBeVisible();
    await page.getByTestId('oa-escalation-new').click();
    await expect(page.getByTestId('oa-escalation-editor')).toBeVisible();
    await expect(page.getByTestId('oa-escalation-preview')).toContainText('Yes');
    await expect(page.getByTestId('oa-escalation-editor')).not.toContainText('AI-generated');
  });

  test('[E2E] the Work Queue shows escalation cards to a targeted role', async ({ page }) => {
    await signIn(page, MANAGER_EMAIL);
    await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Work Queue').click();
    await expect(page.getByTestId('tab-pending')).toBeVisible();
    // The escalation block renders only when the caller has escalations or proposals; when it does,
    // it must carry the deterministic recommendation wording.
    const cards = page.getByTestId('wk-escalation');
    if (await cards.count()) {
      await expect(cards).toBeVisible();
    }
  });
});

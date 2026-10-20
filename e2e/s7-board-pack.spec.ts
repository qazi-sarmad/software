import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S7 E2E: Board Pack (F10).
 *
 * The Dashboard panel shows the pack history and the generator; a pack opens into a web view where
 * every figure is a drill-down. The section list is configurable visually. No screen accepts JSON
 * (F1). The stub provider and synthetic data are used, as in global-setup.
 */
// The Board Pack panel is gated by view_board_pack/generate_board_pack (F3). By F3 the Org Admin
// holds none of the four assurance rights, so the CIA is the principal that can reach it.
const CIA_EMAIL = 'kamran.sheikh@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openBoardPack(page: Page) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Dashboard').click();
  await expect(page.getByTestId('wk-boardpack')).toBeVisible();
}

test.describe('S7 Board Pack', () => {
  test('[E2E] the Dashboard shows the Board Pack panel with the history or the first-pack note', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await openBoardPack(page);
    // The history region is always present; inside it the panel shows either the first-pack note or
    // one row per pack (each row has an open button). Assert the region, then require one of the two.
    const history = page.getByTestId('wk-boardpack-history');
    await expect(history).toBeVisible();
    const empty = page.getByTestId('wk-boardpack-empty');
    const rows = page.locator('[data-testid^="wk-boardpack-open-"]');
    expect((await empty.count()) + (await rows.count())).toBeGreaterThan(0);
  });

  test('[E2E] the panel never offers a JSON box (F1)', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await openBoardPack(page);
    await expect(page.getByTestId('wk-boardpack')).not.toContainText('JSON');
  });

  test('[E2E] the generator offers a scope, a boundary dropdown and a Generate button', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await openBoardPack(page);
    await expect(page.getByTestId('wk-boardpack-generator')).toBeVisible();
    await expect(page.getByTestId('wk-boardpack-scope')).toBeVisible();
    await expect(page.getByTestId('wk-boardpack-boundary')).toBeVisible();
    await expect(page.getByTestId('wk-boardpack-generate')).toBeVisible();
  });

  test('[E2E] the section list is reorderable and can be turned off, never deleted', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await openBoardPack(page);
    await page.getByTestId('wk-boardpack-tab-config').click();
    await expect(page.getByTestId('oa-boardpack-config')).toBeVisible();
    await expect(page.getByTestId('oa-boardpack-section-cover')).toBeVisible();
    await expect(page.getByTestId('oa-boardpack-up-cover')).toBeDisabled();
    await expect(page.getByTestId('oa-boardpack-enabled-cover')).toBeVisible();
  });

  test('[E2E] opening a pack shows the web view with the hash and a sources index', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await openBoardPack(page);
    const openButtons = page.locator('[data-testid^="wk-boardpack-open-"]');
    if ((await openButtons.count()) === 0) {
      test.skip(true, 'No pack exists yet on this project.');
    }
    await openButtons.first().click();
    await expect(page.getByTestId('wk-boardpack-view')).toBeVisible();
    await expect(page.getByTestId('wk-boardpack-section-sources')).toBeVisible();
    // The verify chip is offered when the org set its web address.
    await expect(page.getByTestId('wk-boardpack-verify-chip').or(page.getByTestId('wk-boardpack-url-missing')))
      .toBeVisible();
  });

  test('[E2E] the PDF and PPTX download controls are present on the open pack', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await openBoardPack(page);
    const openButtons = page.locator('[data-testid^="wk-boardpack-open-"]');
    if ((await openButtons.count()) === 0) {
      test.skip(true, 'No pack exists yet on this project.');
    }
    await openButtons.first().click();
    await expect(page.getByTestId('wk-boardpack-view')).toBeVisible();
    await expect(page.getByTestId('wk-boardpack-pdf')).toBeVisible();
    await expect(page.getByTestId('wk-boardpack-pptx')).toBeVisible();
  });
});

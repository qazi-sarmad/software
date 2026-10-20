import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S12 tutorials E2E (F18).
 *
 * Every configuration screen carries a "Show me how" button that opens the TUT-01 drawer (a
 * non-blocking side panel, never a modal). On a screen's first visit the drawer opens once on its
 * own. The suite-wide storage state seeds the autoplay OFF (playwright.config.ts) so other specs stay
 * deterministic; here we clear the key to exercise the autoplay itself.
 */
const ORG_ADMIN_EMAIL = 'ayesha.khan@provio-test.invalid';

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

test.describe('S12 tutorials (F18)', () => {
  test('[E2E] "Show me how" opens the drawer, and it is not a modal', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    await openControlPlane(page);
    await page.getByTestId('org-features-tutorial').click();
    const drawer = page.getByTestId('tutorial-drawer');
    await expect(drawer).toBeVisible();
    // F19 / no-blocking-modal: a complementary side panel, never a blocking dialog. The Org Control
    // panel itself opens in a non-blocking FloatingWindow (an allow-listed role="dialog" that sets no
    // aria-modal), so assert on the drawer's own role and on the absence of any modal dialog.
    await expect(drawer).toHaveAttribute('role', 'complementary');
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await page.getByTestId('tutorial-drawer-close').click();
    await expect(drawer).toBeHidden();
  });

  test('[E2E] the tutorial autoplays once on a screen first visit', async ({ page }) => {
    await signIn(page, ORG_ADMIN_EMAIL);
    // Clear the suite's autoplay-off switch so the first visit autoplays. Mark the History tab as
    // already seen so that navigating through it (to revisit Features) does not autoplay its own.
    await page.evaluate(() => {
      window.localStorage.removeItem('acp.tutorial.autoplay');
      window.localStorage.removeItem('acp.tutorial.seen.oa.features');
      window.localStorage.setItem('acp.tutorial.seen.oa.history', '1');
    });
    await openControlPlane(page);
    await expect(page.getByTestId('tutorial-drawer')).toBeVisible();
    await page.getByTestId('tutorial-drawer-close').click();
    // A second visit to the same screen does not reopen it.
    await page.getByTestId('org-control-tab-history').click();
    await page.getByTestId('org-control-tab-features').click();
    await expect(page.getByTestId('tutorial-drawer')).toBeHidden();
  });
});

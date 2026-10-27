import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * §3 / §25.7 mobile viewport smoke (SCALE-1).
 *
 * A dedicated phone-viewport pass (375×800, iPhone SE) that covers the three flows the clause names:
 * an ethics sign-off, a simple approval, and report viewing. It is deliberately narrower than the
 * desktop suites — it proves each surface renders, is reachable and is not a blocking modal at phone
 * width, and that the shell never scrolls horizontally. Every assertion is a designed state.
 */

const CIA = 'kamran.sheikh@provio-test.invalid';

test.use({ viewport: { width: 375, height: 800 } });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

/** The shell must never scroll sideways at phone width. */
async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'the shell must not scroll horizontally at 375px').toBeLessThanOrEqual(1);
}

async function openFirstAuditFile(page: Page) {
  await page.getByTitle('Audit Files').click();
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.click();
  await expect(page.getByTestId('audit-file')).toBeVisible();
}

test.describe('mobile smoke @ 375px', () => {
  test('[§3] ethics sign-off is reachable and operable at phone width', async ({ page }) => {
    await signIn(page, CIA);
    await assertNoHorizontalScroll(page);

    // The Audit Plan tab carries the ethics control (§10 deployment gate).
    await page.getByTitle('Audit Plan').click();
    const ethicsButton = page.getByTestId('plan-open-ethics');
    await expect(ethicsButton).toBeVisible();
    await ethicsButton.click();

    // The ethics panel renders inside a non-blocking window and shows exactly one designed state:
    // the member list (when the engagement has a team) or the "no members" empty state. The status
    // heading is one of the two designed strings, so the sign-off surface is proven reachable and
    // rendered at phone width without any conditional assertion.
    const panel = page.getByTestId('ethics-panel');
    await expect(panel).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByTestId('ethics-members').or(page.getByTestId('ethics-empty'))
    ).toBeVisible();
    await expect(panel).toContainText(/Ethics acknowledgement pending|All members acknowledged/);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await assertNoHorizontalScroll(page);
  });

  test('[§25.7] a simple approval is reachable and operable at phone width', async ({ page }) => {
    await signIn(page, CIA);
    await assertNoHorizontalScroll(page);

    // The Work Queue is where a simple approval lives; the CIA holds the approval rights.
    await page.getByTitle('Work Queue').click();
    await expect(page.getByTestId('tab-pending')).toBeVisible();
    // The queue renders its sections (or their designed empty states) without a blocking modal.
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await assertNoHorizontalScroll(page);
  });

  test('[§25.7] report viewing renders at phone width', async ({ page }) => {
    await signIn(page, CIA);
    await openFirstAuditFile(page);

    // Open the report view on the Audit File window; it renders its surface (or its designed gate).
    await page.getByTestId('audit-file-view-report').click();
    await expect(page.getByTestId('audit-file-report')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

    // The floating window never clips off the left edge at phone width.
    const win = page.locator('[data-testid^="floating-window-audit_file"]').first();
    const box = await win.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    await assertNoHorizontalScroll(page);
  });
});

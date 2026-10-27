import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { passwordFor } from './password';

/**
 * Accessibility gate (WP12, SECURITY-PLAN item D).
 *
 * Runs axe-core over the signed-in shell and the public surfaces and fails on any serious or
 * critical violation. The project's own rules are checked too: a non-blocking modal is a
 * `role="dialog"` with `aria-modal="true"`, and the tutorial drawer must be `role="complementary"`.
 * Only deterministic checks: no timing, no AI, no network beyond the app itself.
 */

const CIA = 'kamran.sheikh@provio-test.invalid';

const SERIOUS = new Set(['serious', 'critical']);

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = results.violations.filter((v) => SERIOUS.has(v.impact ?? ''));
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `axe serious/critical violations on ${label}`,
  ).toEqual([]);
}

test.describe('accessibility', () => {
  test('[WP12] the public sign-in screen has no serious accessibility violation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('signin-screen')).toBeVisible();
    await audit(page, 'sign-in');
  });

  test('[WP12] the signed-in shell has no serious accessibility violation', async ({ page }) => {
    await signIn(page, CIA);
    await audit(page, 'signed-in shell');
  });

  test('[WP12] the tutorial drawer is complementary, not a blocking modal', async ({ page }) => {
    await signIn(page, CIA);
    // Any screen with a "Show me how" control: the sign-in lands on the dashboard, which has one.
    const tutorial = page.locator('[data-testid$="-tutorial"]').first();
    await expect(tutorial).toBeVisible();
    await tutorial.click();
    const drawer = page.getByTestId('tutorial-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('role', 'complementary');
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
  });
});

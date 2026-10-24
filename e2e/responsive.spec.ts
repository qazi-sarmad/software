import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * Responsive widths (D15). The header hides the full search field below `sm` and the inline
 * universe switcher below `md`; both must remain reachable at 375px, and a floating window may not
 * clip off the left edge. Checked at iPhone SE (375), iPad portrait (768) and tablet (1024).
 */
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(PREPARER_EMAIL);
  await page.getByLabel('Password').fill(passwordFor(PREPARER_EMAIL));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

test.describe('responsive @ 375px', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('[E2E] the compact search button opens the command palette', async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId('header-search-compact')).toBeVisible();
    await page.getByTestId('header-search-compact').click();
    await expect(page.getByTestId('command-palette')).toBeVisible();
  });

  test('[E2E] nav tabs collapse to icons without a horizontal scroll', async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole('navigation', { name: 'Navigation Strip' });
    await expect(nav).toBeVisible();
    // Labels are hidden below `sm`; the icons keep every tab reachable.
    await expect(nav.getByText('Dashboard')).toBeHidden();
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375);
  });

  test('[E2E] a floating window never clips off the left edge', async ({ page }) => {
    await signIn(page);
    await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Files').click();
    const card = page.locator('[data-testid^="audit-card-"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId('audit-file')).toBeVisible();
    const win = page.locator('[data-testid^="floating-window-"]').first();
    await expect(win).toBeVisible();
    const box = await win.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(376);
  });
});

test.describe('responsive @ 768px', () => {
  test.use({ viewport: { width: 768, height: 900 } });

  test('[E2E] the full search field is shown and opens the command palette', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: /Search or jump to/ }).click();
    await expect(page.getByTestId('command-palette')).toBeVisible();
  });
});

test.describe('responsive @ 1024px', () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test('[E2E] the header renders without horizontal overflow', async ({ page }) => {
    await signIn(page);
    const header = page.locator('header').first();
    await expect(header).toBeVisible();
    const box = await header.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
  });
});

import { test, expect } from '@playwright/test';

const SEVEN_TABS = [
  'Executive Summary',
  'Pending Tasks',
  'Audit Universe',
  'Audit Plan',
  'SIRA',
  'Audit File',
  'Issues Register',
];

test.describe('Provio smoke', () => {
  test('nav shows exactly the 7 tabs in order, with no Reports or Calendar tab', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navigation Strip' });
    await expect(nav).toBeVisible();

    const titles = await nav.getByRole('button').evaluateAll((els) =>
      els.map((el) => el.getAttribute('title'))
    );
    expect(titles).toEqual(SEVEN_TABS);
    await expect(nav.getByText('Reports')).toHaveCount(0);
    await expect(nav.getByText('Calendar')).toHaveCount(0);
  });

  test('app shell loads and the new tabs render without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Navigation Strip' });
    await nav.getByTitle('Pending Tasks').click();
    await expect(page.getByTestId('tab-pending')).toBeVisible();
    await nav.getByTitle('SIRA').click();
    await expect(page.getByTestId('tab-sira')).toBeVisible();
    await nav.getByTitle('Audit File').click();
    await expect(page.getByTestId('tab-audit-file')).toBeVisible();
    await nav.getByTitle('Executive Summary').click();
    await expect(page.locator('main')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('/dev/palette shows all 3 presets in light and dark', async ({ page }) => {
    await page.goto('/dev/palette');
    for (const preset of ['ledger', 'porcelain', 'bone']) {
      for (const mode of ['light', 'dark']) {
        await expect(page.getByTestId(`palette-${preset}-${mode}`)).toBeVisible();
      }
    }
  });
});

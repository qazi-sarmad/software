import { test, expect, type Page } from '@playwright/test';

const SEVEN_TABS = [
  'Executive Summary',
  'Pending Tasks',
  'Audit Universe',
  'Audit Plan',
  'SIRA',
  'Audit File',
  'Issues Register',
];

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

test.describe('Phase 0: honest prototype', () => {
  test('[E2E] with no session the sign-in screen shows and no application data does', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('signin-screen')).toBeVisible();
    await expect(page.locator('header')).toHaveCount(0);
    await expect(page.locator('main')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toHaveCount(0);
  });

  test('[E2E] an unknown account is refused and gets no navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('nobody@provio-test.invalid');
    await page.getByLabel('Password').fill('wrong-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('signin-error')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toHaveCount(0);
  });

  test('[E2E] there is no persona switcher in the header', async ({ page }) => {
    await signIn(page);
    await page.getByLabel('Open user profile menu').click();
    await expect(page.getByText('Sign out')).toBeVisible();
    await expect(page.getByText('Simulate Viewpoint')).toHaveCount(0);
    await expect(page.getByText('Team & permissions')).toHaveCount(0);
    await expect(page.getByText('/dev/access')).toHaveCount(0);
  });

  test('[E2E] nav shows exactly the 7 tabs in order, with no Reports or Calendar tab', async ({ page }) => {
    await signIn(page);
    const nav = page.getByRole('navigation', { name: 'Navigation Strip' });
    const titles = await nav.getByRole('button').evaluateAll((els) =>
      els.map((el) => el.getAttribute('title'))
    );
    expect(titles).toEqual(SEVEN_TABS);
    await expect(nav.getByText('Reports')).toHaveCount(0);
    await expect(nav.getByText('Calendar')).toHaveCount(0);
  });

  test('[E2E] sign out returns to the sign-in screen', async ({ page }) => {
    await signIn(page);
    await page.getByLabel('Open user profile menu').click();
    await page.getByText('Sign out').click();
    await expect(page.getByTestId('signin-screen')).toBeVisible();
    await expect(page.locator('main')).toHaveCount(0);
  });

  test('app shell loads and the tabs render without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await signIn(page);
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

  test('/dev/palette (development only) shows all 3 presets in light and dark', async ({ page }) => {
    await page.goto('/dev/palette');
    for (const preset of ['ledger', 'porcelain', 'bone']) {
      for (const mode of ['light', 'dark']) {
        await expect(page.getByTestId(`palette-${preset}-${mode}`)).toBeVisible();
      }
    }
  });
});

import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * R6b (spec §19): the import wizard parses XLSX (SheetJS) as well as CSV. NOT-DONE #12.
 *
 * The wizard opens from the profile menu for a user holding manage_engagements; the preparer account
 * holds perform_work but not manage_engagements, so the flow uses the audit_manager (zara.malik),
 * which does. Recorded as decision D-R6b-users.
 */
const MANAGER_EMAIL = 'zara.malik@provio-test.invalid';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

test.describe('R6b: XLSX import', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, MANAGER_EMAIL);
  });

  test('[E2E] the import wizard parses an XLSX file into the mapping step', async ({ page }) => {
    await page.getByLabel('Open user profile menu').click();
    await page.getByTestId('menu-import').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('import-choose-file')).toBeVisible();
    await dialog.getByTestId('import-file-input').setInputFiles('e2e/fixtures/rcm-sample.xlsx');
    const mapping = dialog.getByTestId('import-mapping');
    await expect(mapping).toBeVisible();
    // The fixture's header row becomes the source-column list.
    await expect(mapping).toContainText('risk_id');
    await expect(mapping).toContainText('control_description');
  });
});

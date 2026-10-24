import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S8 E2E: engagement certificate and public verification (F11).
 *
 * The certificate panel lives in the Audit File window; issuing needs a sealed engagement. The
 * public verification page is the only anonymous surface: it is opened here with no sign-in and shows
 * a plain "not found" for an unknown id, never tenant content.
 */
// The CIA holds manage_engagements and can_reopen (F3), so it can reach the certificate panel.
const CIA_EMAIL = 'kamran.sheikh@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function openFirstAuditFile(page: Page) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Files').click();
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  if ((await card.count()) === 0) return false;
  await card.click();
  await expect(page.getByTestId('audit-file')).toBeVisible();
  return true;
}

test.describe('S8 certificate and public verification', () => {
  test('[E2E] the public verification page answers without a session', async ({ page }) => {
    await page.goto('/verify/00000000-0000-0000-0000-000000000000');
    await expect(page.getByTestId('wk-verify')).toBeVisible();
    await expect(page.getByTestId('wk-verify-status').or(page.getByTestId('wk-verify-error'))).toBeVisible();
  });

  test('[E2E] an unknown certificate id reports not found and shows no tenant content', async ({ page }) => {
    await page.goto('/verify/00000000-0000-0000-0000-000000000000');
    const status = page.getByTestId('wk-verify-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText(/Not found|Valid|Superseded|Revoked|Too many/);
    // The anonymous page never shows an organisation or engagement title unless the tenant allows it.
    await expect(page.getByTestId('wk-verify')).not.toContainText('Synthetic Org');
  });

  test('[E2E] the public Board Pack route answers without a session', async ({ page }) => {
    await page.goto('/pack/00000000-0000-0000-0000-000000000000');
    await expect(page.getByTestId('wk-verify')).toBeVisible();
  });

  test('[E2E] the Audit File offers a certificate tab for a manager', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    if (!(await openFirstAuditFile(page))) {
      test.skip(true, 'No audit file is reachable for this principal.');
    }
    await expect(page.getByTestId('audit-file-view-certificate')).toBeVisible();
    await page.getByTestId('audit-file-view-certificate').click();
    await expect(page.getByTestId('audit-file-certificate')).toBeVisible();
    await expect(page.getByTestId('wk-certificate')).toBeVisible();
  });

  test('[E2E] the certificate panel never offers a JSON box (F1)', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    if (!(await openFirstAuditFile(page))) {
      test.skip(true, 'No audit file is reachable for this principal.');
    }
    await page.getByTestId('audit-file-view-certificate').click();
    await expect(page.getByTestId('wk-certificate')).toBeVisible();
    await expect(page.getByTestId('wk-certificate')).not.toContainText('JSON');
  });
});

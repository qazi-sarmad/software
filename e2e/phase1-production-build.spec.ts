import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * G1 — Phase 1 anti-theatre proof (docs/SCALE-TASKS.md, task 1.1).
 *
 * This spec runs ONLY against the production bundle (`E2E_PROD=1`, served by `vite preview`). It exists
 * because the historical suite ran for months against a demo seed while the production build rendered
 * empty screens: a green test proved nothing about whether the app reads its own database.
 *
 * The assertion is deliberately about a database row: `global-setup.ts` seeds an engagement titled
 * "Phase 1 production-build probe (Test)" and scopes the preparer account to its universe. The title
 * can only appear on screen if the shell hydrated from the database through RLS-scoped reads. The demo
 * seed (dev only) does not contain it, and a production build does not emit the demo seed at all.
 */
const PREPARER = 'bilal.ahmed@provio-test.invalid';
const SEEDED_ENGAGEMENT_TITLE = 'Phase 1 production-build probe (Test)';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

test.describe('Phase 1: the shell reads its own database', () => {
  test('[G1] a database engagement row is rendered from the production build', async ({ page }) => {
    await signIn(page, PREPARER);
    // The Audit Plan tab renders engagements from the tenant snapshot the shell loaded.
    await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Plan').click();
    await expect(page.getByTestId('plan-records')).toBeVisible();
    await expect(page.getByText(SEEDED_ENGAGEMENT_TITLE).first()).toBeVisible();
  });

  test('[G1] no demo-tenant canary marker leaks into the production build', async ({ page }) => {
    await signIn(page, PREPARER);
    // The demo seed's ledger summaries carry [CANARY-*] markers. A production build must never show
    // them; their absence is the second half of the proof that the demo seed is not the data source.
    await expect(page.locator('body')).not.toContainText('[CANARY-');
  });
});

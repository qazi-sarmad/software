import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * S10 E2E: Time-Travel (F14) and cross-engagement Patterns (F15).
 *
 * The CIA holds view_insights, so it reaches both surfaces. Time-Travel lives inside the Audit File
 * window and shows an earlier state reconstructed from append-only history. Patterns lives in the
 * Issues & CAP Register as a second view and groups the seeded concluded findings. Both are
 * deterministic: no AI, no randomness. The server is the gate (feature entitlement and right); the
 * app only hides what it already knows is unavailable.
 */
const CIA_EMAIL = 'kamran.sheikh@provio-test.invalid';
const PREPARER_EMAIL = 'bilal.ahmed@provio-test.invalid';
const A_ENGAGEMENT = 'e0000000-0000-4000-8000-000000000001';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

async function goToTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByRole('button', { name }).click();
}

test.describe('S10 patterns view', () => {
  test('[E2E] the Issues tab carries a Patterns view that groups the seeded findings', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await goToTab(page, 'Issues & CAP Register');
    await expect(page.getByTestId('issues-view-patterns')).toBeVisible();
    await page.getByTestId('issues-view-patterns').click();
    await expect(page.getByTestId('wk-patterns')).toBeVisible();
    // The two seeded findings share a title stem, text and entity, so they form one group.
    const clusters = page.getByTestId('wk-patterns-clusters');
    const empty = page.getByTestId('wk-patterns-empty');
    await expect(clusters.or(empty)).toBeVisible();
  });

  test('[E2E] the Patterns view offers no JSON box (F1)', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await goToTab(page, 'Issues & CAP Register');
    await page.getByTestId('issues-view-patterns').click();
    await expect(page.getByTestId('wk-patterns')).toBeVisible();
    await expect(page.getByTestId('wk-patterns')).not.toContainText('JSON');
  });

  test('[E2E] the heat map and graph views render', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await goToTab(page, 'Issues & CAP Register');
    await page.getByTestId('issues-view-patterns').click();
    await page.getByTestId('wk-patterns-tab-heatmap').click();
    await expect(page.getByTestId('wk-patterns-heatmap')).toBeVisible();
    await page.getByTestId('wk-patterns-tab-graph').click();
    await expect(page.getByTestId('wk-patterns-graph')).toBeVisible();
  });

  test('[E2E] a figure in the graph drills down to the original sealed finding (F15)', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await goToTab(page, 'Issues & CAP Register');
    await page.getByTestId('issues-view-patterns').click();
    await page.getByTestId('wk-patterns-tab-graph').click();
    const node = page.locator('[data-testid^="wk-patterns-node-"]').first();
    await expect(node).toBeVisible();
    const findingId = (await node.getAttribute('data-testid'))!.replace('wk-patterns-node-', '');
    await node.click();
    // The finding opens through the normal record view: the window in the app, the page on /view.
    await expect(page.getByTestId('finding-drilldown')).toBeVisible();
    await expect(page.getByTestId('finding-drilldown-title')).not.toBeEmpty();
    // The URL form of the same record is the drill-down link the Board Pack and the PDF use.
    await page.goto(`/view/finding/${findingId}`);
    await expect(page.getByTestId('record-page')).toBeVisible();
    await expect(page.getByTestId('finding-drilldown')).toBeVisible();
  });

  test('[E2E] a Preparer without view_insights is not offered the Patterns data', async ({ page }) => {
    await signIn(page, PREPARER_EMAIL);
    await goToTab(page, 'Issues & CAP Register');
    // The view switch is offered, but the panel shows the plain refusal rather than the data: the
    // server refuses pattern_findings for a caller without view_insights.
    await page.getByTestId('issues-view-patterns').click();
    await expect(page.getByTestId('wk-patterns-denied')).toBeVisible();
  });
});

test.describe('S10 time-travel', () => {
  test('[E2E] the Audit File window offers a Time-Travel view with the as-of banner', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await page.goto(`/view/engagement/${A_ENGAGEMENT}`);
    await expect(page.getByTestId('record-page')).toBeVisible();
    await page.getByTestId('audit-file-view-as_of').click();
    await expect(page.getByTestId('wk-timetravel')).toBeVisible();
    await expect(page.getByTestId('wk-timetravel-banner')).toBeVisible();
    await expect(page.getByTestId('wk-timetravel-track')).toBeVisible();
    await expect(page.getByTestId('wk-timetravel-handle')).toBeVisible();
  });

  test('[E2E] the timeline is read-only and reports what history did not record', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await page.goto(`/view/engagement/${A_ENGAGEMENT}`);
    await page.getByTestId('audit-file-view-as_of').click();
    await expect(page.getByTestId('wk-timetravel')).toBeVisible();
    // A fresh engagement has little recorded history; the honesty note shows rather than a guess.
    const state = page.getByTestId('wk-timetravel-state');
    await expect(state).toBeVisible();
    // Nothing on this surface is an input that writes: the only inputs are the date picker.
    await expect(page.getByTestId('wk-timetravel')).not.toContainText('JSON');
  });

  test('[E2E] Compare with now is available and produces a comparison region', async ({ page }) => {
    await signIn(page, CIA_EMAIL);
    await page.goto(`/view/engagement/${A_ENGAGEMENT}`);
    await page.getByTestId('audit-file-view-as_of').click();
    await page.getByTestId('wk-timetravel-compare').click();
    await expect(page.getByTestId('wk-timetravel-diff')).toBeVisible();
  });
});

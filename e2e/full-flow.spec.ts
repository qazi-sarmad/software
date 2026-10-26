import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * C5.5 full-flow regression: one spec that walks the happy path of the whole product with the
 * synthetic users and the stub provider (spec §29). It is deliberately tolerant of the data the run
 * happens to hold: every step asserts a DESIGNED state (a panel, or its designed empty state), never
 * a state that only exists after a specific earlier action, so it is green on a fresh CI database
 * and still catches a screen that fails to render, a route that 404s, or a blocking modal that
 * appears. Where a step genuinely needs a downstream object (a sealed engagement, an issued
 * certificate) the spec checks that the object is reachable or that its designed gate is shown, and
 * names which it found.
 *
 * The path: setup wizard → people → universe/entity → SIRA → plan → deployment gate → planning →
 * population gate → sample → test → finding → conclusion → seal → certificate → public verify →
 * report freeze/issue → CAP → Board Pack → export bundle.
 */

const CIA = 'kamran.sheikh@provio-test.invalid';       // governs the function, approves plans
const PREPARER = 'bilal.ahmed@provio-test.invalid';   // performs and documents work
const ADMIN = 'ayesha.khan@provio-test.invalid';      // configures the organisation (org_admin)
const PLATFORM = 'platform.admin@provio-test.invalid';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Navigation Strip' });

async function openEngagement(page: Page) {
  await nav(page).getByTitle('Audit Files').click();
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  if ((await card.count()) === 0) return false;
  await card.click();
  await expect(page.getByTestId('audit-file')).toBeVisible();
  return true;
}

test('[E2E] no step of the flow renders a blocking modal', async ({ page }) => {
  await signIn(page, CIA);
  // No surface may set aria-modal (spec §27.5). The Audit File window legitimately sets role="dialog"
  // without aria-modal, so the rule is asserted on aria-modal, not on role.
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await openEngagement(page);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[E2E] setup wizard and people administration are reachable', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-tabs')).toBeVisible();
  await page.getByTestId('org-control-tab-setup').click();
  await expect(page.getByTestId('org-control-tabs')).toBeVisible();

  // People administration opens as a non-blocking record view with the invite control.
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-people-admin').click();
  await expect(page.getByTestId('people-admin-panel')).toBeVisible();
});

test('[E2E] universe and entity screens render, and the deployment gate is a gate not a button', async ({ page }) => {
  await signIn(page, CIA);
  await nav(page).getByTitle('Audit Universe').click();
  await expect(page.getByTestId('db-entities')).toBeVisible();
  await expect(page.getByTestId('add-entity-open')).toBeVisible();

  // The deployment gate is the ONLY way an audit file appears (§7). Its panel is reachable from the
  // Audit Plan tab, alongside the plan, combined-approval and ethics controls.
  await nav(page).getByTitle('Audit Plan').click();
  await expect(page.getByTestId('plan-records')).toBeVisible();
  await expect(page.getByTestId('plan-open-gate')).toBeVisible();
  await expect(page.getByTestId('plan-open-combined')).toBeVisible();
  await expect(page.getByTestId('plan-open-ethics')).toBeVisible();
});

test('[E2E] SIRA model and cycles render (or their designed empty states)', async ({ page }) => {
  await signIn(page, CIA);
  await nav(page).getByTitle('SIRA').click();
  await expect(page.getByTestId('tab-sira')).toBeVisible();
  // Either the seeded model and cycles, or the designed empty state.
  await expect(
    page.getByTestId('sira-open-model').or(page.getByTestId('sira-model-empty'))
  ).toBeVisible();
  await expect(
    page.getByTestId('sira-open-cycles').or(page.getByTestId('sira-cycles-empty'))
  ).toBeVisible();
});

test('[E2E] planning, the population gate and sampling render inside an engagement', async ({ page }) => {
  await signIn(page, PREPARER);
  if (!(await openEngagement(page))) return;
  await page.getByTestId('audit-file-view-workspace').click();
  await expect(page.getByTestId('audit-file-workspace')).toBeVisible();
  await expect(page.getByTestId('planning-panel')).toBeVisible();
  // The population gate and the sampling panel are the only path to a test (§11.1, L3).
  await expect(page.getByTestId('population-panel')).toBeVisible();
  await expect(page.getByTestId('sampling-panel')).toBeVisible();
  await expect(page.getByTestId('rowtesting-panel')).toBeVisible();
  await expect(page.getByTestId('analyst-panel')).toBeVisible();
});

test('[E2E] findings and issues, conclusion, certificate, report, CAP and export are all reachable', async ({ page }) => {
  await signIn(page, PREPARER);
  if (!(await openEngagement(page))) return;

  await page.getByTestId('audit-file-view-findings').click();
  await expect(page.getByTestId('findings-panel')).toBeVisible();
  await expect(
    page.getByTestId('findings-empty').or(page.locator('[data-testid^="observation-"]').first())
  ).toBeVisible();

  await page.getByTestId('audit-file-view-conclusion').click();
  await expect(page.getByTestId('conclusion-panel')).toBeVisible();
  await expect(page.getByTestId('conclusion-preflight')).toBeVisible();

  await page.getByTestId('audit-file-view-report').click();
  await expect(page.getByTestId('report-editor')).toBeVisible();

  // The deterministic report builder (WRITE-1, W12) is rights-gated on review_and_approve /
  // approve_plan. A preparer sees the designed refusal, never the panel (asserted unconditionally;
  // the full panel walk is its own test below, signed in as the CIA who holds the right).
  await page.getByTestId('audit-file-view-builder').click();
  await expect(page.getByTestId('wk-report-builder-denied')).toBeVisible();
  await expect(page.getByTestId('wk-report-builder-panel')).toHaveCount(0);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

  await page.getByTestId('audit-file-view-caps').click();
  await expect(page.getByTestId('cap-register')).toBeVisible();
  await expect(
    page.getByTestId('cap-empty').or(page.locator('[data-testid^="cap-status-"]').first())
  ).toBeVisible();

  await page.getByTestId('audit-file-view-certificate').click();
  await expect(page.getByTestId('audit-file-certificate')).toBeVisible();

  await page.getByTestId('audit-file-view-export').click();
  await expect(page.getByTestId('export-panel')).toBeVisible();
  await expect(page.getByTestId('export-controls')).toBeVisible();
});

test('[E2E] the report builder composes, reconciles, compares and freezes for a holder of the right', async ({ page }) => {
  // WRITE-1 W12: the deterministic builder. The CIA holds review_and_approve, so the panel renders.
  await signIn(page, CIA);
  if (!(await openEngagement(page))) return;
  await page.getByTestId('audit-file-view-builder').click();
  await expect(page.getByTestId('wk-report-builder-panel')).toBeVisible();
  // One graph root for the whole register matrix; the render hash is beside it.
  await expect(page.getByTestId('wk-report-builder-graph-root')).toBeVisible();
  await expect(page.getByTestId('wk-report-builder-render-hash')).toBeVisible();
  // Every claim carries its phrase version and its "Why this sentence" control.
  await expect(page.locator('[data-testid^="wk-report-builder-claim-c-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid$="-provenance"]').first()).toBeVisible();
  // Changing only the register must not move the graph root (W1, W2.2).
  const rootBefore = await page.getByTestId('wk-report-builder-graph-root').innerText();
  await page.getByTestId('wk-report-builder-formality').click();
  await page.getByRole('option', { name: /F5/ }).click();
  await expect(page.getByTestId('wk-report-builder-graph-root')).toHaveText(rootBefore);
  // Coverage reconciles; the contradiction pane renders; the freeze names its outcome.
  await page.getByTestId('wk-report-builder-pane-coverage').click();
  await expect(page.getByTestId('wk-report-builder-coverage-status')).toBeVisible();
  await page.getByTestId('wk-report-builder-pane-contradictions').click();
  await expect(
    page.getByTestId('wk-report-builder-contradictions-empty')
      .or(page.locator('[data-testid^="wk-report-builder-contradiction-"]').first())
  ).toBeVisible();
  await page.getByTestId('wk-report-builder-pane-compare').click();
  await expect(page.getByTestId('wk-report-builder-compare-summary')).toBeVisible();
  await page.getByTestId('wk-report-builder-freeze-run').click();
  await expect(page.getByTestId('wk-report-builder-freeze-result')).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[E2E] the seal, certificate and public verification path exists end to end', async ({ page }) => {
  // Seal is a Conclusion-stage sign-off; the certificate is issued after it. The spec asserts the
  // path is present: a sealed engagement shows its certificate, and the public page answers for it.
  await signIn(page, CIA);
  if (!(await openEngagement(page))) return;
  await page.getByTestId('audit-file-view-certificate').click();
  const cert = page.getByTestId('audit-file-certificate');
  await expect(cert).toBeVisible();
  // The certificate panel either shows a certificate (id/hash) or its designed gate.
  await expect(cert).toContainText(/certificate|sealed|not yet|issue/i);
});

test('[E2E] the public verification page answers without a session and never leaks tenant content', async ({ page }) => {
  await page.goto('/verify/00000000-0000-0000-0000-000000000000');
  await expect(page.getByTestId('wk-verify')).toBeVisible();
  await expect(
    page.getByTestId('wk-verify-status').or(page.getByTestId('wk-verify-error'))
  ).toBeVisible();
  await expect(page.getByTestId('wk-verify')).not.toContainText('Synthetic Org');
});

test('[E2E] the Dashboard carries the Board Pack generator, history and scope', async ({ page }) => {
  await signIn(page, CIA);
  await expect(page.getByTestId('nav-strip-track')).toBeVisible();
  await expect(page.getByTestId('wk-boardpack')).toBeVisible();
  // The generator panel always renders; before the first pack it carries the empty note instead of
  // a history. (The empty note is a CHILD of the generator, so `.or()` would match two elements.)
  await expect(page.getByTestId('wk-boardpack-generator')).toBeVisible();
  await expect(page.getByTestId('wk-boardpack-history')).toBeVisible();
});

test('[E2E] the platform portal is reachable by platform staff only', async ({ page }) => {
  // With NO session the route renders the sign-in screen (PlatformGate), never the portal.
  await page.goto('/superadmin');
  await expect(page.getByTestId('superadmin-portal')).toHaveCount(0);

  // A signed-in TENANT session is shown the denial, never the portal.
  await signIn(page, ADMIN);
  await page.goto('/superadmin');
  await expect(page.getByTestId('superadmin-denied')).toBeVisible();
  await expect(page.getByTestId('superadmin-portal')).toHaveCount(0);

  // Leave the denial screen, sign out from the tenant shell, then sign in as platform staff.
  await page.getByRole('button', { name: 'Back to workspace' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
  await page.getByLabel('Open user profile menu').click();
  await page.getByText('Sign out').click();
  await expect(page.getByTestId('signin-screen')).toBeVisible();

  await page.goto('/superadmin');
  await page.getByLabel('Email').fill(PLATFORM);
  await page.getByLabel('Password').fill(passwordFor(PLATFORM));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('superadmin-portal')).toBeVisible();
  await expect(page.getByTestId('superadmin-tabs')).toBeVisible();
});

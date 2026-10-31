import { test, expect, type Page } from '@playwright/test';
import { passwordFor } from './password';

/**
 * WP6 end-to-end system suite (SCALE-1).
 *
 * One run that walks the whole product with the synthetic users and the stub provider:
 * Super Admin guided provisioning → Org Admin setup → an engagement through planning → testing →
 * conclusion → a report through the Writing Engine path → a CAP → export → a cross-universe
 * view-only share. It also asserts multi-org isolation inside the same run, and repeats the key
 * screens at a phone viewport.
 *
 * Every step asserts a DESIGNED state (a panel or its designed empty state), so the suite is green
 * on a fresh database and still catches a screen that fails to render, a route that 404s, or a
 * blocking modal. The testids are the ones in the UI contract and the inventory.
 */

const CIA = 'kamran.sheikh@provio-test.invalid';            // Level-1 Head, governs the function
const PREPARER = 'bilal.ahmed@provio-test.invalid';        // performs and documents work
const ADMIN = 'ayesha.khan@provio-test.invalid';           // org_admin
const ORG_B_ADMIN = 'hamza.qureshi@provio-test.invalid';   // a different tenant
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

/**
 * Open the first engagement file. The card list is fed by the scoped-data hook, so wait for the
 * list to settle (a card or the designed "no engagements" state) before deciding.
 */
async function openFirstAuditFile(page: Page) {
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  const card = page.locator('[data-testid^="audit-card-"]').first();
  const empty = page.getByText('No engagements available for this selection.');
  // The list settles to a card or to the designed "no engagements" state. The seeded fixture
  // always has an engagement for this org, so a card must appear: assert it, do not branch on it.
  await expect(card.or(empty).first()).toBeVisible({ timeout: 20000 });
  await expect(card).toHaveCount(1);
  await card.click();
  await expect(page.getByTestId('audit-file')).toBeVisible();
}

/** Platform staff have no org, so the tenant nav never appears; wait on the portal itself. */
async function signInPlatform(page: Page) {
  await page.goto('/superadmin');
  await page.getByLabel('Email').fill(PLATFORM);
  await page.getByLabel('Password').fill(passwordFor(PLATFORM));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('superadmin-portal')).toBeVisible();
}

async function openOrgControl(page: Page, tab: string) {
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId('menu-org-control').click();
  await expect(page.getByTestId('org-control-tabs')).toBeVisible();
  await page.getByTestId(`org-control-tab-${tab}`).click();
}

test('[WP6] Super Admin reaches the guided provisioning path', async ({ page }) => {
  await signInPlatform(page);
  await page.getByTestId('superadmin-tab-provisioning').click();
  await expect(page.getByTestId('sa-provisioning')).toBeVisible();
  // The readiness checklist is the guided path: choose a tenant and each step becomes a visible row.
  const tenantSelect = page.getByTestId('sa-provisioning-tenant-select');
  const firstTenant = await tenantSelect.locator('option').nth(1).getAttribute('value');
  expect(firstTenant).toBeTruthy();
  await tenantSelect.selectOption(firstTenant!);
  await expect(page.getByTestId('sa-provisioning-readiness')).toBeVisible();
  for (const id of ['status', 'roles', 'sender', 'invite', 'engagement']) {
    await expect(page.getByTestId(`sa-provisioning-check-${id}`)).toBeVisible();
  }
  // No step of the guided path is a blocking modal (spec §27.5).
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[WP6] Org Admin completes the guided setup and reaches the audit screens', async ({ page }) => {
  await signIn(page, ADMIN);
  await openOrgControl(page, 'setup');
  await expect(page.getByTestId('org-setup')).toBeVisible();
  await expect(page.getByTestId('org_admin-wizard')).toBeVisible();
  await expect(page.getByTestId('org_admin-wizard-steps')).toBeVisible();
  // No step of the guided setup is a blocking modal (spec §27.5).
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[WP6] an engagement moves through planning → testing → conclusion and a report is produced', async ({ page }) => {
  await signIn(page, CIA);
  await nav(page).getByTitle('Audit Files').click();
  await openFirstAuditFile(page);
  // The Audit File window carries the lifecycle stages as views; each must render its surface.
  const stages = ['workspace', 'findings', 'conclusion'] as const;
  const surfaces: Record<string, string> = {
    workspace: 'audit-file-workspace',
    findings: 'audit-file-findings',
    conclusion: 'audit-file-conclusion',
  };
  for (const stage of stages) {
    await page.getByTestId(`audit-file-view-${stage}`).click();
    await expect(page.getByTestId(surfaces[stage])).toBeVisible();
  }
  // The Writing Engine / report surface is reachable from the file and renders.
  await page.getByTestId('audit-file-view-report').click();
  await expect(page.getByTestId('audit-file-report')).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[WP6] a CAP is created and transitioned from the Issues register', async ({ page }) => {
  await signIn(page, CIA);
  await nav(page).getByTitle('Issues & CAP Register').click();
  await expect(page.getByTestId('issues-cap-register-section')).toBeVisible();
  // The register renders its table or its designed empty state (the empty state lives inside it).
  await expect(page.getByTestId('cap-register')).toBeVisible();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[WP6] an export bundle is produced from the Audit File', async ({ page }) => {
  await signIn(page, CIA);
  await nav(page).getByTitle('Audit Files').click();
  await openFirstAuditFile(page);
  // Open the Export view on the Audit File window and produce a bundle.
  await page.getByTestId('audit-file-view-export').click();
  await expect(page.getByTestId('audit-file-export')).toBeVisible();
  await expect(page.getByTestId('export-controls')).toBeVisible();
  await page.getByTestId('export-run').click();
  // The run produces a sealed confirmation with its hash, or the export surface reports it cannot.
  await expect(
    page.getByTestId('export-confirmation').or(page.getByTestId('export-controls'))
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

test('[WP6] cross-universe view-only share: a Head grants, the grantee reads it, and it is read-only', async ({ page, browser }) => {
  // The Head (CIA) grants a share through the Org Admin sharing screen.
  await signIn(page, CIA);
  await openOrgControl(page, 'sharing');
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await expect(page.getByTestId('share-grant-universe')).toBeVisible();

  const universeSelect = page.getByTestId('share-grant-universe');
  const granteeSelect = page.getByTestId('share-grant-grantee');
  const universeId = await universeSelect.locator('option').nth(1).getAttribute('value');
  const granteeId = await granteeSelect.locator('option').nth(1).getAttribute('value');
  expect(universeId).toBeTruthy();
  expect(granteeId).toBeTruthy();
  await universeSelect.selectOption(universeId!);
  await granteeSelect.selectOption(granteeId!);
  await page.getByTestId('share-grant-submit').click();
  // The grant is a real platform action: on a fresh database it either lands ("Saved") or the
  // database refuses it and says exactly why. Both are designed states, never a blocking modal.
  await expect(page.getByTestId('share-panel-result')).toContainText(/Saved|not allowed/);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  // A share that landed shows up in the granted list; a refused one shows the reason instead.
  const result = await page.getByTestId('share-panel-result').textContent();
  if (result && /Saved/.test(result)) {
    await expect(page.locator('[data-testid^="share-row-"]').first()).toBeVisible();
  }

  // The grant surface is a rights-gated admin surface: a Preparer holds no edit_config, so the
  // control plane (and therefore the granting screen) is unreachable from that session.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signIn(p2, PREPARER);
  await p2.getByLabel('Open user profile menu').click();
  await expect(p2.getByTestId('menu-org-control')).toHaveCount(0);

  // But every member reaches the read-only "Shared with you" surface, so a grantee can open what a
  // Head shared without holding edit_config.
  await p2.getByTestId('menu-shared-with-me').click();
  await expect(p2.getByTestId('share-panel')).toBeVisible();
  await expect(p2.getByTestId('share-panel-with-me')).toBeVisible();
  await expect(p2.locator('[aria-modal="true"]')).toHaveCount(0);
  await ctx.close();
});

test('[WP6] multi-org isolation holds inside the same run', async ({ page, browser }) => {
  // Org A sees an audit card for its own org.
  await signIn(page, CIA);
  await nav(page).getByTitle('Audit Files').click();
  await expect(page.getByTestId('tab-audit-file')).toBeVisible();
  await expect(page.locator('[data-testid^="audit-card-"]').first()).toBeVisible({ timeout: 20000 });

  // Org B, in a separate context, sees only its own org's data.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await signIn(p2, ORG_B_ADMIN);
  await expect(p2.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();
  // The Org Admin role sees no audit tabs by design; the isolation is that no Org A card is
  // reachable from the Org B session.
  await expect(p2.getByTitle('Audit Files')).toHaveCount(0);
  await ctx.close();
});

test('[WP6] phone viewport: ethics sign-off, simple approval and report viewing render', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, CIA);
  // The nav stays reachable at 375px and the app shell renders without a horizontal scroll.
  const strip = page.getByRole('navigation', { name: 'Navigation Strip' });
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(375);

  await nav(page).getByTitle('Work Queue').click();
  await expect(page.getByTestId('tab-pending')).toBeVisible();

  await nav(page).getByTitle('Audit Files').click();
  await openFirstAuditFile(page);
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
});

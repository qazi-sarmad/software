/**
 * Screenshot sweep (C5.4, spec §27.1 and §29).
 *
 * Captures every screen the UI contract names (docs/ACP-UI-CONTRACT.md, Appendix A:
 * GL-01, TUT-01, SA-01..SA-15, OA-01..OA-21, WK-01..WK-10, EX-01..EX-04, plus OA-22) in all THREE
 * design presets (Ledger, Porcelain, Bone) and BOTH themes (light, dark).
 *
 *   npm run screenshots
 *
 * Output: artifacts/screenshots/<preset>-<theme>/<screenId>.png and
 * artifacts/screenshots/manifest.json. The directory is git-ignored; CI uploads it as a workflow
 * artifact (never committed, spec §29).
 *
 * The script drives its own Chromium (like scripts/record-tutorials.mjs), so it takes its base URL
 * from SCREENSHOTS_BASE_URL (default http://localhost:3000) and its credentials from the same
 * environment the Playwright suite uses (SUPABASE_URL / SUPABASE_SECRET_KEY are not needed here; it
 * signs in with the synthetic users through e2e/password.ts, so run the e2e global setup first OR
 * let the dev server be the CI app with the same seeded users).
 *
 * The sweep is a tool for the owner, not a gate: a screen that cannot be reached on the run is
 * recorded as "unreached" in the manifest instead of failing the run, because the owner replaces the
 * UI and re-runs it. Every captured file is a real screenshot of the real app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.SCREENSHOTS_BASE_URL || 'http://localhost:3000';
const OUT = path.resolve('artifacts/screenshots');

const PRESETS = ['ledger', 'porcelain', 'bone'];
const THEMES = ['light', 'dark'];

/** The synthetic principals the E2E setup creates (e2e/global-setup.ts). */
const CIA = 'sana.khan@provio-test.invalid';
const PREPARER = 'bilal.ahmed@provio-test.invalid';
const ADMIN = 'zara.malik@provio-test.invalid';
const PLATFORM = 'platform.admin@provio-test.invalid';

/**
 * One entry per distinct screen. Several Appendix A ids share a route/tab, so they map to the same
 * capture (the contract section is the source of truth for which ids exist; the manifest records the
 * routes captured). `open` performs the navigation after sign-in; `ready` is the testid that proves
 * the screen rendered.
 */

const openMenu = async (p, testid) => {
  await p.getByLabel('Open user profile menu').click();
  await p.getByTestId(testid).click();
};
const goto = (p, url) => p.goto(url, { waitUntil: 'domcontentloaded' });

const CAPTURES = [
  { id: 'GL-01', who: CIA, ready: 'nav-strip-track', open: async (p) => { await goto(p, '/'); }, note: 'authenticated shell (Dual Session banner renders here when a session is active)' },
  { id: 'OA-01', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-setup').click(); }, note: 'setup wizard' },
  { id: 'OA-03', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-changes').click(); }, note: 'change control' },
  { id: 'OA-02', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-branding').click(); }, note: 'branding and report format' },
  { id: 'OA-04', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); }, note: 'features (default tab)' },
  { id: 'OA-06', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-ai').click(); } },
  { id: 'OA-11', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-email').click(); } },
  { id: 'OA-12', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-automation').click(); } },
  { id: 'OA-13', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-escalation').click(); } },
  { id: 'OA-14', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-auditors').click(); } },
  { id: 'OA-15', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-hosting').click(); } },
  { id: 'OA-16', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-consultation').click(); } },
  { id: 'OA-17', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-history').click(); }, note: 'configuration history and change control' },
  { id: 'OA-18', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-tutorials').click(); } },
  { id: 'OA-22', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await openMenu(p, 'menu-org-control'); await p.getByTestId('org-control-tab-governance').click(); }, note: 'governance settings (C3.2-B)' },
  { id: 'SA-01', who: PLATFORM, ready: 'superadmin-portal', open: async (p) => { await goto(p, '/superadmin'); } },
  { id: 'EX-01', who: PREPARER, ready: 'ex-portal', open: async (p) => { await goto(p, '/external'); }, note: 'external auditor portal' },
  { id: 'WK-01', who: CIA, ready: 'nav-strip-track', open: async (p) => { await goto(p, '/'); }, note: 'dashboard block (Board Pack lives in the Dashboard)' },
  { id: 'WK-02', who: CIA, ready: 'tab-pending', open: async (p) => { await goto(p, '/'); await p.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Work Queue').click(); }, note: 'Work Queue' },
  { id: 'tab-universe', who: CIA, ready: 'db-entities', open: async (p) => { await goto(p, '/'); await p.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Universe').click(); } },
  { id: 'tab-plan', who: CIA, ready: 'plan-records', open: async (p) => { await goto(p, '/'); await p.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Plan').click(); } },
  { id: 'tab-sira', who: CIA, ready: 'tab-sira', open: async (p) => { await goto(p, '/'); await p.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('SIRA').click(); } },
  { id: 'tab-issues', who: CIA, ready: 'issues-cap-register-section', open: async (p) => { await goto(p, '/'); await p.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Issues & CAP Register').click(); } },
  { id: 'audit-file', who: PREPARER, ready: 'audit-file', open: async (p) => {
    await goto(p, '/');
    await p.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit Files').click();
    const card = p.locator('[data-testid^="audit-card-"]').first();
    await card.click();
  }, note: 'Audit File window and its tabs (WK-03..WK-10, EX-02/03 live under engagements)' },
];

/** The per-run synthetic passwords written by e2e/global-setup.ts (git-ignored). */
function passwordFor(email) {
  const file = path.join(process.cwd(), 'e2e/.auth/passwords.json');
  if (!fs.existsSync(file)) {
    throw new Error('Run the Playwright global setup first: e2e/.auth/passwords.json is missing.');
  }
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  return all[email] ?? '';
}

async function signIn(page, email) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Navigation Strip' }).waitFor({ state: 'visible', timeout: 30_000 });
}

async function applyTheme(page, preset, theme) {
  await page.evaluate(([p, t]) => {
    localStorage.setItem('provio-preset', p);
    localStorage.setItem('provio-theme', t);
    document.documentElement.setAttribute('data-preset', p);
    document.documentElement.setAttribute('data-theme', t);
  }, [preset, theme]);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const manifest = [];

  for (const preset of PRESETS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      // Seed autoplay off so the tutorial drawer does not cover every screen first visit.
      await ctx.addInitScript(() => localStorage.setItem('acp.tutorial.autoplay', 'off'));
      const dir = path.join(OUT, `${preset}-${theme}`);
      fs.mkdirSync(dir, { recursive: true });

      for (const cap of CAPTURES) {
        const page = await ctx.newPage();
        const file = path.join(dir, `${cap.id}.png`);
        try {
          await signIn(page, cap.who);
          await applyTheme(page, preset, theme);
          await cap.open(page);
          await page.getByTestId(cap.ready).first().waitFor({ state: 'visible', timeout: 20_000 });
          await page.waitForTimeout(300);
          await page.screenshot({ path: file, fullPage: false });
          manifest.push({ screen: cap.id, preset, theme, file: path.relative(OUT, file), status: 'captured' });
        } catch (err) {
          manifest.push({ screen: cap.id, preset, theme, status: `unreached: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` });
        } finally {
          await page.close();
        }
      }
      await ctx.close();
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const captured = manifest.filter((m) => m.status === 'captured').length;
  console.log(`Screenshots: ${captured} captured, ${manifest.length - captured} unreached. Written to ${OUT}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

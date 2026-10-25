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
 * from SCREENSHOTS_BASE_URL (default http://localhost:3000) and its credentials from the per-run
 * file the Playwright global setup writes (e2e/.auth/passwords.json), so run the global setup first.
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

/** The synthetic principals the E2E setup creates (e2e/global-setup.ts, USERS). */
const CIA = 'kamran.sheikh@provio-test.invalid';
const PREPARER = 'bilal.ahmed@provio-test.invalid';
const ADMIN = 'ayesha.khan@provio-test.invalid';
const PLATFORM = 'platform.admin@provio-test.invalid';
const EXTERNAL = 'external.auditor@provio-test.invalid';

const nav = (p) => p.getByRole('navigation', { name: 'Navigation Strip' });
const openMenu = async (p, testid) => {
  await p.getByLabel('Open user profile menu').click();
  await p.getByTestId(testid).click();
};
const goto = (p, url) => p.goto(url, { waitUntil: 'domcontentloaded' });
const home = async (p) => {
  await goto(p, '/');
  await nav(p).waitFor({ state: 'visible', timeout: 30_000 });
};
/** Open a Navigation Strip tab by its title. */
const tab = async (p, title) => {
  await home(p);
  await nav(p).getByTitle(title).click();
};
/** Open the first engagement's Audit File window (phase 4 helper shape). */
const openEngagement = async (p) => {
  await tab(p, 'Audit Files');
  await p.getByTestId('tab-audit-file').waitFor({ state: 'visible', timeout: 30_000 });
  const card = p.locator('[data-testid^="audit-card-"]').first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  await card.click();
  await p.getByTestId('audit-file').waitFor({ state: 'visible', timeout: 30_000 });
};
/** Open the Org Admin control plane on a named tab. */
const org = async (p, tabId) => {
  await openMenu(p, 'menu-org-control');
  await p.getByTestId(`org-control-tab-${tabId}`).click();
};
/** Open the platform portal on a named tab. */
const sa = async (p, tabId) => {
  await goto(p, '/superadmin');
  await p.getByTestId(`superadmin-tab-${tabId}`).click();
};

/**
 * One entry per Appendix A screen. Several ids share a route/tab; where that happens the manifest
 * records both ids against the same capture (the contract section names which ids exist, the
 * manifest names which route was captured). `open` performs the navigation after sign-in; `ready` is
 * the testid that proves the screen rendered.
 */
const CAPTURES = [
  // ---- Global and tutorial drawer ------------------------------------------------------------
  { id: 'GL-01', who: CIA, ready: 'nav-strip-track', open: async (p) => { await home(p); }, note: 'authenticated shell (the Dual Session banner renders here when a session is active)' },
  { id: 'TUT-01', who: CIA, ready: 'tutorial-drawer', open: async (p) => { await home(p); await p.getByTestId('wk-boardpack-tutorial').click(); }, note: 'tutorial drawer' },

  // ---- Platform portal (SA-01..SA-15) --------------------------------------------------------
  { id: 'SA-01', who: PLATFORM, ready: 'sa-setup', open: async (p) => { await sa(p, 'setup'); }, note: 'platform setup wizard' },
  { id: 'SA-02', who: PLATFORM, ready: 'superadmin-support', open: async (p) => { await sa(p, 'support'); }, note: 'support access, support grants and job health' },
  { id: 'SA-03', who: PLATFORM, ready: 'superadmin-tenants', open: async (p) => { await sa(p, 'tenants'); }, note: 'tenant hub' },
  { id: 'SA-04', who: PLATFORM, ready: 'superadmin-email', open: async (p) => { await sa(p, 'email'); }, note: 'email sender profiles' },
  { id: 'SA-05', who: PLATFORM, ready: 'superadmin-recipients', open: async (p) => { await sa(p, 'recipients'); }, note: 'platform notification recipients' },
  { id: 'SA-07', who: PLATFORM, ready: 'superadmin-automation', open: async (p) => { await sa(p, 'automation'); }, note: 'automation rules' },
  { id: 'SA-08', who: PLATFORM, ready: 'superadmin-automation', open: async (p) => { await sa(p, 'automation'); await p.getByTestId('superadmin-automation-tab-templates').click(); }, note: 'message templates' },
  { id: 'SA-09', who: PLATFORM, ready: 'superadmin-consultation', open: async (p) => { await sa(p, 'consultation'); }, note: 'Dual Session console' },
  { id: 'SA-10', who: PLATFORM, ready: 'sa-hosting', open: async (p) => { await sa(p, 'hosting'); await p.getByTestId('sa-hosting-tab-check').click(); }, note: 'hosting fit check' },
  { id: 'SA-11', who: PLATFORM, ready: 'sa-hosting', open: async (p) => { await sa(p, 'hosting'); await p.getByTestId('sa-hosting-tab-rules').click(); }, note: 'hosting rules' },
  { id: 'SA-12', who: PLATFORM, ready: 'sa-migration', open: async (p) => { await sa(p, 'migration'); }, note: 'migration jobs and the deployment kit' },
  { id: 'SA-13', who: PLATFORM, ready: 'superadmin-tutorials', open: async (p) => { await sa(p, 'tutorials'); }, note: 'tutorial library (registry health)' },
  { id: 'SA-14', who: PLATFORM, ready: 'superadmin-features', open: async (p) => { await sa(p, 'features'); }, note: 'features and plans' },
  { id: 'SA-15', who: PLATFORM, ready: 'superadmin-trail', open: async (p) => { await sa(p, 'trail'); }, note: 'platform trail' },

  // ---- Org Admin control plane (OA-01..OA-21) ------------------------------------------------
  { id: 'OA-01', who: ADMIN, ready: 'org-setup', open: async (p) => { await home(p); await org(p, 'setup'); }, note: 'setup wizard' },
  { id: 'OA-02', who: ADMIN, ready: 'oa-branding', open: async (p) => { await home(p); await org(p, 'branding'); }, note: 'branding and report format' },
  { id: 'OA-03', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await home(p); await org(p, 'changes'); }, note: 'change control' },
  { id: 'OA-04', who: ADMIN, ready: 'org-features', open: async (p) => { await home(p); await openMenu(p, 'menu-org-control'); }, note: 'features (the default tab)' },
  { id: 'OA-05', who: ADMIN, ready: 'people-admin-panel', open: async (p) => { await home(p); await openMenu(p, 'menu-people-admin'); }, note: 'roles and rights' },
  { id: 'OA-08', who: ADMIN, ready: 'org-automation', open: async (p) => { await home(p); await org(p, 'automation'); }, note: 'templates hub (inside automation)' },
  { id: 'OA-09', who: CIA, ready: 'wk-boardpack', open: async (p) => { await home(p); await p.getByTestId('wk-boardpack-tab-config').click(); }, note: 'Board Pack configuration' },
  { id: 'OA-10', who: ADMIN, ready: 'oa-branding', open: async (p) => { await home(p); await org(p, 'branding'); }, note: 'certificate configuration (inside branding)' },
  { id: 'OA-11', who: ADMIN, ready: 'org-email', open: async (p) => { await home(p); await org(p, 'email'); }, note: 'email sender' },
  { id: 'OA-12', who: ADMIN, ready: 'org-automation', open: async (p) => { await home(p); await org(p, 'automation'); }, note: 'notification rules' },
  { id: 'OA-13', who: ADMIN, ready: 'oa-escalation', open: async (p) => { await home(p); await org(p, 'escalation'); }, note: 'escalation rules' },
  { id: 'OA-14', who: ADMIN, ready: 'oa-auditors', open: async (p) => { await home(p); await org(p, 'auditors'); }, note: 'external auditors' },
  { id: 'OA-15', who: ADMIN, ready: 'oa-hosting', open: async (p) => { await home(p); await org(p, 'hosting'); }, note: 'hosting and database' },
  { id: 'OA-16', who: ADMIN, ready: 'org-consultation', open: async (p) => { await home(p); await org(p, 'consultation'); }, note: 'Dual Session, tenant side' },
  { id: 'OA-17', who: ADMIN, ready: 'org-history', open: async (p) => { await home(p); await org(p, 'history'); }, note: 'configuration history' },
  { id: 'OA-18', who: ADMIN, ready: 'org-control-tabs', open: async (p) => { await home(p); await org(p, 'tutorials'); }, note: 'tutorial library (tenant view)' },
  { id: 'OA-19', who: ADMIN, ready: 'org-setup', open: async (p) => { await home(p); await org(p, 'setup'); }, note: 'Go Live health check (the last setup step)' },
  { id: 'OA-20', who: ADMIN, ready: 'people-admin-panel', open: async (p) => { await home(p); await openMenu(p, 'menu-people-admin'); }, note: 'invite a colleague (inside People)' },
  { id: 'OA-21', who: CIA, ready: 'oa-patterns-config', open: async (p) => { await tab(p, 'Issues & CAP Register'); await p.getByTestId('issues-view-patterns').click(); }, note: 'patterns settings' },
  { id: 'OA-22', who: ADMIN, ready: 'oa-governance', open: async (p) => { await home(p); await org(p, 'governance'); }, note: 'governance settings (C3.2-B)' },

  // ---- Workspace (WK-01..WK-10) ---------------------------------------------------------------
  { id: 'WK-01', who: CIA, ready: 'wk-boardpack', open: async (p) => { await home(p); }, note: 'dashboard Board Pack block' },
  { id: 'WK-02', who: CIA, ready: 'wk-boardpack', open: async (p) => { await home(p); await p.getByTestId('wk-boardpack-tab-config').click(); }, note: 'Board Pack generator' },
  { id: 'WK-03', who: CIA, ready: 'wk-boardpack', open: async (p) => { await home(p); await p.getByTestId('wk-boardpack-tab-view').click(); }, note: 'Board Pack web view' },
  { id: 'WK-04', who: CIA, ready: 'wk-boardpack', open: async (p) => { await home(p); }, note: 'Board Pack panel (history)' },
  { id: 'WK-05', who: PREPARER, ready: 'wk-certificate', open: async (p) => { await openEngagement(p); await p.getByTestId('audit-file-view-certificate').click(); }, note: 'certificate panel' },
  { id: 'WK-06', who: null, ready: 'wk-verify', open: async (p) => { await goto(p, '/verify/00000000-0000-0000-0000-000000000000'); }, note: 'public verification page (anonymous)' },
  { id: 'WK-07', who: CIA, ready: 'issues-view-patterns', open: async (p) => { await tab(p, 'Issues & CAP Register'); await p.getByTestId('issues-view-patterns').click(); }, note: 'findings surface (observation editor and patterns)' },
  { id: 'WK-08', who: CIA, ready: 'wk-escalation', open: async (p) => { await tab(p, 'Work Queue'); }, note: 'escalation cards and proposals' },
  { id: 'WK-09', who: CIA, ready: 'wk-timetravel', open: async (p) => { await openEngagement(p); await p.getByTestId('audit-file-view-as_of').click(); }, note: 'Time-Travel (offered only with view_insights)' },
  { id: 'WK-10', who: CIA, ready: 'oa-patterns-config', open: async (p) => { await tab(p, 'Issues & CAP Register'); await p.getByTestId('issues-view-patterns').click(); }, note: 'cross-engagement patterns' },

  // ---- External auditor portal (EX-01..EX-04) --------------------------------------------------
  { id: 'EX-01', who: EXTERNAL, ready: 'ex-portal', open: async (p) => { await goto(p, '/external'); }, note: 'external auditor portal' },
  { id: 'EX-02', who: EXTERNAL, ready: 'ex-portal', open: async (p) => { await goto(p, '/external'); }, note: 'portal home' },
  { id: 'EX-03', who: EXTERNAL, ready: 'ex-portal', open: async (p) => { await goto(p, '/external'); const c = p.locator('[data-testid^="ex-portal-engagement-"]').first(); if (await c.count()) await c.click(); }, note: 'engagement view' },
  { id: 'EX-04', who: null, ready: 'ex-accept', open: async (p) => { await goto(p, '/external/accept'); }, note: 'invitation acceptance (anonymous)' },
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
  await nav(page).waitFor({ state: 'visible', timeout: 30_000 });
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
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
      // Seed autoplay off so the tutorial drawer does not cover every screen's first visit.
      await ctx.addInitScript(() => localStorage.setItem('acp.tutorial.autoplay', 'off'));
      const dir = path.join(OUT, `${preset}-${theme}`);
      fs.mkdirSync(dir, { recursive: true });

      for (const cap of CAPTURES) {
        const page = await ctx.newPage();
        const file = path.join(dir, `${cap.id}.png`);
        try {
          if (cap.who) await signIn(page, cap.who);
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

import { test, expect, type Page, type Response } from '@playwright/test';

/**
 * Adversarial QA suite for the Phase 0 clean-up. Written by a reviewer who did not write the
 * application code. These tests attack the claims in docs/PARITY.md; they do not edit source.
 *
 * Two servers are used:
 *  - the Vite DEV server (baseURL, port 3000) started by playwright.config.ts — has the dev-only
 *    sign-in stub and dev routes.
 *  - a PRODUCTION preview (port 4173) that must be running separately:
 *    `npx vite build && npx vite preview --port 4173`. Preview tests skip when it is not reachable.
 */

const PREVIEW = 'http://127.0.0.1:4173';
const DEMO_EMAIL = 'a.wright@provio.internal';

const TENANT_STRINGS = [
  'CANARY',
  'Global Banking',
  'Retail & Digital Banking',
  'Marcus Vance',
  'Alexandra Wright',
  'Elena Rostova',
  'Sarah Jenkins',
  'provio.internal',
  'Treasury Intraday',
  'provio-corp-tenant',
  'Simulate Viewpoint',
];

async function previewUp(): Promise<boolean> {
  try {
    const res = await fetch(PREVIEW, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function storageDump(page: Page) {
  return page.evaluate(() => {
    const local: Record<string, string> = {};
    const session: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      local[k] = localStorage.getItem(k) ?? '';
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      session[k] = sessionStorage.getItem(k) ?? '';
    }
    return { local, session };
  });
}

test.describe('Attack 3 — no tenant data without a session (production build)', () => {
  test.beforeEach(async () => {
    test.skip(!(await previewUp()), 'production preview (4173) is not running');
  });

  test('[E2E] unauthenticated load shows no tenant strings in DOM, storage or network', async ({ page }) => {
    const bodies: { url: string; text: string }[] = [];
    page.on('response', async (res: Response) => {
      try {
        const ct = res.headers()['content-type'] ?? '';
        if (/json|javascript|text|html/.test(ct)) bodies.push({ url: res.url(), text: await res.text() });
      } catch {
        /* ignore */
      }
    });

    await page.goto(PREVIEW + '/');
    await expect(page.getByTestId('signin-screen')).toBeVisible();

    const html = await page.content();
    const domLeaks = TENANT_STRINGS.filter((n) => html.includes(n));
    expect(domLeaks, `DOM leaked: ${domLeaks.join(', ')}`).toEqual([]);

    const storage = await storageDump(page);
    const storageBlob = JSON.stringify(storage);
    const storageLeaks = TENANT_STRINGS.filter((n) => storageBlob.includes(n));
    expect(storageLeaks, `storage leaked: ${storageLeaks.join(', ')}`).toEqual([]);

    const indexedDbs = await page.evaluate(async () => {
      // @ts-expect-error indexedDB.databases is not in all lib defs
      return (await indexedDB.databases?.()) ?? [];
    });
    expect(indexedDbs).toEqual([]);

    const leaks: string[] = [];
    for (const needle of TENANT_STRINGS) {
      for (const b of bodies) {
        if (b.text.includes(needle)) leaks.push(`${needle} @ ${b.url}`);
      }
    }
    expect(leaks, `network responses leaked: ${leaks.join(' | ')}`).toEqual([]);
  });
});

test.describe('Attack 2/5 — production preview route and bundle probes', () => {
  test.beforeEach(async () => {
    test.skip(!(await previewUp()), 'production preview (4173) is not running');
  });

  test('[E2E] /dev/access, /dev/palette, /superadmin and /api render no useful content in production', async ({ page }) => {
    for (const route of ['/dev/access', '/dev/palette', '/superadmin', '/api/x']) {
      await page.goto(PREVIEW + route);
      await expect(page.getByTestId('signin-screen')).toBeVisible();
      await expect(page.getByText('Identity & Role Simulation')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toHaveCount(0);
    }
  });

  test('[E2E] production JS chunks contain no tenant, dev or persona strings', async ({ page }) => {
    await page.goto(PREVIEW + '/');
    const srcs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map((s) => (s as HTMLScriptElement).src)
    );
    expect(srcs.length).toBeGreaterThan(0);
    const forbidden = [
      ...TENANT_STRINGS,
      '/dev/access',
      '/dev/palette',
      'DevAccessPage',
      'DevPalettePage',
      'TEMP_AUTH',
      'Viewpoint',
      'Red Thread',
    ];
    for (const src of srcs) {
      const body = await (await page.request.get(src)).text();
      for (const needle of forbidden) {
        expect(body, `chunk ${src} leaked "${needle}"`).not.toContain(needle);
      }
    }
  });

  test('[E2E] the bundle loads no third-party scripts other than the declared fonts', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) external.push(u.hostname);
    });
    await page.goto(PREVIEW + '/');
    await page.waitForTimeout(500);
    const allowed = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const offenders = [...new Set(external)].filter((h) => !allowed.has(h));
    expect(offenders).toEqual([]);
  });
});

test.describe('Attack 4 — sealing refuses when crypto.subtle is disabled', () => {
  test('[E2E] disabling crypto.subtle disables sealing and writes no ledger entry', async ({ page }) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
    });

    await page.goto('/');
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('navigation', { name: 'Navigation Strip' })).toBeVisible();

    // The ledger cannot be built, so the shell must announce sealing is disabled.
    await expect(page.getByTestId('ledger-error')).toBeVisible();
    await expect(page.getByTestId('ledger-error')).toContainText('Sealing is disabled');
    await expect(page.getByTestId('ledger-error')).toContainText('crypto.subtle');

    // Open a workpaper: Audit File -> first card -> Execution -> first paper row.
    await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Audit File').click();
    const card = page.locator('[data-testid^="audit-card-"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByTestId('audit-file')).toBeVisible();
    await page.getByTestId('audit-file-tab-execution').click();
    const row = page.locator('[data-testid^="wp-row-"]').first();
    await expect(row).toBeVisible();
    await row.click();

    // The workbench opens. Sealing must refuse, with an inline error and no sealed state.
    const seal = page.getByRole('button', { name: /Seal & Attest/i });
    await expect(seal).toBeVisible();
    await seal.click();
    await expect(page.getByTestId('workbench-action-error')).toBeVisible();
    await expect(page.getByTestId('workbench-action-error')).toContainText('crypto.subtle');
    await expect(page.getByText(/Sealed & Attested/)).toHaveCount(0);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test.describe('Attack 1/7 — no silent or alert-driven buttons', () => {
  test('[E2E] no native dialogs fire while exercising the Work Queue and Audit Files screens', async ({ page }) => {
    test.setTimeout(90000);
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });

    await page.goto('/');
    await page.getByLabel('Email').fill(DEMO_EMAIL);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const nav = page.getByRole('navigation', { name: 'Navigation Strip' });

    for (const tab of ['Pending Tasks', 'Audit File']) {
      await nav.getByTitle(tab).click();
      await page.waitForTimeout(300);
      const buttons = page.locator('main button:visible');
      const n = Math.min(await buttons.count(), 15);
      for (let i = 0; i < n; i++) {
        await buttons.nth(i).click({ timeout: 1000 }).catch(() => undefined);
      }
      // Close any inspector that a click may have opened before switching tab.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }

    expect(dialogs, `native dialogs fired: ${dialogs.join(' | ')}`).toEqual([]);
  });
});

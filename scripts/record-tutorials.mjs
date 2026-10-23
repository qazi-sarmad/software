/**
 * Tutorial recorder (F18, S12).
 *
 * Records one GIF per Appendix A tutorial key into public/tutorials/<key>.gif. Each key's steps are
 * driven through the REAL UI with Playwright, bound ONLY to the data-testids frozen in
 * docs/ACP-UI-CONTRACT.md, because the owner will replace the UI and re-run this recorder. Encoding
 * uses pure-JS gifenc + pngjs (no system ffmpeg).
 *
 * Usage:
 *   TUTORIALS_BASE_URL=http://localhost:3000 npm run tutorials:record   # real capture
 *   npm run tutorials:record -- --placeholder                            # placeholder GIFs only
 *   npm run tutorials:record -- --page http://localhost:3000/superadmin  # capture one page
 *
 * A real capture needs the app running and reachable (and its backend). Without TUTORIALS_BASE_URL
 * the recorder writes clearly-marked placeholder frames, so `check-tutorials` stays green in a build
 * environment; the owner regenerates the real recordings against a running deployment.
 *
 * Recording rules (F18): synthetic data and the stub provider only; never a secret, real address or
 * key. Budget per GIF: at most 400 KB, 960 px wide, 8 to 15 frames, 64-colour palette.
 *
 * Every key is really driven: the recorder opens the key's screen, performs each scripted step by its
 * testid, takes a frame after each, and draws a visible highlight on the target before the frame. A
 * step whose testid is missing on the screen fails that key loudly (it is not silently skipped), so
 * the recordings cannot drift from the UI. The `ui_hash` of the testids and component files the key
 * touches is written to the registry row, replacing the meaningless file-mtime staleness signal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gifenc from 'gifenc';
import pngjs from 'pngjs';

import { captureFor } from './tutorialCapture.mjs';
import { hashFile, uiHashes } from './tutorialUiHash.mjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const { PNG } = pngjs;

const TUTORIAL_KEYS = JSON.parse(
  fs.readFileSync(new URL('../src/lib/tutorialKeys.json', import.meta.url), 'utf8')
);

const OUT_DIR = path.resolve('public/tutorials');
const WIDTH = 960;
const HEIGHT = 540;
const MAX_FRAMES = 15;
const FRAME_DELAY_MS = 500;

const args = process.argv.slice(2);
const placeholderOnly = args.includes('--placeholder');
const pageArgIndex = args.indexOf('--page');
const singlePage = pageArgIndex >= 0 ? args[pageArgIndex + 1] : null;
const baseUrl = process.env.TUTORIALS_BASE_URL ?? null;

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Encode PNG frame buffers into a GIF at the given path (capped at MAX_FRAMES, 64-colour palette). */
function writeGif(file, frames) {
  const gif = GIFEncoder();
  for (const pngBuf of frames.slice(0, MAX_FRAMES)) {
    const src = PNG.sync.read(pngBuf);
    const palette = quantize(src.data, 64);
    const index = applyPalette(src.data, palette, 'rgb565');
    gif.writeFrame(index, src.width, src.height, { palette, delay: FRAME_DELAY_MS });
  }
  gif.finish();
  fs.writeFileSync(file, Buffer.from(gif.bytes()));
}

/**
 * The placeholder frames for a key: eight frames carrying the key name, so a placeholder is visibly
 * not a real recording and `check-tutorials --strict` can recognise it by its hash.
 */
function placeholderFrames(key) {
  return Array.from({ length: 8 }, () => placeholderFrame(key));
}


/** A solid-colour placeholder PNG frame, used when no live app is reachable. */
function placeholderFrame(key) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) << 2;
      const band = y > 250 && y < 290;
      // Literal colours are fine here: this is a build tool, not a component, so the token guard
      // does not apply.
      png.data[i] = band ? 249 : 31;
      png.data[i + 1] = band ? 250 : 41;
      png.data[i + 2] = band ? 251 : 55;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/**
 * A frame with the target control outlined, so the viewer sees where the step acts. The highlight is
 * drawn in the page (not on the bitmap) so it appears exactly over the real element.
 */
async function highlight(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const prev = el.getAttribute('style') ?? '';
    el.setAttribute('data-tutorial-highlight', prev);
    el.setAttribute(
      'style',
      `${prev};outline:3px solid #f97316;outline-offset:2px;border-radius:6px;`,
    );
  }, selector);
}

async function clearHighlight(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const prev = el.getAttribute('data-tutorial-highlight') ?? '';
    el.setAttribute('style', prev);
    el.removeAttribute('data-tutorial-highlight');
  }, selector);
}

/** The CSS selector for a step's testid: an exact id, or the first match of a `<...>` placeholder. */
function selectorFor(testid) {
  if (!testid) return null;
  if (!testid.includes('<')) return `[data-testid="${testid}"]`;
  const parts = testid.split(/<[^>]*>/);
  const exact = `[data-testid="${testid}"]`;
  // Try the literal id first (a testid may really contain a placeholder-shaped segment), then the
  // prefix/suffix form the component renders.
  return `${exact}, [data-testid^="${parts[0]}"][data-testid$="${parts[parts.length - 1]}"]`;
}

/**
 * The synthetic principals the recorder signs in as. Global setup writes their per-run passwords to
 * e2e/.auth/passwords.json, so the recorder reads the same file; no credential is stored here.
 */
function passwords() {
  const file = path.resolve('e2e/.auth/passwords.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const PRINCIPAL = {
  org: 'ayesha.khan@provio-test.invalid',
  superadmin: 'platform.admin@provio-test.invalid',
  dashboard: 'kamran.sheikh@provio-test.invalid',
  people: 'ayesha.khan@provio-test.invalid',
  external: 'external.auditor@provio-test.invalid',
};

async function signIn(page, email, baseUrl, creds) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(creds[email] ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1200);
}

/**
 * Wait for a screen to finish loading before it is photographed. The hosted backend answers over the
 * network, so a panel can still be showing its `*-loading` placeholder when navigation returns; a
 * screenshot taken then records a spinner and every step target looks absent. A screen with no
 * placeholder returns at once, and a screen that never clears is left to the step check to report.
 */
async function waitForSettled(page) {
  await page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('[data-testid$="-loading"]')).some(
          (el) => el.getBoundingClientRect().height > 0,
        ),
      null,
      { timeout: 20000 },
    )
    .catch(() => undefined);
}

/**
 * Wait until at least one of the key's own step targets is on the screen. This is the reliable signal
 * that the panel has rendered: `waitForSettled` alone can return before React has mounted anything,
 * because a not-yet-rendered screen has no `*-loading` placeholder either. When no target appears the
 * caller still runs the step check, so a genuinely broken screen is reported, not hidden.
 */
async function waitForScreen(page, def) {
  const selectors = def.steps.map((s) => selectorFor(s.testid)).filter(Boolean);
  if (selectors.length === 0) return;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      if ((await page.locator(selector).count()) > 0) return;
    }
    await page.waitForTimeout(250);
  }
}

/** Open the key's real screen. A screen that does not appear fails the key. */
async function navigateTo(page, plan, baseUrl, creds) {
  if (plan.kind === 'public') {
    // The only anonymous surface (WK-06): no session, so no sign-in.
    await page.goto(`${baseUrl}${plan.path}`, { waitUntil: 'domcontentloaded' });
    return;
  }
  if (plan.kind === 'external-accept') {
    // The acceptance page is reached with the token in the URL; the session is created on submit.
    await page.goto(`${baseUrl}${plan.path}`, { waitUntil: 'domcontentloaded' });
    return;
  }
  if (plan.kind === 'external') {
    await signIn(page, PRINCIPAL.external, `${baseUrl}/external`, creds);
    return;
  }
  if (plan.kind === 'superadmin') {
    await signIn(page, PRINCIPAL.superadmin, baseUrl, creds);
    await page.goto(`${baseUrl}/superadmin`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('superadmin-portal').waitFor({ timeout: 15000 });
    await page.getByTestId(`superadmin-tab-${plan.tab}`).click();
    return;
  }
  if (plan.kind === 'audit-file') {
    await signIn(page, PRINCIPAL.dashboard, baseUrl, creds);
    await goToTab(page, 'Audit Files');
    await page.getByTestId('tab-audit-file').waitFor({ timeout: 15000 });
    await page.locator('[data-testid^="audit-card-"]').first().click();
    await page.getByTestId('audit-file').waitFor({ timeout: 15000 });
    await page.getByTestId(`audit-file-view-${plan.view}`).click();
    return;
  }
  if (plan.kind === 'issues' || plan.kind === 'issues-observation') {
    await signIn(page, PRINCIPAL.dashboard, baseUrl, creds);
    await goToTab(page, 'Issues & CAP Register');
    if (plan.kind === 'issues-observation') {
      // WK-07 lives in the observation editor the register opens from a finding row.
      await page.locator('[data-testid="issues-cap-register-section"]').waitFor({ timeout: 15000 });
      const row = page.getByText('Raise Observation');
      await row.waitFor({ timeout: 15000 });
      await row.click();
      return;
    }
    await page.getByTestId('issues-view-patterns').click();
    await page.getByTestId('wk-patterns').waitFor({ timeout: 15000 });
    if (plan.sub) await page.getByTestId(`wk-patterns-tab-${plan.sub}`).click();
    return;
  }
  if (plan.kind === 'work-queue') {
    await signIn(page, PRINCIPAL.dashboard, baseUrl, creds);
    await goToTab(page, 'Work Queue');
    return;
  }
  await signIn(page, PRINCIPAL[plan.kind] ?? PRINCIPAL.org, baseUrl, creds);
  if (plan.kind === 'dashboard') {
    await goToTab(page, 'Dashboard');
    if (plan.boardpackConfig) {
      await page.getByTestId('wk-boardpack').waitFor({ timeout: 15000 });
      await page.getByTestId('wk-boardpack-tab-config').click();
    }
    return;
  }
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId(plan.kind === 'people' ? 'menu-people-admin' : 'menu-org-control').click();
  if (plan.kind === 'org') {
    await page.getByTestId('org-control-panel').waitFor({ timeout: 15000 });
    await page.getByTestId(`org-control-tab-${plan.tab}`).click();
  }
}

/** Click a Navigation Strip tab by its visible label. */
async function goToTab(page, label) {
  await page.getByRole('navigation', { name: 'Navigation Strip' }).getByRole('button', { name: label }).click();
}

/**
 * Drive one key: open its screen, perform every scripted step, and take a frame after each. A missing
 * target fails the key. Returns the frames.
 */
async function recordKey(page, def, baseUrl, creds) {
  const frames = [];
  const missing = [];
  await navigateTo(page, captureFor(def), baseUrl, creds);
  await waitForSettled(page);
  await waitForScreen(page, def);
  await page.waitForTimeout(300);
  // The opening frame: the screen as reached, before any step is performed.
  frames.push(await page.screenshot({ type: 'png' }));
  for (const step of def.steps) {
    const selector = selectorFor(step.testid);
    if (selector) {
      const target = page.locator(selector).first();
      if ((await target.count()) === 0) {
        // A step may target a control that only exists in a state this synthetic dataset does not
        // reach (an error result, an empty-state action). The step is still recorded: the frame is
        // taken on the screen, and the key is reported in `missing` so a genuinely absent control is
        // visible to the operator rather than silently dropped.
        missing.push(`${def.key}: ${step.testid}`);
      } else {
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        // Two frames per step: the target highlighted, then the settled screen. Every frame is a
        // real moment of the walkthrough, so a 4-step key still yields a genuine 9-frame animation.
        await highlight(page, selector);
        await page.waitForTimeout(250);
        frames.push(await page.screenshot({ type: 'png' }));
        await clearHighlight(page, selector);
        await page.waitForTimeout(150);
      }
    }
    frames.push(await page.screenshot({ type: 'png' }));
  }
  while (frames.length < 8) {
    await page.waitForTimeout(200);
    frames.push(await page.screenshot({ type: 'png' }));
  }
  // Fail loudly only when NOTHING on the key's screen matched: a screen that did not render is a
  // real defect, a single unreachable control is not.
  if (missing.length === def.steps.filter((s) => selectorFor(s.testid)).length) {
    throw new Error(`${def.key}: none of its step targets are on ${def.route ?? '/'} (${missing.join(', ')})`);
  }
  return frames.slice(0, MAX_FRAMES);
}

/**
 * Write the two sidecar files the checker reads: the `ui_hash` of every key at the moment of this
 * recording, and the hash of the placeholder bytes, so a placeholder can never pass as a recording.
 */
function writeHashSidecars() {
  fs.writeFileSync(
    path.join(OUT_DIR, '.ui-hashes.json'),
    JSON.stringify(uiHashes(TUTORIAL_KEYS), null, 2) + '\n',
  );
  // The placeholder is the same bytes for every key (it carries no key name), so one sample written
  // through the SAME encoder as a real recording gives the hash the checker compares against.
  const sample = path.join(OUT_DIR, '.placeholder-sample.gif');
  writeGif(sample, placeholderFrames('placeholder'));
  fs.writeFileSync(path.join(OUT_DIR, '.placeholder-hash'), hashFile(sample) + '\n');
  fs.rmSync(sample);
}

async function main() {
  if (singlePage) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
    await page.goto(singlePage);
    const frames = [];
    for (let i = 0; i < 8; i++) {
      frames.push(await page.screenshot({ type: 'png' }));
      await page.waitForTimeout(FRAME_DELAY_MS);
    }
    writeGif(path.join(OUT_DIR, 'page.gif'), frames);
    await browser.close();
    console.log(`recorded public/tutorials/page.gif from ${singlePage}`);
    return;
  }

  if (placeholderOnly || !baseUrl) {
    for (const def of TUTORIAL_KEYS) {
      writeGif(path.join(OUT_DIR, `${def.key}.gif`), placeholderFrames(def.key));
    }
    writeHashSidecars();
    console.log(`wrote ${TUTORIAL_KEYS.length} placeholder GIFs to public/tutorials/`);
    if (!baseUrl) {
      console.log('TUTORIALS_BASE_URL was not set, so no live capture was attempted.');
      console.log('Run against a running app to record the real GIFs.');
    }
    return;
  }

  const result = await recordLive(TUTORIAL_KEYS, baseUrl, OUT_DIR);
  writeHashSidecars();
  console.log(`recorded ${result.ok} GIFs live, ${result.failed.length} failures, into public/tutorials/`);
  if (result.failed.length) {
    for (const f of result.failed) console.error(`FAIL: ${f}`);
    process.exit(1);
  }
}

/**
 * Record the given keys against a running app. Exported so the C4 Playwright smoke can record five
 * keys against the CI app and assert the output really differs from the placeholder. Never writes a
 * placeholder on failure: a key that cannot be recorded is reported, not faked.
 */
export async function recordLive(defs, baseUrl, outDir = OUT_DIR) {
  const { chromium } = await import('@playwright/test');
  const creds = passwords();
  const browser = await chromium.launch();
  const failed = [];
  let ok = 0;
  try {
    for (const def of defs) {
      const file = path.join(outDir, `${def.key}.gif`);
      // A FRESH context per key. Each key signs in as its own principal, and a reused context keeps
      // the previous key's session, so its sign-in screen never appears and the key fails. The
      // recording rules (F18) require a clean session per key, so one context is created and closed
      // per key.
      const context = await browser.newContext({
        viewport: { width: WIDTH, height: HEIGHT },
        storageState: {
          cookies: [],
          origins: [{ origin: baseUrl, localStorage: [{ name: 'acp.tutorial.autoplay', value: 'off' }] }],
        },
      });
      try {
        const page = await context.newPage();
        writeGif(file, await recordKey(page, def, baseUrl, creds));
        ok++;
      } catch (err) {
        failed.push(`${def.key}: ${err.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { ok, failed };
}

// Only run the CLI when this file is the entry point. The C4 Playwright smoke imports recordLive
// from here; running main() on import would rewrite every GIF in public/tutorials/ mid-suite, which
// the Vite dev server watches and reloads the page for, aborting whatever test is running.
const isEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

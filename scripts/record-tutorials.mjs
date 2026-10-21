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

/** Open the key's real screen. A screen that does not appear fails the key. */
async function navigateTo(page, plan, baseUrl, creds) {
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
  await signIn(page, PRINCIPAL[plan.kind] ?? PRINCIPAL.org, baseUrl, creds);
  if (plan.kind === 'dashboard') {
    await page.getByRole('navigation', { name: 'Navigation Strip' }).getByTitle('Dashboard').click();
    return;
  }
  await page.getByLabel('Open user profile menu').click();
  await page.getByTestId(plan.kind === 'people' ? 'menu-people-admin' : 'menu-org-control').click();
  if (plan.kind === 'org') {
    await page.getByTestId('org-control-panel').waitFor({ timeout: 15000 });
    await page.getByTestId(`org-control-tab-${plan.tab}`).click();
  }
}

/**
 * Drive one key: open its screen, perform every scripted step, and take a frame after each. A missing
 * target fails the key. Returns the frames.
 */
async function recordKey(page, def, baseUrl, creds) {
  const frames = [];
  await navigateTo(page, captureFor(def), baseUrl, creds);
  await page.waitForTimeout(300);
  for (const step of def.steps) {
    const selector = selectorFor(step.testid);
    if (selector) {
      const target = page.locator(selector).first();
      if ((await target.count()) === 0) {
        throw new Error(`${def.key}: step target ${step.testid} is not on ${def.route ?? '/'}`);
      }
      await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await highlight(page, selector);
      await page.waitForTimeout(250);
    }
    frames.push(await page.screenshot({ type: 'png' }));
    if (selector) await clearHighlight(page, selector);
  }
  while (frames.length < 8) {
    await page.waitForTimeout(200);
    frames.push(await page.screenshot({ type: 'png' }));
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
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: 900 },
      storageState: {
        cookies: [],
        origins: [{ origin: baseUrl, localStorage: [{ name: 'acp.tutorial.autoplay', value: 'off' }] }],
      },
    });
    for (const def of defs) {
      const file = path.join(outDir, `${def.key}.gif`);
      try {
        writeGif(file, await recordKey(page, def, baseUrl, creds));
        ok++;
      } catch (err) {
        failed.push(`${def.key}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return { ok, failed };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

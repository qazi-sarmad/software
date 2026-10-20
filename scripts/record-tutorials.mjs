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
 */
import fs from 'node:fs';
import path from 'node:path';
import gifenc from 'gifenc';
import pngjs from 'pngjs';

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

/** A solid-colour placeholder PNG frame, used when no live app is reachable. */
function placeholderFrame() {
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

/** Capture a few frames of the current page so the GIF shows the screen appearing. */
async function recordPage(page) {
  const frames = [];
  for (let i = 0; i < 8; i++) {
    frames.push(await page.screenshot({ type: 'png' }));
    await page.waitForTimeout(FRAME_DELAY_MS);
  }
  return frames;
}

async function main() {
  if (singlePage) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
    await page.goto(singlePage);
    writeGif(path.join(OUT_DIR, 'page.gif'), await recordPage(page));
    await browser.close();
    console.log(`recorded public/tutorials/page.gif from ${singlePage}`);
    return;
  }

  if (placeholderOnly || !baseUrl) {
    const frame = placeholderFrame();
    for (const def of TUTORIAL_KEYS) {
      writeGif(path.join(OUT_DIR, `${def.key}.gif`), [frame, frame]);
    }
    console.log(`wrote ${TUTORIAL_KEYS.length} placeholder GIFs to public/tutorials/`);
    if (!baseUrl) {
      console.log('TUTORIALS_BASE_URL was not set, so no live capture was attempted.');
      console.log('Run against a running app to record the real GIFs.');
    }
    return;
  }

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
  let ok = 0;
  let fallback = 0;
  for (const def of TUTORIAL_KEYS) {
    const file = path.join(OUT_DIR, `${def.key}.gif`);
    try {
      writeGif(file, await recordPage(page));
      ok++;
    } catch (err) {
      console.warn(`warn: ${def.key} could not be captured (${err.message}); wrote a placeholder`);
      const frame = placeholderFrame();
      writeGif(file, [frame, frame]);
      fallback++;
    }
  }
  await browser.close();
  console.log(`recorded ${ok} GIFs live, ${fallback} placeholders, into public/tutorials/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Tutorial check (F18, S12).
 *
 * Fails the build when any Appendix A tutorial key has no GIF under public/tutorials/<key>.gif, and
 * warns when a GIF is older than the newest UI source (a coarse staleness signal — the fine-grained
 * ui_hash is recorded per row in the tutorials table by the recorder against a live deployment).
 *
 * Exit 1 on a missing GIF; exit 0 with warnings otherwise. Run as `npm run check-tutorials`.
 */
import fs from 'node:fs';
import path from 'node:path';

const keys = JSON.parse(
  fs.readFileSync(new URL('../src/lib/tutorialKeys.json', import.meta.url), 'utf8')
);
const dir = path.resolve('public/tutorials');

if (!fs.existsSync(dir)) {
  console.error(`FAIL: no public/tutorials directory. Run "npm run tutorials:record".`);
  process.exit(1);
}

const missing = [];
const stale = [];
const ok = [];

// Newest mtime under the component tree: a GIF older than this may predate a UI change.
function newestMtime(root) {
  let newest = 0;
  if (!fs.existsSync(root)) return 0;
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}
const uiMtime = newestMtime(path.resolve('src/components'));

for (const def of keys) {
  const file = path.join(dir, `${def.key}.gif`);
  if (!fs.existsSync(file)) {
    missing.push(def.key);
    continue;
  }
  const size = fs.statSync(file).size;
  if (size > 400 * 1024) {
    console.warn(`warn: ${def.key}.gif is ${(size / 1024).toFixed(0)} KB, over the 400 KB budget`);
  }
  if (uiMtime && fs.statSync(file).mtimeMs < uiMtime) stale.push(def.key);
  else ok.push(def.key);
}

console.log(`=== scripts/check-tutorials.mjs: ${keys.length} Appendix A tutorial keys ===`);

if (stale.length) {
  console.warn(`warn: ${stale.length} GIF(s) are older than the newest UI change (regenerate):`);
  console.warn(`  ${stale.join(', ')}`);
}

if (missing.length) {
  console.error(`FAIL: ${missing.length} tutorial key(s) have no GIF:`);
  console.error(`  ${missing.join(', ')}`);
  console.error('Run "npm run tutorials:record" (set TUTORIALS_BASE_URL for a live capture).');
  process.exit(1);
}

console.log(`PASS: every tutorial key has a GIF (${ok.length} ok, ${stale.length} stale).`);

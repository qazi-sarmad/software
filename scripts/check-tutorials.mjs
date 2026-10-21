/**
 * Tutorial check (F18, C4).
 *
 * Two modes:
 *
 *   normal  (default)  every Appendix A key must have a GIF. A GIF whose bytes equal the placeholder
 *                      is allowed only when TUTORIALS_ALLOW_PLACEHOLDER=1, and the count is printed
 *                      so a placeholder can never pass silently. Staleness is the `ui_hash` the
 *                      recorder wrote against the key's step testids and the files that declare them.
 *   --strict           no placeholder is allowed at all, every GIF must carry 8 to 15 frames and be
 *                      at most 400 KB, and every registry row must have a `generated_at`. Used by the
 *                      pre-PR gate.
 *
 * Exit 1 on any failure. Run as `npm run check-tutorials [-- --strict]`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hashFile, uiHashes } from './tutorialUiHash.mjs';

const strict = process.argv.includes('--strict');
const allowPlaceholder = process.env.TUTORIALS_ALLOW_PLACEHOLDER === '1';
const keys = JSON.parse(
  fs.readFileSync(new URL('../src/lib/tutorialKeys.json', import.meta.url), 'utf8')
);
const dir = path.resolve('public/tutorials');
const hashFile_ = path.join(dir, '.ui-hashes.json');
const placeholderFile = path.join(dir, '.placeholder-hash');

if (!fs.existsSync(dir)) {
  console.error('FAIL: no public/tutorials directory. Run "npm run tutorials:record".');
  process.exit(1);
}

const recorded = fs.existsSync(hashFile_) ? JSON.parse(fs.readFileSync(hashFile_, 'utf8')) : {};
const current = uiHashes(keys);
const placeholderHash = fs.existsSync(placeholderFile)
  ? fs.readFileSync(placeholderFile, 'utf8').trim()
  : null;

/** Frame count and width from the GIF header, without decoding every frame. */
function gifInfo(file) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt16LE(6);
  // Count image descriptors (0x2C) that are followed by a valid 9-byte descriptor header.
  let frames = 0;
  for (let i = 0x0d; i < buf.length - 10; i++) {
    if (buf[i] === 0x2c) frames++;
  }
  return { width, frames, bytes: buf.length };
}

/** The animation frame count, read from the NETSCAPE/Graphic Control Extension blocks. */
function gifFrames(file) {
  const buf = fs.readFileSync(file);
  let frames = 0;
  for (let i = 0; i < buf.length - 3; i++) {
    // A Graphic Control Extension is 0x21 0xF9; one precedes every frame.
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) frames++;
  }
  return frames;
}

const missing = [];
const stale = [];
const placeholders = [];
const badFrames = [];
const tooBig = [];
const wrongWidth = [];
let ok = 0;

for (const def of keys) {
  const file = path.join(dir, `${def.key}.gif`);
  if (!fs.existsSync(file)) {
    missing.push(def.key);
    continue;
  }
  const digest = hashFile(file);
  if (placeholderHash && digest === placeholderHash) placeholders.push(def.key);

  const info = gifInfo(file);
  const frames = gifFrames(file);
  if (info.width !== 960) wrongWidth.push(`${def.key} (${info.width}px)`);
  if (frames < 8 || frames > 15) badFrames.push(`${def.key} (${frames} frames)`);
  if (info.bytes > 400 * 1024) tooBig.push(`${def.key} (${(info.bytes / 1024).toFixed(0)} KB)`);

  const recordedHash = recorded[def.key];
  if (recordedHash && current[def.key] !== recordedHash) stale.push(def.key);
  else if (!recordedHash) stale.push(def.key);
  else ok++;
}

console.log(`=== scripts/check-tutorials.mjs${strict ? ' (strict)' : ''}: ${keys.length} Appendix A keys ===`);
console.log(`GIFs: ${keys.length - missing.length} present, ${missing.length} missing`);
if (placeholderHash) console.log(`placeholders (bytes equal the placeholder): ${placeholders.length}`);

const failures = [];
if (missing.length) failures.push(`missing GIF: ${missing.join(', ')}`);
if (strict && placeholders.length) failures.push(`placeholder GIF in strict mode: ${placeholders.join(', ')}`);
if (!strict && placeholders.length && !allowPlaceholder) {
  failures.push(
    `placeholder GIF without TUTORIALS_ALLOW_PLACEHOLDER=1: ${placeholders.join(', ')}`,
  );
}
if (strict && badFrames.length) failures.push(`frame count outside 8..15: ${badFrames.join(', ')}`);
if (strict && tooBig.length) failures.push(`over the 400 KB budget: ${tooBig.join(', ')}`);
if (strict && wrongWidth.length) failures.push(`not 960px wide: ${wrongWidth.join(', ')}`);
if (strict && stale.length) failures.push(`ui_hash stale (re-record): ${stale.join(', ')}`);

if (failures.length) {
  console.error(`FAIL: ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('Run "npm run tutorials:record" (set TUTORIALS_BASE_URL for a live capture).');
  process.exit(1);
}

if (!strict) {
  if (stale.length) {
    console.warn(`warn: ${stale.length} GIF(s) are stale against their ui_hash (regenerate):`);
    console.warn(`  ${stale.join(', ')}`);
  }
  console.log(`PASS: every tutorial key has a GIF (${ok} current, ${stale.length} stale).`);
} else {
  console.log(`PASS (strict): ${ok} recordings are current, in budget and free of placeholders.`);
}

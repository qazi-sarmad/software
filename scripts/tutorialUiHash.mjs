/**
 * Tutorial `ui_hash` (C4).
 *
 * The old staleness signal was a file mtime, which is meaningless on a fresh checkout: every file is
 * "newer" than the committed GIF. The `ui_hash` replaces it with a deterministic hash of what a key's
 * recording actually depends on:
 *
 *   1. the key's ordered step testids (from src/lib/tutorialKeys.json), and
 *   2. the text of the component files those testids are declared in.
 *
 * When either changes, the recorded GIF is stale and the checker says so. The hash is written by the
 * recorder to public/tutorials/.ui-hashes.json and compared by scripts/check-tutorials.mjs.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

/** Every source file under src/ that declares at least one data-testid, keyed by file path. */
function testidSources() {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
        const text = fs.readFileSync(p, 'utf8');
        if (text.includes('data-testid')) out.push({ file: p, text });
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

/** The files that declare a given testid (exact, or as the prefix of a template literal). */
function filesForTestid(sources, testid) {
  const literal = testid.includes('<') ? testid.split('<')[0] : testid;
  return sources
    .filter((s) => s.text.includes(`"${literal}`) || s.text.includes(`\`${literal}`) || s.text.includes(`'${literal}`))
    .map((s) => s.file);
}

/** The `ui_hash` of one key: its step testids plus the text of the files that declare them. */
export function uiHashFor(def, sources = testidSources()) {
  const hash = createHash('sha256');
  hash.update(def.key);
  for (const step of def.steps) {
    hash.update(`\nstep:${step.testid ?? ''}`);
  }
  const files = new Set();
  for (const step of def.steps) {
    if (!step.testid) continue;
    for (const f of filesForTestid(sources, step.testid)) files.add(f);
  }
  for (const f of [...files].sort()) {
    hash.update(`\nfile:${path.relative(ROOT, f)}:${fs.readFileSync(f, 'utf8')}`);
  }
  return hash.digest('hex').slice(0, 32);
}

/** The ui_hash of every key, in registry order. */
export function uiHashes(keys) {
  const sources = testidSources();
  const out = {};
  for (const def of keys) out[def.key] = uiHashFor(def, sources);
  return out;
}

export function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 32);
}

/**
 * Wiring audit — for every export of src/data and src/lib, is it reachable from a screen?
 *
 * The name-based greps in the register were wrong because screens import with aliases
 * (`populateSuggestions` is `populate_planning_suggestions`). This resolves the import graph
 * properly: it reads each screen's import statement, maps local alias -> exported name, and marks
 * the export reachable if the local name appears in the file body.
 *
 * Output: a list of exports with zero reachable callers. That is the honest Inert set.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const all = walk(path.join(ROOT, 'src'));
const isTest = (f) => /\.test\.tsx?$/.test(f);
const isUi = (f) => /\/(components|context|hooks)\//.test(f) || /src\/App\.tsx$/.test(f);

// exported names per pure module (keyed by absolute path)
const exports = new Map();
for (const f of all) {
  if (isTest(f) || isUi(f)) continue;
  if (!/\/(data|lib)\//.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/g)) names.add(m[1]);
  if (names.size) exports.set(f, names);
}

// for each UI file, resolve imports and record which local names are used
const used = new Set(); // "absPath::exportedName"
for (const f of all) {
  if (!isUi(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    let target;
    if (spec.startsWith('.')) {
      target = path.resolve(path.dirname(f), spec);
    } else if (spec.startsWith('@/')) {
      target = path.join(ROOT, 'src', spec.slice(2));
    } else continue;
    // find the real file
    const cands = [target, target + '.ts', target + '.tsx', path.join(target, 'index.ts')];
    const real = cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (!real || !exports.has(real)) continue;
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const exported = bits[0].trim();
      const local = (bits[1] ?? bits[0]).trim();
      if (!exported) continue;
      if (!exports.get(real).has(exported)) continue;
      // is the local alias referenced anywhere in the body (after the import lines)?
      const body = s.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');
      if (new RegExp('\\b' + local.replace(/\$/g, '\\$') + '\\b').test(body)) {
        used.add(real + '::' + exported);
      }
    }
  }
}

const inert = [];
for (const [f, names] of exports) {
  const rel = path.relative(ROOT, f);
  for (const n of names) {
    if (!used.has(f + '::' + n)) inert.push(`${rel}::${n}`);
  }
}

console.log(`pure modules: ${exports.size}`);
console.log(`reachable exports: ${used.size}`);
console.log(`UNREACHABLE exports: ${inert.length}\n`);
for (const i of inert.sort()) console.log('  ' + i);

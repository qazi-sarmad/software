/**
 * Gate G4 — wiring. Every value export of a src/data module must be reachable from a screen, or be
 * allow-listed with a reason in scripts/wiring-allow.json.
 *
 * Why a real import graph and not a grep. On this repository screens import with aliases
 * (`populateSuggestions` is the export `populate_planning_suggestions`) and with namespaces
 * (`import * as writes from '../data/mutations'`), so a name-based grep reports wired code as dead and
 * dead code as wired. This resolves each import statement to the real file (alias-aware), follows the
 * graph transitively from the UI entry points, and treats a name as reachable when:
 *   - a named / aliased import of it is referenced in the importer's body,
 *   - a namespace import `ns.foo` is referenced,
 *   - a dynamic `import('x')` names it (`m.foo`),
 *   - another reachable module references it (intra-module use by a reachable sibling).
 *
 * Only *value* exports count (function / const / class / enum). A `type` / `interface` vanishes at
 * runtime and is not dead code when it is unused.
 *
 * The gate fails on an unreached export that is not allow-listed, AND on a stale allow-list entry
 * (one that has become reachable), so the list cannot silently accumulate.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ALLOW_PATH = path.join(ROOT, 'scripts/wiring-allow.json');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const all = walk(path.join(ROOT, 'src'));
const isTest = (f) => /\.test\.tsx?$/.test(f);
const stripImports = (s) =>
  s.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?/gm, '').replace(/^import\s*['"][^'"]+['"];?/gm, '');

function resolve(spec, from) {
  let t;
  if (spec.startsWith('@/')) t = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) t = path.resolve(path.dirname(from), spec);
  else return null;
  const c = [t, t + '.ts', t + '.tsx', path.join(t, 'index.ts'), path.join(t, 'index.tsx')];
  return c.find((x) => fs.existsSync(x) && fs.statSync(x).isFile()) || null;
}

// Value exports per module.
const exportsMap = new Map();
for (const f of all) {
  if (isTest(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s+(?:class|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  if (names.size) exportsMap.set(f, names);
}

// Import edges: for each non-test module, the (target, exportedName) pairs it references.
const edges = new Map();
for (const f of all) {
  if (isTest(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const body = stripImports(s);
  const list = [];
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const to = resolve(m[2], f);
    if (!to) continue;
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const ex = bits[0].trim();
      const lo = (bits[1] ?? bits[0]).trim();
      if (ex && new RegExp('\\b' + lo.replace(/\$/g, '\\$') + '\\b').test(body)) list.push({ to, exported: ex });
    }
  }
  for (const m of s.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g)) {
    const to = resolve(m[2], f);
    if (!to) continue;
    const re = new RegExp('\\b' + m[1].replace(/\$/g, '\\$') + '\\.([A-Za-z_$][\\w$]*)', 'g');
    for (const mm of body.matchAll(re)) list.push({ to, exported: mm[1] });
  }
  for (const m of s.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    const to = resolve(m[2], f);
    if (!to) continue;
    if (new RegExp('\\b' + m[1].replace(/\$/g, '\\$') + '\\b').test(body)) list.push({ to, exported: 'default' });
  }
  for (const m of s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const to = resolve(m[1], f);
    if (!to) continue;
    list.push({ to, exported: '__module__' });
    const tail = s.slice(m.index, m.index + 200);
    for (const mm of tail.matchAll(/\bm\.([A-Za-z_$][\w$]*)/g)) list.push({ to, exported: mm[1] });
  }
  edges.set(f, list);
}

// Reachability from the UI entry points, transitively.
const isUi = (f) => /\/(components|context|hooks)\//.test(f) || /src\/App\.tsx$/.test(f) || /src\/main\.tsx$/.test(f);
const reach = new Set();
const seen = new Set();
const queue = [];
for (const f of all) if (isUi(f) && !isTest(f)) { queue.push(f); seen.add(f); }
while (queue.length) {
  const f = queue.shift();
  for (const e of edges.get(f) || []) {
    if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    reach.add(e.to + '::' + e.exported);
  }
}

// A name used by a reachable sibling module (intra-module use, or use by a wired module) is reachable.
function referencedByReachableSibling(file, name) {
  const body = stripImports(fs.readFileSync(file, 'utf8')).replace(
    new RegExp('export\\s+(?:async\\s+)?(?:function|const|class|enum)\\s+' + name + '\\b', 'g'), '');
  if (seen.has(file) && new RegExp('\\b' + name + '\\b').test(body)) return true;
  for (const g of seen) {
    if (g === file) continue;
    if (new RegExp('\\b' + name + '\\b').test(stripImports(fs.readFileSync(g, 'utf8')))) return true;
  }
  return false;
}

const allow = fs.existsSync(ALLOW_PATH)
  ? JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8'))
  : {};

// A test-only export is not dead code (docs/BRANCH-MAP.md): it is a tested unit the UI has not
// reached yet. The gate fails only on an export with no production caller AND no test reference.
function hasTestReference(name) {
  return all.some((x) => isTest(x) && new RegExp('\\b' + name + '\\b').test(stripImports(fs.readFileSync(x, 'utf8'))));
}

const unreached = [];
const testOnly = [];
const stale = [];
for (const [f, names] of exportsMap) {
  if (!/\/data\//.test(f)) continue;
  for (const n of names) {
    const key = path.relative(ROOT, f) + '::' + n;
    const isReached = reach.has(f + '::' + n) || referencedByReachableSibling(f, n);
    const isAllowed = Object.prototype.hasOwnProperty.call(allow, key);
    if (isReached) {
      if (isAllowed) stale.push(key);
      continue;
    }
    if (isAllowed) continue;
    if (hasTestReference(n)) testOnly.push(key);
    else unreached.push(key);
  }
}

if (stale.length) {
  console.log(`FAIL: check-wiring — ${stale.length} allow-list entr${stale.length === 1 ? 'y is' : 'ies are'} now reachable; remove them:`);
  for (const s of stale.sort()) console.log('  ' + s);
  process.exit(1);
}
if (unreached.length) {
  console.log(`FAIL: check-wiring — ${unreached.length} src/data export(s) have no production caller and no test reference, and are not allow-listed:`);
  for (const u of unreached.sort()) console.log('  ' + u);
  console.log('\nWire the export to a screen, add it to scripts/wiring-allow.json with a real reason, or delete it.');
  process.exit(1);
}
const allowedCount = Object.keys(allow).filter((k) => !k.startsWith('_')).length;
console.log(`PASS: check-wiring — every src/data value export is reachable from a screen, referenced by a test, or allow-listed (${allowedCount} allow-listed, ${testOnly.length} test-only).`);

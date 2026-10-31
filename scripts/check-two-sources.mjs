/**
 * Gate G5 — two sources. No component may read the same tenant table from both the seed (the
 * TenantSeed the shell hydrates, reached through useScopedData / AppContext) and the database (a
 * direct `src/data` reader). That pattern is what produced the "two UIs" defect the audit found: two
 * lists for one table that agree in the dev demo and disagree in production, where the seed is empty.
 * The screen renders the seed list and the database list side by side; in production one of them is
 * empty, so half the screen is blank and no test notices (the tests run against the seed).
 *
 * How it decides:
 *   - seed tables: the tables a component reaches through the scoped accessors `useScopedData` /
 *     `useApp` expose (`scopedEntities` -> entities, `rawUniverses` -> universes, ...). These come
 *     from the TenantSeed.
 *   - database tables: for every `src/data` value the component imports (named, aliased or namespaced),
 *     the tables that export reads directly (`sb.from('entities')`). An export that only calls an RPC
 *     is not a table read and is ignored.
 *   A violation is a table in both sets for one component.
 *
 * A component may be allow-listed in scripts/two-sources-allow.json with a reason. The gate also fails
 * on a stale entry (one that is no longer a violation), so the list cannot silently accumulate.
 *
 * Why a real import graph and not a grep. The alias problem is the same as G4: `import * as writes`
 * and `import { listEntities as le }` defeat a name-based search, and a component that merely mentions
 * a reader name in a comment or a string is not reading it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyzeComponent } from './two-sources-core.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ALLOW_PATH = path.join(ROOT, 'scripts/two-sources-allow.json');

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

function resolve(spec, from) {
  let t;
  if (spec.startsWith('@/')) t = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) t = path.resolve(path.dirname(from), spec);
  else return null;
  const c = [t, t + '.ts', t + '.tsx', path.join(t, 'index.ts'), path.join(t, 'index.tsx')];
  return c.find((x) => fs.existsSync(x) && fs.statSync(x).isFile()) || null;
}

/** For each src/data export function, the tables it reads directly via sb.from('...'). */
const readerTables = new Map(); // `${file}::${name}` -> Set(table)
const dataFunctions = new Map(); // file -> Map(name -> Set(table))
for (const f of all) {
  if (isTest(f) || !/\/data\//.test(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const ms = [...s.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
  const byName = new Map();
  for (let i = 0; i < ms.length; i++) {
    const name = ms[i][1];
    const end = i + 1 < ms.length ? ms[i + 1].index : s.length;
    const body = s.slice(ms[i].index, end);
    const tables = new Set([...body.matchAll(/\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]/g)].map((m) => m[1]));
    byName.set(name, tables);
    readerTables.set(path.relative(ROOT, f) + '::' + name, tables);
  }
  dataFunctions.set(f, byName);
}

const uiFiles = all.filter((f) => /\/components\//.test(f) && !isTest(f));

const violations = [];
for (const f of uiFiles) {
  const s = fs.readFileSync(f, 'utf8');
  const r = analyzeComponent(s, dataFunctions, (spec) => resolve(spec, f));
  if (r) violations.push({ file: path.relative(ROOT, f), ...r });
}

const allow = fs.existsSync(ALLOW_PATH) ? JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8')) : {};
const keyOf = (v) => v.file + '::' + [...v.clash].sort().join(',');

const stale = [];
const open = [];
for (const v of violations) {
  if (Object.prototype.hasOwnProperty.call(allow, keyOf(v))) continue;
  open.push(v);
}
const seenKeys = new Set(violations.map(keyOf));
for (const k of Object.keys(allow)) {
  if (k.startsWith('_')) continue;
  if (!seenKeys.has(k)) stale.push(k);
}

if (stale.length) {
  console.log(`FAIL: check-two-sources — ${stale.length} allow-list entr${stale.length === 1 ? 'y is' : 'ies are'} no longer a violation; remove them:`);
  for (const s of stale.sort()) console.log('  ' + s);
  process.exit(1);
}
if (open.length) {
  console.log(`FAIL: check-two-sources — ${open.length} component(s) read the same table from both the seed and the database:`);
  for (const v of open.sort((a, b) => a.file.localeCompare(b.file))) {
    console.log('  ' + v.file);
    for (const t of v.clash) console.log(`      ${t}: seed accessor + db reader ${[...v.note.get(t)].join(', ')}`);
  }
  console.log('\nRead the table from one source. The screen should take its rows from the shell');
  console.log('(useScopedData), which the tenant loader hydrates from the database, and not also');
  console.log('call a src/data reader for the same table. Or allow-list it in');
  console.log('scripts/two-sources-allow.json with a reason.');
  process.exit(1);
}
const allowedCount = Object.keys(allow).filter((k) => !k.startsWith('_')).length;
console.log(`PASS: check-two-sources — no component reads a table from both the seed and the database (${allowedCount} allow-listed).`);

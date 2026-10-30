#!/usr/bin/env node
/**
 * G2 — no dead code (docs/SCALE-TASKS.md, the six anti-theatre gates).
 *
 * Every `public` SQL function that the final schema defines must have a production caller, or be
 * allow-listed here with a reason. "Production caller" means one of:
 *   - another SQL function or trigger body in the final schema calls it (read from pg_proc);
 *   - an RPC target named in `src/data/*.ts` or `supabase/functions/**` (`rpc('name'`, `callRpc...`);
 *   - an RPC target named in the RPC catalogue in `docs/UI-INVENTORY.md`;
 *   - a trigger fires it (`execute function` in a `create trigger`).
 *
 * Why this gate exists: a migration can create a function nothing ever reaches. The unit tests mock
 * the client, so they never touch it, and the screen never calls it. It is dead weight that looks
 * like a feature. This gate reads the real schema (pglite) so the answer is about the database that
 * ships, not about the source text.
 *
 * The schema is read by replaying every migration into an in-process Postgres (pglite, installed
 * --no-save). If pglite is not installed the gate fails loudly rather than passing vacuously.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const ALLOW_PATH = path.join(ROOT, 'scripts/dead-code-allow.json');

async function loadSchema() {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    console.error('FAIL: @electric-sql/pglite is not installed. Run: npm i --no-save @electric-sql/pglite');
    process.exit(1);
  }
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  const shim = fs.readFileSync(path.join(ROOT, 'scripts/local-sql-shim.sql'), 'utf8');
  const PROVIDED = new Set(['pgcrypto']);
  const shimStripped = shim.replace(/create extension[^;]*;/gi, (m) =>
    PROVIDED.has((m.match(/extension if not exists (\w+)/i) ?? [])[1]) ? m : '-- stripped: ' + m);
  await db.exec(shimStripped);
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      console.error(`FAIL: migration ${f} did not apply: ${e.message}`);
      process.exit(1);
    }
  }
  const rows = await db.query(`
    select p.proname as name, pg_get_functiondef(p.oid) as def, p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`);
  // Other places a function can be reached from the schema itself: RLS policies, views, generated
  // columns / defaults and check constraints. Without these the graph reports helpers used only by a
  // policy (has_org, is_cia, share_covers, ...) as dead, which is wrong.
  const policies = await db.query(`
    select coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
      from pg_policies where schemaname = 'public'`);
  const views = await db.query(`
    select pg_get_viewdef(c.oid) as expr from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v', 'm')`);
  const constraints = await db.query(`
    select pg_get_constraintdef(con.oid) as expr from pg_constraint con
      join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public'`);
  const defaults = await db.query(`
    select pg_get_expr(d.adbin, d.adrelid) as expr from pg_attrdef d
      join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'`);
  await db.close();
  const exprs = [...policies.rows, ...views.rows, ...constraints.rows, ...defaults.rows]
    .map((r) => r.expr ?? '').join('\n');
  return { funcs: rows.rows, exprs };
}

/** Names a function body actually calls (bare or `public.`-qualified), excluding its own name. */
function callsIn(body) {
  const calls = new Set();
  for (const m of body.matchAll(/(?:public\.)?([a-z_][a-z_0-9]{2,})\s*\(/g)) calls.add(m[1]);
  for (const m of body.matchAll(/execute\s+(?:function|procedure)\s+(?:public\.)?([a-z_][a-z_0-9]{2,})/gi)) calls.add(m[1]);
  return calls;
}

const { funcs, exprs } = await loadSchema();
const names = new Set(funcs.map((f) => f.name));

// Callers that live outside the database: the app's RPC calls and the RPC catalogue.
const external = new Set();
const scan = (dir, filter) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scan(p, filter); continue; }
    if (!filter(e.name)) continue;
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/[Rr]pc[A-Za-z]*\(\s*'([a-z_0-9]+)'/g)) external.add(m[1]);
  }
};
scan(path.join(ROOT, 'src/data'), (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
scan(path.join(ROOT, 'supabase/functions'), (n) => /\.(ts|js|mjs)$/.test(n));
const inv = fs.readFileSync(path.join(ROOT, 'docs/UI-INVENTORY.md'), 'utf8');
for (const m of inv.matchAll(/^\| `([a-z_0-9]+)` \|/gm)) external.add(m[1]);
// Supabase auth hooks are wired in config.toml by fully-qualified function name; that is a
// production caller the JS scan cannot see.
const cfgPath = path.join(ROOT, 'supabase/config.toml');
if (fs.existsSync(cfgPath)) {
  const cfg = fs.readFileSync(cfgPath, 'utf8');
  for (const m of cfg.matchAll(/pg-functions:\/\/[^/]+\/public\/([a-z_0-9]+)/g)) external.add(m[1]);
}

// Reachability: a name is reachable if any function body calls it, or it is an external RPC target.
const reachable = new Set(external);
for (const f of funcs) {
  for (const c of callsIn(f.def)) {
    if (c !== f.name && names.has(c)) reachable.add(c);
  }
}
// Trigger functions are reached by a `create trigger ... execute function` (their own body has no
// caller). A trigger function with no trigger is dead; record which trigger functions are wired.
// Migration-level statements (a DO block that seeds, a `select public.x()` in a migration) are real
// call sites too, so they count — with SQL comments stripped, because a mention in a comment is not
// a caller.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const allSqlRaw = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))
  .map((n) => fs.readFileSync(path.join(MIGRATIONS, n), 'utf8')).join('\n');
const allSql = stripComments(allSqlRaw);
const wiredTriggers = new Set();
for (const m of allSql.matchAll(/execute\s+(?:function|procedure)\s+(?:public\.)?([a-z_][a-z_0-9]{2,})/gi)) {
  wiredTriggers.add(m[1]);
}
// Definition headers look like calls; remove them so a definition is never mistaken for a caller.
// Also drop the statements that NAME a function without calling it: grant/revoke, comment on,
// alter function, drop function, and a trigger's execute clause. What is left is a real call site
// (`select f()`, `perform f()`, an expression using `f(...)`).
const migrationCalls = stripComments(allSqlRaw)
  .replace(/create\s+(?:or\s+replace\s+)?function\s+public\.[a-z_0-9]+\s*\(/gi, 'def(')
  .replace(/\b(?:grant|revoke)\b[^;]*?\bon\s+(?:function|procedure)\s+public\.[a-z_0-9]+\s*\(/gi, 'priv(')
  .replace(/\bcomment\s+on\s+(?:function|procedure)\s+public\.[a-z_0-9]+/gi, 'cmt(')
  .replace(/\balter\s+function\s+public\.[a-z_0-9]+/gi, 'alt(')
  .replace(/\bdrop\s+function\s+(?:if\s+exists\s+)?public\.[a-z_0-9]+/gi, 'drop(')
  .replace(/\bexecute\s+(?:function|procedure)\s+(?:public\.)?[a-z_0-9]+/gi, 'trig(');
// Functions used only by a policy, a view, a constraint or a column default are reachable too.
for (const c of callsIn(exprs)) {
  if (names.has(c)) reachable.add(c);
}
// Functions called from a migration-level statement (a seed DO block, a one-off backfill) count.
for (const c of callsIn(migrationCalls)) {
  if (names.has(c)) reachable.add(c);
}


const allow = fs.existsSync(ALLOW_PATH) ? JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8')) : {};
const allowNames = new Set(Object.keys(allow));

const unreachable = funcs
  .filter((f) => !reachable.has(f.name) && !wiredTriggers.has(f.name))
  .map((f) => f.name)
  .filter((n) => !allowNames.has(n))
  .sort();

// Also flag allow-list entries that are now reachable (stale allow-list entries hide nothing but
// should be pruned so the list stays honest).
const staleAllow = [...allowNames].filter((n) => reachable.has(n) || wiredTriggers.has(n)).sort();

if (unreachable.length || staleAllow.length) {
  console.error(`FAIL: check-dead-code found ${unreachable.length} unreachable and ${staleAllow.length} stale allow-list entr(ies):`);
  for (const n of unreachable) console.error(`  - UNREACHABLE: public.${n}() has no caller in schema, src, Edge Functions or the RPC catalogue`);
  for (const n of staleAllow) console.error(`  - STALE ALLOW: public.${n}() is now reachable; remove it from scripts/dead-code-allow.json`);
  process.exit(1);
}
console.log(`PASS: check-dead-code — all ${funcs.length} public functions are reachable or allow-listed (${allowNames.size} allow-listed).`);

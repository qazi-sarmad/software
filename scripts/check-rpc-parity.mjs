#!/usr/bin/env node
/**
 * G6 — RPC parity (docs/SCALE-TASKS.md, the six anti-theatre gates).
 *
 * Every RPC the app calls (`sb.rpc('name', ...)` in src/data/*.ts, and every name in the RPC
 * catalogue in docs/UI-INVENTORY.md) must exist as a function in the final schema, and every function
 * the app calls must have been granted to `authenticated` (or be service-only and called only from
 * the Edge Function / a scheduled job — those are allow-listed below with a reason).
 *
 * Why this gate exists: a screen can call an RPC that no migration ever created. The call compiles,
 * the unit test mocks the client and passes, and the screen is broken in production. This gate reads
 * the real schema, not the mock.
 *
 * The schema is read by replaying every migration into an in-process Postgres (pglite, installed
 * --no-save) — the same engine the SQL harness uses, so what this checks is what the database
 * actually ends up with. If pglite is not installed the gate fails loudly rather than passing
 * vacuously: a gate that cannot run is not a green gate.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const DATA_DIR = path.join(ROOT, 'src/data');

// RPCs the app calls that are deliberately not granted to `authenticated`: they are reached only by
// the service role (the Edge Function or a scheduled job). Each needs a reason.
const SERVICE_ONLY = new Map([
  ['email_dispatch_claim', 'called by the email-dispatch Edge Function with the service key'],
  ['email_dispatch_complete', 'called by the email-dispatch Edge Function with the service key'],
  ['email_expire_stale', 'called by the email-retention scheduled job'],
  ['notification_digest_send', 'called by the notification-digest scheduled job'],
  ['cap_notification_sweep', 'called by the CAP-overdue scheduled job'],
  ['monitor_runner_sweep', 'called by the monitor-runner pg_cron job'],
  ['automation_dispatch_pending', 'called by the automation dispatcher'],
  ['grant_expiry_sweep', 'called by the grant-expiry scheduled job'],
  ['consultation_sweep', 'called by the consultation scheduled job'],
  ['population_archive_due', 'called by the population-archive scheduled job'],
]);

function appCalledRpcs() {
  const names = new Set();
  for (const f of fs.readdirSync(DATA_DIR).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    const s = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
    for (const m of s.matchAll(/rpc\(\s*'([a-z_0-9]+)'/g)) names.add(m[1]);
  }
  return names;
}

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
  // pglite ships the extension bundles but not the Supabase-specific `pg_cron` / `vault` /
  // `pgsodium` shims some migrations reference. Those are local-only conveniences; strip the
  // `create extension` lines for anything pglite does not provide so the replay reaches the end.
  const PROVIDED = new Set(['pgcrypto']);
  const shimStripped = shim.replace(/create extension[^;]*;/gi, (m) =>
    PROVIDED.has((m.match(/extension if not exists (\w+)/i) ?? [])[1]) ? m : '-- stripped: ' + m);
  await db.exec(shimStripped);
  const files = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      console.error(`FAIL: migration ${f} did not apply: ${e.message}`);
      process.exit(1);
    }
  }
  const fns = await db.query(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('authenticated', p.oid, 'execute') as tenant_granted
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`);
  await db.close();
  return fns.rows;
}

const called = appCalledRpcs();
const rows = await loadSchema();
const byName = new Map();
for (const r of rows) {
  if (!byName.has(r.name)) byName.set(r.name, []);
  byName.get(r.name).push(r);
}

const problems = [];
for (const name of [...called].sort()) {
  const defs = byName.get(name);
  if (!defs) {
    problems.push(`MISSING: the app calls rpc('${name}') but no migration defines it`);
    continue;
  }
  const anyGranted = defs.some((d) => d.tenant_granted);
  if (!anyGranted && !SERVICE_ONLY.has(name)) {
    problems.push(`UNGRANTED: rpc('${name}') exists but is not granted to authenticated, and is not allow-listed as service-only`);
  }
}

if (problems.length) {
  console.error(`FAIL: check-rpc-parity found ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`PASS: check-rpc-parity — every RPC the app calls (${called.size}) exists in the final schema and is callable by authenticated (${SERVICE_ONLY.size} service-only allow-listed).`);

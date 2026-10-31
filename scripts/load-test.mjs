#!/usr/bin/env node
/**
 * Deterministic concurrent-org load test (SECURITY-PLAN item G, WP4).
 *
 * Stands up N organisations against the LOCAL PostgreSQL cluster (the same DB and the same
 * `provio_test` helpers as `scripts/local-sql-harness.sh`), writes one universe into each as the
 * owner, then fires ORGS × SESSIONS concurrent RLS reads and asserts every org sees exactly its own
 * row and never another org's. The input is fixed every run, so a p50/p95 change is real contention,
 * not random data. No clock inside the logic, no model, no network beyond the local database.
 *
 * Run the SQL harness first so the schema and `provio_test` exist:
 *   bash scripts/local-sql-harness.sh
 *   node scripts/load-test.mjs                 # 8 orgs × 4 sessions
 *   ORGS=16 SESSIONS=8 node scripts/load-test.mjs
 *
 * Exit 0 when every org read exactly its own row and every foreign read returned zero; 1 otherwise.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ORGS = Number(process.env.ORGS ?? 8);
const SESSIONS = Number(process.env.SESSIONS ?? 4);
const DB = process.env.PROVIO_DB ?? 'provio_local';

function psql(sql, { tuples = false } = {}) {
  const args = ['-n', '-u', 'postgres', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB];
  if (tuples) args.push('-t', '-A');
  args.push('-c', sql);
  return run('sudo', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** Deterministic ids: org i uses a fixed uuid derived from i. */
const orgUuid = (i) => `f0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const univUuid = (i) => `f1000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const userUuid = (i) => `f2000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

console.log(`load test: ${ORGS} orgs, ${SESSIONS} concurrent sessions each, db=${DB}`);

async function readAs(i) {
  const t0 = process.hrtime.bigint();
  const { stdout } = await psql(
    `select provio_test.as_user('${userUuid(i)}', '${orgUuid(i)}', 'cia');
     select count(*) from public.universes;`,
    { tuples: true }
  );
  const t1 = process.hrtime.bigint();
  const count = Number(
    stdout.split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).pop()
  );
  return { ms: Number(t1 - t0) / 1e6, count };
}

// --- Fixture: N orgs, each with one universe, written as the owner. ---
await psql('\\i supabase/tests/00_lib.sql');
await psql('select provio_test.seed();');
let fixture = 'select provio_test.as_owner();\n';
for (let i = 0; i < ORGS; i++) {
  fixture += `
    insert into orgs (id, name) values ('${orgUuid(i)}', 'Load Org ${i}') on conflict (id) do nothing;
    insert into universes (id, org_id, name) values ('${univUuid(i)}', '${orgUuid(i)}', 'U${i}')
      on conflict (id) do nothing;
    insert into user_scopes (org_id, user_id, universe_id)
      select '${orgUuid(i)}', '${userUuid(i)}', '${univUuid(i)}'
      where not exists (select 1 from user_scopes s
                        where s.org_id = '${orgUuid(i)}' and s.user_id = '${userUuid(i)}');
  `;
}
await psql(fixture);
console.log(`fixture: ${ORGS} orgs seeded`);

// --- Read phase: fire every (org, session) read concurrently. A correct read returns exactly 1. ---
const pending = [];
for (let i = 0; i < ORGS; i++) {
  for (let s = 0; s < SESSIONS; s++) pending.push(readAs(i));
}
const results = await Promise.all(pending);
const timings = results.map((r) => r.ms).sort((a, b) => a - b);
const own = results.filter((r) => r.count === 1).length;
const foreign = results.filter((r) => r.count !== 1).length;

console.log(`reads: ${own} own-org, ${foreign} unexpected`);
console.log(
  `latency ms: p50=${percentile(timings, 50).toFixed(1)} p95=${percentile(timings, 95).toFixed(1)} max=${timings[timings.length - 1].toFixed(1)}`
);

if (foreign !== 0) {
  console.error(`FAIL: ${foreign} reads saw a row count other than 1 (cross-tenant leakage or missing row)`);
  process.exit(1);
}
if (own !== ORGS * SESSIONS) {
  console.error(`FAIL: expected ${ORGS * SESSIONS} own-org reads, got ${own}`);
  process.exit(1);
}
console.log('PASS: every org read exactly its own row; zero cross-tenant leakage');

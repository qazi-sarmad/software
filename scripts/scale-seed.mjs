#!/usr/bin/env node
/**
 * scripts/scale-seed.mjs — the runnable front end for the S17 scale generator.
 *
 * The generator itself is SQL (`supabase/tests/99_scale_seed.sql`); this script drives it at a chosen
 * scale so the designated target shape (docs/build/SCALE-PROGRAMME.md §1) can be built and inspected
 * on demand, without the CI harness paying for the full volume on every run.
 *
 * Usage:
 *   node scripts/scale-seed.mjs --factor=20
 *   node scripts/scale-seed.mjs --target           # the §1 designated shape
 *   node scripts/scale-seed.mjs --clean            # remove the generator's fixtures and exit
 *   node scripts/scale-seed.mjs --target --clean   # clean, then build the target shape
 *
 * Options:
 *   --factor=N   the structural factor (universes/entities/engagements scale with N)
 *   --target     use the §1 designated counts (5,000 entities, 1,000,000 population rows,
 *                2,000 engagements, 100,000 evidence rows, 5,000,000 ledger entries)
 *   --db=NAME    the database (default: env SCALE_DB or provio_local)
 *   --clean      remove the generator's fixtures; skip building
 *
 * It assumes a migrated database (the SQL harness leaves one). It connects the same way the harness
 * does — `sudo -u postgres psql` — so it runs in this sandbox without a password.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};

const factor = Number(opt('factor', '1'));
const target = Boolean(opt('target', false));
const clean = Boolean(opt('clean', false));
const db = String(opt('db', process.env.SCALE_DB || 'provio_local'));

// The §1 designated counts, applied as the heavy-count overrides.
const TARGET_SETTINGS = {
  provio_test: {
    scale_eng: 2000,
    scale_pop_rows: 1000000,
    scale_ledger: 5000000,
    scale_evidence: 100000,
    scale_users_per_org: 13, // 8 * 313 orgs * 13 users ~= 32,552; --users-per-org overrides
  },
};

function psql(sql) {
  return execFileSync('sudo', ['-n', '-u', 'postgres', 'psql', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db],
    { input: sql, encoding: 'utf8' });
}

const lib = readFileSync(resolve(ROOT, 'supabase/tests/00_lib.sql'), 'utf8');

if (clean) {
  psql(`${lib}\nselect provio_test.scale_cleanup();\nselect 'scale fixtures removed';`);
  process.stdout.write('scale-seed: fixtures removed\n');
  process.exit(0);
}

// The structural factor: the target uses 5000 entities (16 per factor) and 200 universes (4 per
// factor), so a factor of 313 reaches 5,008 entities and 1,252 universes. --factor overrides it.
const structFactor = target ? Number(opt('factor', '313')) : factor;

const gucs = [
  `select set_config('provio_test.scale_factor', '${structFactor}', false);`,
  ...(opt('users-per-org', null) ? [`select set_config('provio_test.scale_users_per_org', '${opt('users-per-org', null)}', false);`] : []),
  ...(target
    ? Object.entries(TARGET_SETTINGS.provio_test).map(
        ([k, v]) => `select set_config('${k}', '${v}', false);`)
    : []),
];

const body = `
${lib}
select provio_test.seed();
select provio_test.as_owner();
select provio_test.scale_cleanup();
select provio_test.scale_seed_a(${structFactor});
select provio_test.scale_seed_b(${structFactor});
select provio_test.scale_seed_c(${structFactor});
select provio_test.as_owner();
select
  (select count(*) from universes where name like 'SCALE-%') as universes,
  (select count(*) from entities where name like 'SCALE-%') as entities,
  (select count(*) from engagements where title like 'SCALE-%') as engagements,
  (select count(*) from population_rows where data ? 'ref' or data ? 'hostile') as population_rows,
  (select count(*) from evidence_files where filename like 'SCALE-%') as evidence_files,
  (select count(*) from ledger_entries where action like 'SCALE-%') as ledger_entries,
  (select count(*) from org_members m join orgs o on o.id = m.org_id
     where o.name like 'SCALE-B-%') as users,
  (select md5(string_agg(sha256, '' order by sha256)) from populations p
     where exists (select 1 from universes u where u.org_id = p.org_id and u.name like 'SCALE-%')) as population_hash_fingerprint;
`;

const out = psql(`${gucs.join('\n')}\n${body}`);
process.stdout.write(out);
process.stdout.write(`scale-seed: built at factor=${structFactor}${target ? ' (target shape)' : ''}\n`);

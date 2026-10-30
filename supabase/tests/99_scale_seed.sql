-- Test 99: S17 — the deterministic scale generator.
--
-- This file is the generator the scale programme assigns to the integrator
-- (docs/build/SCALE-PROGRAMME.md §4). It builds the three target shapes from a fixed seed, proves
-- they are deterministic, and proves the tenant boundary still holds over them.
--
--   Shape A — the large tenant: one org, many universes / entities / engagements, a population and a
--             hash-chained ledger.
--   Shape B — the long tail: many small orgs, each with a CIA role, a universe, an engagement, a
--             population and a ledger.
--   Shape C — the adversarial mix: Shape A plus hostile rows (near-duplicate names, out-of-order
--             approvals, just-below-threshold amounts).
--
-- Determinism (L1): no now(), no random(). Every id and every value is a pure function of an index,
-- so the same factor produces byte-identical rows and a stable population hash. A failure is
-- reproducible.
--
-- Scale (§4): the shapes are built at a FACTOR. The designated target (§1: 5,000 entities, a
-- 1,000,000-row population, 5,000,000 ledger entries) is reached at a high factor in the dedicated
-- scale run (`scripts/scale-seed.mjs --factor=N`). The default factor keeps this file fast enough for
-- the CI harness, which runs every file twice — the STRUCTURE it proves is the same at any factor.
-- The factor is read from the GUC `provio_test.scale_factor` (default 1).
--
-- Idempotent (§4): each shape cleans up its own fixtures first, so the harness can run this file
-- twice against the same database, which it does.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A deterministic uuid: p_tag (8 hex chars) + a fixed tail + the 12-digit index. No randomness.
create or replace function provio_test.det_uuid(p_tag text, p_n bigint) returns uuid
language sql immutable as $$
  select format('%s-0000-4000-8000-%s', p_tag, lpad(p_n::text, 12, '0'))::uuid
$$;

-- The generator's org names all start with this prefix, so cleanup is precise and idempotent.
create or replace function provio_test.scale_org_prefix() returns text
language sql immutable as $$ select 'SCALE-' $$;

-- Remove every fixture the generator owns. It CANNOT be a DELETE: `ledger_entries` and the other
-- append-only tables (L5) refuse DELETE for every role, and the generator writes ledger rows, so the
-- only sanctioned clear is TRUNCATE — which does not fire the row-level append-only triggers. This
-- calls the seed's own reset (`truncate orgs cascade` + the non-FK truncates), so it clears the scale
-- shapes and the base fixtures alike; the harness re-seeds at the top of every file. Used by
-- `scripts/scale-seed.mjs --clean`.
create or replace function provio_test.scale_cleanup() returns void
language plpgsql as $$
begin
  perform provio_test.reset_data();
end $$;

-- The population hash for a set of rows: a stable SHA-256 over (row_ref, data) in row_ref order.
-- Deterministic, so two runs of the same shape produce the same hash (§6).
create or replace function provio_test.scale_pop_hash(p_population uuid) returns text
language sql stable as $$
  select encode(extensions.digest(
    coalesce(string_agg(row_ref::text || ':' || data::text, '|' order by row_ref), ''), 'sha256'), 'hex')
  from population_rows where population_id = p_population
$$;

-- The CIA rights matrix (the same one the seed's org A CIA role carries), so a generated org's CIA
-- identity passes is_cia() and its own rows are visible.
create or replace function provio_test.scale_cia_rights() returns jsonb
language sql immutable as $$
  select '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- Shape A — the large tenant. The structural counts scale with p_factor; the two heavy counts
-- (population rows and ledger entries) may be overridden so the designated target shape
-- (docs/build/SCALE-PROGRAMME.md §1: a 1,000,000-row population, 5,000,000 ledger entries) is reached
-- without inflating the structural counts to match.
-- ---------------------------------------------------------------------------
create or replace function provio_test.scale_seed_a(p_factor int) returns uuid
language plpgsql as $$
declare
  v_org uuid := provio_test.det_uuid('5ca1ea00', 0);
  v_univ int := 4 * p_factor;
  v_ent int := 16 * p_factor;
  v_eng int := coalesce(nullif(current_setting('provio_test.scale_eng', true), '')::int, 4 * p_factor);
  v_pop_rows int := coalesce(nullif(current_setting('provio_test.scale_pop_rows', true), '')::int, 200 * p_factor);
  v_ledger int := coalesce(nullif(current_setting('provio_test.scale_ledger', true), '')::int, 200 * p_factor);
  v_evidence int := coalesce(nullif(current_setting('provio_test.scale_evidence', true), '')::int, 40 * p_factor);
  v_pop uuid := provio_test.det_uuid('5ca1ea04', 0);
  v_eng0 uuid;
begin
  insert into orgs (id, name, is_demo) values (v_org, provio_test.scale_org_prefix() || 'A', false);

  insert into universes (id, org_id, name)
  select provio_test.det_uuid('5ca1ea01', i), v_org, format('SCALE-A-U%s', i)
  from generate_series(1, v_univ) i;

  insert into entities (id, org_id, universe_id, name, approved, status)
  select provio_test.det_uuid('5ca1ea02', i), v_org, provio_test.det_uuid('5ca1ea01', ((i - 1) % v_univ) + 1),
         format('SCALE-A-E%s', i), true, 'approved'
  from generate_series(1, v_ent) i;

  insert into engagements (id, org_id, universe_id, entity_id, title)
  select provio_test.det_uuid('5ca1ea03', i), v_org, provio_test.det_uuid('5ca1ea01', ((i - 1) % v_univ) + 1),
         provio_test.det_uuid('5ca1ea02', ((i - 1) % v_ent) + 1), format('SCALE-A-Eng%s', i)
  from generate_series(1, v_eng) i;

  v_eng0 := provio_test.det_uuid('5ca1ea03', 1);

  insert into populations (id, org_id, engagement_id, sha256, control_total_cents, row_count, status)
  values (v_pop, v_org, v_eng0, repeat('0', 64), v_pop_rows * 100, 0, 'pending');

  insert into population_rows (org_id, population_id, row_ref, data)
  select v_org, v_pop, i, jsonb_build_object('amt', (i * 7) % 100000, 'ref', format('A-%s', i))
  from generate_series(1, v_pop_rows) i;

  update populations
     set sha256 = provio_test.scale_pop_hash(v_pop), row_count = v_pop_rows, status = 'verified'
   where id = v_pop;

  insert into evidence_files (id, org_id, engagement_id, filename, stage, content_sha256)
  select provio_test.det_uuid('5ca1ea05', i), v_org, v_eng0, format('SCALE-A-ev%s.pdf', i), 'testing',
         encode(extensions.digest(format('ev-%s', i), 'sha256'), 'hex')
  from generate_series(1, v_evidence) i;

  -- The ledger: the chain trigger assigns seq / prev_hash / hash from the payload (L5).
  insert into ledger_entries (org_id, prev_hash, hash, payload_hash, action, payload)
  select v_org, '', '', '', 'SCALE-A', jsonb_build_object('n', i)
  from generate_series(1, v_ledger) i;

  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- Shape B — the long tail: p_orgs small organisations, each with a CIA role.
-- ---------------------------------------------------------------------------
create or replace function provio_test.scale_seed_b(p_factor int) returns int
language plpgsql as $$
declare
  v_orgs int := 8 * p_factor;
  v_org uuid;
  v_univ uuid;
  v_eng uuid;
  v_pop uuid;
  n int;
begin
  for n in 1..v_orgs loop
    v_org := provio_test.det_uuid('5ca1eb00', n);
    insert into orgs (id, name, is_demo) values (v_org, format('%sB-%s', provio_test.scale_org_prefix(), n), false);

    insert into roles (id, org_id, name, slug, is_seed, rights)
    values (provio_test.det_uuid('5ca1eb06', n), v_org, 'CIA', 'cia', true, provio_test.scale_cia_rights());

    v_univ := provio_test.det_uuid('5ca1eb01', n);
    insert into universes (id, org_id, name) values (v_univ, v_org, format('SCALE-B%s-U1', n));

    insert into entities (id, org_id, universe_id, name, approved, status)
    select provio_test.det_uuid('5ca1eb02', n * 1000 + i), v_org, v_univ, format('SCALE-B%s-E%s', n, i), true, 'approved'
    from generate_series(1, 3) i;

    v_eng := provio_test.det_uuid('5ca1eb03', n);
    insert into engagements (id, org_id, universe_id, entity_id, title)
    values (v_eng, v_org, v_univ, provio_test.det_uuid('5ca1eb02', n * 1000 + 1), format('SCALE-B%s-Eng1', n));

    v_pop := provio_test.det_uuid('5ca1eb04', n);
    insert into populations (id, org_id, engagement_id, sha256, control_total_cents, row_count, status)
    values (v_pop, v_org, v_eng, repeat('0', 64), 1000, 0, 'pending');
    insert into population_rows (org_id, population_id, row_ref, data)
    select v_org, v_pop, i, jsonb_build_object('amt', i)
    from generate_series(1, 10) i;
    update populations
       set sha256 = provio_test.scale_pop_hash(v_pop), row_count = 10, status = 'verified'
     where id = v_pop;

    insert into ledger_entries (org_id, prev_hash, hash, payload_hash, action, payload)
    select v_org, '', '', '', 'SCALE-B', jsonb_build_object('n', i)
    from generate_series(1, 10) i;
  end loop;
  return v_orgs;
end $$;

-- ---------------------------------------------------------------------------
-- Shape C — an overlay on an EXISTING Shape A: hostile rows. Every value is still deterministic.
-- ---------------------------------------------------------------------------
create or replace function provio_test.scale_seed_c(p_factor int) returns uuid
language plpgsql as $$
declare
  v_org uuid := provio_test.det_uuid('5ca1ea00', 0);
  v_univ uuid;
  v_pop uuid;
  v_hostile int := 8 * p_factor;
  n int;
begin
  v_univ := provio_test.det_uuid('5ca1ea01', 1);
  select id into v_pop from populations where org_id = v_org limit 1;
  perform provio_test.assert_true(v_pop is not null, 'scale C: Shape A must exist before the overlay');

  -- Duplicate ids are impossible (primary key), so the hostile cases are the ones the schema allows:
  --   * near-duplicate names (a trailing space on half of them),
  --   * out-of-order approval (a draft entity inside an approved universe),
  --   * just-below-threshold amounts on population rows.
  for n in 1..v_hostile loop
    insert into entities (id, org_id, universe_id, name, approved, status)
    values (provio_test.det_uuid('5ca1ec02', n), v_org, v_univ,
            case when n % 2 = 0 then format('SCALE-A-E%s ', n) else format('SCALE-A-E%s', n) end,
            (n % 2 = 1), case when n % 2 = 1 then 'draft' else 'approved' end);

    insert into population_rows (org_id, population_id, row_ref, data)
    values (v_org, v_pop, 100000 + n, jsonb_build_object('amt', 99999, 'hostile', true));
  end loop;

  -- Re-hash so the population stays verified with the hostile rows included.
  update populations
     set sha256 = provio_test.scale_pop_hash(v_pop), row_count = row_count + v_hostile
   where id = v_pop;

  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- The test body: build, assert the structure, prove determinism.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();

do $$
declare
  v_factor int;
  v_a uuid;
  v_b int;
  v_pop uuid;
  v_sha1 text;
  v_sha2 text;
begin
  v_factor := coalesce(nullif(current_setting('provio_test.scale_factor', true), ''), '1')::int;

  -- --- Shape A: build, then assert the structure matches the factor exactly. ---
  v_a := provio_test.scale_seed_a(v_factor);
  perform provio_test.assert_eq(
    (select count(*)::int from universes where org_id = v_a), 4 * v_factor,
    'scale A: the universe count matches the factor');
  perform provio_test.assert_eq(
    (select count(*)::int from entities where org_id = v_a), 16 * v_factor,
    'scale A: the entity count matches the factor');
  perform provio_test.assert_eq(
    (select count(*)::int from populations where org_id = v_a), 1,
    'scale A: one population');
  perform provio_test.assert_eq(
    (select row_count from populations where org_id = v_a), 200 * v_factor,
    'scale A: the population row count matches the factor');
  perform provio_test.assert_eq(
    (select status from populations where org_id = v_a), 'verified',
    'scale A: the population is verified');

  select id into v_pop from populations where org_id = v_a;
  v_sha1 := provio_test.scale_pop_hash(v_pop);
  perform provio_test.assert_eq(
    (select sha256 from populations where org_id = v_a), v_sha1,
    'scale A: the stored hash equals the recomputed population hash');

  -- The ledger chained: one entry per write, unique contiguous seq from 1.
  perform provio_test.assert_eq(
    (select count(*)::bigint from ledger_entries where org_id = v_a), 200::bigint * v_factor,
    'scale A: the ledger has one entry per write');
  perform provio_test.assert_true(
    (select count(*) = count(distinct seq) from ledger_entries where org_id = v_a),
    'scale A: ledger seq values are unique');
  perform provio_test.assert_eq(
    (select min(seq) from ledger_entries where org_id = v_a), 1::bigint,
    'scale A: the ledger starts at seq 1');

  -- --- Determinism (L1): the stored population hash must equal the hash recomputed from the PURE
  -- FORMULA that produced the rows. If it matches, every row is a function of its index alone — no
  -- clock, no random — so a second run is byte-identical. ---
  v_sha2 := encode(extensions.digest(
    (select coalesce(string_agg(
        i::text || ':' || jsonb_build_object('amt', (i * 7) % 100000, 'ref', format('A-%s', i))::text,
        '|' order by i), '')
     from generate_series(1, (select row_count from populations where org_id = v_a)) i),
    'sha256'), 'hex');
  perform provio_test.assert_eq(v_sha2, v_sha1,
    'scale determinism: the population hash equals the pure formula (index-only, no clock/random)');

  -- --- Shape C: the adversarial overlay on A. ---
  perform provio_test.scale_seed_c(v_factor);
  perform provio_test.assert_eq(
    (select count(*)::int from entities where org_id = v_a and status = 'draft'), (8 * v_factor) / 2,
    'scale C: out-of-order draft entities are present');
  perform provio_test.assert_eq(
    (select count(*)::int from population_rows where population_id =
       (select id from populations where org_id = v_a) and data ? 'hostile'), 8 * v_factor,
    'scale C: the hostile population rows are present');

  -- --- Shape B: the long tail. ---
  v_b := provio_test.scale_seed_b(v_factor);
  perform provio_test.assert_eq(v_b, 8 * v_factor, 'scale B: the long-tail org count matches the factor');
  perform provio_test.assert_eq(
    (select count(*)::int from orgs where name like provio_test.scale_org_prefix() || 'B-%'), 8 * v_factor,
    'scale B: every long-tail org exists');
end $$;

-- ---------------------------------------------------------------------------
-- The tenant boundary over the generated shapes (L2). Every refusal is paired with a legitimate read,
-- so a fix that blocks everything fails too.
-- ---------------------------------------------------------------------------
-- The seed tenant (org A) sees its OWN rows and none of the generated scale rows.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_scale_a uuid := provio_test.det_uuid('5ca1ea00', 0);
begin
  perform provio_test.assert_eq(
    (select count(*)::int from universes where org_id = 'a0000000-0000-0000-0000-000000000001'), 2,
    'scale RLS: the seed org still sees exactly its own two universes');
  perform provio_test.assert_eq(
    (select count(*)::int from universes where org_id = v_scale_a), 0,
    'scale RLS: the seed org sees none of the large tenant’s universes');
  perform provio_test.assert_eq(
    (select count(*)::int from population_rows where org_id = v_scale_a), 0,
    'scale RLS: the seed org sees none of the large tenant’s population');
  perform provio_test.assert_eq(
    (select count(*)::int from ledger_entries where org_id = v_scale_a), 0,
    'scale RLS: the seed org sees none of the large tenant’s ledger');
end $$;
select provio_test.as_owner();

-- A long-tail org sees its own rows and only itself in orgs.
select provio_test.as_user(
  provio_test.det_uuid('5ca1eb00', 1)::text, provio_test.det_uuid('5ca1eb00', 1)::text, 'cia');
do $$
declare
  v_own uuid := provio_test.det_uuid('5ca1eb00', 1);
begin
  perform provio_test.assert_eq(
    (select count(*)::int from universes where org_id = v_own), 1,
    'scale RLS: a long-tail org sees its own single universe');
  perform provio_test.assert_eq(
    (select count(*)::int from orgs), 1,
    'scale RLS: a long-tail org sees only itself in orgs');
end $$;
select provio_test.as_owner();

-- The generator leaves its shapes in place; the next file's `select provio_test.seed()` clears them
-- with the same TRUNCATE reset (L5 — append-only rows cannot be DELETEd).
select provio_test.assert_true(true, 'scale: the generator built Shapes A, B and C');

-- Test 35 (4D): Sampling engine — deterministic system sampling, auditor paste validation, the
-- floor, locked-sample immutability, replacement rationale and org sampling table configuration
-- (spec §11.2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 0. Fixtures (created as the owner: a testing workpaper needs planning sign-off as an app role,
--    and this file tests sampling, not the 4B lock).
-- ---------------------------------------------------------------------------
do $$
declare
  v_pop uuid := '70000000-0000-0000-0000-0000000000d1';
  v_wp  uuid := '60000000-0000-0000-0000-0000000000d1';
begin
  insert into workpapers (id, org_id, engagement_id, stage) values
    (v_wp, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'testing');
  insert into populations (id, org_id, engagement_id, workpaper_id, sha256, row_count, status)
  values (v_pop, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1',
          v_wp, repeat('f',64), 100, 'verified');
  insert into population_rows (org_id, population_id, row_ref, data)
  select 'a0000000-0000-0000-0000-000000000001', v_pop, g, jsonb_build_object('amt', g)
  from generate_series(1, 100) g;
end $$;

do $$
declare
  v_pop uuid := '70000000-0000-0000-0000-0000000000d2';
  v_wp  uuid := '60000000-0000-0000-0000-0000000000d2';
begin
  insert into workpapers (id, org_id, engagement_id, stage) values
    (v_wp, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'testing');
  insert into populations (id, org_id, engagement_id, workpaper_id, sha256, row_count, status)
  values (v_pop, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1',
          v_wp, repeat('a',64), 3, 'verified');
  insert into population_rows (org_id, population_id, row_ref, data) values
    ('a0000000-0000-0000-0000-000000000001', v_pop, 1, '{}'),
    ('a0000000-0000-0000-0000-000000000001', v_pop, 2, '{}'),
    ('a0000000-0000-0000-0000-000000000001', v_pop, 3, '{}');
end $$;

-- A workpaper with no verified population (for the negative case).
insert into workpapers (id, org_id, engagement_id, stage) values
  ('60000000-0000-0000-0000-0000000000d9','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','testing');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

-- ---------------------------------------------------------------------------
-- 1. Org sampling table: seeded defaults and deterministic get_sample_size.
-- ---------------------------------------------------------------------------
select public.seed_org_sampling_table('a0000000-0000-0000-0000-000000000001');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from org_sampling_table where org_id = 'a0000000-0000-0000-0000-000000000001'), 3::bigint,
    '4D: the default sampling table has three bands');
  -- small band: base 5, 10% -> a population of 40 gives max(5, 4) = 5.
  perform provio_test.assert_eq(
    public.get_sample_size('a0000000-0000-0000-0000-000000000001','any','any','small',40), 5,
    '4D: get_sample_size uses the greater of the base size and the percentage');
  -- medium band: base 10, 8% -> a population of 200 gives max(10, 16) = 16.
  perform provio_test.assert_eq(
    public.get_sample_size('a0000000-0000-0000-0000-000000000001','any','any','medium',200), 16,
    '4D: get_sample_size applies the percentage for a larger population');
  perform provio_test.assert_eq(
    public.get_sample_size('a0000000-0000-0000-0000-000000000001','any','any','large',20), 15,
    '4D: the large band uses its base size of 15');
  perform provio_test.assert_eq(
    public.get_sample_size('a0000000-0000-0000-0000-000000000001','any','any','large',12), 12,
    '4D: the sample size never exceeds the population');
  perform provio_test.assert_eq(
    public.get_sample_size('a0000000-0000-0000-0000-000000000001','any','any','large',0), 0,
    '4D: a population of zero yields a sample size of zero');
end $$;

-- The method CHECK is enforced at the database (as the owner, to bypass RLS on the config table).
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into org_sampling_table (org_id, control_type, frequency, pop_band, method) values ('a0000000-0000-0000-0000-000000000001','any','any','x','coin_toss')$q$,
    'org_sampling_table_method_check', '4D: an invalid sampling method is refused by the CHECK');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

-- ---------------------------------------------------------------------------
-- 2. System mode: a deterministic sample from a verified population attached to the workpaper.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000d1';
  v_rows1 jsonb;
  v_rows2 jsonb;
  v_sample uuid;
begin
  v_rows1 := public.compute_sample(v_wp, 'system');
  v_rows2 := public.compute_sample(v_wp, 'system');
  perform provio_test.assert_eq(v_rows1, v_rows2, '4D: system sampling is deterministic and reproducible');
  perform provio_test.assert_true(jsonb_array_length(v_rows1) >= 5, '4D: the system sample meets the floor');
  perform provio_test.assert_eq(
    (select sample_rows from samples where workpaper_id = v_wp), v_rows1,
    '4D: the computed rows are stored on the sample');
  perform provio_test.assert_true(
    (select seed is not null from samples where workpaper_id = v_wp),
    '4D: the deterministic seed is recorded');
  select id into v_sample from samples where workpaper_id = v_wp;
  perform public.lock_sample(v_sample);
  perform provio_test.assert_true(
    (select locked_at is not null from samples where id = v_sample), '4D: a sample that meets the floor locks');
  -- A locked sample is immutable.
  perform provio_test.assert_raises(
    format($q$update samples set sample_rows = '[]'::jsonb where id = %L$q$, v_sample),
    'sample_locked', '4D: a locked sample cannot be edited');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Auditor paste: items not in the population are rejected; items present are accepted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000d2';
  v_rows jsonb;
begin
  perform provio_test.assert_raises(
    format($q$select public.compute_sample(%L,'auditor_paste','[{"row_ref":1},{"row_ref":9}]'::jsonb)$q$, v_wp),
    'not in population', '4D: a pasted item outside the population is rejected');
  v_rows := public.compute_sample(v_wp, 'auditor_paste', '[{"row_ref":1},{"row_ref":3}]'::jsonb);
  perform provio_test.assert_eq(jsonb_array_length(v_rows), 2, '4D: pasted items within the population are accepted');
  perform provio_test.assert_eq(
    (select mode from samples where workpaper_id = v_wp), 'auditor_paste', '4D: the sample mode is recorded');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The floor constraint: a locked sample must hold at least size_floor rows.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into samples (id, org_id, population_id, population_sha256, workpaper_id, size_floor, sample_rows)
  values ('80000000-0000-0000-0000-0000000000d3', 'a0000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-0000000000d1', repeat('f',64),
          '60000000-0000-0000-0000-0000000000d1', 5, '[{"row_ref":1}]'::jsonb);
  perform provio_test.assert_raises(
    $q$select public.lock_sample('80000000-0000-0000-0000-0000000000d3')$q$,
    'sample_floor', '4D: locking below the floor is refused');
  perform provio_test.assert_raises(
    $q$update samples set locked_at = now(), locked = true where id = '80000000-0000-0000-0000-0000000000d3'$q$,
    'samples_floor_chk', '4D: the floor is enforced at the database, not the client');
end $$;

-- ---------------------------------------------------------------------------
-- 5. A locked sample is replaced with a rationale, and the old row is retained.
-- ---------------------------------------------------------------------------
do $$
declare
  v_old uuid;
  v_new uuid;
begin
  select id into v_old from samples where workpaper_id = '60000000-0000-0000-0000-0000000000d1' and locked_at is not null;
  perform provio_test.assert_raises(
    format($q$select public.replace_sample(%L,'short')$q$, v_old),
    'at least 10 characters', '4D: replacement needs a rationale');
  v_new := public.replace_sample(v_old, 'The source extract was corrected after a query fix.');
  perform provio_test.assert_eq(
    (select locked_at is not null from samples where id = v_old), true, '4D: the old locked sample is retained');
  perform provio_test.assert_true(v_new is not null, '4D: replacement returns the new sample id');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'sample_replaced'), '4D: replacement writes a ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 6. compute_sample needs a verified population on the workpaper.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compute_sample('60000000-0000-0000-0000-0000000000d9','system')$q$,
    'no verified population', '4D: system sampling without a verified population is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 7. A caller without perform_work cannot compute a sample.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compute_sample('60000000-0000-0000-0000-0000000000d1','system')$q$,
    'perform_work', '4D: a caller without perform_work cannot compute a sample');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 8. Isolation: Org B cannot read Org A sampling rows; anon reads nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from org_sampling_table where org_id = 'a0000000-0000-0000-0000-000000000001'), 0::bigint,
    '4D: an Org B caller reads zero Org A sampling rules');
end $$;
select provio_test.as_owner();
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from org_sampling_table), 0::bigint, '4D: anon reads zero sampling rules');
end $$;
select provio_test.as_owner();

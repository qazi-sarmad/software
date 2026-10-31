-- Test 105 (Phase 2.7): locking a sample seeds the tested rows.
--
-- Before migration 0104 `lock_sample` (0027) locked a sample and stopped: `workpaper_rows` (0028) had
-- no writer but `record_workpaper_row`, and `workpaper_rows.sample_id` had no writer at all. The
-- auditor drew a sample and then had to re-key every row_ref by hand, with nothing linking the two.
-- 0104 seeds one `workpaper_rows` row per `samples.sample_rows` element when the sample locks, sets
-- `sample_id`, and exposes `sample_tested_rows` for the drilldown.
--
-- Every assertion runs under a real role.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: a testing workpaper with a verified 100-row population.
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

-- ===========================================================================
-- 1. The right check: a caller without perform_work cannot lock a sample.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_sample uuid;
begin
  perform public.compute_sample('60000000-0000-0000-0000-0000000000d1', 'system');
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  perform provio_test.assert_true(v_sample is not null, '2.7: computing a sample creates the sample row');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
declare
  v_sample uuid;
begin
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  perform provio_test.assert_raises(
    format($q$select public.lock_sample(%L)$q$, v_sample),
    'perform_work', '2.7: a caller without perform_work cannot lock a sample');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 2. Locking the sample seeds one workpaper_rows row per sampled row, linked by sample_id.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_sample uuid;
  v_n int;
  v_seeded int;
  v_unlinked int;
begin
  select id, jsonb_array_length(sample_rows) into v_sample, v_n
    from samples where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  perform public.lock_sample(v_sample);
  select count(*), count(*) filter (where sample_id = v_sample)
    into v_seeded, v_unlinked
    from workpaper_rows where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  perform provio_test.assert_eq(v_seeded, v_n, '2.7: locking seeds one row per sampled row');
  perform provio_test.assert_eq(v_unlinked, v_n, '2.7: every seeded row is linked to the sample');
  perform provio_test.assert_eq(
    (select count(*) from workpaper_rows
      where workpaper_id = '60000000-0000-0000-0000-0000000000d1' and result is null),
    v_n::bigint, '2.7: a seeded row carries no result yet');
end $$;

-- The ledger entry is read as the CIA, which holds the ledger read right (the preparer does not).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'sample_locked'),
    '2.7: locking writes a ledger entry');
end $$;

-- ===========================================================================
-- 3. Recording a result against a seeded row keeps the sample link (the upsert must not clobber it).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_sample uuid;
  v_ref text;
  v_row_id uuid;
  v_before int;
begin
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  select count(*) into v_before from workpaper_rows
   where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  select row_ref into v_ref from workpaper_rows
   where workpaper_id = '60000000-0000-0000-0000-0000000000d1' order by row_ref limit 1;
  select id into v_row_id from workpaper_rows
   where workpaper_id = '60000000-0000-0000-0000-0000000000d1' and row_ref = v_ref;
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000d1', v_ref, 'tick');
  perform provio_test.assert_eq(
    (select result from workpaper_rows where id = v_row_id), 'tick',
    '2.7: a result is recorded against the seeded row');
  perform provio_test.assert_eq(
    (select sample_id from workpaper_rows where id = v_row_id), v_sample,
    '2.7: recording a result keeps the sample link (no duplicate row)');
  perform provio_test.assert_eq(
    (select count(*)::int from workpaper_rows where workpaper_id = '60000000-0000-0000-0000-0000000000d1'),
    v_before, '2.7: recording does not add a row');
end $$;

-- ===========================================================================
-- 4. sample_tested_rows returns exactly the linked rows.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_sample uuid;
begin
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000d1';
  perform provio_test.assert_eq(
    jsonb_array_length(public.sample_tested_rows(v_sample)),
    (select count(*)::int from workpaper_rows
      where workpaper_id = '60000000-0000-0000-0000-0000000000d1'),
    '2.7: sample_tested_rows returns every linked row');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. Cross-organisation: Org B sees no rows for Org A's sample.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    jsonb_array_length(public.sample_tested_rows('80000000-0000-0000-0000-0000000000a1')), 0,
    '2.7: another organisation sees no tested rows for this sample');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. The seeded set can be signed off (every row resolved) — the link makes the flow complete.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  r record;
begin
  for r in select row_ref from workpaper_rows
            where workpaper_id = '60000000-0000-0000-0000-0000000000d1' and result is null loop
    perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000d1', r.row_ref, 'tick');
  end loop;
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.sign_off_workpaper('60000000-0000-0000-0000-0000000000d1');
  perform provio_test.assert_eq(
    (select status from workpapers where id = '60000000-0000-0000-0000-0000000000d1'), 'signed_off',
    '2.7: a workpaper whose rows were seeded from the sample signs off');
end $$;
select provio_test.as_owner();

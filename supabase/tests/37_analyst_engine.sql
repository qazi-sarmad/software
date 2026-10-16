-- Test 37 (4F): Analyst engine DB side — a stored check result references only rows from the caller's
-- own org, and cross-org or out-of-population references are refused (spec §12).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: a verified population with rows, owned by Org A.
insert into workpapers (id, org_id, engagement_id, stage) values
  ('60000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','testing');
insert into populations (id, org_id, engagement_id, workpaper_id, sha256, row_count, status) values
  ('70000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','60000000-0000-0000-0000-0000000000f1',repeat('c',64),3,'verified');
insert into population_rows (org_id, population_id, row_ref, data) values
  ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000f1',1,'{}'),
  ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000f1',2,'{}'),
  ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000f1',3,'{}');

-- ---------------------------------------------------------------------------
-- 1. A valid check result is stored and readable by its own org.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_id uuid;
begin
  v_id := public.create_observation_stub(
    '50000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000f1',
    'round_numbers', '{"multiples":["1000"]}'::jsonb, array[1,2]);
  perform provio_test.assert_true(v_id is not null, '4F: a valid check result is stored');
  perform provio_test.assert_eq(
    (select row_refs from analysis_results where id = v_id), array[1,2],
    '4F: the result keeps its row references');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A row reference outside the population is refused.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_observation_stub('50000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000f1','duplicates','{}'::jsonb,array[99])$q$,
    'row_ref_out_of_scope', '4F: a row reference outside the population is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A caller cannot reference another org's population.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_observation_stub('50000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000f1','duplicates','{}'::jsonb,array[1])$q$,
    'not found in this organisation', '4F: an Org B caller cannot reference an Org A engagement');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Isolation: Org B reads no Org A analysis results; anon reads nothing.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_eq((select count(*) from analysis_results), 0::bigint,
    '4F: an Org B caller reads zero Org A analysis results');
end $$;
select provio_test.as_owner();
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_eq((select count(*) from analysis_results), 0::bigint,
    '4F: anon reads zero analysis results');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. A caller without perform_work cannot raise a finding.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_observation_stub('50000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000f1','duplicates','{}'::jsonb,array[1])$q$,
    'perform_work', '4F: a caller without perform_work cannot raise a finding');
end $$;
select provio_test.as_owner();

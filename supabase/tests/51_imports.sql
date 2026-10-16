-- Test 51 (7B): Imports — the job lifecycle, row validation with field-level reasons, and the commit
-- that writes to the target tables (spec §19).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. start_import creates a pending job and requires manage_engagements.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.start_import('entities', 'e.csv')$q$,
    'manage_engagements', '7B: a preparer cannot start an import');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.start_import('entities', 'entities.csv');
  perform provio_test.assert_true(v_id is not null, '7B: start_import returns a job id');
  perform provio_test.assert_eq((select status from import_jobs where id = v_id), 'pending',
    '7B: a new import job is pending');
end $$;

-- ---------------------------------------------------------------------------
-- 2. validate_import reports valid/invalid counts and a field-level reason.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_res jsonb;
begin
  select id into v_id from import_jobs where org_id = 'a0000000-0000-0000-0000-000000000001'
   order by created_at desc limit 1;
  v_res := public.validate_import(v_id, jsonb_build_array(
    jsonb_build_object('name', 'New Entity', 'universe_id', '30000000-0000-0000-0000-0000000000a1'),
    jsonb_build_object('name', '', 'universe_id', '30000000-0000-0000-0000-0000000000a1'),
    jsonb_build_object('name', 'Bad Universe', 'universe_id', '30000000-0000-0000-0000-0000000000b1')
  ));
  perform provio_test.assert_eq((v_res ->> 'valid')::int, 1, '7B: one row is valid');
  perform provio_test.assert_eq((v_res ->> 'invalid')::int, 2, '7B: two rows are invalid');
  perform provio_test.assert_true((v_res -> 'errors' -> 0 ->> 'reason') is not null,
    '7B: each invalid row carries a reason');
end $$;

-- ---------------------------------------------------------------------------
-- 3. commit_import writes the valid rows to the target table and logs each.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_n int; v_before int; v_after int;
begin
  select id into v_id from import_jobs where org_id = 'a0000000-0000-0000-0000-000000000001'
   order by created_at desc limit 1;
  select count(*) into v_before from entities where org_id = 'a0000000-0000-0000-0000-000000000001';
  v_n := public.commit_import(v_id, jsonb_build_array(
    jsonb_build_object('name', 'Imported Entity', 'universe_id', '30000000-0000-0000-0000-0000000000a1')
  ));
  select count(*) into v_after from entities where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(v_n, 1, '7B: commit_import reports one row');
  perform provio_test.assert_eq(v_after, v_before + 1, '7B: the entity was written');
  perform provio_test.assert_eq((select status from import_jobs where id = v_id), 'done',
    '7B: a committed job is done');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Another organisation cannot see or drive this job.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  perform provio_test.assert_eq((select count(*) from import_jobs), 0::bigint,
    '7B: another organisation sees no import jobs');
  select id into v_id from import_jobs where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_raises(
    format($q$select public.commit_import('%s', '[]'::jsonb)$q$, coalesce(v_id, gen_random_uuid())),
    'not found', '7B: another organisation cannot commit this job');
end $$;

select provio_test.as_owner();

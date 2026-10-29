-- Test 115 (D1-D4): the deterministic capability library's persistence.
--
-- The pure functions themselves are tested in vitest (src/lib/capabilities/*.test.ts). This proves
-- the SQL half: the thresholds read back with their defaults, a change requires edit_config and a
-- reason and is versioned (config-as-ledger), a run is recorded append-only and cannot be edited or
-- deleted, and the read surface is org-scoped.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- a. capability_config_get returns the defaults before any row exists.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare r record;
begin
  select * into r from public.capability_config_get();
  perform provio_test.assert_eq(r.risk_tolerance, 'high', 'D-series: the default risk tolerance is high');
  perform provio_test.assert_eq(r.stratification_sample, 25, 'D-series: the default sample size is 25');
  perform provio_test.assert_eq(r.reviewer_ageing_days, 14, 'D-series: the default ageing window is 14 days');
end $$;

-- ---------------------------------------------------------------------------
-- b. Changing the thresholds requires edit_config and a reason.
-- ---------------------------------------------------------------------------
-- A preparer holds no edit_config and is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select provio_test.assert_raises(
  $$select public.capability_config_save('critical', 30, 20, 'a long enough reason')$$,
  'edit_config', 'D-series: a caller without edit_config cannot change thresholds');

-- A CIA holds edit_config but a short reason is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_raises(
  $$select public.capability_config_save('critical', 30, 20, 'too short')$$,
  'reason', 'D-series: a change needs a reason of at least 10 characters');

-- A valid change is accepted and read back.
select public.capability_config_save('medium', 40, 21, 'Tightened after the Q3 review');
do $$
declare r record; v_versions int;
begin
  select * into r from public.capability_config_get();
  perform provio_test.assert_eq(r.risk_tolerance, 'medium', 'D-series: the changed tolerance reads back');
  perform provio_test.assert_eq(r.stratification_sample, 40, 'D-series: the changed sample reads back');
  perform provio_test.assert_eq(r.reviewer_ageing_days, 21, 'D-series: the changed window reads back');
  select count(*) into v_versions from config_versions
   where org_id = 'a0000000-0000-0000-0000-000000000001' and key = 'capability_config';
  perform provio_test.assert_true(v_versions >= 1, 'D-series: the change is versioned (config-as-ledger)');
end $$;

-- ---------------------------------------------------------------------------
-- c. A run is recorded append-only and cannot be edited or deleted.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_count int;
begin
  v_id := public.capability_run_record('risk_control', repeat('a', 64), '{"breaches":2}'::jsonb, 2);
  perform provio_test.assert_true(v_id is not null, 'D-series: a run is recorded');
  select count(*) into v_count from public.capability_runs_list('risk_control');
  perform provio_test.assert_eq(v_count, 1, 'D-series: the run is listed under its kind');
  perform provio_test.assert_eq((select count(*) from public.capability_runs_list(null)), 1,
    'D-series: the run is listed with no kind filter');
end $$;

-- The append-only trigger refuses an update and a delete even when the grant would allow it.
do $$
begin
  perform provio_test.assert_raises(
    $$update capability_runs set finding_count = 99$$,
    'append-only', 'D-series: a run cannot be updated');
  perform provio_test.assert_raises(
    $$delete from capability_runs$$,
    'append-only', 'D-series: a run cannot be deleted');
end $$;

-- An unknown kind is refused, and a missing inputs hash is refused.
select provio_test.assert_raises(
  $$select public.capability_run_record('not_a_kind', repeat('a',64), '{}'::jsonb, 0)$$,
  'unknown capability kind', 'D-series: an unknown kind is refused');
select provio_test.assert_raises(
  $$select public.capability_run_record('assurance_ops', 'short', '{}'::jsonb, 0)$$,
  'inputs hash', 'D-series: a missing inputs hash is refused');

-- ---------------------------------------------------------------------------
-- d. The read surface is org-scoped: org B sees none of org A's runs.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from public.capability_runs_list(null)), 0,
    'D-series: org B sees none of org A''s runs');
end $$;

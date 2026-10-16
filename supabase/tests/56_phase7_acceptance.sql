-- Test 56 (7E): Phase 7 acceptance — the cross-cutting guarantees for exports, imports, activity
-- archival and prior-year import in one place. Cross-org reads and writes refused, unauthenticated
-- calls refused, no-right callers refused, exports write the ledger, and the prior-year import
-- blocks planning sign-off until it is confirmed (spec §18, §19; L2, L5).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Cross-org: an Org B caller reads zero Org A rows in every Phase 7 table and cannot call a Phase 7
--    RPC that targets an Org A object.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['exports_log','import_jobs','archive_jobs','prior_year_imports'] loop
    execute format('select count(*) from %I where org_id = %L', t, 'a0000000-0000-0000-0000-000000000001') into n;
    perform provio_test.assert_eq(n, 0::bigint, format('7E: an Org B caller reads zero Org A rows in %s', t));
  end loop;
  perform provio_test.assert_raises(
    $q$select public.export_workpaper('60000000-0000-0000-0000-0000000000a1')$q$,
    'not found in this organisation', '7E: an Org B caller cannot export an Org A workpaper');
  perform provio_test.assert_raises(
    $q$select public.import_prior_year_item('50000000-0000-0000-0000-0000000000a1','scope','50000000-0000-0000-0000-0000000000a2')$q$,
    'not found in this organisation', '7E: an Org B caller cannot import an Org A engagement');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Unauthenticated: anon cannot call any Phase 7 RPC and reads zero rows.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.log_export('workpaper', null, 'csv', '{}'::jsonb, 'h')$q$,
    null, '7E: anon cannot log an export');
  perform provio_test.assert_raises(
    $q$select public.start_import('rcm', 'a.csv')$q$,
    null, '7E: anon cannot start an import');
  perform provio_test.assert_eq((select count(*) from exports_log), 0::bigint,
    '7E: anon reads zero export rows');
  perform provio_test.assert_eq((select count(*) from import_jobs), 0::bigint,
    '7E: anon reads zero import jobs');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. No-right caller: the Observer holds neither manage_engagements nor manage_users.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.archive_activity_period('a0000000-0000-0000-0000-000000000001','2026-01-01','2026-01-31')$q$,
    'manage_engagements', '7E: an Observer cannot archive the activity log');
  perform provio_test.assert_raises(
    $q$select public.export_full_tenant('a0000000-0000-0000-0000-000000000001')$q$,
    'manage_users', '7E: an Observer cannot export the full tenant');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. An export writes a hash-chained ledger entry (§18).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.log_export('workpaper', '60000000-0000-0000-0000-0000000000a1', 'csv', '{}'::jsonb, 'abc123');
  perform provio_test.assert_true(v_id is not null, '7E: log_export returns a row id');
  perform provio_test.assert_raises(
    $q$select public.log_export('workpaper', null, 'docx', '{}'::jsonb, 'h')$q$,
    'unknown export format', '7E: an unknown export format is refused');
end $$;

-- The ledger is visible to cia/org_admin only, so read it as cia.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'export_logged'),
    '7E: the export writes a hash-chained ledger entry');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Prior-year import blocks planning sign-off until every item is confirmed (§19.2).
-- ---------------------------------------------------------------------------
-- One planning section prepared by a different user, with no risks, so the four-eyes and reconciliation
-- gates pass and the prior-year gate is the one that fires.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'scope',
                                       jsonb_build_object('summary', 'A scope'));
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_import uuid;
begin
  v_import := public.import_prior_year_item('50000000-0000-0000-0000-0000000000a2', 'scope',
                                            '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(v_import is not null, '7E: a prior-year item is imported');
  perform provio_test.assert_eq(
    (select status from prior_year_imports where id = v_import), 'imported_confirm',
    '7E: an imported item starts as Imported - confirm');
  perform provio_test.assert_eq(public.unconfirmed_prior_year_imports('50000000-0000-0000-0000-0000000000a1'), 1,
    '7E: the unconfirmed count is one');
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a1')$q$,
    'prior-year', '7E: an unconfirmed prior-year import blocks planning sign-off');
  perform public.confirm_prior_year_item(v_import);
  perform provio_test.assert_eq(public.unconfirmed_prior_year_imports('50000000-0000-0000-0000-0000000000a1'), 0,
    '7E: confirming the item clears the count');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. An import job is org-scoped: another org cannot validate or commit it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
select public.start_import('rcm', 'rcm.csv') as job_id \gset
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_raises(
  'select public.validate_import(''' || :'job_id' || ''', ''[]''::jsonb)',
  'not found in this organisation', '7E: another org cannot validate an Org A import job');
select provio_test.assert_raises(
  'select public.commit_import(''' || :'job_id' || ''', ''[]''::jsonb)',
  'not found in this organisation', '7E: another org cannot commit an Org A import job');

select provio_test.as_owner();

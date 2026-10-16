-- Test 50 (7A): Exports — the recorded export log, the hash-chained ledger entry and the per-object
-- export functions (spec §18, §26).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. log_export writes a row and a ledger entry (§18).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.log_export('workpaper', '60000000-0000-0000-0000-0000000000a1', 'csv',
                            jsonb_build_object('stage', 'testing'), repeat('c', 64));
  perform provio_test.assert_true(v_id is not null, '7A: log_export returns an id');
  perform provio_test.assert_eq(
    (select format from exports_log where id = v_id), 'csv', '7A: the export records the format');
  perform provio_test.assert_eq(
    (select count(*) from exports_log where org_id = 'a0000000-0000-0000-0000-000000000001'), 1::bigint,
    '7A: the org sees its own export');
end $$;

-- The ledger is visible to cia/org_admin only, so read it as cia.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'export_logged'),
    '7A: the export writes a hash-chained ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An unknown format is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.log_export('workpaper', null, 'docx', '{}'::jsonb, null)$q$,
    'unknown export format', '7A: an unknown format is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 3. export_workpaper returns the workpaper, its rows and its sign-offs.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.export_workpaper('60000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(v -> 'workpaper' is not null, '7A: the bundle carries the workpaper');
  perform provio_test.assert_true(jsonb_typeof(v -> 'rows') = 'array', '7A: rows is an array');
  perform provio_test.assert_true(jsonb_typeof(v -> 'sign_offs') = 'array', '7A: sign_offs is an array');
end $$;

-- ---------------------------------------------------------------------------
-- 4. export_engagement_bundle returns every engagement-scoped section.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.export_engagement_bundle('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(v -> 'engagement' is not null, '7A: the bundle carries the engagement');
  perform provio_test.assert_true(jsonb_typeof(v -> 'populations') = 'array', '7A: populations is an array');
  perform provio_test.assert_true(jsonb_typeof(v -> 'reports') = 'array', '7A: reports is an array');
end $$;

-- ---------------------------------------------------------------------------
-- 5. export_sira_results and export_audit_plan are scoped to their universe.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.export_sira_results('30000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(jsonb_typeof(v -> 'scores') = 'array', '7A: sira scores is an array');
  v := public.export_audit_plan('30000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(jsonb_typeof(v -> 'plans') = 'array', '7A: plans is an array');
end $$;

-- ---------------------------------------------------------------------------
-- 6. export_cap_register and export_ledger refuse a cross-org argument.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.export_cap_register('b0000000-0000-0000-0000-000000000001')$q$,
    'cross-org export refused', '7A: export_cap_register refuses another org');
  perform provio_test.assert_raises(
    $q$select public.export_ledger('b0000000-0000-0000-0000-000000000001')$q$,
    'cross-org export refused', '7A: export_ledger refuses another org');
end $$;

-- ---------------------------------------------------------------------------
-- 7. export_activity_log honours the time window.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.export_activity_log('a0000000-0000-0000-0000-000000000001', null, null);
  perform provio_test.assert_true(jsonb_array_length(v -> 'rows') >= 1, '7A: the full activity window has rows');
  v := public.export_activity_log('a0000000-0000-0000-0000-000000000001', now() + interval '1 day', null);
  perform provio_test.assert_eq(jsonb_array_length(v -> 'rows'), 0,
    '7A: a window after now has no rows');
end $$;

-- ---------------------------------------------------------------------------
-- 8. export_full_tenant requires manage_users.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.export_full_tenant('a0000000-0000-0000-0000-000000000001')$q$,
    'manage_users', '7A: an audit_manager cannot export the whole tenant');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v jsonb;
begin
  v := public.export_full_tenant('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v ->> 'org_id', 'a0000000-0000-0000-0000-000000000001',
    '7A: an org_admin with manage_users can export the whole tenant');
  perform provio_test.assert_true(jsonb_typeof(v -> 'ledger') = 'array', '7A: the tenant bundle carries the ledger');
end $$;

-- ---------------------------------------------------------------------------
-- 9. Another organisation sees no exports.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq((select count(*) from exports_log), 0::bigint,
    '7A: another organisation sees no exports');
  perform provio_test.assert_raises(
    $q$insert into exports_log (org_id, object_type, format) values ('b0000000-0000-0000-0000-000000000001','x','csv')$q$,
    'permission denied', '7A: a tenant role cannot insert into exports_log directly');
end $$;

select provio_test.as_owner();

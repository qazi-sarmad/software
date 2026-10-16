-- Test 52 (7C): Activity log archival — period export, row count, content hash, ledger entry and the
-- delete of archived rows (spec §26).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Give org A some activity in a known window.
insert into activity_log (org_id, action, ts) values
  ('a0000000-0000-0000-0000-000000000001', 'old_1', now() - interval '400 days'),
  ('a0000000-0000-0000-0000-000000000001', 'old_2', now() - interval '390 days'),
  ('a0000000-0000-0000-0000-000000000001', 'recent_1', now());

-- ---------------------------------------------------------------------------
-- 1. archive_activity_period requires manage_engagements (§26 admin-only).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.archive_activity_period('a0000000-0000-0000-0000-000000000001', current_date - 500, current_date - 300)$q$,
    'manage_engagements', '7C: a preparer cannot archive the activity log');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Archiving the old window removes only those rows and records the count + hash.
-- ---------------------------------------------------------------------------
-- activity_log is visible to cia/org_admin only, so the counts are read as the owner around the call.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from activity_log
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action in ('old_1', 'old_2')),
    2::bigint, '7C: the two old rows are present before the archive');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.archive_activity_period('a0000000-0000-0000-0000-000000000001',
                                         (current_date - 500), (current_date - 300));
  perform provio_test.assert_true(v_id is not null, '7C: archive_activity_period returns a job id');
end $$;

select provio_test.as_owner();
do $$
declare v_id uuid;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_eq((select archived_row_count from archive_jobs where id = v_id), 2,
    '7C: the archive records the row count');
  perform provio_test.assert_true((select content_hash from archive_jobs where id = v_id) is not null,
    '7C: the archive records a content hash');
  perform provio_test.assert_true((select storage_path from archive_jobs where id = v_id) is not null,
    '7C: the archive records a storage path');
  perform provio_test.assert_eq((select status from archive_jobs where id = v_id), 'done',
    '7C: a completed archive job is done');
  -- D-7C-append-only: activity_log stays append-only (L5), so the rows are NOT physically deleted.
  perform provio_test.assert_eq(
    (select count(*) from activity_log
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action in ('old_1', 'old_2')),
    2::bigint, '7C: the archived rows remain in the append-only log (L5 outranks the delete step)');
  perform provio_test.assert_eq(
    (select count(*) from activity_log
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'recent_1'),
    1::bigint, '7C: the recent row is untouched');
end $$;

-- The ledger is visible to cia/org_admin only, so read it as cia.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'activity_archived'),
    '7C: the archive writes a hash-chained ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cross-org refusal and no direct writes.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.archive_activity_period('b0000000-0000-0000-0000-000000000001', current_date - 10, current_date)$q$,
    'cross-org archive refused', '7C: a cross-org archive is refused');
  perform provio_test.assert_raises(
    $q$insert into archive_jobs (org_id, period_start, period_end) values ('a0000000-0000-0000-0000-000000000001', current_date, current_date)$q$,
    'permission denied', '7C: a tenant role cannot insert into archive_jobs directly');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Another organisation sees no archive jobs.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq((select count(*) from archive_jobs), 0::bigint,
    '7C: another organisation sees no archive jobs');
end $$;

select provio_test.as_owner();

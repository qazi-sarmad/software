-- Test 86 (C2.5): verified archival. Nothing is deleted before a verified upload (spec §25.4).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. An activity archive stops at 'pending': the file does not exist yet, so nothing may say 'done'.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.archive_activity_period('a0000000-0000-0000-0000-000000000001',
                                         current_date - 500, current_date - 300);
  perform provio_test.assert_true(v_id is not null, 'C2.5: archive_activity_period returns a job id');
end $$;

select provio_test.as_owner();
do $$
declare v_id uuid;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_eq((select status from archive_jobs where id = v_id), 'pending',
    'C2.5: an archive with no uploaded file is pending, not done');
  perform provio_test.assert_true((select upload_verified_at from archive_jobs where id = v_id) is null,
    'C2.5: a pending archive has no verification timestamp');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A hash that does not match is refused, and raises an integrity alert (§25.4 "never silently
--    accepted"). The function returns the status rather than raising, so the refusal and its alert
--    are both durable.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_status text;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;

  v_status := public.archive_job_mark_uploaded(v_id, repeat('0', 64), 10::bigint);
  perform provio_test.assert_eq(v_status, 'failed',
    'C2.5: a stored file whose hash differs is refused');

  perform provio_test.assert_eq((select status from archive_jobs where id = v_id), 'failed',
    'C2.5: a mismatched upload leaves the job failed');
  perform provio_test.assert_eq(
    (select count(*) from integrity_alerts
      where object_type = 'archive_job' and object_id = v_id and kind = 'archive_hash_mismatch'),
    1::bigint, 'C2.5: a hash mismatch raises exactly one integrity alert');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The matching hash is accepted and only then is the job done.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_hash text; v_status text;
begin
  select id, content_hash into v_id, v_hash from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  v_status := public.archive_job_mark_uploaded(v_id, v_hash, 42::bigint);
  perform provio_test.assert_eq(v_status, 'done',
    'C2.5: a matching stored hash is accepted');
  perform provio_test.assert_eq((select status from archive_jobs where id = v_id), 'done',
    'C2.5: the job is done once the stored hash matches');
  perform provio_test.assert_true((select upload_verified_at from archive_jobs where id = v_id) is not null,
    'C2.5: the verification timestamp is recorded');
  perform provio_test.assert_eq((select uploaded_bytes from archive_jobs where id = v_id), 42::bigint,
    'C2.5: the stored size is recorded');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Population archival: deletion is blocked before the upload is verified.
-- ---------------------------------------------------------------------------
-- A population with working rows, in org A. The population gate (L3) requires a positive row count
-- and a SHA-256 before the row may be marked verified, so the rows go in first, then the status.
insert into populations (id, org_id, engagement_id, sha256, row_count, status)
values ('c2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', repeat('ab', 32), 2, 'pending')
on conflict (id) do update set sha256 = excluded.sha256, status = 'pending';

insert into population_rows (org_id, population_id, row_ref, data) values
  ('a0000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 1, '{"a": 1}'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 2, '{"a": 2}'::jsonb)
on conflict do nothing;

update populations set status = 'verified'
 where id = 'c2000000-0000-0000-0000-000000000001';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  v_id := public.archive_population('c2000000-0000-0000-0000-000000000001');
  perform provio_test.assert_true(v_id is not null, 'C2.5: archive_population returns an archive id');
end $$;

select provio_test.as_owner();
do $$
declare v_id uuid;
begin
  select id into v_id from population_archives
   where population_id = 'c2000000-0000-0000-0000-000000000001';

  -- Nothing deleted yet: the archive is only recorded.
  perform provio_test.assert_eq(
    (select count(*) from population_rows where population_id = 'c2000000-0000-0000-0000-000000000001'),
    2::bigint, 'C2.5: the working rows are still present before any upload');
  perform provio_test.assert_eq((select status from population_archives where id = v_id), 'pending',
    'C2.5: a population archive starts pending');
  perform provio_test.assert_eq((select content_hash from population_archives where id = v_id),
    (select sha256 from populations where id = 'c2000000-0000-0000-0000-000000000001'),
    'C2.5: the archive carries the original population hash');

  -- A wrong hash is refused, alerts, and leaves the rows untouched.
  perform provio_test.assert_eq(
    public.population_archive_verify(v_id, repeat('cd', 32), 5::bigint), 'failed',
    'C2.5: a population upload with a wrong hash is refused');
  perform provio_test.assert_eq(
    (select count(*) from population_rows where population_id = 'c2000000-0000-0000-0000-000000000001'),
    2::bigint, 'C2.5: the working rows survive a refused upload');
  perform provio_test.assert_eq((select status from population_archives where id = v_id), 'failed',
    'C2.5: a refused population upload marks the archive failed');
  perform provio_test.assert_eq(
    (select count(*) from integrity_alerts
      where object_type = 'population_archive' and object_id = v_id),
    1::bigint, 'C2.5: a refused population upload raises exactly one integrity alert');

  -- The matching hash verifies the upload and only then removes the working rows.
  perform public.population_archive_verify(v_id, repeat('ab', 32), 99::bigint);
  perform provio_test.assert_eq(
    (select count(*) from population_rows where population_id = 'c2000000-0000-0000-0000-000000000001'),
    0::bigint, 'C2.5: the working rows are removed only after a verified upload');
  perform provio_test.assert_eq((select status from population_archives where id = v_id), 'done',
    'C2.5: a verified population archive is done');
  perform provio_test.assert_true(
    (select working_rows_removed_at from population_archives where id = v_id) is not null,
    'C2.5: the removal timestamp is recorded');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Download re-check: a mismatch alerts and returns false; a match returns true and does not
--    re-run anything (§25.4).
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from population_archives
   where population_id = 'c2000000-0000-0000-0000-000000000001';

  perform provio_test.assert_true(public.population_archive_check(v_id, repeat('ab', 32)),
    'C2.5: a download whose hash matches is accepted');
  perform provio_test.assert_true(not public.population_archive_check(v_id, repeat('ee', 32)),
    'C2.5: a download whose hash differs is refused');
  perform provio_test.assert_eq(
    (select count(*) from integrity_alerts
      where object_type = 'population_archive' and object_id = v_id
        and kind = 'population_archive_download_mismatch'),
    1::bigint, 'C2.5: a download mismatch raises an integrity alert');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The archived population stays viewable (paginated) after the rows are gone, and the tenant
--    reads only its own. Also: a caller without read_only sees nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid; v_n int;
begin
  select id into v_id from population_archives
   where population_id = 'c2000000-0000-0000-0000-000000000001';
  select count(*) into v_n from public.population_archive_page(v_id, 50, 0);
  perform provio_test.assert_eq(v_n, 1, 'C2.5: an archived population is still viewable');
  -- Pagination is real: an offset past the single row returns nothing.
  select count(*) into v_n from public.population_archive_page(v_id, 50, 10);
  perform provio_test.assert_eq(v_n, 0, 'C2.5: the archived view is paginated');
end $$;

-- An Observer (read_only, and not a writer) can still read the archive: §25.4 says archived
-- populations remain available at any time.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
declare v_id uuid; v_n int;
begin
  select id into v_id from population_archives
   where population_id = 'c2000000-0000-0000-0000-000000000001';
  select count(*) into v_n from public.population_archive_page(v_id, 50, 0);
  perform provio_test.assert_eq(v_n, 1, 'C2.5: an Observer can view the archived population');
end $$;

-- An Org B user must not read an Org A archive.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'audit_manager');
do $$
declare v_id uuid; v_n int;
begin
  select id into v_id from population_archives
   where population_id = 'c2000000-0000-0000-0000-000000000001';
  perform provio_test.assert_true(v_id is null,
    'C2.5: an Org B caller cannot even see the Org A archive row');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Retention: each organisation may set its own period; the platform default is six months.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
begin
  -- The accessor is what the app and the scheduled job read, so an organisation with no settings row
  -- still gets the platform default of six months.
  perform provio_test.assert_eq(
    public.population_retention_months('a0000000-0000-0000-0000-000000000001'),
    6, 'C2.5: the platform default population retention is six months');

  -- An organisation may set its own period.
  insert into org_settings_extra (org_id, population_archive_after_months)
  values ('a0000000-0000-0000-0000-000000000001', 12)
  on conflict (org_id) do update set population_archive_after_months = 12;
  perform provio_test.assert_eq(
    public.population_retention_months('a0000000-0000-0000-0000-000000000001'),
    12, 'C2.5: an organisation may set its own retention period');
end $$;

-- ---------------------------------------------------------------------------
-- 8. population_archive_due: an engagement finalised long ago is due; one finalised recently is not.
-- ---------------------------------------------------------------------------
-- Back to the platform default so the 400-day fixture below is unambiguously past its period.
update org_settings_extra set population_archive_after_months = 6
 where org_id = 'a0000000-0000-0000-0000-000000000001';

insert into report_versions (org_id, engagement_id, version_number, status, frozen_at)
values ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a2', 1, 'frozen',
        now() - interval '400 days')
on conflict (engagement_id, version_number) do update set frozen_at = excluded.frozen_at, status = 'frozen';

insert into populations (id, org_id, engagement_id, sha256, row_count, status)
values ('c2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a2', repeat('ef', 32), 1, 'pending')
on conflict (id) do update set sha256 = excluded.sha256, status = 'pending';
update populations set status = 'verified' where id = 'c2000000-0000-0000-0000-000000000002';

-- population_archive_due is org-scoped (it compares p_org_id to jwt_org_id()), so the query runs as
-- an org-A user; the fixtures above were inserted with owner rights.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_due int;
begin
  select count(*) into v_due from public.population_archive_due('a0000000-0000-0000-0000-000000000001')
   where population_id = 'c2000000-0000-0000-0000-000000000002';
  perform provio_test.assert_eq(v_due, 1,
    'C2.5: a population finalised beyond its retention period is due for archival');

  -- The already-archived population is not reported again.
  select count(*) into v_due from public.population_archive_due('a0000000-0000-0000-0000-000000000001')
   where population_id = 'c2000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(v_due, 0,
    'C2.5: an archived population is not reported as due again');
end $$;

-- ---------------------------------------------------------------------------
-- 9. The upload authority check the edge function runs as the caller (C1.2): the database decides,
--    the request body does not. A caller with the right in this org may upload; another org's caller
--    and a caller without the right may not.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_true(public.can_upload_archive(v_id),
    'C2.5: a caller with manage_engagements may upload this org archive');
end $$;

-- A Preparer lacks manage_engagements.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_id uuid;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_true(not public.can_upload_archive(v_id),
    'C2.5: a caller without manage_engagements may not upload the archive');
end $$;

-- An Org B caller naming an Org A archive is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_true(not public.can_upload_archive(v_id),
    'C2.5: a cross-org upload check is refused');
end $$;

-- The service-only readers are not callable by an authenticated caller (F5: no secret, no raw row).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_id uuid;
begin
  select id into v_id from archive_jobs
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.archive_job_for_upload(%L::uuid)$q$, v_id),
    'permission denied', 'C2.5: an authenticated caller cannot read the upload row');
  perform provio_test.assert_raises(
    format($q$select public.archive_job_canonical(%L::uuid)$q$, v_id),
    'permission denied', 'C2.5: an authenticated caller cannot read the canonical payload');
end $$;

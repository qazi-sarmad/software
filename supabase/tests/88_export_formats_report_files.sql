-- Test 88 (C2.7): the widened export format vocabulary and the issued report's files
-- (spec §18, §15.5).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Build a frozen report for A-Eng1, so a report file can be stored (store_report_file requires a
-- frozen or issued version).
insert into workpaper_rows (org_id, workpaper_id, row_ref, result) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','tick');
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_owner();
insert into caps (org_id, finding_id, responsible_dept, due_date, status)
select 'a0000000-0000-0000-0000-000000000001', f.id, 'Finance', current_date + 14, 'open'
  from findings f
 where f.org_id = 'a0000000-0000-0000-0000-000000000001'
   and f.entity_id = (select entity_id from engagements where id = '50000000-0000-0000-0000-0000000000a1');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform public.freeze_report(v_version);
end $$;

-- ---------------------------------------------------------------------------
-- 1. The export vocabulary now accepts the binary formats §18 lists, and still refuses nonsense.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  foreach v_id in array array[
    public.log_export('workpaper', null, 'docx', '{}'::jsonb, 'h'),
    public.log_export('workpaper', null, 'png', '{}'::jsonb, 'h'),
    public.log_export('workpaper', null, 'svg', '{}'::jsonb, 'h')
  ] loop
    perform provio_test.assert_true(v_id is not null, 'C2.7: a binary export format is accepted');
  end loop;
  perform provio_test.assert_raises(
    $q$select public.log_export('workpaper', null, 'xml', '{}'::jsonb, null)$q$,
    'unknown export format', 'C2.7: an unknown format is still refused');
end $$;

-- ---------------------------------------------------------------------------
-- 2. store_report_file requires the approve_plan right.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.store_report_file('%s','pdf','a/x.pdf','deadbeef',10)$q$, v_version),
    'approve_plan', 'C2.7: a caller without approve_plan cannot store a report file');
end $$;

-- ---------------------------------------------------------------------------
-- 3. As CIA, both files are stored, the hashes are recorded and the ledger carries each hash.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid; v_pdf uuid; v_docx uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  v_pdf := public.store_report_file(v_version, 'pdf', 'a0000000/reports/' || v_version || '.pdf', 'pdfhash', 2048);
  v_docx := public.store_report_file(v_version, 'docx', 'a0000000/reports/' || v_version || '.docx', 'docxhash', 1024);
  perform provio_test.assert_true(v_pdf is not null and v_docx is not null, 'C2.7: both report files are stored');
  perform provio_test.assert_eq(
    (select sha256 from report_files where report_version_id = v_version and kind = 'pdf'),
    'pdfhash', 'C2.7: the PDF hash is recorded by the database');
  perform provio_test.assert_eq(
    (select sha256 from report_files where report_version_id = v_version and kind = 'docx'),
    'docxhash', 'C2.7: the DOCX hash is recorded by the database');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
      and action = 'report_file_stored'),
    2::bigint, 'C2.7: each stored file writes a hash-chained ledger entry');
  perform provio_test.assert_raises(
    format($q$select public.store_report_file('%s','txt','a/x.txt','h',1)$q$, v_version),
    'unknown report file kind', 'C2.7: an unknown file kind is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cross-org: an Org B caller cannot store a file for an Org A report version.
-- ---------------------------------------------------------------------------
-- Read the version id as the owner (RLS would hide it from Org B) and hand it over through a
-- session setting, which both roles can read.
select provio_test.as_owner();
select set_config('provio.c27_version', (select id::text from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1), false);

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid := current_setting('provio.c27_version')::uuid;
begin
  perform provio_test.assert_raises(
    format($q$select public.store_report_file('%s','pdf','b/x.pdf','h',1)$q$, v_version),
    'not found in this organisation', 'C2.7: an Org B caller cannot store a file for an Org A report');
end $$;

-- ---------------------------------------------------------------------------
-- 5. No direct write path: authenticated cannot insert into report_files.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into report_files (org_id, report_version_id, kind, storage_path, sha256)
       values ('a0000000-0000-0000-0000-000000000001', gen_random_uuid(), 'pdf', 'x', 'h')$q$,
    'permission denied', 'C2.7: there is no direct write path to report_files');
end $$;

-- Org B sees none of Org A's report files (RLS).
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from report_files), 0::bigint,
    'C2.7: Org B sees no report files belonging to Org A');
end $$;

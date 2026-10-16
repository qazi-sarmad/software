-- Test 49 (6C): Freeze and issuance — the open-comment gate, the CAP reconciliation gate, the
-- approve_plan right, the hash-chained ledger entries and the queued email (spec §15.5, §16.3).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Build a frozen-ready report for A-Eng1: sign Testing, pull exceptions, sign Conclusion, compose,
-- and give every finding a CAP row so the register reconciles.
insert into workpaper_rows (org_id, workpaper_id, row_ref, result) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','tick');
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;

-- Give every finding of the engagement's entity a CAP row, then recompose so the due dates match.
select provio_test.as_owner();
insert into caps (org_id, finding_id, responsible_dept, due_date, status)
select 'a0000000-0000-0000-0000-000000000001', f.id, 'Finance', current_date + 14, 'open'
  from findings f
 where f.org_id = 'a0000000-0000-0000-0000-000000000001'
   and f.entity_id = (select entity_id from engagements where id = '50000000-0000-0000-0000-0000000000a1');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;

-- ---------------------------------------------------------------------------
-- 1. freeze_report requires the approve_plan right (§15.5).
-- ---------------------------------------------------------------------------
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.freeze_report('%s')$q$, v_version),
    'approve_plan', '6C: a caller without approve_plan cannot freeze');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An open management comment blocks the freeze (§15.2 step 5, §15.5).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid; v_comment uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  v_comment := public.add_report_comment(v_version, null, 'Please clarify the opinion.');
  perform provio_test.assert_raises(
    format($q$select public.freeze_report('%s')$q$, v_version),
    'open_comments', '6C: an open comment blocks the freeze');
end $$;
-- A different reviewer resolves it (four-eyes), clearing the gate.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid; v_comment uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  select id into v_comment from report_comments where report_version_id = v_version and status = 'open' limit 1;
  perform public.resolve_report_comment(v_comment, 'incorporated', 'Clarified.');
  perform provio_test.assert_eq(public.open_report_comment_count(v_version), 0,
    '6C: resolving the comment clears the gate');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A CAP mismatch blocks the freeze (§16.3).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into findings (id, org_id, entity_id, severity) values
  ('f0000000-0000-0000-0000-0000000000f2','a0000000-0000-0000-0000-000000000001',
   (select entity_id from engagements where id = '50000000-0000-0000-0000-0000000000a1'), 'high');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.freeze_report('%s')$q$, v_version),
    'cap_mismatch', '6C: a report finding without a CAP row blocks the freeze');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Once the CAP row exists the freeze succeeds and writes a ledger entry (§15.5).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into caps (org_id, finding_id, responsible_dept, due_date, status) values
  ('a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-0000000000f2','Finance',current_date + 14,'open');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform public.freeze_report(v_version);
  perform provio_test.assert_eq(
    (select status from report_versions where id = v_version), 'frozen',
    '6C: the report is frozen');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
      and action = 'report_frozen'),
    '6C: the freeze writes a hash-chained ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Issuance requires a frozen report and writes a ledger entry plus a queued email (§15.5).
-- ---------------------------------------------------------------------------
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform public.issue_report(v_version);
  perform provio_test.assert_eq(
    (select status from report_versions where id = v_version), 'issued_v1',
    '6C: an issued report is issued_v1');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
      and action = 'report_issued'),
    '6C: issuance writes a hash-chained ledger entry');
end $$;

-- The pending email is invisible to the org (6E RLS), so read it as the owner.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    (select count(*) > 0 from email_queue
      where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'pending'),
    '6C: issuance queues a pending email');
end $$;

-- A draft cannot be issued before it is frozen.
select provio_test.as_owner();
insert into report_versions (org_id, engagement_id, version_number, status) values
  ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1', 99, 'draft');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' and version_number = 99;
  perform provio_test.assert_raises(
    format($q$select public.issue_report('%s')$q$, v_version),
    'not_frozen', '6C: a draft cannot be issued');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Another organisation cannot freeze or issue.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select id as rv_id from report_versions
 where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1 \gset
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_raises(
  'select public.freeze_report(''' || :'rv_id' || ''')',
  'not found', '6C: another organisation cannot freeze this report');

select provio_test.as_owner();

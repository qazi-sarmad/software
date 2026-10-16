-- Test 45 (6A): Report drafting — the Conclusion gate, composed blocks with placeholders, the
-- computed summary and org isolation (spec §15.1, §15.2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: sign off Testing, pull exceptions and sign the Conclusion for A-Eng1, so the report is
-- available (§15.1). Workpapers/rows are inserted as the owner (the Planning gate blocks an app role).
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','cross','Invoice missing','true'),
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R2','tick',null,false),
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R3','tick',null,false);
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1');
end $$;

-- ---------------------------------------------------------------------------
-- 1. The report is refused before Conclusion sign-off, allowed after (§15.1).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compose_report('50000000-0000-0000-0000-0000000000a2')$q$,
    'conclusion_not_signed_off', '6A: the report is refused for an engagement without a signed Conclusion');
end $$;

-- ---------------------------------------------------------------------------
-- 2. compose_report creates a draft with the expected sections and placeholders (§15.2 step 3).
-- ---------------------------------------------------------------------------
do $$
declare v_version uuid; v_blocks int; v_placeholders int;
begin
  v_version := public.compose_report('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(v_version is not null, '6A: a report version is composed');
  select count(*) into v_blocks from report_blocks where report_version_id = v_version;
  perform provio_test.assert_true(v_blocks >= 5, '6A: the default template sections are created');
  perform provio_test.assert_eq(
    (select status from report_versions where id = v_version), 'draft',
    '6A: a newly composed version is a draft');
  -- The scope section is absent for this engagement, so its block is a placeholder.
  perform provio_test.assert_eq(
    (select is_placeholder from report_blocks
      where report_version_id = v_version and section_type = 'scope'), true,
    '6A: a missing value becomes a placeholder block');
end $$;

-- ---------------------------------------------------------------------------
-- 3. compute_report_summary computes every figure from the records (§15.2 step 2).
-- ---------------------------------------------------------------------------
do $$
declare v_version uuid; v jsonb;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  v := public.compute_report_summary(v_version);
  perform provio_test.assert_true((v ? 'findings_by_severity') and (v ? 'pass_proportion'),
    '6A: the summary carries the severity breakdown and the pass proportion');
  perform provio_test.assert_eq((v ->> 'tests_total')::int, 3,
    '6A: the summary counts every resolved row');
  perform provio_test.assert_eq((v ->> 'tests_failed')::int, 1,
    '6A: the summary counts the exception rows');
  perform provio_test.assert_eq((v ->> 'tests_passed')::int, 2,
    '6A: passed = total - failed');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Cross-org and unauthenticated callers are refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compose_report('50000000-0000-0000-0000-0000000000a1')$q$,
    'engagement not found', '6A: another organisation cannot compose this report');
end $$;

select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.compose_report('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '6A: an unauthenticated caller cannot compose a report');
end $$;

select provio_test.as_owner();

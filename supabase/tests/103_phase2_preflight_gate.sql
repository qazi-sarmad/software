-- Test 103 (Phase 2.5): the §11.4 pre-flight is wired into freeze_report.
--
-- Before migration 0102 the pre-flight engine (src/lib/preflight.ts) had no caller but its own test,
-- and freeze_report gated on exactly two inline checks. A report could be frozen with the eight-check
-- pre-flight never executed. 0102 computes the open items from real tables
-- (`preflight_items`), returns the unacknowledged ones (`preflight_blocking`) and refuses the freeze
-- while any remain (`assert_preflight_clear`, called by `freeze_report`).
--
-- Every assertion runs under a real role. The fixture's own state is pre-flight clean, so the first
-- freeze succeeds and proves the gate does not over-block; then one open item is created and the gate
-- is proven to bite.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. The fixture is pre-flight clean: no items, nothing blocking.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    jsonb_array_length(public.preflight_items('50000000-0000-0000-0000-0000000000a1')), 0,
    '2.5: the clean fixture has no open pre-flight item');
  perform provio_test.assert_eq(
    jsonb_array_length(public.preflight_blocking('50000000-0000-0000-0000-0000000000a1')), 0,
    '2.5: the clean fixture blocks nothing');
end $$;

-- ===========================================================================
-- 2. The right check: a caller without perform_work cannot acknowledge.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1', 'unresolved_flags', 'x', 'a long enough reason')$q$,
    'perform_work', '2.5: a caller without perform_work cannot acknowledge');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 3. Create one real open item (an exception row with no review decision), plus the evidence item
--    its exception raises, then prove the freeze is refused with preflight_blocked.
-- ===========================================================================
select provio_test.as_owner();
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag)
values ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','RX','cross','Bank statement missing.', true);

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_items jsonb;
  v_blocking jsonb;
begin
  v_items := public.preflight_items('50000000-0000-0000-0000-0000000000a1');
  v_blocking := public.preflight_blocking('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(
    v_items @> '[{"check_key":"unresolved_flags"}]'::jsonb,
    '2.5: an unreviewed exception row is an unresolved_flags item');
  perform provio_test.assert_true(
    v_items @> '[{"check_key":"missing_evidence"}]'::jsonb,
    '2.5: a workpaper with an exception and no evidence is a missing_evidence item');
  perform provio_test.assert_eq(jsonb_array_length(v_items), jsonb_array_length(v_blocking),
    '2.5: every open item blocks until it is acknowledged');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4. Build a freeze-ready report (mirrors test 49) and prove the freeze is refused.
-- ===========================================================================
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

-- The pulled exception now has a rationale, so exceptions_without_rationale is clear; the
-- unresolved_flags and missing_evidence items remain and block the freeze.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.freeze_report('%s')$q$, v_version),
    'preflight_blocked', '2.5: an unacknowledged pre-flight item blocks the freeze');
  perform provio_test.assert_eq(
    (select status from report_versions where id = v_version), 'draft',
    '2.5: a refused freeze leaves the report a draft');
end $$;

-- ===========================================================================
-- 5. Acknowledge each open item with a reason, then the freeze succeeds.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_row_id text;
  v_item jsonb;
begin
  select r.id::text into v_row_id from workpaper_rows r
   where r.workpaper_id = '60000000-0000-0000-0000-0000000000a1' and r.row_ref = 'RX';
  perform public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1',
    'unresolved_flags', v_row_id, 'Reviewed by the engagement manager; the exception stands.');
  for v_item in select * from jsonb_array_elements(public.preflight_blocking('50000000-0000-0000-0000-0000000000a1')) loop
    perform public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1',
      v_item ->> 'check_key', v_item ->> 'item_id', 'Acknowledged with a reason for the test run.');
  end loop;
  perform provio_test.assert_eq(
    jsonb_array_length(public.preflight_blocking('50000000-0000-0000-0000-0000000000a1')), 0,
    '2.5: every acknowledged item stops blocking');
end $$;

do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform public.freeze_report(v_version);
  perform provio_test.assert_eq(
    (select status from report_versions where id = v_version), 'frozen',
    '2.5: the freeze succeeds once every pre-flight item is acknowledged');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
      and action = 'report_frozen'),
    '2.5: the freeze still writes its ledger entry');
end $$;

-- ===========================================================================
-- 6. The acknowledgement is append-only and the reason is validated.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1', 'unresolved_flags', 'x', 'short')$q$,
    '10 characters', '2.5: a too-short acknowledgement reason is refused');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises(
    $q$update preflight_acks set reason = 'tampered with a longer reason' where org_id = 'a0000000-0000-0000-0000-000000000001'$q$,
    null, '2.5: preflight_acks cannot be edited');
end $$;

-- ===========================================================================
-- 7. Cross-organisation: org B sees none of org A's pre-flight items.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    jsonb_array_length(public.preflight_items('50000000-0000-0000-0000-0000000000a1')), 0,
    '2.5: another organisation sees no pre-flight items for this engagement');
end $$;
select provio_test.as_owner();

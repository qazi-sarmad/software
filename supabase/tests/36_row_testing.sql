-- Test 36 (4E): Row testing — the rationale rule, four-eyes sign-off, the completeness gate and
-- reopen with a justification (spec §11.3, §11.4).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures (as the owner; see test 35 for why an app role cannot create a testing workpaper here).
insert into workpapers (id, org_id, engagement_id, stage, status) values
  ('60000000-0000-0000-0000-0000000000e1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','testing','open');

-- ---------------------------------------------------------------------------
-- 1. The rationale rule: a cross or unverifiable requires a rationale; a tick does not.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 1','cross')$q$,
    'wpr_rationale_chk', '4E: a cross without a rationale is refused');
  perform provio_test.assert_raises(
    $q$select public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 2','unverifiable')$q$,
    'wpr_rationale_chk', '4E: an unverifiable without a rationale is refused');
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 1','tick');
  perform provio_test.assert_true(true, '4E: a tick needs no rationale');
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 2','cross',
    'Invoice missing from the ledger');
  perform provio_test.assert_eq(
    (select exception_flag from workpaper_rows where workpaper_id='60000000-0000-0000-0000-0000000000e1' and row_ref='Row 2'),
    true, '4E: a cross is flagged as an exception by default');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The sign-off completeness gate: every row must have a result.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into workpaper_rows (org_id, workpaper_id, row_ref) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000e1','Row 3');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_off_workpaper('60000000-0000-0000-0000-0000000000e1')$q$,
    'workpaper_incomplete', '4E: sign-off is blocked while a row has no result');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The signer cannot have prepared every row (four-eyes).
-- ---------------------------------------------------------------------------
-- a4 (audit_manager) has review_and_approve but prepared nothing; a2 prepared the rows. That is fine.
-- Instead, have a2 (preparer) gain a right to sign: use the Reviewer role which has review_and_approve,
-- after a2's rows are the only rows. We test the opposite: make a6 prepare every row.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 1','tick');
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 2','cross','Invoice missing from the ledger');
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 3','tick');
  -- a6 prepared / updated every row now; a6 also holds review_and_approve, so a6 cannot sign.
  perform provio_test.assert_raises(
    $q$select public.sign_off_workpaper('60000000-0000-0000-0000-0000000000e1')$q$,
    'four_eyes', '4E: the preparer of every row cannot sign');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A different manager signs once every row is resolved.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.sign_off_workpaper('60000000-0000-0000-0000-0000000000e1');
  perform provio_test.assert_eq(
    (select status from workpapers where id='60000000-0000-0000-0000-0000000000e1'), 'signed_off',
    '4E: a complete, four-eyes workpaper signs off');
  -- A signed-off workpaper is read-only.
  perform provio_test.assert_raises(
    $q$select public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 1','cross','a reason')$q$,
    'workpaper_locked', '4E: a signed-off workpaper is read-only');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id='a0000000-0000-0000-0000-000000000001'
            and action='workpaper_signed_off'), '4E: sign-off writes a ledger entry');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');

-- ---------------------------------------------------------------------------
-- 5. Reopen requires can_reopen and a >=10-character justification.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.reopen_workpaper('60000000-0000-0000-0000-0000000000e1','a long enough reason')$q$,
    'can_reopen', '4E: a caller without can_reopen cannot reopen');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.reopen_workpaper('60000000-0000-0000-0000-0000000000e1','short')$q$,
    'at least 10 characters', '4E: a justification under 10 characters is refused');
  perform public.reopen_workpaper('60000000-0000-0000-0000-0000000000e1',
    'The reviewer identified a mis-ticked row.');
  perform provio_test.assert_eq(
    (select status from workpapers where id='60000000-0000-0000-0000-0000000000e1'), 'reviewed',
    '4E: a reopened workpaper leaves the signed_off state');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id='a0000000-0000-0000-0000-000000000001'
            and action='workpaper_reopened'), '4E: reopen writes a ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A caller without perform_work cannot record a row; isolation holds.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.record_workpaper_row('60000000-0000-0000-0000-0000000000e1','Row 1','tick')$q$,
    'perform_work', '4E: a caller without perform_work cannot record a row');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from workpaper_rows), 0::bigint,
    '4E: an Org B caller reads zero workpaper rows from Org A');
end $$;
select provio_test.as_owner();
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_eq((select count(*) from workpaper_rows), 0::bigint,
    '4E: anon reads zero workpaper rows');
end $$;
select provio_test.as_owner();

-- Test 43 (5B): Conclusion stage — the Testing sign-off gate, the exception pull, four-eyes, the
-- optional opinion configuration and the seal after sign-off (spec §10.3, §10.4, §15.1).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A cross row exists on the engagement's workpaper, so the pull has something to copy. Workpapers are
-- inserted as the owner because an application role cannot create a testing workpaper without a
-- signed-off Planning stage (0025 guard); this test exercises Conclusion, not Planning.
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','cross','Invoice missing','true'),
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R2','tick',null,false);

-- ---------------------------------------------------------------------------
-- 1. pull_exceptions is refused until Testing is signed off (§10.3 gate).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(public.testing_signed_off('50000000-0000-0000-0000-0000000000a1'), false,
    '5B: Testing is not signed off while a workpaper is open');
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    'testing_not_signed_off', '5B: the exception pull is refused before Testing sign-off');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A caller without review_and_approve is refused (rights, not role names).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(public.testing_signed_off('50000000-0000-0000-0000-0000000000a1'), true,
    '5B: Testing is signed off once every workpaper is signed off');
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    'review_and_approve', '5B: a caller without review_and_approve cannot pull exceptions');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A manager pulls the exceptions; only the cross row is copied.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_n int;
begin
  v_n := public.pull_exceptions('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(v_n, 1, '5B: only the cross/unverifiable row is pulled');
  perform provio_test.assert_eq(
    (select jsonb_array_length(exceptions) from conclusion_records
      where engagement_id = '50000000-0000-0000-0000-0000000000a1'), 1,
    '5B: the pulled exception is stored on the conclusion record');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Four-eyes: the caller who pulled the exceptions cannot sign them off (§10.4).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_conclusion('50000000-0000-0000-0000-0000000000a1')$q$,
    'four_eyes', '5B: the preparer of the exceptions cannot sign the conclusion');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Removing a pulled item requires a comment of at least 10 characters (§10.3).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.remove_conclusion_exception('50000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','short')$q$,
    'comment_required', '5B: removing a conclusion item without a comment is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The overall opinion is optional unless the org's methodology requires it (§10.3).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into config_versions (org_id, key, value, version) values
  ('a0000000-0000-0000-0000-000000000001', 'conclusion.opinion_required', 'true', 1);
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_conclusion('50000000-0000-0000-0000-0000000000a1')$q$,
    'opinion_required', '5B: a required opinion blocks sign-off while it is empty');
end $$;

-- ---------------------------------------------------------------------------
-- 7. A different reviewer signs once the opinion is supplied; the engagement is sealed (§10.4).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
update conclusion_records set overall_opinion = 'Adequate'
 where engagement_id = '50000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(
    (select locked_at is not null from conclusion_records
      where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    '5B: the conclusion is locked after sign-off');
  perform provio_test.assert_true(
    (select sealed from engagements where id = '50000000-0000-0000-0000-0000000000a1'),
    '5B: the engagement is sealed after Conclusion sign-off');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'conclusion_signed_off'),
    '5B: sign-off writes a hash-chained ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Cross-org and unauthenticated callers are refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    'engagement not found', '5B: another organisation cannot pull this engagement''s exceptions');
end $$;

select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_conclusion('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '5B: an unauthenticated caller cannot sign a conclusion');
end $$;

select provio_test.as_owner();

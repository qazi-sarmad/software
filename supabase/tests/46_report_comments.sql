-- Test 46 (6B): Management comments — attach to a block, resolve with a reason, four-eyes and the
-- open-comment count the freeze gate reads (spec §15.2 step 5).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A composed report version for A-Eng1 (fixtures prepared as the owner, then composed via the RPC).
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','tick',null,false);
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;

-- ---------------------------------------------------------------------------
-- 1. A comment is attached to a block; the open count reflects it (§15.2 step 5).
-- ---------------------------------------------------------------------------
do $$
declare v_version uuid; v_block uuid; v_comment uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  select id into v_block from report_blocks where report_version_id = v_version order by position limit 1;
  v_comment := public.add_report_comment(v_version, v_block, 'Please reword the scope paragraph.');
  perform provio_test.assert_true(v_comment is not null, '6B: a comment is attached to a block');
  perform provio_test.assert_eq(public.open_report_comment_count(v_version), 1,
    '6B: the open-comment count is 1');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A resolution needs a reason (§15.2 step 5).
-- ---------------------------------------------------------------------------
do $$
declare v_version uuid; v_comment uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  select id into v_comment from report_comments where report_version_id = v_version limit 1;
  perform provio_test.assert_raises(
    format($q$select public.resolve_report_comment('%s','incorporated','')$q$, v_comment),
    'resolution_reason_required', '6B: a resolution without a reason is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Four-eyes: the commenter cannot resolve their own comment (§15.2 step 5).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid; v_comment uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  select id into v_comment from report_comments where report_version_id = v_version limit 1;
  -- a1 is a different user from the commenter (a4); resolving is allowed for a1.
  perform public.resolve_report_comment(v_comment, 'incorporated', 'Reworded in revision 2.');
  perform provio_test.assert_eq(public.open_report_comment_count(v_version), 0,
    '6B: resolving a comment clears the open count');
end $$;

-- The commenter (a4) resolving their own comment is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid; v_comment uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  v_comment := public.add_report_comment(v_version, null, 'Second comment from a4.');
  perform provio_test.assert_raises(
    format($q$select public.resolve_report_comment('%s','rejected','not needed')$q$, v_comment),
    'four_eyes', '6B: the commenter cannot resolve their own comment');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A caller without the right is refused; another org sees nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.add_report_comment('%s', null, 'x')$q$, v_version),
    'perform_work', '6B: a read-only caller cannot comment');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from report_comments), 0::bigint,
    '6B: another organisation reads no comments');
end $$;

select provio_test.as_owner();

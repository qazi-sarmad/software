-- Test 117 (Phase 6, G1): the workpaper-creation path exists and enforces its rules.
--
-- The defect: no migration inserted a workpaper and no RPC created one, so in production an
-- engagement had zero workpapers and the testing workspace's sampling/row-testing panels (gated on
-- `workpapers[0]`) never rendered. `create_workpaper` (0116) is the one write path.
--
-- Runs under a real role for each assertion. a2 is the Preparer (perform_work only).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. The right gates the write: a caller without perform_work is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_workpaper('50000000-0000-0000-0000-0000000000a1')$q$,
    'perform_work', 'create_workpaper: an observer (read-only) cannot create a workpaper');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 2. Planning must be signed off (the guard_testing_lock rule, repeated in the RPC).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_workpaper('50000000-0000-0000-0000-0000000000a1')$q$,
    'testing_locked', 'create_workpaper: refused until planning is signed off');
end $$;
select provio_test.as_owner();

-- Sign planning off (fixtures bypass the rights path, as 102 does), then the preparer may create.
insert into planning_sections (org_id, engagement_id, section_type, content, signed_off_at, signed_off_by) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'scope',
   '{"summary":"x"}'::jsonb, now(), '10000000-0000-0000-0000-0000000000a1');

-- ===========================================================================
-- 3. The happy path: a workpaper is created, carries its title, and is logged.
-- ===========================================================================
-- The id is carried out of the caller's session through a session setting: the ledger select policy
-- admits only cia/org_admin, so the ledger assertion below runs as the owner.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_id uuid;
begin
  v_id := public.create_workpaper('50000000-0000-0000-0000-0000000000a1', null, '  Cash count  ');
  perform provio_test.assert_true(v_id is not null, 'create_workpaper: returns the new id');
  perform set_config('provio_test.new_wp', v_id::text, false);
end $$;
select provio_test.as_owner();
do $$
declare
  v_id uuid := current_setting('provio_test.new_wp')::uuid;
  v_title text;
  v_stage text;
  v_ledger int;
begin
  select title, stage into v_title, v_stage from workpapers where id = v_id;
  perform provio_test.assert_eq(v_title, 'Cash count', 'create_workpaper: the title is trimmed and stored');
  perform provio_test.assert_eq(v_stage, 'testing', 'create_workpaper: the new workpaper is in the testing stage');

  select count(*) into v_ledger from ledger_entries
   where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'workpaper_created'
     and payload->>'workpaper_id' = v_id::text;
  perform provio_test.assert_eq(v_ledger, 1, 'create_workpaper: a ledger entry anchors the creation');
end $$;

-- ===========================================================================
-- 4. Cross-tenant and sealed-engagement refusals.
-- ===========================================================================
-- Org A's preparer cannot create against org B's engagement.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_workpaper('50000000-0000-0000-0000-0000000000b1')$q$,
    'engagement not found', 'create_workpaper: an engagement in another organisation is not found');
end $$;
select provio_test.as_owner();

-- A sealed engagement is read-only.
update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_workpaper('50000000-0000-0000-0000-0000000000a1')$q$,
    'sealed', 'create_workpaper: a sealed engagement is read-only');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. The anonymous surface cannot reach it (F11).
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.create_workpaper(uuid, uuid, text)', 'execute'),
    'create_workpaper: anon has no execute privilege');
end $$;

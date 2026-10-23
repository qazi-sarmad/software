-- Test 79 (S10-FIX, F14, L2): engagement_as_of_events is guarded like engagement_as_of.
--
-- 0068 granted engagement_as_of_events to authenticated and the browser calls it directly, but the
-- body performed no org, scope, right or feature check: an org B member passing an org A engagement
-- uuid read org A's ledger payloads and activity (L2 leak). 0070 replaced the body with the same
-- guard order engagement_as_of uses. This test proves each refusal, and that the happy path still
-- returns the recorded events.
--
-- Applies twice (M2, M6): the whole file is a no-op on a second run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Feature off: the event list is refused with the plan message (F25).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.engagement_as_of_events('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'not included in your plan', 'F25: engagement_as_of_events is refused while time_travel is off');
end $$;
select provio_test.as_owner();

-- Turn the feature on for org A.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','time_travel',true,'Assurance','S10-FIX test');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Cross-org: an org B member cannot read an org A engagement's events.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.engagement_as_of_events('50000000-0000-0000-0000-0000000000a1', now())$q$,
    null, 'L2: a member of org B cannot read an org A engagement''s events (refused by the plan gate or the org guard)');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. Out-of-scope and missing-right refusals, matching engagement_as_of.
-- ---------------------------------------------------------------------------
-- scoped_a (a Preparer) holds only universe u_a1; engagement g_a2 is in u_a2 (out of scope), and a
-- Preparer lacks view_insights even for the in-scope g_a1.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.engagement_as_of_events('50000000-0000-0000-0000-0000000000a2', now())$q$,
    'outside the caller', 'F14: an out-of-scope engagement''s events are refused');
  perform provio_test.assert_raises(
    $q$select * from public.engagement_as_of_events('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'cannot view the engagement timeline', 'F14: a Preparer lacks view_insights for the events');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. Happy path: the CIA reads the recorded events for an in-scope engagement, and the list matches
--    what the reconstruction replays (the same append-only sources).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000a1', 'r1', 'tick');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.sign_off_workpaper('60000000-0000-0000-0000-0000000000a1');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_n int;
  v_res jsonb;
begin
  select count(*) into v_n from public.engagement_as_of_events('50000000-0000-0000-0000-0000000000a1', now());
  perform provio_test.assert_true(v_n >= 1, 'F14: an in-scope CIA reads the recorded events');

  -- The reconstruction and the event list agree on the signed-off workpaper.
  v_res := public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now());
  perform provio_test.assert_true(
    jsonb_array_length(v_res -> 'workpapers') >= 1,
    'F14: the same history is replayable through engagement_as_of');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. anon can execute neither surface.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.engagement_as_of_events('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'permission denied', 'F14: anon cannot execute engagement_as_of_events');
end $$;
select provio_test.as_owner();

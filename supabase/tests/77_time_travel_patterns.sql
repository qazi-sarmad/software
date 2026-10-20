-- Test 77 (S10, F14, F15): Time-Travel and Cross-engagement Patterns.
--
-- F14: engagement_as_of reconstructs an engagement from APPEND-ONLY history only. It refuses when
--      the time_travel feature is off or the engagement is outside the caller's scope, reports
--      "not_recorded_before" rather than guessing, replays the recorded seal/reopen and workpaper
--      events, and writes one batched activity entry per call.
-- F15: pattern_settings stores the deterministic settings within their documented ranges; the read
--      and write both gate on the patterns entitlement and a right; pattern_findings returns only
--      in-scope concluded findings.
-- Applies twice (M2, M6): the whole file is a no-op on a second run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Feature off: both surfaces refuse with the plan message (F25).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.pattern_settings_get('a0000000-0000-0000-0000-000000000001')$q$,
    'not included in your plan', 'F25: pattern_settings_get is refused while patterns is off');
  perform provio_test.assert_raises(
    $q$select public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'not included in your plan', 'F25: engagement_as_of is refused while time_travel is off');
end $$;
select provio_test.as_owner();

-- Turn both features on for org A.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','patterns',true,'Assurance','S10 test');
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','time_travel',true,'Assurance','S10 test');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. pattern_settings: defaults seed on first read, the Org Admin edits within range, and a value
--    out of range is refused (F15).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_rec record;
begin
  select * into v_rec from public.pattern_settings_get('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_rec.similarity_threshold, 0.40::numeric, 'F15: default threshold is 0.40');
  perform provio_test.assert_eq(v_rec.min_cluster_size, 2, 'F15: default minimum cluster size is 2');
  perform provio_test.assert_eq(v_rec.years_back, 5, 'F15: default years back is 5');
  perform provio_test.assert_eq(v_rec.visibility_right, 'view_insights', 'F15: default visibility right');

  perform public.pattern_settings_save('a0000000-0000-0000-0000-000000000001', 0.55, 3, 7,
                                       '["High","Medium"]'::jsonb, 'view_insights');
  select * into v_rec from public.pattern_settings_get('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_rec.similarity_threshold, 0.55::numeric, 'F15: the threshold is saved');
  perform provio_test.assert_eq(v_rec.min_cluster_size, 3, 'F15: the minimum cluster size is saved');
  perform provio_test.assert_eq(v_rec.years_back, 7, 'F15: years back is saved');
  perform provio_test.assert_eq(v_rec.severities, '["High","Medium"]'::jsonb, 'F15: severities are saved');

  perform provio_test.assert_raises(
    $q$select public.pattern_settings_save('a0000000-0000-0000-0000-000000000001', 0.95)$q$,
    'pattern_settings_threshold_chk', 'F15: a threshold above 0.90 is refused');
  perform provio_test.assert_raises(
    $q$select public.pattern_settings_save('a0000000-0000-0000-0000-000000000001', null, 1)$q$,
    'pattern_settings_min_size_chk', 'F15: a minimum cluster size below 2 is refused');
end $$;
select provio_test.as_owner();

-- A caller without view_insights (the Org Admin role carries none of the four assurance rights) is
-- refused: use the auditee-equivalent path via a Preparer, which lacks view_insights.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.pattern_settings_get('a0000000-0000-0000-0000-000000000001')$q$,
    'cannot view insight settings', 'F15: a caller without view_insights cannot read the settings');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. pattern_findings: only concluded, in-scope findings are returned. scoped_a (universe u_a1) sees
--    only findings on entities in u_a1; a cross-org read sees nothing.
-- ---------------------------------------------------------------------------
update findings set status = 'concluded', sections = '{"title":"A finding","condition":"c","risk":"r","effect":"e"}'::jsonb
 where org_id = 'a0000000-0000-0000-0000-000000000001';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  -- The Preparer lacks view_insights, so even the corpus read is refused.
  perform provio_test.assert_raises(
    $q$select * from public.pattern_findings('a0000000-0000-0000-0000-000000000001')$q$,
    'cannot view patterns', 'F15: a caller without view_insights cannot read the corpus');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_n int;
begin
  select count(*) into v_n from public.pattern_findings('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_true(v_n >= 1, 'F15: the corpus returns the concluded finding');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_n int;
begin
  perform provio_test.assert_raises(
    $q$select * from public.pattern_findings('a0000000-0000-0000-0000-000000000001')$q$,
    'not allowed', 'F15: org B cannot read org A''s corpus');
end $$;
select provio_test.as_owner();

-- Enable patterns for org B: it sees only its own finding, never org A's.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('b0000000-0000-0000-0000-000000000001','patterns',true,'Assurance','S10 test');
end $$;
select provio_test.as_owner();

update findings set status = 'concluded' where org_id = 'b0000000-0000-0000-0000-000000000001';

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_n int;
begin
  select count(*) into v_n from public.pattern_findings('b0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_n, 1, 'F15: org B sees only its own finding, not org A''s');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. engagement_as_of: with no recorded history it says not_recorded_before rather than guessing;
--    after a recorded event it replays the event and writes one activity entry.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_res jsonb;
  v_before int;
  v_after int;
begin
  -- No ledger or activity rows mention this engagement yet.
  v_res := public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now());
  perform provio_test.assert_eq(v_res ->> 'status', 'not_recorded_before',
    'F14: an engagement with no history is reported, not guessed');
end $$;
select provio_test.as_owner();

-- Record a real event: prepare a row (Preparer) then sign the workpaper off (CIA). Both write a
-- ledger entry and an activity row, so the as-of reconstruction has history to replay.
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
  v_res jsonb;
  v_before int;
  v_after int;
begin
  select count(*) into v_before from activity_log
   where action = 'engagement_as_of_viewed' and object_id = '50000000-0000-0000-0000-0000000000a1';

  v_res := public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now());
  perform provio_test.assert_eq(v_res ->> 'status', 'ok', 'F14: with history the reconstruction is ok');
  perform provio_test.assert_true(
    jsonb_array_length(v_res -> 'workpapers') >= 1,
    'F14: the signed-off workpaper is replayed');
  perform provio_test.assert_eq(
    v_res -> 'workpapers' -> 0 ->> 'status', 'signed_off',
    'F14: the replayed workpaper status is signed_off');

  select count(*) into v_after from activity_log
   where action = 'engagement_as_of_viewed' and object_id = '50000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_eq(v_after - v_before, 1, 'F14: every as-of view writes one activity entry');
end $$;
select provio_test.as_owner();

-- A time before the recorded event reports not_recorded_before with the earliest recorded moment.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_res jsonb;
begin
  v_res := public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', '2000-01-01T00:00:00Z');
  perform provio_test.assert_eq(v_res ->> 'status', 'not_recorded_before',
    'F14: a time before the first recorded event is not guessed');
  perform provio_test.assert_true(v_res ->> 'earliest_recorded' is not null,
    'F14: the earliest recorded moment is reported');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Cross-org and out-of-scope are refused; a caller without view_insights is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'outside the caller', 'F14: a member of org B cannot view an org A engagement');
end $$;
select provio_test.as_owner();

-- scoped_a holds only universe u_a1; engagement g_a2 is in u_a2, so it is out of scope.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.engagement_as_of('50000000-0000-0000-0000-0000000000a2', now())$q$,
    'outside the caller', 'F14: an out-of-scope engagement is refused');
  -- g_a1 IS in scope, so the refusal here is the missing view_insights right.
  perform provio_test.assert_raises(
    $q$select public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'cannot view the engagement timeline', 'F14: a Preparer lacks view_insights');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. anon can execute neither surface.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.engagement_as_of('50000000-0000-0000-0000-0000000000a1', now())$q$,
    'permission denied', 'F14: anon cannot execute engagement_as_of');
  perform provio_test.assert_raises(
    $q$select public.pattern_settings_get('a0000000-0000-0000-0000-000000000001')$q$,
    'permission denied', 'F15: anon cannot execute pattern_settings_get');
end $$;
select provio_test.as_owner();

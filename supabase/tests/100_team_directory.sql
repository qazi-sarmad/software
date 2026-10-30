-- 100_team_directory.sql — the team directory (spec §4.2 audit teams, §5 "team workload",
-- §9 "people, time and travel by engagement").
--   * A manager saves a profile and travel preferences; the directory returns them.
--   * A trip and an assignment are added and removed by stamping, never by deleting the row.
--   * Travel is personal: a member sees their own, a manager sees everyone's, a third party sees none.
--   * An engagement is tagged as requiring travel, and a tag without a location is refused.
--   * Cross-org: an Org A caller cannot see or write an Org B member's travel, and cannot tag Org B's
--     engagement.
--   * No new function is granted to anon.
-- M5: the fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. A manager saves a profile and travel, and the directory returns them. (org_admin holds
--    manage_users, so it may edit any member; the preparer role does not, and is used below.)
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_me record;
begin
  perform public.team_profile_save('10000000-0000-0000-0000-0000000000a2', 'https://x/y.png', 120);
  perform public.team_travel_save('10000000-0000-0000-0000-0000000000a2', 'Karachi', 'limited',
    array['Karachi','Lahore'], array['2026-12-25'::date]);

  select * into v_me from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a2';
  perform provio_test.assert_eq(v_me.avatar_url, 'https://x/y.png', 'the profile picture is saved and read');
  perform provio_test.assert_eq(v_me.capacity_hours, 120::numeric, 'the capacity is saved and read');
  perform provio_test.assert_eq(v_me.home_base, 'Karachi', 'the home base is saved and read');
  perform provio_test.assert_eq(v_me.willingness, 'limited', 'the travel willingness is saved and read');
  perform provio_test.assert_eq(array_length(v_me.preferred_regions, 1), 2, 'the preferred regions are saved');

  -- An unknown willingness is refused.
  perform provio_test.assert_raises(
    $q$select public.team_travel_save('10000000-0000-0000-0000-0000000000a2', 'Karachi', 'maybe', '{}'::text[], '{}'::date[])$q$,
    'none, limited or full'::text, 'a willingness outside none/limited/full is refused');
  -- A negative capacity is refused.
  perform provio_test.assert_raises(
    $q$select public.team_profile_save('10000000-0000-0000-0000-0000000000a2', null, -5)$q$,
    'between 0 and 10000'::text, 'a negative capacity is refused');
  -- A user who is not a member of the org is refused.
  perform provio_test.assert_raises(
    $q$select public.team_profile_save('10000000-0000-0000-0000-0000000000b1', null, 10)$q$,
    'no such member'::text, 'a profile for a non-member is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A trip and an assignment are added, then removed by stamping.
-- ---------------------------------------------------------------------------
do $$
declare
  v_trip uuid;
  v_assign uuid;
  v_stamped int;
begin
  v_trip := public.team_trip_add('10000000-0000-0000-0000-0000000000a2',
    '50000000-0000-0000-0000-0000000000a1', 'Lahore', '2026-11-10'::date, '2026-11-14'::date, 'site visit');
  perform provio_test.assert_true(
    exists (select 1 from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a2'
            and jsonb_array_length(trips) = 1),
    'a trip is returned in the directory');
  perform public.team_trip_remove(v_trip);
  select count(*) into v_stamped from team_travel_trips where id = v_trip and removed_at is not null;
  perform provio_test.assert_eq(v_stamped, 1, 'a removed trip is stamped, not deleted');
  perform provio_test.assert_true(
    not exists (select 1 from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a2'
                and jsonb_array_length(trips) > 0),
    'a stamped trip is not returned in the directory');

  -- A trip that ends before it starts is refused.
  perform provio_test.assert_raises(
    $q$select public.team_trip_add('10000000-0000-0000-0000-0000000000a2', null, 'Lahore', '2026-11-14'::date, '2026-11-10'::date, null)$q$,
    'end on or after'::text, 'a trip that ends before it starts is refused');

  v_assign := public.team_assignment_add('10000000-0000-0000-0000-0000000000a2',
    '50000000-0000-0000-0000-0000000000a1', 'A-Eng1', 'lead', '2026-11-01'::date, '2026-11-30'::date, 40);
  perform provio_test.assert_true(
    exists (select 1 from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a2'
            and jsonb_array_length(assignments) = 1),
    'an assignment is returned in the directory');
  perform public.team_assignment_remove(v_assign);
  perform provio_test.assert_true(
    exists (select 1 from team_assignments where id = v_assign and removed_at is not null),
    'a removed assignment is stamped, not deleted');
  -- An assignment against another org's engagement is refused.
  perform provio_test.assert_raises(
    $q$select public.team_assignment_add('10000000-0000-0000-0000-0000000000a2', '50000000-0000-0000-0000-0000000000b1', 'B', 'lead', '2026-11-01'::date, '2026-11-30'::date, 5)$q$,
    'no such engagement'::text, 'an assignment against another org''s engagement is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Travel is personal: a member sees their own, a manager sees everyone's, a third party none.
-- ---------------------------------------------------------------------------
-- Give member a1 a travel row, so the hiding is observable.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.team_travel_save('10000000-0000-0000-0000-0000000000a1', 'Islamabad', 'full', '{}'::text[], '{}'::date[]);
  perform provio_test.assert_eq(
    (select home_base from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a1'),
    'Islamabad', 'a manager sees another member''s travel');
end $$;

-- A member without manage_team sees their own and not another's.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(
    (select home_base from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a2'),
    'Karachi', 'a member sees their own travel');
  perform provio_test.assert_true(
    (select home_base is null from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000a1'),
    'a member does not see another member''s travel');
  -- The RLS policy itself refuses the other member's row.
  perform provio_test.assert_eq(
    (select count(*) from team_travel where user_id = '10000000-0000-0000-0000-0000000000a1'), 0::bigint,
    'the RLS policy hides another member''s travel row');
  -- A member cannot write another member's travel.
  perform provio_test.assert_raises(
    $q$select public.team_travel_save('10000000-0000-0000-0000-0000000000a1', 'X', 'full', '{}'::text[], '{}'::date[])$q$,
    'your own travel'::text, 'a member cannot edit another member''s travel');
end $$;

-- ---------------------------------------------------------------------------
-- 4. An engagement is tagged as requiring travel; a tag without a location is refused. The tag needs
--    manage_engagements (audit_manager), which org_admin does not hold.
-- ---------------------------------------------------------------------------
-- The tag is written by the RPC as the audit_manager; the stored columns are read as the owner, so
-- the assertion does not depend on the engagements RLS policy (which calls a helper granted only in
-- the hosted project).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
select public.engagement_travel_tag('50000000-0000-0000-0000-0000000000a1', true, 'Lahore',
  '2026-11-10'::date, '2026-11-14'::date);
select provio_test.as_owner();
do $$
declare v_eng record;
begin
  select requires_travel, travel_location into v_eng
    from engagements where id = '50000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_true(v_eng.requires_travel, 'an engagement can be tagged as requiring travel');
  perform provio_test.assert_eq(v_eng.travel_location, 'Lahore', 'the travel location is stored');
  -- The tag is a versioned, logged change.
  perform provio_test.assert_true(
    exists (select 1 from activity_log where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'engagement_travel_tagged'),
    'tagging travel writes an activity row');
end $$;

-- Untagging clears the location.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
select public.engagement_travel_tag('50000000-0000-0000-0000-0000000000a1', false, null, null, null);
select provio_test.as_owner();
do $$
declare v_eng record;
begin
  select requires_travel, travel_location into v_eng from engagements where id = '50000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_true(not v_eng.requires_travel, 'the travel tag can be cleared');
  perform provio_test.assert_eq(v_eng.travel_location, '', 'clearing the tag clears the location');
end $$;

-- A tag with no location is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.engagement_travel_tag('50000000-0000-0000-0000-0000000000a1', true, '  ', null, null)$q$,
    'a location is required'::text, 'a travel tag without a location is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Cross-org: an Org A caller cannot see or write an Org B member's travel, nor tag Org B's
--    engagement.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from team_travel where user_id = '10000000-0000-0000-0000-0000000000b1'), 0::bigint,
    'cross-org: Org B travel is invisible to an Org A caller');
  perform provio_test.assert_eq(
    (select count(*) from public.team_directory_get() where user_id = '10000000-0000-0000-0000-0000000000b1'), 0::bigint,
    'cross-org: Org B members are not in Org A''s directory');
  perform provio_test.assert_raises(
    $q$select public.team_profile_save('10000000-0000-0000-0000-0000000000b1', null, 10)$q$,
    'no such member'::text, 'cross-org: an Org A caller cannot write an Org B profile');
  perform provio_test.assert_raises(
    $q$select public.engagement_travel_tag('50000000-0000-0000-0000-0000000000b1', true, 'Dubai', null, null)$q$,
    'no such engagement'::text, 'cross-org: an Org A caller cannot tag Org B''s engagement');
end $$;

-- ---------------------------------------------------------------------------
-- 6. No new function is granted to anon (guard anonGrantAllowList).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    not exists (
      select 1 from information_schema.role_routine_grants
       where routine_schema = 'public' and grantee = 'anon'
         and routine_name in ('team_profile_save', 'team_travel_save', 'team_trip_add',
                              'team_trip_remove', 'team_assignment_add', 'team_assignment_remove',
                              'team_directory_get', 'engagement_travel_tag')),
    'no team-directory function is granted to anon');
end $$;

select provio_test.as_owner();

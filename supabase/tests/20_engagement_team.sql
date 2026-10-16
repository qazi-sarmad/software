-- Test 20: engagement team roles and the only assignment path (2C, spec §4.2).
-- Writes go only through assign_team_role(); a direct write by an application role is refused.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The fixture users must exist in auth.users: engagement_team_members.user_id references it.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a4', 'a4@provio-test.invalid')
on conflict (id) do nothing;

-- The four team roles and their rights are fixed.
select provio_test.assert_eq((select count(*) from team_role_rights), 4, 'team_role_rights holds exactly four rows');
select provio_test.assert_eq((select rights from team_role_rights where team_role = 'lead'), '{"manage_team":true}'::jsonb,
  'lead holds manage_team');
select provio_test.assert_eq((select rights from team_role_rights where team_role = 'preparer'), '{"perform_work":true}'::jsonb,
  'preparer holds perform_work');
select provio_test.assert_eq((select rights from team_role_rights where team_role = 'reviewer'), '{"review_and_approve":true}'::jsonb,
  'reviewer holds review_and_approve');
select provio_test.assert_eq((select rights from team_role_rights where team_role = 'observer'), '{"read_only":true}'::jsonb,
  'observer holds read_only');

-- a: a caller holding manage_engagements (cia) can assign a team role.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a4', 'reviewer');
select provio_test.as_owner();
select provio_test.assert_eq(
  (select team_role from engagement_team_members where engagement_id = '50000000-0000-0000-0000-0000000000a1' and user_id = '10000000-0000-0000-0000-0000000000a4'),
  'reviewer', 'a caller with manage_engagements can assign a team role');

-- b: a caller who is already the engagement's lead can assign.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a2', 'lead');
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a4', 'observer');
select provio_test.as_owner();
select provio_test.assert_eq(
  (select team_role from engagement_team_members where engagement_id = '50000000-0000-0000-0000-0000000000a1' and user_id = '10000000-0000-0000-0000-0000000000a4'),
  'observer', 'a caller who is the engagement lead can assign a team role');

-- c: a caller who holds neither manage_engagements nor lead is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a4', 'reviewer')$q$,
    'not allowed', 'a caller with neither manage_engagements nor lead cannot assign');
end $$;
select provio_test.as_owner();

-- d: a direct INSERT by an application role is refused by RLS (there is no INSERT policy).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into engagement_team_members (org_id, engagement_id, user_id, team_role)
       values ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a4', 'observer')$q$,
    'row-level security', 'a direct INSERT into engagement_team_members is refused by RLS');
end $$;
select provio_test.as_owner();

-- e: team_role must be one of lead, preparer, reviewer, observer.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a4', 'manager')$q$,
    'team_role', 'a team_role outside the four allowed values is refused');
end $$;
select provio_test.as_owner();

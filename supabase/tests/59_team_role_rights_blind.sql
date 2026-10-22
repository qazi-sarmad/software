-- Test 59: team_role_rights is not readable by authenticated or anon (D2, L2, spec §25.2).
-- The table holds the shared team-role -> rights mapping and has no org_id, so it carries no policy.
-- Reads happen only inside SECURITY DEFINER functions, which run as the owner.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The fixture users must exist in auth.users: engagement_team_members.user_id references it.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a4', 'a4@provio-test.invalid')
on conflict (id) do nothing;

-- The owner sees the four seeded rows, and RLS is enabled on the table.
do $$
begin
  perform provio_test.assert_eq((select count(*) from team_role_rights), 4,
    'the owner reads the four team role rows');
  perform provio_test.assert_true(
    (select relrowsecurity from pg_class where oid = 'public.team_role_rights'::regclass),
    'RLS is enabled on team_role_rights');
end $$;

-- An authenticated member of org A reads zero rows.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from team_role_rights), 0,
    'authenticated reads zero team_role_rights rows');
  perform provio_test.assert_eq((select count(*) from team_role_rights where team_role = 'lead'), 0,
    'authenticated reads zero rows even by primary key');
  -- No direct write either.
  perform provio_test.assert_raises(
    $q$insert into team_role_rights (team_role, rights) values ('lead', '{"manage_team":true}')$q$,
    'row-level security', 'a direct INSERT into team_role_rights is refused by RLS');
end $$;
select provio_test.as_owner();

-- The anonymous role reads zero rows.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises('select count(*) from team_role_rights', 'permission denied',
    'anon cannot read team_role_rights');
end $$;
select provio_test.as_owner();

-- The right is still usable through the SECURITY DEFINER path: the lead branch of assign_team_role
-- reads team_role_rights as the owner. This proves RLS did not break the feature.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a2', 'lead');
select provio_test.as_owner();
-- a2 is now the lead and holds only manage_team: the lead branch must still read team_role_rights.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select public.assign_team_role('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a4', 'observer');
select provio_test.as_owner();
select provio_test.assert_eq(
  (select team_role from engagement_team_members
    where engagement_id = '50000000-0000-0000-0000-0000000000a1'
      and user_id = '10000000-0000-0000-0000-0000000000a4'),
  'observer', 'the lead branch still works: team_role_rights is readable inside the definer function');

-- Test 24 (2H-DB): the administration RPCs (spec §23).
-- They take the org from the JWT only, require the right the action needs, refuse a target outside
-- the caller's org, and write a versioned, logged change.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: org_admin (manage_users, manage_roles, edit_config) can provision, change roles, set manager.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.admin_provision_member('10000000-0000-0000-0000-0000000000a9', 'New Member', 'reviewer', 3);
  perform provio_test.assert_eq(
    (select count(*) from org_members where org_id = 'a0000000-0000-0000-0000-000000000001'
       and user_id = '10000000-0000-0000-0000-0000000000a9'), 1,
    'org_admin provisions a member');
  perform public.admin_set_member_role('10000000-0000-0000-0000-0000000000a9', 'preparer');
  perform provio_test.assert_eq(
    (select r.slug from org_members m join roles r on r.id = m.role_id
      where m.user_id = '10000000-0000-0000-0000-0000000000a9'), 'preparer',
    'org_admin changes a member role');
  perform public.admin_set_member_manager('10000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a3');
  perform provio_test.assert_eq(
    (select manager_id from org_members where user_id = '10000000-0000-0000-0000-0000000000a9'),
    '10000000-0000-0000-0000-0000000000a3'::uuid, 'org_admin sets a reporting line');
  -- The change is versioned and logged.
  perform provio_test.assert_true(
    exists (select 1 from config_versions where org_id = 'a0000000-0000-0000-0000-000000000001'
              and key = 'member:10000000-0000-0000-0000-0000000000a9'),
    'a member change writes a config version');
  perform provio_test.assert_true(
    exists (select 1 from activity_log where org_id = 'a0000000-0000-0000-0000-000000000001'
              and action = 'member_provisioned'),
    'a member change writes an activity-log row');
end $$;
select provio_test.as_owner();

-- b: a member without manage_users cannot provision. A preparer holds perform_work only.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_provision_member('10000000-0000-0000-0000-0000000000a8', 'Nope', 'reviewer')$q$,
    'lacks the manage_users right', 'a preparer cannot provision a member');
  perform provio_test.assert_raises(
    $q$select public.admin_set_member_role('10000000-0000-0000-0000-0000000000a2', 'observer')$q$,
    'lacks the manage_roles right', 'a preparer cannot change roles');
  perform provio_test.assert_raises(
    $q$select public.admin_set_org_setting('sampling', '{"v":2}')$q$,
    'lacks the edit_config right', 'a preparer cannot change settings');
end $$;
select provio_test.as_owner();

-- c: unauthenticated (no org claim) is refused. The execute grant is revoked from anon, so the
-- caller is refused before the function body runs; that is the stronger guarantee.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_provision_member('10000000-0000-0000-0000-0000000000a8', 'Nope', 'reviewer')$q$,
    'permission denied', 'an anon caller cannot provision a member');
end $$;
select provio_test.as_owner();

-- d: an org_admin of A cannot touch org B data. The functions filter by jwt_org_id(), so a target
-- outside the caller's org is simply not found, and no change is written for the other org.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_set_member_role('10000000-0000-0000-0000-0000000000b1', 'observer')$q$,
    'member not found', 'an org_admin of A cannot change a member of B');
  perform provio_test.assert_raises(
    $q$select public.admin_update_role_rights('no_such_role', '{"manage_users":true}')$q$,
    'role not found', 'updating an unknown role is refused');
  -- A settings change by org A writes no version under org B.
  perform public.admin_set_org_setting('sampling', '{"v":9}');
  perform provio_test.assert_eq(
    (select count(*) from config_versions where org_id = 'b0000000-0000-0000-0000-000000000001' and key = 'setting:sampling'),
    0, 'org A settings changes never reach org B');
end $$;
select provio_test.as_owner();

-- e: role rights are validated against the closed list.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_create_role('Bad', 'bad_role', '{"disable_four_eyes":true}')$q$,
    'closed list', 'creating a role with an illegal right key is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_update_role_rights('reviewer', '{"manage_users":"yes"}')$q$,
    'closed list', 'updating a role with a non-boolean right is refused');
  -- A legal role is created and can be deleted while unused.
  perform public.admin_create_role('Custom Reviewer', 'custom_reviewer', '{"review_and_approve":true}');
  perform provio_test.assert_eq(
    (select count(*) from roles where org_id = 'a0000000-0000-0000-0000-000000000001' and slug = 'custom_reviewer'), 1,
    'a legal custom role is created');
  perform public.admin_delete_role('custom_reviewer');
  perform provio_test.assert_eq(
    (select count(*) from roles where org_id = 'a0000000-0000-0000-0000-000000000001' and slug = 'custom_reviewer'), 0,
    'an unused custom role is deleted');
  -- A seed role cannot be deleted (guard from 0014).
  perform provio_test.assert_raises(
    $q$select public.admin_delete_role('reviewer')$q$,
    'seed roles cannot be deleted', 'a seed role cannot be deleted');
end $$;
select provio_test.as_owner();

-- f: scopes are granted and revoked with rights, and stay inside the org.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_scope uuid;
begin
  v_scope := public.admin_grant_scope('10000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a2', null, null);
  perform provio_test.assert_true(v_scope is not null, 'org_admin grants a scope');
  perform public.admin_revoke_scope(v_scope);
  perform provio_test.assert_eq((select count(*) from user_scopes where id = v_scope), 0, 'org_admin revokes a scope');
  perform provio_test.assert_raises(
    $q$select public.admin_grant_scope('10000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000b1')$q$,
    'universe not found', 'a scope on another org universe is refused');
end $$;
select provio_test.as_owner();

-- g: reporting-line cycles are refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.admin_set_member_manager('10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a9');
  perform provio_test.assert_raises(
    $q$select public.admin_set_member_manager('10000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a2')$q$,
    'cycle', 'a reporting line that would form a cycle is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_set_member_manager('10000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2')$q$,
    'report to themselves', 'a member cannot report to themselves');
end $$;
select provio_test.as_owner();

-- h: the invite cap is bounded 1..100 and versioned.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.admin_set_invite_cap(35);
  perform provio_test.assert_eq(
    (select per_user_daily from invite_cap_settings where org_id = 'a0000000-0000-0000-0000-000000000001'), 35,
    'org_admin sets the invite cap');
  perform provio_test.assert_raises(
    $q$select public.admin_set_invite_cap(0)$q$, 'between 1 and 100', 'a cap below 1 is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_set_invite_cap(101)$q$, 'between 1 and 100', 'a cap above 100 is refused');
end $$;
select provio_test.as_owner();

-- Leave the fixtures as seeded (M5).
select provio_test.seed();

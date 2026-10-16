-- Test 23 (2F-2b): RLS and the permission predicates are driven by rights, not by role names.
-- The rights matrix in 0012 makes is_cia()/is_org_admin()/can_read_all_scopes() reproduce the old
-- behaviour exactly, and editing a role's rights changes its access immediately.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: the predicates read rights, and match the seed matrix.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(public.is_cia(), 'cia satisfies is_cia()');
  perform provio_test.assert_true(not public.is_org_admin(), 'cia is not an org admin');
  perform provio_test.assert_true(public.can_read_all_scopes(), 'cia reads all scopes');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_true(public.is_org_admin(), 'org_admin satisfies is_org_admin()');
  perform provio_test.assert_true(not public.is_cia(), 'org_admin is not a cia');
  perform provio_test.assert_true(not public.can_read_all_scopes(), 'org_admin reads no audit scope');
end $$;
select provio_test.as_owner();

-- b: audit_manager holds view_all_scopes, so it reads all universes but is not a cia.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_true(public.can_read_all_scopes(), 'audit_manager reads all scopes');
  perform provio_test.assert_true(not public.is_cia(), 'audit_manager is not a cia');
  perform provio_test.assert_eq((select count(*) from universes), 2,
    'audit_manager sees every universe in its org through the right');
  perform provio_test.assert_eq((select count(*) from universes where org_id = 'b0000000-0000-0000-0000-000000000001'), 0,
    'audit_manager still sees no other org');
end $$;
select provio_test.as_owner();

-- c: a scoped preparer (no view_all_scopes) sees only its own universe; the right, not the name,
-- decides. It cannot see another org even when the JWT claims it.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_true(not public.can_read_all_scopes(), 'preparer does not read all scopes');
  perform provio_test.assert_eq((select count(*) from universes), 1, 'preparer sees only its scoped universe');
end $$;
select provio_test.as_owner();

-- d: editing a role's rights changes access at once. Grant manage_users to the reviewer role and
-- the reviewer becomes an org admin for that predicate, with no code change.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
update roles
   set rights = '{"manage_users":true,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'::jsonb
 where org_id = 'a0000000-0000-0000-0000-000000000001' and slug = 'reviewer';
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_true(public.is_org_admin(),
    'a reviewer granted manage_users satisfies is_org_admin(), proving the check is rights-driven');
end $$;
select provio_test.as_owner();

-- Restore the matrix so later tests see the seed state (M5: no residue).
select provio_test.seed();

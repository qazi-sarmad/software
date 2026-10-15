-- Test 19: the closed rights list (2B, spec §4.1). Only the eleven keys may appear in
-- roles.rights, each a boolean; the seven seed roles carry the exact matrix from 0012.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a/b/c: a key outside the list, a non-boolean value, and an illegal update are all refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into roles (org_id, name, slug, is_seed, rights)
       values ('a0000000-0000-0000-0000-000000000001', 'Bad Key', 'bad_key', false, '{"disable_four_eyes":true}')$q$,
    'closed list', 'a rights key outside the closed list is refused on insert');
  perform provio_test.assert_raises(
    $q$insert into roles (org_id, name, slug, is_seed, rights)
       values ('a0000000-0000-0000-0000-000000000001', 'Bad Type', 'bad_type', false, '{"manage_users":"yes"}')$q$,
    'closed list', 'a non-boolean rights value is refused on insert');
  perform provio_test.assert_raises(
    $q$update roles set rights = '{"disable_four_eyes":true}'
         where org_id = 'a0000000-0000-0000-0000-000000000001' and slug = 'reviewer'$q$,
    'closed list', 'an update to an illegal key is refused');
end $$;
select provio_test.as_owner();

-- d: the seven seed roles carry exactly the matrix from migration 0012.
do $$
declare
  org uuid := 'a0000000-0000-0000-0000-000000000001';
  none_true jsonb := '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'::jsonb;
begin
  perform provio_test.assert_eq((select count(*) from roles where org_id = org and is_seed), 7,
    'org A holds exactly seven seed roles');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'org_admin'),
    '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'::jsonb,
    'org_admin holds manage_users, manage_roles, edit_config only');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'cia'),
    '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":false,"perform_work":false,"can_reopen":true,"view_all_scopes":true,"read_only":false}'::jsonb,
    'cia holds manage_roles, edit_config, manage_engagements, approve_plan, can_reopen, view_all_scopes');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'audit_manager'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":false}'::jsonb,
    'audit_manager holds manage_engagements and view_all_scopes only');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'observer'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true}'::jsonb,
    'observer holds read_only only');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'reviewer'), none_true,
    'reviewer holds no true right');
  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'preparer'), none_true,
    'preparer holds no true right');
  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'auditee'), none_true,
    'auditee holds no true right');
end $$;

-- e: caller_has_right reads the caller's own role rights.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_true(public.caller_has_right('can_reopen'), 'cia has can_reopen');
select provio_test.assert_true(not public.caller_has_right('manage_users'), 'cia does not have manage_users');
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select provio_test.assert_true(not public.caller_has_right('can_reopen'), 'preparer does not have can_reopen');
select provio_test.as_owner();

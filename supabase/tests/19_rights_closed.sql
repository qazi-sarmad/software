-- Test 19: the closed rights list (2B, spec §4.1). Only the fourteen keys may appear in
-- roles.rights, each a boolean; the seven seed roles carry the exact matrix from 0087, which removed
-- use_ai_assist from the fifteen-key list of 0050 with the rest of the AI feature.
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

-- d: the seven seed roles carry exactly the matrix from migration 0087.
do $$
declare
  org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_eq((select count(*) from roles where org_id = org and is_seed), 7,
    'org A holds exactly seven seed roles');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'org_admin'),
    '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb,
    'org_admin holds manage_users, manage_roles, edit_config only');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'cia'),
    '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb,
    'cia holds manage_roles, edit_config, manage_engagements, approve_plan, review_and_approve, perform_work, can_reopen, view_all_scopes');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'audit_manager'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":true}'::jsonb,
    'audit_manager manages engagements and teams, reviews and performs, and reads all scopes');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'observer'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":false}'::jsonb,
    'observer is read-only across all scopes');

  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'reviewer'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb,
    'reviewer reviews, approves and performs work');
  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'preparer'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb,
    'preparer performs work');
  perform provio_test.assert_eq((select rights from roles where org_id = org and slug = 'auditee'),
    '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb,
    'auditee is read-only with no view_all_scopes (link access to its own entity)');
end $$;

-- e: caller_has_right reads the caller's own role rights.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_true(public.caller_has_right('can_reopen'), 'cia has can_reopen');
select provio_test.assert_true(not public.caller_has_right('manage_users'), 'cia does not have manage_users');
select provio_test.assert_true(public.caller_has_right('view_board_pack'), 'cia has view_board_pack');
select provio_test.assert_true(public.caller_has_right('generate_board_pack'), 'cia has generate_board_pack');
select provio_test.assert_true(public.caller_has_right('view_insights'), 'cia has view_insights');
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select provio_test.assert_true(not public.caller_has_right('can_reopen'), 'preparer does not have can_reopen');
select provio_test.as_owner();

-- f: the extended keys are part of the closed list, and a key outside it is still refused.
-- use_ai_assist was removed with the AI feature (0087), so the list itself now rejects it.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_true(
    public.rights_keys_valid('{"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb),
    'the three remaining extended keys are valid on their own');
  perform provio_test.assert_true(
    not public.rights_keys_valid('{"board_pack":true}'::jsonb),
    'a key outside the fourteen is refused');
  perform provio_test.assert_true(
    not public.rights_keys_valid('{"use_ai_assist":true}'::jsonb),
    'use_ai_assist is no longer part of the closed list');
  -- Org Admin configures through edit_config and can edit any role's rights against the fourteen keys.
  perform public.admin_update_role_rights('reviewer', '{"view_insights":true}'::jsonb);
  perform provio_test.assert_true(
    (select (rights ->> 'view_insights')::boolean from roles
      where org_id = 'a0000000-0000-0000-0000-000000000001' and slug = 'reviewer'),
    'the Org Admin edits a role against the new keys');
end $$;
select provio_test.as_owner();

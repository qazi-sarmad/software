-- 0050: the closed rights list grows from eleven keys to fifteen (F3, 2026-10-19).
--
-- Four keys are added: view_board_pack, generate_board_pack, use_ai_assist, view_insights.
-- The seed matrix gains:
--   CIA           all four
--   Audit Manager view_board_pack, use_ai_assist, view_insights
--   Reviewer      use_ai_assist
--   Preparer      use_ai_assist
--   Observer      view_board_pack
--   Org Admin     none (an Org Admin configures through edit_config, and can edit any role's rights
--                 against the fifteen keys)
--
-- M2: the migration is safe to apply repeatedly. rights_keys_valid is replaced (not duplicated) and
-- the seed matrix is re-applied as UPDATEs. The matrices are written with all fifteen keys so the
-- row is explicit about the new ones.

create or replace function public.rights_keys_valid(p_rights jsonb) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(p_rights) e
    where e.key not in ('manage_users','manage_roles','edit_config','manage_engagements','approve_plan',
                        'review_and_approve','perform_work','can_reopen','view_all_scopes',
                        'read_only','manage_team',
                        'view_board_pack','generate_board_pack','use_ai_assist','view_insights')
       or jsonb_typeof(e.value) <> 'boolean'
  )
$$;

-- The seed matrix, fifteen keys, in every organisation. Idempotent. Mirrored in src/lib/rights.ts
-- and checked by src/lib/rightsMatrix.test.ts.
update roles set rights = '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"use_ai_assist":false,"view_insights":false}'::jsonb where is_seed and slug = 'org_admin';
update roles set rights = '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":true,"use_ai_assist":true,"view_insights":true}'::jsonb where is_seed and slug = 'cia';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"use_ai_assist":true,"view_insights":true}'::jsonb where is_seed and slug = 'audit_manager';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"use_ai_assist":true,"view_insights":false}'::jsonb where is_seed and slug = 'reviewer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"use_ai_assist":true,"view_insights":false}'::jsonb where is_seed and slug = 'preparer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"use_ai_assist":false,"view_insights":false}'::jsonb where is_seed and slug = 'observer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"use_ai_assist":false,"view_insights":false}'::jsonb where is_seed and slug = 'auditee';

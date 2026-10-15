-- 2B: closed rights list. Only these keys may appear in roles.rights, each with a boolean value.
create or replace function public.rights_keys_valid(p_rights jsonb) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(p_rights) e
    where e.key not in ('manage_users','manage_roles','edit_config','manage_engagements','approve_plan',
                        'review_and_approve','perform_work','can_reopen','view_all_scopes',
                        'read_only','manage_team')
       or jsonb_typeof(e.value) <> 'boolean'
  )
$$;


create or replace function public.roles_rights_guard() returns trigger
language plpgsql as $$
begin
  if not public.rights_keys_valid(new.rights) then
    raise exception 'rights contains a key outside the closed list or a non-boolean value';
  end if;
  return new;
end $$;


drop trigger if exists roles_rights_guard on roles;
create trigger roles_rights_guard before insert or update of rights on roles
for each row execute function public.roles_rights_guard();


-- Organisation role matrix for seed roles, in every organisation. Idempotent.
update roles set rights = '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'::jsonb where is_seed and slug = 'org_admin';
update roles set rights = '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":false,"perform_work":false,"can_reopen":true,"view_all_scopes":true,"read_only":false}'::jsonb where is_seed and slug = 'cia';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":false}'::jsonb where is_seed and slug = 'audit_manager';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true}'::jsonb where is_seed and slug = 'observer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false}'::jsonb where is_seed and slug in ('reviewer','preparer','auditee');

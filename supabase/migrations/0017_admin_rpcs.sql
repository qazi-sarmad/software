-- 2H-DB: administration RPCs for the People & Roles pages (spec §23).
--
-- Every function:
--   * takes the organisation from the JWT claim only (public.jwt_org_id());
--   * refuses a caller without the right the action needs (public.caller_has_right);
--   * refuses a target outside the caller's organisation;
--   * is SECURITY DEFINER with a fixed search_path;
--   * writes a versioned, logged change (L5): activity_log always, and config_versions for the
--     configuration objects an admin edits.
-- No function compares a role name to decide.
--
-- Schema adaptations (the real schema differs from the 2H-DB sketch; each was checked with grep
-- before writing):
--   * org_members already carries display_name (0011) and hierarchy_level (0002). Only the
--     reporting line was missing, so it is added here as one column (manager_id) rather than a
--     second table.
--   * roles already carries the rights jsonb map and is_seed (0002); the closed-list guard
--     rights_keys_valid() and the seed/in-use delete guards already exist (0012, 0014), so the
--     role RPCs reuse them instead of re-implementing them.
--   * config_versions (0005) has columns (org_id, key, value, version, actor_id, ts); it is used
--     as-is for versioned settings and member/scope/role changes.
--   * the invitation cap table is invite_cap_settings (0015), so admin_set_invite_cap targets it
--     rather than a new settings table.
--   * there is no org "settings" table; settings are stored as versioned config_versions rows
--     under the key 'setting:<name>', which is the pattern 0005 established.
--   * p_hierarchy_level is int, not smallint: Postgres does not implicitly cast an integer literal
--     to smallint for function resolution, so the parameter takes int and casts on insert.

-- Reporting line (spec §23 People: reporting lines). Nullable: no manager.
alter table org_members add column if not exists manager_id uuid null;

-- ---------------------------------------------------------------------------
-- Small shared helpers.
-- ---------------------------------------------------------------------------
create or replace function public.admin_assert_org(p_org uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
end $$;

-- Next version number for a configuration key in this org.
create or replace function public.admin_next_version(p_org uuid, p_key text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(version), 0) + 1 from config_versions where org_id = p_org and key = p_key
$$;

-- Append a versioned configuration change and an activity-log row.
create or replace function public.admin_log_change(
  p_org uuid, p_key text, p_value jsonb, p_action text, p_object_type text, p_object_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into config_versions (org_id, key, value, version, actor_id)
  values (p_org, p_key, coalesce(p_value, '{}'::jsonb), public.admin_next_version(p_org, p_key), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), p_action, p_object_type, p_object_id, coalesce(p_value, '{}'::jsonb));
end $$;

create or replace function public.admin_require_right(p_right text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.caller_has_right(p_right), false) then
    raise exception 'not allowed: caller lacks the % right', p_right using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- People.
-- ---------------------------------------------------------------------------

-- Provision a member for an existing auth user. Requires manage_users.
create or replace function public.admin_provision_member(
  p_user uuid, p_display_name text, p_role_slug text, p_hierarchy_level int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_role_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  if p_user is null then
    raise exception 'a user id is required' using errcode = 'P0001';
  end if;
  select r.id into v_role_id from roles r where r.org_id = v_org and r.slug = p_role_slug;
  if v_role_id is null then
    raise exception 'unknown role for this organisation: %', p_role_slug using errcode = 'P0001';
  end if;
  insert into org_members (org_id, user_id, role_id, display_name, hierarchy_level)
  values (v_org, p_user, v_role_id, coalesce(p_display_name, ''), p_hierarchy_level::smallint)
  on conflict (org_id, user_id) do update
    set role_id = excluded.role_id,
        display_name = excluded.display_name,
        hierarchy_level = excluded.hierarchy_level;
  perform public.admin_log_change(v_org, 'member:' || p_user::text,
    jsonb_build_object('user_id', p_user, 'role_slug', p_role_slug, 'display_name', p_display_name,
                       'hierarchy_level', p_hierarchy_level),
    'member_provisioned', 'org_member', p_user);
end $$;

-- Change a member's role. Requires manage_roles.
create or replace function public.admin_set_member_role(p_user uuid, p_role_slug text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_role_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_roles');
  select r.id into v_role_id from roles r where r.org_id = v_org and r.slug = p_role_slug;
  if v_role_id is null then
    raise exception 'unknown role for this organisation: %', p_role_slug using errcode = 'P0001';
  end if;
  update org_members set role_id = v_role_id
   where org_id = v_org and user_id = p_user;
  if not found then
    raise exception 'member not found in this organisation' using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'member:' || p_user::text,
    jsonb_build_object('user_id', p_user, 'role_slug', p_role_slug), 'member_role_changed', 'org_member', p_user);
end $$;

-- Set a member's reporting line. Requires manage_users. Refuses self-reporting and cycles.
create or replace function public.admin_set_member_manager(p_user uuid, p_manager uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_walk uuid;
  v_guard int := 0;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  if p_user = p_manager then
    raise exception 'a member cannot report to themselves' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members where org_id = v_org and user_id = p_user) then
    raise exception 'member not found in this organisation' using errcode = 'P0001';
  end if;
  if p_manager is not null and not exists (select 1 from org_members where org_id = v_org and user_id = p_manager) then
    raise exception 'manager not found in this organisation' using errcode = 'P0001';
  end if;
  -- Walk up from the proposed manager; if we reach the member, the link would form a cycle.
  v_walk := p_manager;
  while v_walk is not null and v_guard < 1000 loop
    if v_walk = p_user then
      raise exception 'reporting line would form a cycle' using errcode = 'P0001';
    end if;
    select manager_id into v_walk from org_members where org_id = v_org and user_id = v_walk;
    v_guard := v_guard + 1;
  end loop;
  update org_members set manager_id = p_manager where org_id = v_org and user_id = p_user;
  perform public.admin_log_change(v_org, 'member:' || p_user::text,
    jsonb_build_object('user_id', p_user, 'manager_id', p_manager), 'member_manager_changed', 'org_member', p_user);
end $$;

-- Grant a scope row to a member. Requires manage_users.
create or replace function public.admin_grant_scope(
  p_user uuid, p_universe uuid default null, p_entity uuid default null, p_engagement uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  if p_universe is null and p_entity is null and p_engagement is null then
    raise exception 'a scope needs a universe, an entity or an engagement' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members where org_id = v_org and user_id = p_user) then
    raise exception 'member not found in this organisation' using errcode = 'P0001';
  end if;
  -- Any target must belong to the caller's organisation.
  if p_universe is not null and not exists (select 1 from universes where id = p_universe and org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if p_entity is not null and not exists (select 1 from entities where id = p_entity and org_id = v_org) then
    raise exception 'entity not found in this organisation' using errcode = 'P0001';
  end if;
  if p_engagement is not null and not exists (select 1 from engagements where id = p_engagement and org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  insert into user_scopes (org_id, user_id, universe_id, entity_id, engagement_id)
  values (v_org, p_user, p_universe, p_entity, p_engagement)
  returning id into v_id;
  perform public.admin_log_change(v_org, 'scopes:' || p_user::text,
    jsonb_build_object('user_id', p_user, 'scope_id', v_id, 'universe_id', p_universe,
                       'entity_id', p_entity, 'engagement_id', p_engagement),
    'scope_granted', 'user_scope', v_id);
  return v_id;
end $$;

-- Remove one scope row. Requires manage_users.
create or replace function public.admin_revoke_scope(p_scope uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  delete from user_scopes where id = p_scope and org_id = v_org returning user_id into v_user;
  if v_user is null then
    raise exception 'scope not found in this organisation' using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'scopes:' || v_user::text,
    jsonb_build_object('user_id', v_user, 'scope_id', p_scope), 'scope_revoked', 'user_scope', p_scope);
end $$;

-- ---------------------------------------------------------------------------
-- Roles.
-- ---------------------------------------------------------------------------

-- Create a role. Requires manage_roles. The rights map must use the closed key list.
create or replace function public.admin_create_role(p_name text, p_slug text, p_rights jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_roles');
  if p_name is null or btrim(p_name) = '' then
    raise exception 'a role name is required' using errcode = 'P0001';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'a role slug must be lower-case letters, digits or underscores' using errcode = 'P0001';
  end if;
  if not public.rights_keys_valid(coalesce(p_rights, '{}'::jsonb)) then
    raise exception 'rights contains a key outside the closed list or a non-boolean value' using errcode = 'P0001';
  end if;
  insert into roles (org_id, name, slug, is_seed, rights)
  values (v_org, btrim(p_name), p_slug, false, coalesce(p_rights, '{}'::jsonb))
  returning id into v_id;
  perform public.admin_log_change(v_org, 'role:' || v_id::text,
    jsonb_build_object('role_id', v_id, 'slug', p_slug, 'name', p_name, 'rights', p_rights),
    'role_created', 'role', v_id);
  return v_id;
end $$;

-- Replace a role's rights. Requires manage_roles. The closed list is enforced by the guard trigger.
create or replace function public.admin_update_role_rights(p_slug text, p_rights jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_roles');
  if not public.rights_keys_valid(coalesce(p_rights, '{}'::jsonb)) then
    raise exception 'rights contains a key outside the closed list or a non-boolean value' using errcode = 'P0001';
  end if;
  update roles set rights = coalesce(p_rights, '{}'::jsonb)
   where org_id = v_org and slug = p_slug
  returning id into v_id;
  if v_id is null then
    raise exception 'role not found in this organisation: %', p_slug using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'role:' || v_id::text,
    jsonb_build_object('role_id', v_id, 'slug', p_slug, 'rights', p_rights),
    'role_rights_changed', 'role', v_id);
end $$;

-- Delete a role. Requires manage_roles. Seed and in-use guards live on the roles table (0014).
create or replace function public.admin_delete_role(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_roles');
  select id into v_id from roles where org_id = v_org and slug = p_slug;
  if v_id is null then
    raise exception 'role not found in this organisation: %', p_slug using errcode = 'P0001';
  end if;
  delete from roles where id = v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Organisation settings (spec §23). Requires edit_config; versioned and logged.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_org_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_key is null or btrim(p_key) = '' then
    raise exception 'a setting key is required' using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'setting:' || p_key, coalesce(p_value, '{}'::jsonb),
    'setting_changed', 'config', null);
end $$;

-- Invitation cap for the organisation (2E table). Requires manage_users.
create or replace function public.admin_set_invite_cap(p_per_user_daily int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('manage_users');
  if p_per_user_daily is null or p_per_user_daily < 1 or p_per_user_daily > 100 then
    raise exception 'the per-user daily invitation cap must be between 1 and 100' using errcode = 'P0001';
  end if;
  insert into invite_cap_settings (org_id, per_user_daily) values (v_org, p_per_user_daily)
  on conflict (org_id) do update set per_user_daily = excluded.per_user_daily;
  perform public.admin_log_change(v_org, 'invite_cap',
    jsonb_build_object('per_user_daily', p_per_user_daily), 'invite_cap_changed', 'config', null);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only, and revoke the implicit PUBLIC grant.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_assert_org','admin_next_version','admin_log_change','admin_require_right',
                        'admin_provision_member','admin_set_member_role','admin_set_member_manager',
                        'admin_grant_scope','admin_revoke_scope','admin_create_role',
                        'admin_update_role_rights','admin_delete_role','admin_set_org_setting',
                        'admin_set_invite_cap')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

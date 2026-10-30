-- 0199 (integrator, final phase): roles and access become configurable at EVERY level.
--
-- Owner instruction 2026-10-30: "every role is configurable per org as default for that org or for a
-- universe or for an engagement (complete customization in roles and access). All orgs are different;
-- all CIAs have different preferences in day-to-day engagements."
--
-- Before this file a role was a single property of the membership: `org_members.role_id`. One person
-- held one role in the whole organisation. That is not how an audit function works — the same person
-- is a Reviewer on one engagement, the Preparer on another, and a read-only Observer on a third, and
-- the firm's default for a new engagement in a given universe is a choice each organisation makes for
-- itself. This migration makes the role a *scoped* property:
--
--   1. role_scope_defaults — the roles an organisation applies by DEFAULT at the org, at a universe,
--      or at a single engagement. Every role is configurable at every level, and a default can be
--      turned off without being deleted (config honesty: a disabled default does not apply).
--   2. role_assignments    — the roles a named person holds at a scope. A person may hold different
--      roles at different scopes, and more than one role at the same scope.
--   3. role_effective()    — the deterministic resolution of a person's rights at an engagement:
--      the most specific scope that has a grant wins (engagement, then universe, then org), and the
--      rights of every role granted at that scope are unioned. With no scoped grant the membership
--      role stands, so behaviour without any configuration is exactly what it was.
--   4. role_effective_has_right() — the same resolution as a rights predicate, so a scoped decision
--      can be taken without a caller reading a role name (the 2F-2b rule).
--
-- Laws honoured: L1 (resolution is arithmetic over configured rows — no model, no learned threshold),
-- L2 (every row is pinned to the session org by pin_org_id(), and every writer refuses a scope id that
-- belongs to another tenant), L3/L5 (a change is versioned in config_versions and appended to the
-- activity log and the ledger, with a reason).
--
-- M1: grepped migrations and tests for every new name; all new, none redefined. M2: create table if
-- not exists / create index if not exists. M6: the harness applies this twice and runs the tests
-- twice before the push.

-- ---------------------------------------------------------------------------
-- 1. The scope defaults. One row per (scope, role). `org` scope carries no target id; `universe`
--    carries universe_id; `engagement` carries engagement_id. The check keeps the three shapes
--    disjoint, so a row can never be ambiguous about where it applies.
-- ---------------------------------------------------------------------------
create table if not exists role_scope_defaults (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('org','universe','engagement')),
  universe_id uuid null references universes(id) on delete cascade,
  engagement_id uuid null references engagements(id) on delete cascade,
  -- The role, by slug, in this organisation. A slug the org does not define is refused by the writer.
  role_slug text not null,
  -- A default can be offered and not applied. A disabled row stays visible and does nothing.
  is_default boolean not null default true,
  version int not null default 1,
  set_by uuid null,
  set_at timestamptz not null default now(),
  constraint role_scope_defaults_shape check (
    (scope_kind = 'org'        and universe_id is null     and engagement_id is null)
    or (scope_kind = 'universe'   and universe_id is not null and engagement_id is null)
    or (scope_kind = 'engagement' and engagement_id is not null)
  )
);
-- One row per scope + role. The target ids are coalesced so a null universe/engagement still
-- participates in the uniqueness (a plain unique constraint ignores nulls, which would let the same
-- default be inserted twice).
create unique index if not exists role_scope_defaults_key on role_scope_defaults (
  org_id, scope_kind,
  coalesce(universe_id,   '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid),
  role_slug
);
create index if not exists role_scope_defaults_org_idx on role_scope_defaults (org_id, scope_kind);

alter table role_scope_defaults enable row level security;
drop policy if exists role_scope_defaults_select on role_scope_defaults;
create policy role_scope_defaults_select on role_scope_defaults for select to authenticated
  using (org_id = public.jwt_org_id());
-- No insert/update/delete policy: every write goes through role_scope_default_set / _clear.
drop trigger if exists role_scope_defaults_pin_org on role_scope_defaults;
create trigger role_scope_defaults_pin_org before insert on role_scope_defaults
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 2. The scoped assignments. `is_default` marks a grant that the scope's default produced rather
--    than a person's explicit choice, so a reader can tell the two apart.
-- ---------------------------------------------------------------------------
create table if not exists role_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  scope_kind text not null check (scope_kind in ('org','universe','engagement')),
  universe_id uuid null references universes(id) on delete cascade,
  engagement_id uuid null references engagements(id) on delete cascade,
  role_slug text not null,
  is_default boolean not null default false,
  granted_by uuid null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint role_assignments_shape check (
    (scope_kind = 'org'        and universe_id is null     and engagement_id is null)
    or (scope_kind = 'universe'   and universe_id is not null and engagement_id is null)
    or (scope_kind = 'engagement' and engagement_id is not null)
  )
);
create unique index if not exists role_assignments_key on role_assignments (
  org_id, user_id, scope_kind,
  coalesce(universe_id,   '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid),
  role_slug
);
create index if not exists role_assignments_user_idx on role_assignments (org_id, user_id);
create index if not exists role_assignments_engagement_idx on role_assignments (org_id, engagement_id);

alter table role_assignments enable row level security;
drop policy if exists role_assignments_select on role_assignments;
create policy role_assignments_select on role_assignments for select to authenticated
  using (org_id = public.jwt_org_id());
drop trigger if exists role_assignments_pin_org on role_assignments;
create trigger role_assignments_pin_org before insert on role_assignments
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 3. role_scope_guard — one place that validates a scope target before either writer uses it. A
--    scope id that belongs to another organisation is refused by name, so the refusal is legible and
--    no row is written (L2).
-- ---------------------------------------------------------------------------
create or replace function public.role_scope_guard(
  p_org uuid, p_scope_kind text, p_universe uuid, p_engagement uuid
) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_universe_org uuid;
  v_engagement_org uuid;
begin
  if p_scope_kind not in ('org','universe','engagement') then
    raise exception 'scope_kind % is not one of org / universe / engagement', p_scope_kind using errcode = 'P0001';
  end if;
  if p_scope_kind = 'org' then
    if p_universe is not null or p_engagement is not null then
      raise exception 'the org scope takes no universe or engagement' using errcode = 'P0001';
    end if;
    return;
  end if;
  if p_scope_kind = 'universe' then
    if p_universe is null then
      raise exception 'the universe scope needs a universe' using errcode = 'P0001';
    end if;
    if p_engagement is not null then
      raise exception 'the universe scope takes no engagement' using errcode = 'P0001';
    end if;
    select u.org_id into v_universe_org from universes u where u.id = p_universe;
    if v_universe_org is null then
      raise exception 'unknown universe %', p_universe using errcode = 'P0001';
    end if;
    if v_universe_org <> p_org then
      raise exception 'the universe belongs to another organisation' using errcode = 'P0001';
    end if;
    return;
  end if;
  -- engagement scope
  if p_engagement is null then
    raise exception 'the engagement scope needs an engagement' using errcode = 'P0001';
  end if;
  if p_universe is not null then
    raise exception 'the engagement scope takes no universe' using errcode = 'P0001';
  end if;
  select e.org_id into v_engagement_org from engagements e where e.id = p_engagement;
  if v_engagement_org is null then
    raise exception 'unknown engagement %', p_engagement using errcode = 'P0001';
  end if;
  if v_engagement_org <> p_org then
    raise exception 'the engagement belongs to another organisation' using errcode = 'P0001';
  end if;
end $$;

-- The role must be one this organisation defines. A slug from another tenant is not a role here.
create or replace function public.role_scope_role_guard(p_org uuid, p_role_slug text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_slug text;
begin
  if coalesce(btrim(p_role_slug), '') = '' then
    raise exception 'a role is required' using errcode = 'P0001';
  end if;
  select r.slug into v_slug from roles r where r.org_id = p_org and r.slug = btrim(p_role_slug);
  if v_slug is null then
    raise exception 'unknown role in this organisation: %', p_role_slug using errcode = 'P0001';
  end if;
  return v_slug;
end $$;

-- ---------------------------------------------------------------------------
-- 4. role_scope_default_set — configure the default role at a scope. Requires manage_roles.
--    Idempotent per (scope, role): a second call updates is_default rather than duplicating.
-- ---------------------------------------------------------------------------
create or replace function public.role_scope_default_set(
  p_scope_kind text,
  p_universe uuid default null,
  p_engagement uuid default null,
  p_role_slug text default null,
  p_is_default boolean default true,
  p_reason text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_slug text;
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_roles');
  perform public.role_scope_guard(v_org, p_scope_kind, p_universe, p_engagement);
  v_slug := public.role_scope_role_guard(v_org, p_role_slug);

  select d.id into v_id from role_scope_defaults d
   where d.org_id = v_org and d.scope_kind = p_scope_kind
     and d.universe_id is not distinct from p_universe
     and d.engagement_id is not distinct from p_engagement
     and d.role_slug = v_slug;

  if v_id is null then
    insert into role_scope_defaults (org_id, scope_kind, universe_id, engagement_id, role_slug, is_default, set_by)
    values (v_org, p_scope_kind, p_universe, p_engagement, v_slug, coalesce(p_is_default, true), auth.uid())
    returning id into v_id;
  else
    update role_scope_defaults
       set is_default = coalesce(p_is_default, true),
           version = version + 1,
           set_by = auth.uid(),
           set_at = now()
     where id = v_id;
  end if;

  perform public.admin_log_change(v_org, 'role_scope_default:' || v_id::text,
    jsonb_build_object('scope_kind', p_scope_kind, 'universe_id', p_universe, 'engagement_id', p_engagement,
                       'role_slug', v_slug, 'is_default', coalesce(p_is_default, true), 'reason', p_reason),
    'role_scope_default_set', 'role_scope_default', v_id);
  perform public.append_ledger_entry(v_org, 'role_scope_default_set',
    jsonb_build_object('scope_kind', p_scope_kind, 'universe_id', p_universe, 'engagement_id', p_engagement,
                       'role_slug', v_slug, 'is_default', coalesce(p_is_default, true), 'reason', p_reason),
    auth.uid());
  return v_id;
end $$;

-- Remove a default entirely. Requires manage_roles. A refusal names the missing row.
create or replace function public.role_scope_default_clear(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row role_scope_defaults;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_roles');
  select * into v_row from role_scope_defaults d where d.id = p_id and d.org_id = v_org;
  if v_row.id is null then
    raise exception 'no scope default with that id in this organisation' using errcode = 'P0001';
  end if;
  delete from role_scope_defaults where id = p_id;
  perform public.admin_log_change(v_org, 'role_scope_default:' || p_id::text,
    jsonb_build_object('scope_kind', v_row.scope_kind, 'role_slug', v_row.role_slug, 'removed', true),
    'role_scope_default_clear', 'role_scope_default', p_id);
  perform public.append_ledger_entry(v_org, 'role_scope_default_clear',
    jsonb_build_object('scope_kind', v_row.scope_kind, 'role_slug', v_row.role_slug), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 5. role_assign — give a person a role at a scope.
--
--    p_role_slug given   : grant that one role at that scope (explicit).
--    p_role_slug omitted : apply the scope's configured defaults. The nearest scope that has an
--                          enabled default wins (engagement, then the engagement's universe, then the
--                          org), which is what makes a configured default actually do something.
--
--    Requires manage_users. The person must be a member of the organisation. Returns the number of
--    assignments applied.
-- ---------------------------------------------------------------------------
create or replace function public.role_assign(
  p_user uuid,
  p_scope_kind text,
  p_universe uuid default null,
  p_engagement uuid default null,
  p_role_slug text default null,
  p_reason text default ''
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_applied int := 0;
  v_slug text;
  v_scope_kind text := p_scope_kind;
  v_universe uuid := p_universe;
  v_engagement uuid := p_engagement;
  v_slugs text[];
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_users');
  perform public.role_scope_guard(v_org, p_scope_kind, p_universe, p_engagement);
  if p_user is null then
    raise exception 'a user is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user) then
    raise exception 'the user is not a member of this organisation' using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_role_slug), '') <> '' then
    v_slugs := array[public.role_scope_role_guard(v_org, p_role_slug)];
  else
    -- Resolve the nearest enabled default. An engagement's universe is its own scope to fall back to.
    if p_scope_kind = 'engagement' then
      select array_agg(d.role_slug order by d.role_slug) into v_slugs
        from role_scope_defaults d
       where d.org_id = v_org and d.is_default and d.scope_kind = 'engagement' and d.engagement_id = p_engagement;
      if v_slugs is null then
        select e.universe_id into v_universe from engagements e where e.id = p_engagement and e.org_id = v_org;
        v_scope_kind := 'universe';
      end if;
    end if;
    if v_slugs is null and p_scope_kind in ('engagement','universe') and v_universe is not null then
      select array_agg(d.role_slug order by d.role_slug) into v_slugs
        from role_scope_defaults d
       where d.org_id = v_org and d.is_default and d.scope_kind = 'universe' and d.universe_id = v_universe;
      v_scope_kind := 'universe';
    end if;
    if v_slugs is null then
      select array_agg(d.role_slug order by d.role_slug) into v_slugs
        from role_scope_defaults d
       where d.org_id = v_org and d.is_default and d.scope_kind = 'org';
      v_scope_kind := 'org';
    end if;
    if v_slugs is null then
      raise exception 'no default role is configured for this scope' using errcode = 'P0001';
    end if;
    -- The defaults resolved to their own scope: the assignment lands where the default lives.
    if v_scope_kind = 'org' then
      v_universe := null; v_engagement := null;
    elsif v_scope_kind = 'universe' then
      v_engagement := null;
    end if;
  end if;

  foreach v_slug in array v_slugs loop
    if not exists (
      select 1 from role_assignments a
       where a.org_id = v_org and a.user_id = p_user and a.scope_kind = v_scope_kind
         and a.universe_id is not distinct from v_universe
         and a.engagement_id is not distinct from v_engagement
         and a.role_slug = v_slug
    ) then
      insert into role_assignments (org_id, user_id, scope_kind, universe_id, engagement_id, role_slug, is_default, granted_by, reason)
      values (v_org, p_user, v_scope_kind, v_universe, v_engagement, v_slug,
              coalesce(btrim(p_role_slug), '') = '', auth.uid(), coalesce(p_reason, ''));
      v_applied := v_applied + 1;
    end if;
  end loop;

  perform public.admin_log_change(v_org, 'role_assign:' || p_user::text,
    jsonb_build_object('user_id', p_user, 'scope_kind', v_scope_kind, 'universe_id', v_universe,
                       'engagement_id', v_engagement, 'roles', to_jsonb(v_slugs), 'applied', v_applied,
                       'reason', p_reason),
    'role_assigned', 'role_assignment', p_user);
  perform public.append_ledger_entry(v_org, 'role_assigned',
    jsonb_build_object('user_id', p_user, 'scope_kind', v_scope_kind, 'roles', to_jsonb(v_slugs),
                       'applied', v_applied, 'reason', p_reason),
    auth.uid());
  return v_applied;
end $$;

-- Remove one scoped assignment. Requires manage_users.
create or replace function public.role_unassign(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row role_assignments;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_users');
  select * into v_row from role_assignments a where a.id = p_id and a.org_id = v_org;
  if v_row.id is null then
    raise exception 'no role assignment with that id in this organisation' using errcode = 'P0001';
  end if;
  delete from role_assignments where id = p_id;
  perform public.admin_log_change(v_org, 'role_assign:' || v_row.user_id::text,
    jsonb_build_object('user_id', v_row.user_id, 'scope_kind', v_row.scope_kind,
                       'universe_id', v_row.universe_id, 'engagement_id', v_row.engagement_id,
                       'role_slug', v_row.role_slug, 'removed', true),
    'role_unassigned', 'role_assignment', p_id);
  perform public.append_ledger_entry(v_org, 'role_unassigned',
    jsonb_build_object('user_id', v_row.user_id, 'scope_kind', v_row.scope_kind, 'role_slug', v_row.role_slug),
    auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 6. role_effective — the deterministic resolution of a person's rights at an engagement.
--
--    The most specific scope that has a grant wins: engagement, then the engagement's universe, then
--    the org. Every role granted at that scope contributes its rights (a union), so two roles at one
--    scope add up rather than one silently winning. With no scoped grant the membership role stands,
--    which keeps the behaviour of an organisation that configures nothing exactly as it was.
--
--    Returns `{source, role_slugs, rights}`. Never reads a clock; the same rows always give the same
--    answer.
-- ---------------------------------------------------------------------------
create or replace function public.role_effective(p_user uuid, p_engagement uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_universe uuid;
  v_slugs text[];
  v_source text;
  v_rights jsonb := '{}'::jsonb;
begin
  if p_user is null then
    raise exception 'a user is required' using errcode = 'P0001';
  end if;

  if p_engagement is not null then
    select e.universe_id into v_universe from engagements e where e.id = p_engagement and e.org_id = v_org;
    select array_agg(a.role_slug order by a.role_slug) into v_slugs
      from role_assignments a
     where a.org_id = v_org and a.user_id = p_user and a.scope_kind = 'engagement' and a.engagement_id = p_engagement;
    if v_slugs is not null then v_source := 'engagement'; end if;
  end if;

  if v_slugs is null and v_universe is not null then
    select array_agg(a.role_slug order by a.role_slug) into v_slugs
      from role_assignments a
     where a.org_id = v_org and a.user_id = p_user and a.scope_kind = 'universe' and a.universe_id = v_universe;
    if v_slugs is not null then v_source := 'universe'; end if;
  end if;

  if v_slugs is null then
    select array_agg(a.role_slug order by a.role_slug) into v_slugs
      from role_assignments a
     where a.org_id = v_org and a.user_id = p_user and a.scope_kind = 'org';
    if v_slugs is not null then v_source := 'org'; end if;
  end if;

  if v_slugs is null then
    -- No scoped grant: the membership role is the role.
    select array_agg(r.slug order by r.slug) into v_slugs
      from org_members m join roles r on r.id = m.role_id
     where m.org_id = v_org and m.user_id = p_user;
    v_source := 'membership';
  end if;

  if v_slugs is null then
    -- Not a member and no grant anywhere: no role, no rights.
    return jsonb_build_object('source', 'none', 'role_slugs', '[]'::jsonb, 'rights', '{}'::jsonb);
  end if;

  select coalesce(jsonb_object_agg(e.key, (e.value)::boolean), '{}'::jsonb) into v_rights
    from roles r
    cross join lateral jsonb_each_text(r.rights) e(key, value)
   where r.org_id = v_org and r.slug = any(v_slugs) and (e.value)::boolean;

  return jsonb_build_object('source', v_source, 'role_slugs', to_jsonb(v_slugs), 'rights', v_rights);
end $$;

-- The same resolution as a rights predicate, so a scoped decision needs no role-name comparison.
create or replace function public.role_effective_has_right(p_user uuid, p_engagement uuid, p_right text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.role_effective(p_user, p_engagement) -> 'rights' ->> p_right)::boolean, false)
$$;

-- ---------------------------------------------------------------------------
-- 7. Readers for the screen. A reader returns the org's own rows; RLS already restricts the tables,
--    and the readers add the role name so the screen never joins by hand.
-- ---------------------------------------------------------------------------
create or replace function public.role_scope_defaults_list()
returns table (id uuid, scope_kind text, universe_id uuid, universe_name text, engagement_id uuid,
               engagement_title text, role_slug text, role_name text, is_default boolean, version int)
language sql stable security definer set search_path = public as $$
  select d.id, d.scope_kind, d.universe_id, u.name, d.engagement_id, e.title,
         d.role_slug, r.name, d.is_default, d.version
    from role_scope_defaults d
    left join universes  u on u.id = d.universe_id
    left join engagements e on e.id = d.engagement_id
    left join roles r on r.org_id = d.org_id and r.slug = d.role_slug
   where d.org_id = public.jwt_org_id()
   order by d.scope_kind, coalesce(u.name, ''), coalesce(e.title, ''), d.role_slug
$$;

create or replace function public.role_assignments_list()
returns table (id uuid, user_id uuid, scope_kind text, universe_id uuid, universe_name text,
               engagement_id uuid, engagement_title text, role_slug text, role_name text,
               is_default boolean, reason text)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, a.scope_kind, a.universe_id, u.name, a.engagement_id, e.title,
         a.role_slug, r.name, a.is_default, a.reason
    from role_assignments a
    left join universes  u on u.id = a.universe_id
    left join engagements e on e.id = a.engagement_id
    left join roles r on r.org_id = a.org_id and r.slug = a.role_slug
   where a.org_id = public.jwt_org_id()
   order by a.scope_kind, a.role_slug
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants. The tables are written only through the RPCs; the readers and the writers are for a
--    signed-in session. Nothing here is reachable by anon.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on role_scope_defaults from public, anon, authenticated;
revoke insert, update, delete on role_assignments from public, anon, authenticated;

revoke execute on function public.role_scope_guard(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.role_scope_role_guard(uuid, text) from public, anon, authenticated;
revoke execute on function public.role_scope_default_set(text, uuid, uuid, text, boolean, text) from public, anon;
revoke execute on function public.role_scope_default_clear(uuid) from public, anon;
revoke execute on function public.role_assign(uuid, text, uuid, uuid, text, text) from public, anon;
revoke execute on function public.role_unassign(uuid) from public, anon;
revoke execute on function public.role_effective(uuid, uuid) from public, anon;
revoke execute on function public.role_effective_has_right(uuid, uuid, text) from public, anon;
revoke execute on function public.role_scope_defaults_list() from public, anon;
revoke execute on function public.role_assignments_list() from public, anon;

grant execute on function public.role_scope_default_set(text, uuid, uuid, text, boolean, text) to authenticated;
grant execute on function public.role_scope_default_clear(uuid) to authenticated;
grant execute on function public.role_assign(uuid, text, uuid, uuid, text, text) to authenticated;
grant execute on function public.role_unassign(uuid) to authenticated;
grant execute on function public.role_effective(uuid, uuid) to authenticated;
grant execute on function public.role_effective_has_right(uuid, uuid, text) to authenticated;
grant execute on function public.role_scope_defaults_list() to authenticated;
grant execute on function public.role_assignments_list() to authenticated;

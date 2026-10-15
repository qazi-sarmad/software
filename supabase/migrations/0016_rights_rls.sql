-- 2F-2b: replace role-name checks in the database with rights checks.
--
-- Until now the RLS policies asked "is the caller's role slug cia or org_admin?". They now ask
-- "does the caller hold the right?" — the same rule the app applies (src/lib/rights.ts). The
-- predicate functions keep their names (policies reference them), but their bodies read rights
-- only, never a role slug.
--
-- The seed rights matrix (0012_rights_closed.sql) makes these two predicates reproduce the old
-- behaviour exactly:
--   approve_plan + can_reopen  is true only for cia     (audit_manager has neither)
--   manage_users               is true only for org_admin
-- A role whose rights are edited (0012 allows that) therefore changes its access immediately,
-- which is the point of rights-driven access.

-- ---------------------------------------------------------------------------
-- caller_has_right now resolves the caller's rights from the role named by the JWT claim
-- (public.jwt_user_role()), in the caller's org. Identity comes from the token — the access-token
-- hook stamps user_role from org_members (0010) — and the permission decision is a lookup of the
-- right key in that role's rights row. No branch compares a role name to grant or deny.
-- ---------------------------------------------------------------------------
create or replace function public.caller_has_right(p_right text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(coalesce((r.rights ->> p_right)::boolean, false)), false)
  from roles r
  where r.org_id = public.jwt_org_id() and r.slug = public.jwt_user_role()
$$;

create or replace function public.is_cia() returns boolean
language sql stable security definer set search_path = public as $$
  select public.caller_has_right('approve_plan') and public.caller_has_right('can_reopen')
$$;

create or replace function public.is_org_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.caller_has_right('manage_users')
$$;

-- A caller may read all audit content in the organisation when they hold view_all_scopes.
-- This replaces the "is_cia()" read branches; audit_manager and observer also hold the right,
-- which matches their intended read breadth (audit_manager sees all, observer is read-only all).
create or replace function public.can_read_all_scopes() returns boolean
language sql stable security definer set search_path = public as $$
  select public.caller_has_right('view_all_scopes')
$$;

-- ---------------------------------------------------------------------------
-- Rewrite the RLS policies that used a role-name predicate, so every policy now reads a right.
-- The predicates above already do; these policies additionally use the dedicated read predicate
-- for the "see everything in the org" branches, so the intent is legible in each policy.
-- ---------------------------------------------------------------------------
drop policy if exists universes_select on universes;
create policy universes_select on universes for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(id, null, null)));

drop policy if exists entities_select on entities;
create policy entities_select on entities for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(universe_id, id, null)));

drop policy if exists engagements_select on engagements;
create policy engagements_select on engagements for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(universe_id, entity_id, id)));

drop policy if exists sira_cycles_select on sira_cycles;
create policy sira_cycles_select on sira_cycles for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(universe_id, null, null)));

drop policy if exists sira_scores_select on sira_scores;
create policy sira_scores_select on sira_scores for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(null, entity_id, null)));

drop policy if exists plans_select on plans;
create policy plans_select on plans for select to authenticated
  using (org_id = public.jwt_org_id() and (public.can_read_all_scopes() or public.has_scope(universe_id, null, null)));

-- ---------------------------------------------------------------------------
-- assign_team_role: the "caller is the engagement lead" branch becomes a rights check on the
-- team_role_rights table (a lead holds manage_team), so no team-role name is compared.
-- ---------------------------------------------------------------------------
create or replace function public.assign_team_role(p_engagement uuid, p_user uuid, p_team_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_caller uuid := auth.uid();
  v_allowed boolean;
begin
  select e.org_id into v_org from engagements e where e.id = p_engagement;
  if v_org is null or v_org <> public.jwt_org_id() then
    raise exception 'engagement not found';
  end if;
  if not exists (select 1 from org_members om where om.org_id = v_org and om.user_id = p_user) then
    raise exception 'user is not a member of this organisation';
  end if;
  v_allowed := public.caller_has_right('manage_engagements')
    or exists (
      select 1
      from engagement_team_members m
      join team_role_rights t on t.team_role = m.team_role
      where m.engagement_id = p_engagement
        and m.user_id = v_caller
        and coalesce((t.rights ->> 'manage_team')::boolean, false)
    );
  if not coalesce(v_allowed, false) then
    raise exception 'not allowed to assign team roles on this engagement';
  end if;
  insert into engagement_team_members (org_id, engagement_id, user_id, team_role)
  values (v_org, p_engagement, p_user, p_team_role)
  on conflict (engagement_id, user_id) do update set team_role = excluded.team_role;
end $$;

revoke execute on function public.assign_team_role(uuid, uuid, text) from public;
grant execute on function public.assign_team_role(uuid, uuid, text) to authenticated;
grant execute on function public.is_cia() to authenticated, anon;
grant execute on function public.is_org_admin() to authenticated, anon;
grant execute on function public.can_read_all_scopes() to authenticated, anon;

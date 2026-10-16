-- 2C: engagement team roles and the only assignment path.
create table if not exists team_role_rights (
  team_role text primary key check (team_role in ('lead','preparer','reviewer','observer')),
  rights jsonb not null default '{}'::jsonb check (jsonb_typeof(rights) = 'object' and public.rights_keys_valid(rights))
);


insert into team_role_rights (team_role, rights) values
  ('lead', '{"manage_team":true}'),
  ('preparer', '{"perform_work":true}'),
  ('reviewer', '{"review_and_approve":true}'),
  ('observer', '{"read_only":true}')
on conflict (team_role) do update set rights = excluded.rights;


create table if not exists engagement_team_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team_role text not null references team_role_rights(team_role),
  created_at timestamptz not null default now(),
  unique (engagement_id, user_id)
);


alter table engagement_team_members enable row level security;
drop policy if exists etm_select on engagement_team_members;
create policy etm_select on engagement_team_members for select using (org_id = public.jwt_org_id());
-- No insert, update or delete policy: writes happen only through assign_team_role().


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
    or exists (select 1 from engagement_team_members m
               where m.engagement_id = p_engagement and m.user_id = v_caller and m.team_role = 'lead');
  if not coalesce(v_allowed, false) then
    raise exception 'not allowed to assign team roles on this engagement';
  end if;
  insert into engagement_team_members (org_id, engagement_id, user_id, team_role)
  values (v_org, p_engagement, p_user, p_team_role)
  on conflict (engagement_id, user_id) do update set team_role = excluded.team_role;
end $$;


revoke execute on function public.assign_team_role(uuid, uuid, text) from public;
grant execute on function public.assign_team_role(uuid, uuid, text) to authenticated;

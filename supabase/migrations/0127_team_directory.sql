-- 0127: the team directory (spec §4.2 audit teams, §5 "team workload", §9 "people, time and travel").
--
-- The people side of the platform had a member list and a role matrix and nothing else. This adds the
-- three things a manager needs to answer "who can take this engagement?" and "when is this person
-- free?": a working profile (a picture or a generated avatar, a capacity), travel preferences and a
-- travel calendar, and the assignments that make up a workload. The arithmetic lives in the pure model
-- `src/lib/teamDirectory.ts`; this migration holds only the state that model is handed.
--
-- Laws honoured: L2 (personal data never leaves the tenant; every row is org-scoped by RLS and by a
-- pin trigger), rights not role names (a person edits their own row; `manage_team` edits anyone's),
-- append-only where a record is evidence (a trip and an assignment are removed by a status change, not
-- silently deleted — see `team_travel_trips.removed_at`), idempotent (the harness applies every file
-- twice), and every RPC is security-definer with an explicit caller check.

-- ---------------------------------------------------------------------------
-- 1. team_profiles — one row per member: the working profile and the capacity the workload divides by.
-- ---------------------------------------------------------------------------
create table if not exists team_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  avatar_url text null,
  capacity_hours numeric(8,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
alter table team_profiles add column if not exists avatar_url text null;
alter table team_profiles add column if not exists capacity_hours numeric(8,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_profiles_capacity_chk') then
    alter table team_profiles add constraint team_profiles_capacity_chk
      check (capacity_hours >= 0 and capacity_hours <= 10000);
  end if;
end $$;

alter table team_profiles enable row level security;
drop policy if exists team_profiles_select on team_profiles;
create policy team_profiles_select on team_profiles for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
-- A person writes their own row; a manager writes anyone's. The RPC is the only write path, so the
-- policy stays read-only and the right is enforced in the function.

drop trigger if exists team_profiles_pin_org on team_profiles;
create trigger team_profiles_pin_org before insert on team_profiles
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 2. team_travel — the preferences: home base, willingness, preferred regions, blackout dates.
-- ---------------------------------------------------------------------------
create table if not exists team_travel (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  home_base text not null default '',
  willingness text not null default 'limited',
  preferred_regions text[] not null default '{}',
  blackout_dates date[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table team_travel add column if not exists home_base text not null default '';
alter table team_travel add column if not exists willingness text not null default 'limited';
alter table team_travel add column if not exists preferred_regions text[] not null default '{}';
alter table team_travel add column if not exists blackout_dates date[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_travel_willingness_chk') then
    alter table team_travel add constraint team_travel_willingness_chk
      check (willingness in ('none', 'limited', 'full'));
  end if;
end $$;

alter table team_travel enable row level security;
-- Travel is personal: a person sees their own; a caller with manage_team or manage_users sees the
-- team's. Anyone else is refused by the policy, so the data cannot leak through a select.
drop policy if exists team_travel_select on team_travel;
create policy team_travel_select on team_travel for select to authenticated
  using (
    org_id = public.jwt_org_id()
    and (user_id = auth.uid() or public.caller_has_right('manage_team') or public.caller_has_right('manage_users') or public.is_platform_admin())
  );

drop trigger if exists team_travel_pin_org on team_travel;
create trigger team_travel_pin_org before insert on team_travel
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 3. team_travel_trips — the travel calendar. A trip is removed by stamping `removed_at`, not deleted.
-- ---------------------------------------------------------------------------
create table if not exists team_travel_trips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  engagement_id uuid null,
  location text not null default '',
  from_date date not null,
  to_date date not null,
  note text null,
  removed_at timestamptz null,
  created_at timestamptz not null default now()
);
alter table team_travel_trips add column if not exists removed_at timestamptz null;
create index if not exists team_travel_trips_org_idx on team_travel_trips (org_id, from_date);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_travel_trips_range_chk') then
    alter table team_travel_trips add constraint team_travel_trips_range_chk
      check (to_date >= from_date);
  end if;
end $$;

alter table team_travel_trips enable row level security;
drop policy if exists team_travel_trips_select on team_travel_trips;
create policy team_travel_trips_select on team_travel_trips for select to authenticated
  using (
    org_id = public.jwt_org_id()
    and (user_id = auth.uid() or public.caller_has_right('manage_team') or public.caller_has_right('manage_users') or public.is_platform_admin())
  );

drop trigger if exists team_travel_trips_pin_org on team_travel_trips;
create trigger team_travel_trips_pin_org before insert on team_travel_trips
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 4. team_assignments — the commitments that make a workload. Also append-only.
-- ---------------------------------------------------------------------------
create table if not exists team_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  engagement_id uuid not null,
  engagement_name text not null default '',
  role text not null default '',
  from_date date not null,
  to_date date not null,
  hours numeric(8,2) not null default 0,
  removed_at timestamptz null,
  created_at timestamptz not null default now()
);
alter table team_assignments add column if not exists engagement_name text not null default '';
alter table team_assignments add column if not exists removed_at timestamptz null;
create index if not exists team_assignments_org_idx on team_assignments (org_id, user_id);

alter table team_assignments enable row level security;
drop policy if exists team_assignments_select on team_assignments;
create policy team_assignments_select on team_assignments for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

drop trigger if exists team_assignments_pin_org on team_assignments;
create trigger team_assignments_pin_org before insert on team_assignments
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 5. engagements — tag an audit as requiring travel (the owner's ask).
-- ---------------------------------------------------------------------------
alter table engagements add column if not exists requires_travel boolean not null default false;
alter table engagements add column if not exists travel_location text not null default '';
alter table engagements add column if not exists travel_from date null;
alter table engagements add column if not exists travel_to date null;

-- Tag (or untag) an engagement as requiring travel. A team-management right is required.
create or replace function public.engagement_travel_tag(
  p_engagement_id uuid, p_requires_travel boolean, p_location text, p_from date, p_to date
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('manage_team') or public.caller_has_right('manage_engagements')) then
    raise exception 'a team-management right is required to tag travel' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements where id = p_engagement_id and org_id = v_org) then
    raise exception 'no such engagement in this organisation' using errcode = 'P0001';
  end if;
  if p_requires_travel and (p_location is null or length(btrim(p_location)) = 0) then
    raise exception 'a location is required when an engagement needs travel' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'the travel window must end on or after it starts' using errcode = 'P0001';
  end if;

  update engagements set
    requires_travel = p_requires_travel,
    travel_location = case when p_requires_travel then btrim(coalesce(p_location, '')) else '' end,
    travel_from = case when p_requires_travel then p_from else null end,
    travel_to = case when p_requires_travel then p_to else null end
  where id = p_engagement_id and org_id = v_org;

  perform public.admin_log_change(
    v_org, 'engagement',
    jsonb_build_object('engagement_id', p_engagement_id, 'requires_travel', p_requires_travel, 'location', p_location),
    'engagement_travel_tagged', 'engagement', p_engagement_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. RPCs.
-- ---------------------------------------------------------------------------

-- Save a member's working profile. A person saves their own; a manager saves anyone's.
create or replace function public.team_profile_save(
  p_user_id uuid, p_avatar_url text, p_capacity_hours numeric
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if p_user_id is null then
    raise exception 'a user is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members where org_id = v_org and user_id = p_user_id) then
    raise exception 'no such member in this organisation' using errcode = 'P0001';
  end if;
  if p_user_id <> auth.uid()
     and not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users')) then
    raise exception 'you may edit only your own profile' using errcode = 'P0001';
  end if;
  if p_capacity_hours is not null and (p_capacity_hours < 0 or p_capacity_hours > 10000) then
    raise exception 'the capacity must be between 0 and 10000 hours' using errcode = 'P0001';
  end if;

  insert into team_profiles (org_id, user_id, avatar_url, capacity_hours, updated_at)
  values (v_org, p_user_id, nullif(btrim(coalesce(p_avatar_url, '')), ''), coalesce(p_capacity_hours, 0), now())
  on conflict (org_id, user_id) do update set
    avatar_url = excluded.avatar_url,
    capacity_hours = excluded.capacity_hours,
    updated_at = now();

  perform public.admin_log_change(
    v_org, 'team_profile',
    jsonb_build_object('user_id', p_user_id, 'capacity_hours', coalesce(p_capacity_hours, 0)),
    'team_profile_saved', 'team_profile', p_user_id);
end $$;

-- Save a member's travel preferences. A person saves their own; a manager saves anyone's.
create or replace function public.team_travel_save(
  p_user_id uuid, p_home_base text, p_willingness text, p_preferred_regions text[], p_blackout_dates date[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if p_user_id is null then
    raise exception 'a user is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members where org_id = v_org and user_id = p_user_id) then
    raise exception 'no such member in this organisation' using errcode = 'P0001';
  end if;
  if p_user_id <> auth.uid()
     and not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users')) then
    raise exception 'you may edit only your own travel preferences' using errcode = 'P0001';
  end if;
  if p_willingness not in ('none', 'limited', 'full') then
    raise exception 'the willingness must be none, limited or full' using errcode = 'P0001';
  end if;

  insert into team_travel (org_id, user_id, home_base, willingness, preferred_regions, blackout_dates, updated_at)
  values (v_org, p_user_id, coalesce(btrim(p_home_base), ''), p_willingness,
          coalesce(p_preferred_regions, '{}'), coalesce(p_blackout_dates, '{}'), now())
  on conflict (org_id, user_id) do update set
    home_base = excluded.home_base,
    willingness = excluded.willingness,
    preferred_regions = excluded.preferred_regions,
    blackout_dates = excluded.blackout_dates,
    updated_at = now();

  perform public.admin_log_change(
    v_org, 'team_travel',
    jsonb_build_object('user_id', p_user_id, 'willingness', p_willingness),
    'team_travel_saved', 'team_travel', p_user_id);
end $$;

-- Add a trip to a member's travel calendar. A person adds their own; a manager adds anyone's.
create or replace function public.team_trip_add(
  p_user_id uuid, p_engagement_id uuid, p_location text, p_from date, p_to date, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members where org_id = v_org and user_id = p_user_id) then
    raise exception 'no such member in this organisation' using errcode = 'P0001';
  end if;
  if p_user_id <> auth.uid()
     and not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users')) then
    raise exception 'you may edit only your own travel calendar' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'the trip must end on or after it starts' using errcode = 'P0001';
  end if;
  if p_location is null or length(btrim(p_location)) = 0 then
    raise exception 'a location is required' using errcode = 'P0001';
  end if;

  insert into team_travel_trips (org_id, user_id, engagement_id, location, from_date, to_date, note)
  values (v_org, p_user_id, p_engagement_id, btrim(p_location), p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  perform public.admin_log_change(
    v_org, 'team_travel_trip',
    jsonb_build_object('user_id', p_user_id, 'location', btrim(p_location), 'from', p_from, 'to', p_to),
    'team_trip_added', 'team_travel_trip', v_id);
  return v_id;
end $$;

-- Remove a trip. Stamped, never deleted: the calendar keeps its history.
create or replace function public.team_trip_remove(p_trip_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid;
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  select user_id into v_user from team_travel_trips where id = p_trip_id and org_id = v_org;
  if v_user is null then
    raise exception 'no such trip in this organisation' using errcode = 'P0001';
  end if;
  if v_user <> auth.uid()
     and not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users')) then
    raise exception 'you may edit only your own travel calendar' using errcode = 'P0001';
  end if;
  update team_travel_trips set removed_at = now() where id = p_trip_id and org_id = v_org and removed_at is null;
  perform public.admin_log_change(
    v_org, 'team_travel_trip', jsonb_build_object('trip_id', p_trip_id),
    'team_trip_removed', 'team_travel_trip', p_trip_id);
end $$;

-- Add an assignment (a commitment that counts toward a workload).
create or replace function public.team_assignment_add(
  p_user_id uuid, p_engagement_id uuid, p_engagement_name text, p_role text,
  p_from date, p_to date, p_hours numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users') or public.caller_has_right('manage_engagements')) then
    raise exception 'a team-management right is required to assign an engagement' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members where org_id = v_org and user_id = p_user_id) then
    raise exception 'no such member in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements where id = p_engagement_id and org_id = v_org) then
    raise exception 'no such engagement in this organisation' using errcode = 'P0001';
  end if;
  if p_engagement_id is null then
    raise exception 'an engagement is required' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'the assignment must end on or after it starts' using errcode = 'P0001';
  end if;
  if p_hours is null or p_hours < 0 then
    raise exception 'the hours must not be negative' using errcode = 'P0001';
  end if;

  insert into team_assignments (org_id, user_id, engagement_id, engagement_name, role, from_date, to_date, hours)
  values (v_org, p_user_id, p_engagement_id, coalesce(btrim(p_engagement_name), ''), coalesce(btrim(p_role), ''),
          p_from, p_to, p_hours)
  returning id into v_id;

  perform public.admin_log_change(
    v_org, 'team_assignment',
    jsonb_build_object('user_id', p_user_id, 'engagement_id', p_engagement_id, 'hours', p_hours),
    'team_assignment_added', 'team_assignment', v_id);
  return v_id;
end $$;

-- Remove an assignment. Stamped, never deleted.
create or replace function public.team_assignment_remove(p_assignment_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users') or public.caller_has_right('manage_engagements')) then
    raise exception 'a team-management right is required to change an assignment' using errcode = 'P0001';
  end if;
  update team_assignments set removed_at = now()
  where id = p_assignment_id and org_id = v_org and removed_at is null;
  perform public.admin_log_change(
    v_org, 'team_assignment', jsonb_build_object('assignment_id', p_assignment_id),
    'team_assignment_removed', 'team_assignment', p_assignment_id);
end $$;

-- Read the whole directory in one call: the member list, each one's profile, travel and commitments.
-- The pure model in TypeScript turns this into workloads and recommendations. Only the fields the
-- caller may see are returned; a caller without manage_team gets no travel row.
create or replace function public.team_directory_get()
returns table (
  user_id uuid,
  display_name text,
  role_slug text,
  role_name text,
  avatar_url text,
  capacity_hours numeric,
  home_base text,
  willingness text,
  preferred_regions text[],
  blackout_dates date[],
  assignments jsonb,
  trips jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_may_see_travel boolean;
begin
  if v_org is null then
    raise exception 'no organisation in the session' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('manage_team') or public.caller_has_right('manage_users')
          or public.caller_has_right('manage_engagements') or public.caller_has_right('view_all_scopes')
          or public.caller_has_right('perform_work') or public.caller_has_right('read_only')
          or public.caller_has_right('view_insights')) then
    raise exception 'a right is required to read the team directory' using errcode = 'P0001';
  end if;
  v_may_see_travel := public.caller_has_right('manage_team') or public.caller_has_right('manage_users');

  return query
    select
      m.user_id,
      coalesce(m.display_name, ''),
      r.slug,
      r.name,
      p.avatar_url,
      coalesce(p.capacity_hours, 0),
      case when (t.user_id is not null and (t.user_id = auth.uid() or v_may_see_travel)) then t.home_base else null end,
      case when (t.user_id is not null and (t.user_id = auth.uid() or v_may_see_travel)) then t.willingness else null end,
      case when (t.user_id is not null and (t.user_id = auth.uid() or v_may_see_travel)) then t.preferred_regions else null end,
      case when (t.user_id is not null and (t.user_id = auth.uid() or v_may_see_travel)) then t.blackout_dates else null end,
      coalesce(a.items, '[]'::jsonb),
      case when (t.user_id is not null and (t.user_id = auth.uid() or v_may_see_travel))
           then coalesce(tr.items, '[]'::jsonb) else '[]'::jsonb end
    from org_members m
    join roles r on r.id = m.role_id
    left join team_profiles p on p.org_id = m.org_id and p.user_id = m.user_id
    left join team_travel t on t.org_id = m.org_id and t.user_id = m.user_id
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'engagementId', x.engagement_id, 'engagementName', x.engagement_name,
        'role', x.role, 'from', x.from_date, 'to', x.to_date, 'hours', x.hours) order by x.from_date) as items
      from team_assignments x
      where x.org_id = m.org_id and x.user_id = m.user_id and x.removed_at is null
    ) a on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'engagementId', x.engagement_id, 'location', x.location,
        'from', x.from_date, 'to', x.to_date, 'note', x.note) order by x.from_date) as items
      from team_travel_trips x
      where x.org_id = m.org_id and x.user_id = m.user_id and x.removed_at is null
    ) tr on true
    where m.org_id = v_org
    order by r.name, coalesce(m.display_name, '');
end $$;

revoke execute on function public.team_profile_save(uuid, text, numeric) from public, anon;
revoke execute on function public.team_travel_save(uuid, text, text, text[], date[]) from public, anon;
revoke execute on function public.team_trip_add(uuid, uuid, text, date, date, text) from public, anon;
revoke execute on function public.team_trip_remove(uuid) from public, anon;
revoke execute on function public.team_assignment_add(uuid, uuid, text, text, date, date, numeric) from public, anon;
revoke execute on function public.team_assignment_remove(uuid) from public, anon;
revoke execute on function public.team_directory_get() from public, anon;
revoke execute on function public.engagement_travel_tag(uuid, boolean, text, date, date) from public, anon;
grant execute on function public.team_profile_save(uuid, text, numeric) to authenticated;
grant execute on function public.team_travel_save(uuid, text, text, text[], date[]) to authenticated;
grant execute on function public.team_trip_add(uuid, uuid, text, date, date, text) to authenticated;
grant execute on function public.team_trip_remove(uuid) to authenticated;
grant execute on function public.team_assignment_add(uuid, uuid, text, text, date, date, numeric) to authenticated;
grant execute on function public.team_assignment_remove(uuid) to authenticated;
grant execute on function public.team_directory_get() to authenticated;
grant execute on function public.engagement_travel_tag(uuid, boolean, text, date, date) to authenticated;

-- Table grants follow the 0008 convention: authenticated reads (RLS filters), writes only via RPC.
grant select on table team_profiles to authenticated;
grant select on table team_travel to authenticated;
grant select on table team_travel_trips to authenticated;
grant select on table team_assignments to authenticated;

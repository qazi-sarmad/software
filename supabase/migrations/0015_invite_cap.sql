-- 2E: invitation cap. Default 20 per user per day. Platform ceiling 100 per organisation per day.
create table if not exists invite_cap_settings (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table invite_cap_settings add column if not exists per_user_daily int not null default 20;
alter table invite_cap_settings drop constraint if exists invite_cap_settings_per_user_daily_chk;
alter table invite_cap_settings add constraint invite_cap_settings_per_user_daily_chk check (per_user_daily between 1 and 100);


insert into invite_cap_settings (org_id) select id from orgs on conflict (org_id) do nothing;


create or replace function public.orgs_seed_invite_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into invite_cap_settings (org_id) values (new.id) on conflict (org_id) do nothing;
  return new;
end $$;


drop trigger if exists orgs_seed_invite_cap on orgs;
create trigger orgs_seed_invite_cap after insert on orgs
for each row execute function public.orgs_seed_invite_cap();


create table if not exists invite_cap_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade
);
alter table invite_cap_events add column if not exists invited_by uuid references auth.users(id) on delete cascade;
alter table invite_cap_events add column if not exists email text;
alter table invite_cap_events add column if not exists created_at timestamptz not null default now();
create index if not exists invite_cap_events_org_day on invite_cap_events (org_id, created_at);


alter table invite_cap_settings enable row level security;
alter table invite_cap_events enable row level security;
drop policy if exists icap_settings_select on invite_cap_settings;
create policy icap_settings_select on invite_cap_settings for select using (org_id = public.jwt_org_id());
drop policy if exists icap_events_select on invite_cap_events;
create policy icap_events_select on invite_cap_events for select using (org_id = public.jwt_org_id());
-- No insert, update or delete policy: rows are written only by invite_user_capped().


create or replace function public.invite_user_capped(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_caller uuid := auth.uid();
  v_user_limit int;
  v_user_count int;
  v_org_count int;
begin
  if v_org is null or v_caller is null then
    raise exception 'not signed in';
  end if;
  if not coalesce(public.caller_has_right('manage_users'), false) then
    raise exception 'not allowed to invite users';
  end if;
  if p_email is null or position('@' in p_email) <= 1 then
    raise exception 'invalid email address';
  end if;
  perform pg_advisory_xact_lock(hashtext('invite:' || v_org::text));
  select coalesce(s.per_user_daily, 20) into v_user_limit from invite_cap_settings s where s.org_id = v_org;
  v_user_limit := coalesce(v_user_limit, 20);
  select count(*) into v_user_count from invite_cap_events e
    where e.org_id = v_org and e.invited_by = v_caller and e.created_at > now() - interval '1 day';
  select count(*) into v_org_count from invite_cap_events e
    where e.org_id = v_org and e.created_at > now() - interval '1 day';
  if v_user_count >= v_user_limit then
    raise exception 'daily invitation limit reached for this user';
  end if;
  if v_org_count >= 100 then
    raise exception 'daily invitation limit reached for this organisation';
  end if;
  insert into invite_cap_events (org_id, invited_by, email) values (v_org, v_caller, lower(p_email));
end $$;


revoke execute on function public.invite_user_capped(text) from public;
grant execute on function public.invite_user_capped(text) to authenticated;

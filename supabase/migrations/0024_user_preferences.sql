-- H3a: user preferences (record_view_mode foundation, spec §27.5, §17).
--
-- The record view has two non-blocking modes controlled by the user's `record_view_mode`
-- preference (full_page | floating_window). Preferences are per user, per organisation, so they
-- follow the user across devices without leaking between tenants.
--
-- Reuse (grep first): no user_preferences table exists. `config_versions` is org-level
-- configuration, not per-user state, so a dedicated table is the simplest option that obeys the
-- Laws. Every new table carries org_id, has RLS on, has a select policy using jwt_org_id() and has
-- no direct write policy: writes go through set_user_preference().

create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, key)
);

create index if not exists user_preferences_user_idx on user_preferences (org_id, user_id);

alter table user_preferences enable row level security;
drop policy if exists user_preferences_select on user_preferences;
create policy user_preferences_select on user_preferences for select to authenticated
  using (org_id = public.jwt_org_id() and user_id = auth.uid());
-- No insert, update or delete policy: writes happen only through set_user_preference().

-- ---------------------------------------------------------------------------
-- get_user_preference: the caller's own preference value, or null.
-- SECURITY DEFINER so the read is not filtered by the row policy when the RPC is called
-- before the policy is in place, and so the org comes from the JWT, never from an argument.
-- ---------------------------------------------------------------------------
create or replace function public.get_user_preference(p_key text)
returns text
language sql stable security definer set search_path = public as $$
  select p.value
  from user_preferences p
  where p.org_id = public.jwt_org_id()
    and p.user_id = auth.uid()
    and p.key = p_key
$$;

-- ---------------------------------------------------------------------------
-- set_user_preference: upsert the caller's own preference. The org is the JWT org; a caller may
-- only write their own row (auth.uid()), so no user can set another user's preference.
-- ---------------------------------------------------------------------------
create or replace function public.set_user_preference(p_key text, p_value text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if v_org is null or v_user is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'a preference key is required' using errcode = 'P0001';
  end if;
  if p_value is null then
    raise exception 'a preference value is required' using errcode = 'P0001';
  end if;

  insert into user_preferences (user_id, org_id, key, value)
  values (v_user, v_org, p_key, p_value)
  on conflict (user_id, org_id, key)
  do update set value = excluded.value, updated_at = now();
end $$;

revoke execute on function public.get_user_preference(text) from public, anon;
revoke execute on function public.set_user_preference(text, text) from public, anon;
grant execute on function public.get_user_preference(text) to authenticated;
grant execute on function public.set_user_preference(text, text) to authenticated;

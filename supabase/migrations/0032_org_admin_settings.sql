-- 0032 (C2): Org Admin settings. Fills the control-plane gap so the Org Admin portal can edit the
-- organisation sampling table, severity levels and email provider shape — configuration in a portal,
-- not in SQL. Every write goes through a security-definer RPC that checks edit_config, and every write
-- is recorded in the org's hash-chained configuration log.
--
-- M1: org_sampling_table (0027) and severity_levels (0030) already exist; this migration adds the
-- missing CRUD RPCs rather than new tables.

-- ---------------------------------------------------------------------------
-- Org sampling table CRUD (§11.2 configuration-not-code).
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_sampling_row(
  p_control_type text, p_frequency text, p_pop_band text,
  p_method text, p_base_size int, p_pct numeric, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_control_type is null or btrim(p_control_type) = ''
     or p_frequency is null or btrim(p_frequency) = ''
     or p_pop_band is null or btrim(p_pop_band) = '' then
    raise exception 'control type, frequency and population band are required' using errcode = 'P0001';
  end if;
  if p_method not in ('random', 'systematic', 'mus', 'stratified', 'high_value', 'low_value', 'haphazard') then
    raise exception 'unknown sampling method: %', p_method using errcode = 'P0001';
  end if;
  if p_base_size is null or p_base_size < 1 then
    raise exception 'the base sample size must be at least 1' using errcode = 'P0001';
  end if;
  if p_pct is null or p_pct <= 0 or p_pct > 1 then
    raise exception 'the sample percentage must be greater than 0 and at most 1' using errcode = 'P0001';
  end if;

  if p_id is not null then
    update org_sampling_table
       set control_type = p_control_type, frequency = p_frequency, pop_band = p_pop_band,
           method = p_method, base_size = p_base_size, pct = p_pct
     where id = p_id and org_id = v_org
     returning id into v_id;
    if v_id is null then
      raise exception 'sampling row not found in this organisation' using errcode = 'P0001';
    end if;
  else
    insert into org_sampling_table (org_id, control_type, frequency, pop_band, method, base_size, pct)
    values (v_org, p_control_type, p_frequency, p_pop_band, p_method, p_base_size, p_pct)
    on conflict (org_id, control_type, frequency, pop_band) do update
      set method = excluded.method, base_size = excluded.base_size, pct = excluded.pct
    returning id into v_id;
  end if;

  perform public.admin_log_change(v_org, 'sampling_row:' || v_id::text,
    jsonb_build_object('control_type', p_control_type, 'frequency', p_frequency, 'pop_band', p_pop_band,
                       'method', p_method, 'base_size', p_base_size, 'pct', p_pct),
    'sampling_row_saved', 'org_sampling_table', v_id);
  return v_id;
end $$;

create or replace function public.admin_delete_sampling_row(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_n int;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  delete from org_sampling_table where id = p_id and org_id = v_org;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'sampling row not found in this organisation' using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'sampling_row:' || p_id::text, jsonb_build_object('deleted', true),
    'sampling_row_deleted', 'org_sampling_table', p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Severity levels CRUD (§14.4). The colour must be a design token (CHECK in 0030).
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_severity_level(
  p_name text, p_color_token text, p_rank int, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_name is null or btrim(p_name) = '' then
    raise exception 'a severity level name is required' using errcode = 'P0001';
  end if;
  if p_color_token is null or p_color_token not like '--%' then
    raise exception 'the severity colour must be a design token, not a raw colour' using errcode = 'P0001';
  end if;

  if p_id is not null then
    update severity_levels
       set name = p_name, color_token = p_color_token, rank = coalesce(p_rank, 0)
     where id = p_id and org_id = v_org
     returning id into v_id;
    if v_id is null then
      raise exception 'severity level not found in this organisation' using errcode = 'P0001';
    end if;
  else
    insert into severity_levels (org_id, name, color_token, rank)
    values (v_org, p_name, p_color_token, coalesce(p_rank, 0))
    on conflict (org_id, name) do update
      set color_token = excluded.color_token, rank = excluded.rank
    returning id into v_id;
  end if;

  perform public.admin_log_change(v_org, 'severity_level:' || v_id::text,
    jsonb_build_object('name', p_name, 'color_token', p_color_token, 'rank', coalesce(p_rank, 0)),
    'severity_level_saved', 'severity_levels', v_id);
  return v_id;
end $$;

create or replace function public.admin_delete_severity_level(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_n int;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  delete from severity_levels where id = p_id and org_id = v_org;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'severity level not found in this organisation' using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'severity_level:' || p_id::text, jsonb_build_object('deleted', true),
    'severity_level_deleted', 'severity_levels', p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Email provider shape. Secrets (provider_config) are never exposed to tenant roles: they are read
-- only through the platform policy, and tenant roles read the non-secret view.
-- ---------------------------------------------------------------------------
create table if not exists email_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  provider text not null default 'stub' check (provider in ('stub', 'resend', 'graph')),
  provider_config jsonb not null default '{}'::jsonb,
  from_address text,
  updated_at timestamptz not null default now()
);

alter table email_settings enable row level security;
drop policy if exists email_settings_platform on email_settings;
create policy email_settings_platform on email_settings for select to authenticated
  using (public.is_platform_admin());

-- An org reads its own provider shape. Column privileges, not a definer view: provider_config is
-- never granted to tenant roles, so it cannot be selected at all.
drop policy if exists email_settings_org_select on email_settings;
create policy email_settings_org_select on email_settings for select to authenticated
  using (org_id = public.jwt_org_id());

revoke select on public.email_settings from public, anon, authenticated;
revoke insert, update, delete on public.email_settings from public, anon, authenticated;
grant select (org_id, provider, from_address, updated_at) on public.email_settings to authenticated;

create or replace function public.admin_set_email_provider(p_provider text, p_from_address text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_provider not in ('stub', 'resend', 'graph') then
    raise exception 'unknown email provider: %', p_provider using errcode = 'P0001';
  end if;
  insert into email_settings (org_id, provider, from_address, updated_at)
  values (v_org, p_provider, p_from_address, now())
  on conflict (org_id) do update
    set provider = excluded.provider, from_address = excluded.from_address, updated_at = now();
  perform public.admin_log_change(v_org, 'email_provider',
    jsonb_build_object('provider', p_provider, 'from_address', p_from_address),
    'email_provider_changed', 'email_settings', null);
end $$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_upsert_sampling_row(text, text, text, text, int, numeric, uuid)',
    'admin_delete_sampling_row(uuid)',
    'admin_upsert_severity_level(text, text, int, uuid)',
    'admin_delete_severity_level(uuid)',
    'admin_set_email_provider(text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

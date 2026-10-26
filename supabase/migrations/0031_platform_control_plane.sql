-- 0031 (C1): the platform control plane. Super Admin reads and writes tenant metadata only; it reads
-- no tenant business content. Tenant roles read zero platform rows. Platform checks may read the JWT
-- user_role inside platform RPCs only (D-PLATFORM-RIGHTS); org product code keeps caller_has_right.
--
-- M1: platform_trail already exists (0005_logging.sql); this migration ALTERs it (adds payload) rather
-- than creating it again.

-- ---------------------------------------------------------------------------
-- Platform settings: platform-wide constants (no tenant data).
-- ---------------------------------------------------------------------------
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into platform_settings (key, value) values ('support_grant_max_hours', to_jsonb(48))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tenant settings: per-tenant control-plane state.
-- ---------------------------------------------------------------------------
create table if not exists tenant_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  feature_flags jsonb not null default '{}'::jsonb,
  usage_quota jsonb not null default '{}'::jsonb,
  ai_enabled boolean not null default false,
  ai_model_endpoint text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into tenant_settings (org_id) select id from orgs on conflict (org_id) do nothing;

-- ---------------------------------------------------------------------------
-- Support access grants: time-boxed metadata (used by a future authenticated support session).
-- ---------------------------------------------------------------------------
create table if not exists support_access_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  scope jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  revoke_reason text,
  platform_actor_id uuid,
  constraint sag_expires_after_grant check (expires_at > granted_at)
);
create index if not exists sag_org_idx on support_access_grants (org_id);

-- ---------------------------------------------------------------------------
-- M1: extend platform_trail with a payload column.
-- ---------------------------------------------------------------------------
alter table platform_trail add column if not exists payload jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Platform identity. This is the sole place that reads user_role outside RLS (D-PLATFORM-RIGHTS).
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin() returns boolean
language sql stable as $$ select public.jwt_user_role() = 'platform_admin' $$;

create or replace function public.require_platform_admin() returns void
language plpgsql stable as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.platform_log(
  p_action text, p_tenant uuid, p_object_type text, p_object_id uuid, p_payload jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into platform_trail (actor_id, action, tenant_id, object_type, object_id, payload)
  values (auth.uid(), p_action, p_tenant, p_object_type, p_object_id, coalesce(p_payload, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- RLS: platform tables are invisible to tenant roles and writable by the platform role only.
-- ---------------------------------------------------------------------------
alter table platform_settings     enable row level security;
alter table tenant_settings       enable row level security;
alter table support_access_grants enable row level security;

drop policy if exists platform_settings_all on platform_settings;
create policy platform_settings_all on platform_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists tenant_settings_select on tenant_settings;
create policy tenant_settings_select on tenant_settings for select to authenticated
  using (public.is_platform_admin());
drop policy if exists tenant_settings_write on tenant_settings;
create policy tenant_settings_write on tenant_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists sag_select on support_access_grants;
create policy sag_select on support_access_grants for select to authenticated
  using (public.is_platform_admin());

-- The Super Admin portal shows the invite cap it set (a quota, not tenant business content).
drop policy if exists icap_settings_platform_select on invite_cap_settings;
create policy icap_settings_platform_select on invite_cap_settings for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Super Admin RPCs.
-- ---------------------------------------------------------------------------
-- M2: dropped first because 0087 changes this function's OUT columns (ai_enabled is removed with
-- the rest of the AI feature); a repeat apply would otherwise fail with "cannot change return type".
drop function if exists public.platform_list_tenants();
create or replace function public.platform_list_tenants()
returns table (id uuid, name text, status text, feature_flags jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  return query
    select o.id, o.name, coalesce(ts.status, 'active'),
           coalesce(ts.feature_flags, '{}'::jsonb), o.created_at
    from orgs o
    left join tenant_settings ts on ts.org_id = o.id
    order by o.name;
end $$;

create or replace function public.platform_set_tenant_status(p_org uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_status not in ('active', 'suspended') then
    raise exception 'tenant status must be active or suspended' using errcode = 'P0001';
  end if;
  insert into tenant_settings (org_id, status, updated_at) values (p_org, p_status, now())
  on conflict (org_id) do update set status = excluded.status, updated_at = now();
  perform public.platform_log('tenant_status_changed', p_org, 'tenant', p_org,
    jsonb_build_object('status', p_status));
end $$;

create or replace function public.platform_set_feature_flag(p_org uuid, p_flag text, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_flag is null or btrim(p_flag) = '' then
    raise exception 'a feature flag key is required' using errcode = 'P0001';
  end if;
  insert into tenant_settings (org_id, feature_flags, updated_at)
  values (p_org, jsonb_build_object(p_flag, p_value), now())
  on conflict (org_id) do update
    set feature_flags = coalesce(tenant_settings.feature_flags, '{}'::jsonb) || jsonb_build_object(p_flag, p_value),
        updated_at = now();
  perform public.platform_log('feature_flag_set', p_org, 'tenant', p_org,
    jsonb_build_object('flag', p_flag, 'value', p_value));
end $$;

create or replace function public.platform_enable_ai(p_org uuid, p_enabled boolean, p_endpoint text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  insert into tenant_settings (org_id, ai_enabled, ai_model_endpoint, updated_at)
  values (p_org, coalesce(p_enabled, false), p_endpoint, now())
  on conflict (org_id) do update
    set ai_enabled = coalesce(p_enabled, false), ai_model_endpoint = p_endpoint, updated_at = now();
  perform public.platform_log('ai_enablement_changed', p_org, 'tenant', p_org,
    jsonb_build_object('ai_enabled', coalesce(p_enabled, false), 'endpoint', p_endpoint));
end $$;

create or replace function public.platform_set_invite_cap(p_org uuid, p_per_user_daily int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_per_user_daily is null or p_per_user_daily < 1 or p_per_user_daily > 100 then
    raise exception 'the per-user daily invitation cap must be between 1 and 100' using errcode = 'P0001';
  end if;
  insert into invite_cap_settings (org_id, per_user_daily) values (p_org, p_per_user_daily)
  on conflict (org_id) do update set per_user_daily = excluded.per_user_daily;
  perform public.platform_log('invite_cap_set', p_org, 'tenant', p_org,
    jsonb_build_object('per_user_daily', p_per_user_daily));
end $$;

-- Shared support-grant creation, used by the platform RPC and the org-admin RPC.
create or replace function public.support_access_create(
  p_org uuid, p_scope jsonb, p_duration_hours int, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_id uuid;
begin
  if p_duration_hours is null or p_duration_hours < 1 then
    raise exception 'a grant duration of at least one hour is required' using errcode = 'P0001';
  end if;
  select coalesce((value)::text::int, 48) into v_max from platform_settings where key = 'support_grant_max_hours';
  v_max := coalesce(v_max, 48);
  if p_duration_hours > v_max then
    raise exception 'a support grant may not exceed % hours', v_max using errcode = 'P0001';
  end if;
  if not exists (select 1 from orgs where id = p_org) then
    raise exception 'tenant not found' using errcode = 'P0001';
  end if;
  insert into support_access_grants (org_id, granted_by, expires_at, scope, platform_actor_id)
  values (p_org, auth.uid(), now() + make_interval(hours => p_duration_hours), coalesce(p_scope, '{}'::jsonb), p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.platform_grant_support_access(
  p_org uuid, p_scope jsonb, p_duration_hours int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.require_platform_admin();
  v_id := public.support_access_create(p_org, p_scope, p_duration_hours, auth.uid());
  perform public.platform_log('support_access_granted', p_org, 'support_access_grant', v_id,
    jsonb_build_object('duration_hours', p_duration_hours, 'scope', coalesce(p_scope, '{}'::jsonb)));
  return v_id;
end $$;

-- Org-admin variant (8B): the tenant's Org Admin authorises time-boxed platform support.
create or replace function public.grant_support_access(
  p_org uuid, p_scope jsonb, p_duration_hours int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_org is distinct from public.jwt_org_id() then
    raise exception 'a grant can only be issued for your own organisation' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_users'), false) then
    raise exception 'not allowed: caller lacks the manage_users right' using errcode = 'P0001';
  end if;
  v_id := public.support_access_create(p_org, p_scope, p_duration_hours, null);
  perform public.append_ledger_entry(p_org, 'support_access_granted',
    jsonb_build_object('grant_id', v_id, 'duration_hours', p_duration_hours));
  return v_id;
end $$;

create or replace function public.platform_revoke_support_access(p_grant_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  perform public.require_platform_admin();
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a revoke reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  update support_access_grants
     set revoked_at = now(), revoke_reason = p_reason
   where id = p_grant_id and revoked_at is null
   returning org_id into v_org;
  if v_org is null then
    raise exception 'grant not found or already revoked' using errcode = 'P0001';
  end if;
  perform public.platform_log('support_access_revoked', v_org, 'support_access_grant', p_grant_id,
    jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.revoke_support_access(p_grant_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a revoke reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  select org_id into v_org from support_access_grants where id = p_grant_id and revoked_at is null;
  if v_org is null then
    raise exception 'grant not found or already revoked' using errcode = 'P0001';
  end if;
  if v_org is distinct from public.jwt_org_id() then
    raise exception 'a grant can only be revoked by its own organisation' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_users'), false) then
    raise exception 'not allowed: caller lacks the manage_users right' using errcode = 'P0001';
  end if;
  update support_access_grants set revoked_at = now(), revoke_reason = p_reason where id = p_grant_id;
  perform public.append_ledger_entry(v_org, 'support_access_revoked',
    jsonb_build_object('grant_id', p_grant_id, 'reason', p_reason));
end $$;

create or replace function public.platform_list_trail(p_limit int default 100)
returns table (id uuid, actor_id uuid, action text, tenant_id uuid, payload jsonb, ts timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  return query
    select t.id, t.actor_id, t.action, t.tenant_id, t.payload, t.ts
    from platform_trail t
    order by t.ts desc
    limit greatest(coalesce(p_limit, 100), 1);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application functions to authenticated only.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'platform_list_tenants()',
    'platform_set_tenant_status(uuid, text)',
    'platform_set_feature_flag(uuid, text, boolean)',
    'platform_enable_ai(uuid, boolean, text)',
    'platform_set_invite_cap(uuid, int)',
    'platform_grant_support_access(uuid, jsonb, int)',
    'platform_revoke_support_access(uuid, text)',
    'platform_list_trail(int)',
    'grant_support_access(uuid, jsonb, int)',
    'revoke_support_access(uuid, text)',
    'is_platform_admin()',
    'require_platform_admin()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;

  -- Internal helpers stay private: security-definer RPCs call them as the owner, so a tenant
  -- user must not reach them directly (support_access_create would bypass every guard).
  foreach fn in array array[
    'support_access_create(uuid, jsonb, int, uuid)',
    'platform_log(text, uuid, text, uuid, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;

-- 0207: owner-only platform console, and a second factor for every tenant member.
--
-- Ported from feature/security-harden-v1 (0103) onto the trunk, with the trunk's tenant-suspension
-- logic (0115) merged into the access-token hook so this file does not regress it. The hook here is
-- the union of 0115 (suspension), 0204 (SSO enforcement) and 0207 (owner gate + tenant MFA):
-- a suspended tenant's member is issued no claim; an SSO-enforcing org withholds claims from a
-- non-SSO session; an MFA-enforcing org withholds claims from an aal1 session.
--
-- Two controls, one migration, because both are enforced in the same two choke points:
--   * the access-token hook (`custom_access_token_hook`) is the only writer of org_id/user_role;
--   * `require_platform_admin()` is the only gate every platform RPC calls.
--
-- Laws that shape this file:
--   - L1 deterministic: no model call anywhere. The only decision is a boolean over JWT claims.
--   - L2: neither control widens a read path. Both *withhold* claims, so RLS shows less, never more.
--   - Config-as-ledger: the tenant MFA switch is a row with a reason and an append-only
--     hash-chained `org_security_versions` table.
--   - Rights, not role names, for tenant actions (`edit_config`); the owner row for platform actions.
--   - Time is an argument: nothing here reads a clock except the `now()` default on an audit column.
--   - Idempotent: every object is `if not exists` / `create or replace`, every seed is
--     `on conflict do nothing`, so the harness applies this file twice.

-- ---------------------------------------------------------------------------
-- 1. Owner-only platform console (spec §24).
--
-- `platform_admins` says "QSCorp staff". `platform_owners` says "the one person who may open the
-- console". A platform admin who is not an owner is refused by EVERY platform RPC with the same
-- message a tenant user gets, so the console is indistinguishable from a door that is not there.
-- ---------------------------------------------------------------------------
create table if not exists platform_owners (
  user_id uuid primary key,
  claimed_at timestamptz not null default now(),
  note text
);

alter table platform_owners enable row level security;

-- A platform user reads only its own owner row; a tenant user reads nothing.
drop policy if exists platform_owners_select on platform_owners;
create policy platform_owners_select on platform_owners for select to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policy exists for any application role, and 0008 revokes write grants, so
-- ownership is changed only by the bootstrap RPC below or by the owner at the database.

/** True when the caller holds the single platform-owner row. Reads a table, never a claim. */
create or replace function public.is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_owners where user_id = auth.uid())
$$;

/** True when an owner exists at all. Used to decide whether the bootstrap is still open. */
create or replace function public.platform_owner_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_owners)
$$;

-- ---------------------------------------------------------------------------
-- 2. require_platform_admin() now requires ownership.
--
-- It stays the ONE choke point every platform_* RPC already calls, so arming the owner check
-- protects the whole control plane at once. The refusal message is identical for a non-owner
-- platform admin and for a tenant user: the console does not reveal that it exists.
-- ---------------------------------------------------------------------------
create or replace function public.require_platform_admin() returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_required boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  if not public.is_platform_owner() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  select require_platform_mfa into v_required from platform_security_settings where id;
  if coalesce(v_required, false) and not public.platform_aal2() then
    raise exception 'mfa required: platform administrator sessions must complete multi-factor authentication'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The one-time bootstrap.
--
-- A fresh install has no owner, so the console would be unreachable. The first platform admin may
-- claim ownership once, before any owner exists. After that the RPC is permanently closed: there is
-- no API to add, move or remove an owner. This is the "cannot and shall not be accessed by anyone
-- except me" rule, expressed as code.
-- ---------------------------------------------------------------------------
create or replace function public.platform_owner_claim(p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to claim platform ownership' using errcode = 'P0001';
  end if;
  if public.platform_owner_exists() then
    raise exception 'not allowed: platform ownership is already claimed' using errcode = 'P0001';
  end if;
  insert into platform_owners (user_id, note) values (auth.uid(), p_reason);
  insert into platform_trail (actor_id, action, object_type, payload)
  values (auth.uid(), 'owner_claim', 'platform_owner', jsonb_build_object('reason', p_reason));
end $$;

/** The console's identity probe: the platform role, and whether this session is the owner. */
-- The return shape gains two columns, so the old function is dropped first (the signature cannot be
-- widened in place). Nothing depends on it but the client and the portal's own test.
drop function if exists public.platform_whoami();
create or replace function public.platform_whoami()
returns table (user_id uuid, is_platform_admin boolean, is_platform_owner boolean, owner_exists boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  return query select auth.uid(), public.is_platform_admin(), public.is_platform_owner(),
                      public.platform_owner_exists();
end $$;

-- ---------------------------------------------------------------------------
-- 4. The second factor for tenant members (spec §25.2).
--
-- Until now only the platform console required a second factor. A client organisation can now
-- require one of every member, through the same hook that already withholds claims for SSO.
-- Config-as-ledger: the switch is a row with a reason, and every change is versioned.
-- ---------------------------------------------------------------------------
create table if not exists org_security_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  require_mfa boolean not null default false,
  set_by uuid,
  set_at timestamptz not null default now(),
  reason text
);
alter table org_security_settings add column if not exists require_mfa boolean not null default false;
alter table org_security_settings add column if not exists set_by uuid;
alter table org_security_settings add column if not exists set_at timestamptz not null default now();
alter table org_security_settings add column if not exists reason text;

alter table org_security_settings enable row level security;

drop policy if exists org_security_settings_select on org_security_settings;
create policy org_security_settings_select on org_security_settings for select to authenticated
  using (org_id = public.jwt_org_id() and (public.caller_has_right('edit_config') or public.is_platform_admin()));

create table if not exists org_security_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  require_mfa boolean not null,
  actor uuid,
  reason text not null,
  prev_hash text,
  row_hash text not null,
  created_at timestamptz not null default now()
);
alter table org_security_versions add column if not exists org_id uuid;
alter table org_security_versions add column if not exists require_mfa boolean;
alter table org_security_versions add column if not exists actor uuid;
alter table org_security_versions add column if not exists reason text;
alter table org_security_versions add column if not exists prev_hash text;
alter table org_security_versions add column if not exists row_hash text;
alter table org_security_versions add column if not exists created_at timestamptz not null default now();
create index if not exists org_security_versions_org_idx on org_security_versions (org_id, created_at);

alter table org_security_versions enable row level security;
drop policy if exists org_security_versions_select on org_security_versions;
create policy org_security_versions_select on org_security_versions for select to authenticated
  using (org_id = public.jwt_org_id() and (public.caller_has_right('edit_config') or public.is_platform_admin()));

/** True when the caller's organisation requires a second factor. Null org reads as false. */
create or replace function public.org_requires_mfa() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.require_mfa from public.org_security_settings s
                    where s.org_id = public.jwt_org_id()), false)
$$;

/** The caller's organisation MFA posture, for the UI gate. Never returns a secret. */
create or replace function public.org_security_status()
returns table (require_mfa boolean, aal text, mfa_satisfied boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  return query select public.org_requires_mfa(), public.jwt_aal(),
                      (not public.org_requires_mfa() or public.jwt_aal() = 'aal2');
end $$;

/** Set the organisation's second-factor requirement. Requires edit_config and a reason. */
create or replace function public.admin_set_require_mfa(p_required boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_prev text;
  v_body text;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required to change the multi-factor requirement' using errcode = 'P0001';
  end if;

  insert into org_security_settings (org_id, require_mfa, set_by, set_at, reason)
  values (v_org, coalesce(p_required, false), auth.uid(), now(), p_reason)
  on conflict (org_id) do update set
    require_mfa = excluded.require_mfa, set_by = excluded.set_by,
    set_at = excluded.set_at, reason = excluded.reason;

  select row_hash into v_prev from org_security_versions where org_id = v_org order by created_at desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || coalesce(p_required, false)::text || '|' || p_reason;
  insert into org_security_versions (org_id, require_mfa, actor, reason, prev_hash, row_hash)
  values (v_org, coalesce(p_required, false), auth.uid(), p_reason, v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));

  perform public.admin_log_change(v_org, 'security_settings',
    jsonb_build_object('require_mfa', coalesce(p_required, false)),
    'security_settings_saved', 'org_security_settings', v_org);
end $$;

-- ---------------------------------------------------------------------------
-- 5. The access-token hook gains the tenant MFA gate.
--
-- Order matters: the MFA requirement is checked first, so an organisation that requires a second
-- factor withholds claims even from an SSO session that has not completed one. Both controls only
-- ever remove `org_id`/`user_role`; neither adds a claim a session would not otherwise have.
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_org_id uuid;
  v_slug text;
  v_platform boolean;
  v_ext_org uuid;
  v_enforced boolean;
  v_mfa boolean;
  v_aal text;
begin
  -- Strip any pre-existing values first, so a stale or forged claim cannot survive.
  v_claims := coalesce(event -> 'claims', '{}'::jsonb)
              - 'org_id' - 'user_role' - 'sso_required' - 'mfa_required';

  select m.org_id, r.slug
    into v_org_id, v_slug
  from org_members m
  join roles r on r.id = m.role_id
  where m.user_id = v_user_id
  order by m.created_at asc
  limit 1;

  if v_org_id is not null then
    -- A suspended tenant is issued no org claim and no role (0115): the member is, to RLS, a user
    -- with no membership. Platform staff below are checked independently and are never suspended.
    if not public.tenant_is_active(v_org_id) then
      v_org_id := null;
      v_slug := null;
    end if;
  end if;

  if v_org_id is not null then
    -- The session's assurance level, as Supabase Auth reports it on the token being minted.
    v_aal := coalesce(nullif(v_claims ->> 'aal', ''), 'aal1');
    select s.require_mfa into v_mfa from org_security_settings s where s.org_id = v_org_id;
    select s.enforced into v_enforced from org_sso_settings s where s.org_id = v_org_id;

    if coalesce(v_mfa, false) and v_aal <> 'aal2' then
      -- The organisation requires a second factor and this session has not completed one.
      v_claims := jsonb_set(v_claims, '{mfa_required}', to_jsonb(true), true);
    elsif coalesce(v_enforced, false) and not public.session_is_sso(v_claims) then
      -- The organisation requires SSO and this session did not arrive through it.
      v_claims := jsonb_set(v_claims, '{sso_required}', to_jsonb(true), true);
    else
      v_claims := jsonb_set(v_claims, '{org_id}', to_jsonb(v_org_id::text), true);
      v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_slug::text), true);
    end if;
  else
    -- An external auditor: an active external_auditor_access row and no org_members row. A
    -- suspended tenant's external auditors are likewise issued nothing (0115).
    select a.org_id into v_ext_org
      from external_auditor_access a
     where a.user_id = v_user_id and a.active and a.revoked_at is null
     order by a.created_at asc
     limit 1;
    if v_ext_org is not null and public.tenant_is_active(v_ext_org) then
      v_claims := jsonb_set(v_claims, '{org_id}', to_jsonb(v_ext_org::text), true);
      v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb('external_auditor'::text), true);
    else
      select exists (select 1 from platform_admins p where p.user_id = v_user_id) into v_platform;
      if v_platform then
        -- Platform staff carry no org and no tenant role.
        v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb('platform_admin'::text), true);
      end if;
    end if;
  end if;

  return jsonb_set(event, '{claims}', v_claims, true);
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant execute on function public.session_is_sso(jsonb) to supabase_auth_admin;
    grant select on public.org_members, public.roles, public.platform_admins, public.org_sso_settings,
      public.org_security_settings, public.external_auditor_access,
      public.tenant_settings to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Every new definer RPC is revoked from public/anon and granted to authenticated.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_platform_owner()',
    'public.platform_owner_exists()',
    'public.platform_owner_claim(text)',
    'public.platform_whoami()',
    'public.org_requires_mfa()',
    'public.org_security_status()',
    'public.admin_set_require_mfa(boolean,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

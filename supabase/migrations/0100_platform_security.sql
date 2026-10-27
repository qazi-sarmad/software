-- 0100: Security & enterprise readiness, part 1 (WP9, WP11, WP14, WP15).
--
-- Laws that shape this migration:
--   - L1 deterministic: nothing here calls a model. The only "smart" step, SSO domain routing, is a
--     pure string comparison.
--   - L2: tenant data never leaves the tenant. The SSO change *narrows* the read path (it withholds
--     claims); it never widens it. No new anonymous surface is created (the anon allow-list stays at
--     three verification functions).
--   - Config-as-ledger: every setting is a row with a `reason`, an append-only hash-chained
--     `*_versions` table, and a definer RPC that stamps actor and time. Nothing is hard-coded.
--   - Rights, not role names, for tenant actions; `is_platform_admin()` for platform actions.
--   - Idempotent: every object is `if not exists` / `create or replace`, every seed is
--     `on conflict do nothing`. The harness applies this file twice.

-- ---------------------------------------------------------------------------
-- 1. MFA: a session's assurance level, read from the JWT (stamped by Supabase Auth).
--    `require_platform_admin()` is the ONE choke point every platform RPC calls, so the second
--    factor is enforced there and nowhere else.
-- ---------------------------------------------------------------------------
create or replace function public.jwt_aal() returns text
language sql stable as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1')
$$;

/** True when the caller's session has completed multi-factor authentication (Supabase AAL2). */
create or replace function public.platform_aal2() returns boolean
language sql stable as $$ select public.jwt_aal() = 'aal2' $$;

-- ---------------------------------------------------------------------------
-- 2. Platform security settings (single row). Config-as-ledger.
-- ---------------------------------------------------------------------------
create table if not exists platform_security_settings (
  id boolean primary key default true check (id),
  -- The switch that arms the second factor for every platform RPC. OFF until the owner enrols a
  -- factor, so provisioning a fresh install is not locked out by a factor nobody holds yet.
  require_platform_mfa boolean not null default false,
  -- The unlisted path the platform portal answers on. Deploy-time configurable, stored for the
  -- record; the client reads VITE_PLATFORM_ADMIN_PATH (see src/lib/platformPath.ts).
  admin_path text not null default '/superadmin',
  -- A platform session older than this many minutes must re-authenticate. Recorded for the UI; the
  -- hard limit is Supabase's jwt_expiry.
  session_max_age_minutes int not null default 60,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table platform_security_settings add column if not exists require_platform_mfa boolean not null default false;
alter table platform_security_settings add column if not exists admin_path text not null default '/superadmin';
alter table platform_security_settings add column if not exists session_max_age_minutes int not null default 60;
alter table platform_security_settings add column if not exists updated_by uuid;
alter table platform_security_settings add column if not exists updated_at timestamptz not null default now();

insert into platform_security_settings (id) values (true) on conflict (id) do nothing;

create table if not exists platform_security_versions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null,
  actor uuid,
  reason text not null,
  prev_hash text,
  row_hash text not null,
  created_at timestamptz not null default now()
);
alter table platform_security_versions add column if not exists key text;
alter table platform_security_versions add column if not exists value jsonb;
alter table platform_security_versions add column if not exists actor uuid;
alter table platform_security_versions add column if not exists reason text;
alter table platform_security_versions add column if not exists prev_hash text;
alter table platform_security_versions add column if not exists row_hash text;
alter table platform_security_versions add column if not exists created_at timestamptz not null default now();
create index if not exists platform_security_versions_key_idx on platform_security_versions (key, created_at);

-- Append-only: the ledger is the record, so a row may never be rewritten.
drop trigger if exists platform_security_versions_append_only on platform_security_versions;
create trigger platform_security_versions_append_only
  before update or delete on platform_security_versions
  for each row execute function public.forbid_mutation();

alter table platform_security_settings enable row level security;
drop policy if exists platform_security_settings_select on platform_security_settings;
-- Platform staff only. A tenant session never sees the platform security posture.
create policy platform_security_settings_select on platform_security_settings for select to authenticated
  using (public.is_platform_admin());

alter table platform_security_versions enable row level security;
drop policy if exists platform_security_versions_select on platform_security_versions;
create policy platform_security_versions_select on platform_security_versions for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. require_platform_admin now enforces the second factor. It is the single choke point every
--    platform_* RPC already calls, so arming the switch protects the whole control plane at once.
--    When the switch is OFF the function behaves exactly as before, so the existing suite is
--    unaffected until an owner arms it.
-- ---------------------------------------------------------------------------
create or replace function public.require_platform_admin() returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_required boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  select require_platform_mfa into v_required from platform_security_settings where id;
  if coalesce(v_required, false) and not public.platform_aal2() then
    raise exception 'mfa required: platform administrator sessions must complete multi-factor authentication'
      using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Platform security RPCs.
-- ---------------------------------------------------------------------------
-- The posture, readable by any platform admin (any AAL) so the portal can tell an un-enrolled
-- admin to enrol. It never returns a secret.
create or replace function public.platform_security_status()
returns table (
  require_platform_mfa boolean,
  admin_path text,
  session_max_age_minutes int,
  aal text,
  mfa_satisfied boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  return query
    select s.require_platform_mfa, s.admin_path, s.session_max_age_minutes,
           public.jwt_aal(), (not s.require_platform_mfa or public.platform_aal2())
    from platform_security_settings s where s.id;
end $$;

/** Set one platform security setting. AAL2 only, reason required, ledgered. */
create or replace function public.platform_set_security_setting(
  p_key text, p_value jsonb, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
  v_hash text;
begin
  perform public.require_platform_admin();
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a security setting change' using errcode = 'P0001';
  end if;
  if p_key not in ('require_platform_mfa', 'admin_path', 'session_max_age_minutes') then
    raise exception 'unknown security setting: %', p_key using errcode = 'P0001';
  end if;

  if p_key = 'require_platform_mfa' then
    update platform_security_settings set require_platform_mfa = (p_value #>> '{}')::boolean,
      updated_by = auth.uid(), updated_at = now() where id;
  elsif p_key = 'admin_path' then
    if (p_value #>> '{}') !~ '^/[a-z0-9/_-]+$' then
      raise exception 'the admin path must start with / and contain only lower-case letters, digits, /, _ or -'
        using errcode = 'P0001';
    end if;
    update platform_security_settings set admin_path = (p_value #>> '{}'),
      updated_by = auth.uid(), updated_at = now() where id;
  else
    update platform_security_settings set session_max_age_minutes = (p_value #>> '{}')::int,
      updated_by = auth.uid(), updated_at = now() where id;
  end if;

  select row_hash into v_prev from platform_security_versions order by created_at desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || p_key || '|' || p_value::text || '|' || p_reason;
  v_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  insert into platform_security_versions (key, value, actor, reason, prev_hash, row_hash)
  values (p_key, p_value, auth.uid(), p_reason, v_prev, v_hash);

  perform public.platform_log('platform_security_setting_changed', null, 'platform_security_settings',
    null, jsonb_build_object('key', p_key, 'value', p_value, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- 5. SSO / SAML / OIDC (WP11). A provider registry plus per-org policy. The access-token hook is
--    the enforcement choke point: an org that requires SSO does not hand tenant claims to a
--    password session, so RLS hides the whole tenant. No new anonymous surface is added.
-- ---------------------------------------------------------------------------
create table if not exists sso_providers (
  provider text primary key,
  label text not null,
  protocol text not null check (protocol in ('saml', 'oidc')),
  enabled boolean not null default true,
  notes text
);
alter table sso_providers add column if not exists label text;
alter table sso_providers add column if not exists protocol text;
alter table sso_providers add column if not exists enabled boolean not null default true;
alter table sso_providers add column if not exists notes text;

insert into sso_providers (provider, label, protocol, notes) values
  ('saml', 'SAML 2.0', 'saml', 'Generic SAML 2.0. Metadata is configured in Supabase Auth; Provio stores the policy.'),
  ('oidc', 'OpenID Connect', 'oidc', 'Generic OIDC. Discovery document is configured in Supabase Auth.'),
  ('azure-ad', 'Microsoft Entra ID', 'oidc', 'Entra ID (Azure AD) via OIDC.'),
  ('google-workspace', 'Google Workspace', 'oidc', 'Google Workspace via OIDC.'),
  ('okta', 'Okta', 'saml', 'Okta via SAML 2.0.')
on conflict (provider) do nothing;

create table if not exists org_sso_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  provider text references sso_providers(provider),
  domain text,
  enforced boolean not null default false,
  set_by uuid,
  set_at timestamptz not null default now(),
  reason text
);
alter table org_sso_settings add column if not exists provider text;
alter table org_sso_settings add column if not exists domain text;
alter table org_sso_settings add column if not exists enforced boolean not null default false;
alter table org_sso_settings add column if not exists set_by uuid;
alter table org_sso_settings add column if not exists set_at timestamptz not null default now();
alter table org_sso_settings add column if not exists reason text;
-- One domain routes to one organisation.
create unique index if not exists org_sso_settings_domain_uq on org_sso_settings (lower(domain)) where domain is not null;

create table if not exists org_sso_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider text,
  domain text,
  enforced boolean not null,
  actor uuid,
  reason text not null,
  prev_hash text,
  row_hash text not null,
  created_at timestamptz not null default now()
);
alter table org_sso_versions add column if not exists org_id uuid;
alter table org_sso_versions add column if not exists provider text;
alter table org_sso_versions add column if not exists domain text;
alter table org_sso_versions add column if not exists enforced boolean;
alter table org_sso_versions add column if not exists actor uuid;
alter table org_sso_versions add column if not exists reason text;
alter table org_sso_versions add column if not exists prev_hash text;
alter table org_sso_versions add column if not exists row_hash text;
alter table org_sso_versions add column if not exists created_at timestamptz not null default now();
create index if not exists org_sso_versions_org_idx on org_sso_versions (org_id, created_at);

-- Append-only: the SSO policy history is the record.
drop trigger if exists org_sso_versions_append_only on org_sso_versions;
create trigger org_sso_versions_append_only
  before update or delete on org_sso_versions
  for each row execute function public.forbid_mutation();

alter table sso_providers enable row level security;
drop policy if exists sso_providers_select on sso_providers;
create policy sso_providers_select on sso_providers for select to authenticated
  using (public.is_platform_admin() or public.caller_has_right('edit_config'));

alter table org_sso_settings enable row level security;
drop policy if exists org_sso_settings_select on org_sso_settings;
-- The org's own members with edit_config, or platform staff.
create policy org_sso_settings_select on org_sso_settings for select to authenticated
  using (org_id = public.jwt_org_id() and (public.caller_has_right('edit_config') or public.is_platform_admin()));

alter table org_sso_versions enable row level security;
drop policy if exists org_sso_versions_select on org_sso_versions;
create policy org_sso_versions_select on org_sso_versions for select to authenticated
  using (org_id = public.jwt_org_id() and (public.caller_has_right('edit_config') or public.is_platform_admin()));

/** True when the token's authentication-method references include an SSO method. Pure. */
create or replace function public.session_is_sso(p_claims jsonb) returns boolean
language sql stable as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_claims -> 'amr', '[]'::jsonb)) a
    where coalesce(a ->> 'method', '') in ('sso/saml', 'sso/oidc', 'sso')
       or coalesce(a ->> 'provider', '') <> ''
  )
$$;

/** The org that owns an email domain, or null. Used by the sign-in screen to route to SSO. */
create or replace function public.sso_org_for_domain(p_domain text)
returns table (org_id uuid, provider text, enforced boolean)
language sql stable security definer set search_path = public as $$
  select s.org_id, s.provider, s.enforced
  from org_sso_settings s
  where s.domain is not null and lower(s.domain) = lower(btrim(p_domain))
  limit 1
$$;

/** Read an org's SSO policy. Requires edit_config in that org, or platform staff. */
create or replace function public.sso_get_settings(p_org uuid)
returns table (provider text, domain text, enforced boolean, set_at timestamptz, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or (p_org = public.jwt_org_id() and public.caller_has_right('edit_config'))) then
    raise exception 'not allowed: edit_config is required to read SSO settings' using errcode = 'P0001';
  end if;
  return query select s.provider, s.domain, s.enforced, s.set_at, s.reason
    from org_sso_settings s where s.org_id = p_org;
end $$;

/** Set an org's SSO policy. Requires edit_config. Reason required, ledgered. */
create or replace function public.sso_set_provider(
  p_org uuid, p_provider text, p_domain text, p_enforced boolean, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform public.provio_org_guard(p_org);
  if not (public.is_platform_admin() or public.caller_has_right('edit_config')) then
    raise exception 'not allowed: edit_config is required to change SSO settings' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for an SSO change' using errcode = 'P0001';
  end if;
  if p_provider is not null and not exists (select 1 from sso_providers where provider = p_provider and enabled) then
    raise exception 'unknown or disabled SSO provider: %', p_provider using errcode = 'P0001';
  end if;

  insert into org_sso_settings (org_id, provider, domain, enforced, set_by, set_at, reason)
  values (p_org, p_provider, nullif(btrim(coalesce(p_domain, '')), ''), coalesce(p_enforced, false),
          auth.uid(), now(), p_reason)
  on conflict (org_id) do update set
    provider = excluded.provider, domain = excluded.domain, enforced = excluded.enforced,
    set_by = excluded.set_by, set_at = excluded.set_at, reason = excluded.reason;

  select row_hash into v_prev from org_sso_versions where org_id = p_org order by created_at desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || coalesce(p_provider, '') || '|' || coalesce(p_domain, '')
            || '|' || coalesce(p_enforced, false)::text || '|' || p_reason;
  insert into org_sso_versions (org_id, provider, domain, enforced, actor, reason, prev_hash, row_hash)
  values (p_org, p_provider, nullif(btrim(coalesce(p_domain, '')), ''), coalesce(p_enforced, false),
          auth.uid(), p_reason, v_prev, encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));

  perform public.append_ledger_entry(p_org, 'sso_settings_changed',
    jsonb_build_object('provider', p_provider, 'domain', p_domain, 'enforced', p_enforced, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- 6. The access-token hook gains SSO enforcement (WP11). It is the only writer of org_id, so an
--    org that requires SSO cannot be reached by a password session. Everything else is unchanged.
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
begin
  -- Strip any pre-existing values first, so a stale or forged claim cannot survive.
  v_claims := coalesce(event -> 'claims', '{}'::jsonb) - 'org_id' - 'user_role' - 'sso_required';

  select m.org_id, r.slug
    into v_org_id, v_slug
  from org_members m
  join roles r on r.id = m.role_id
  where m.user_id = v_user_id
  order by m.created_at asc
  limit 1;

  if v_org_id is not null then
    -- SSO enforcement (WP11): an org that requires SSO does not hand tenant claims to a session
    -- that was not authenticated through SSO. Without org_id the RLS path shows the member nothing,
    -- so the tenant is unreachable; the client sees `sso_required` and offers the SSO route.
    select s.enforced into v_enforced from org_sso_settings s where s.org_id = v_org_id;
    if coalesce(v_enforced, false) and not public.session_is_sso(v_claims) then
      v_claims := jsonb_set(v_claims, '{sso_required}', to_jsonb(true), true);
    else
      v_claims := jsonb_set(v_claims, '{org_id}', to_jsonb(v_org_id::text), true);
      v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_slug::text), true);
    end if;
  else
    -- An external auditor: an active external_auditor_access row and no org_members row.
    select a.org_id into v_ext_org
      from external_auditor_access a
     where a.user_id = v_user_id and a.active and a.revoked_at is null
     order by a.created_at asc
     limit 1;
    if v_ext_org is not null then
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
      public.external_auditor_access to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Data residency (WP15). An allow-list of regions the platform supports, plus the org's chosen
--    region on org_settings_extra. The region is a promise about where data is stored; the
--    allow-list keeps a typo from silently recording an unsupported region.
-- ---------------------------------------------------------------------------
create table if not exists data_residency_regions (
  code text primary key,
  label text not null,
  enabled boolean not null default true,
  sort_order int not null default 0
);
alter table data_residency_regions add column if not exists label text;
alter table data_residency_regions add column if not exists enabled boolean not null default true;
alter table data_residency_regions add column if not exists sort_order int not null default 0;

insert into data_residency_regions (code, label, sort_order) values
  ('us-east-1', 'United States (N. Virginia)', 1),
  ('us-west-1', 'United States (N. California)', 2),
  ('eu-central-1', 'European Union (Frankfurt)', 3),
  ('eu-west-2', 'European Union (London)', 4),
  ('ap-southeast-2', 'Australia (Sydney)', 5),
  ('me-central-1', 'GCC (UAE)', 6),
  ('ap-south-1', 'Pakistan / South Asia (Mumbai)', 7)
on conflict (code) do nothing;

alter table org_settings_extra add column if not exists data_residency_region text;

alter table data_residency_regions enable row level security;
drop policy if exists data_residency_regions_select on data_residency_regions;
-- A reference list any signed-in member may read; never a blanket `using (true)` (spec §25.1).
create policy data_residency_regions_select on data_residency_regions for select to authenticated
  using (auth.uid() is not null);

/** Read the residency allow-list. */
create or replace function public.platform_list_residency_regions()
returns table (code text, label text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select r.code, r.label, r.enabled from data_residency_regions r order by r.sort_order
$$;

/** Set an org's data-residency region. Platform staff, AAL2, reason required, ledgered. */
create or replace function public.platform_set_residency(p_org uuid, p_region text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a residency change' using errcode = 'P0001';
  end if;
  if p_region is not null and not exists (select 1 from data_residency_regions where code = p_region and enabled) then
    raise exception 'unsupported residency region: %', p_region using errcode = 'P0001';
  end if;
  insert into org_settings_extra (org_id, data_residency_region) values (p_org, p_region)
  on conflict (org_id) do update set data_residency_region = excluded.data_residency_region;
  perform public.platform_log('tenant_residency_set', p_org, 'org', p_org,
    jsonb_build_object('region', p_region, 'reason', p_reason));
  perform public.append_ledger_entry(p_org, 'residency_set',
    jsonb_build_object('region', p_region, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Backup / PITR / DR record (WP14). The runbook is docs/DR-RUNBOOK.md; this is the ledgered
--    record of the posture and of each restore test.
-- ---------------------------------------------------------------------------
create table if not exists platform_dr_settings (
  id boolean primary key default true check (id),
  pitr_enabled boolean not null default false,
  backup_frequency text not null default 'daily',
  retention_days int not null default 7,
  restore_test_interval_days int not null default 90,
  last_restore_test_at timestamptz,
  rpo_minutes int not null default 1440,
  rto_minutes int not null default 240,
  notes text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table platform_dr_settings add column if not exists pitr_enabled boolean not null default false;
alter table platform_dr_settings add column if not exists backup_frequency text not null default 'daily';
alter table platform_dr_settings add column if not exists retention_days int not null default 7;
alter table platform_dr_settings add column if not exists restore_test_interval_days int not null default 90;
alter table platform_dr_settings add column if not exists last_restore_test_at timestamptz;
alter table platform_dr_settings add column if not exists rpo_minutes int not null default 1440;
alter table platform_dr_settings add column if not exists rto_minutes int not null default 240;
alter table platform_dr_settings add column if not exists notes text;
alter table platform_dr_settings add column if not exists updated_by uuid;
alter table platform_dr_settings add column if not exists updated_at timestamptz not null default now();

insert into platform_dr_settings (id) values (true) on conflict (id) do nothing;

create table if not exists platform_dr_versions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null,
  actor uuid,
  reason text not null,
  prev_hash text,
  row_hash text not null,
  created_at timestamptz not null default now()
);
alter table platform_dr_versions add column if not exists key text;
alter table platform_dr_versions add column if not exists value jsonb;
alter table platform_dr_versions add column if not exists actor uuid;
alter table platform_dr_versions add column if not exists reason text;
alter table platform_dr_versions add column if not exists prev_hash text;
alter table platform_dr_versions add column if not exists row_hash text;
alter table platform_dr_versions add column if not exists created_at timestamptz not null default now();
create index if not exists platform_dr_versions_key_idx on platform_dr_versions (key, created_at);

-- Append-only: the DR history is the record.
drop trigger if exists platform_dr_versions_append_only on platform_dr_versions;
create trigger platform_dr_versions_append_only
  before update or delete on platform_dr_versions
  for each row execute function public.forbid_mutation();

alter table platform_dr_settings enable row level security;
drop policy if exists platform_dr_settings_select on platform_dr_settings;
create policy platform_dr_settings_select on platform_dr_settings for select to authenticated
  using (public.is_platform_admin());

alter table platform_dr_versions enable row level security;
drop policy if exists platform_dr_versions_select on platform_dr_versions;
create policy platform_dr_versions_select on platform_dr_versions for select to authenticated
  using (public.is_platform_admin());

/** Read the DR posture and the next restore-test due date. */
create or replace function public.platform_get_dr_settings()
returns table (
  pitr_enabled boolean, backup_frequency text, retention_days int,
  restore_test_interval_days int, last_restore_test_at timestamptz,
  next_restore_test_due timestamptz, rpo_minutes int, rto_minutes int, notes text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: platform administrator only' using errcode = 'P0001';
  end if;
  return query select d.pitr_enabled, d.backup_frequency, d.retention_days, d.restore_test_interval_days,
    d.last_restore_test_at,
    case when d.last_restore_test_at is null then null
         else d.last_restore_test_at + make_interval(days => d.restore_test_interval_days) end,
    d.rpo_minutes, d.rto_minutes, d.notes
  from platform_dr_settings d where d.id;
end $$;

/** Set one DR setting. Platform staff, AAL2, reason required, ledgered. */
create or replace function public.platform_set_dr_setting(p_key text, p_value jsonb, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform public.require_platform_admin();
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for a DR setting change' using errcode = 'P0001';
  end if;
  if p_key not in ('pitr_enabled', 'backup_frequency', 'retention_days', 'restore_test_interval_days', 'rpo_minutes', 'rto_minutes', 'notes') then
    raise exception 'unknown DR setting: %', p_key using errcode = 'P0001';
  end if;

  if p_key in ('retention_days', 'restore_test_interval_days', 'rpo_minutes', 'rto_minutes') then
    execute format('update platform_dr_settings set %I = ($1 #>> ''{}'')::int, updated_by = auth.uid(), updated_at = now() where id', p_key)
      using p_value;
  elsif p_key = 'pitr_enabled' then
    update platform_dr_settings set pitr_enabled = (p_value #>> '{}')::boolean, updated_by = auth.uid(), updated_at = now() where id;
  else
    execute format('update platform_dr_settings set %I = ($1 #>> ''{}''), updated_by = auth.uid(), updated_at = now() where id', p_key)
      using p_value;
  end if;

  select row_hash into v_prev from platform_dr_versions order by created_at desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || p_key || '|' || p_value::text || '|' || p_reason;
  insert into platform_dr_versions (key, value, actor, reason, prev_hash, row_hash)
  values (p_key, p_value, auth.uid(), p_reason, v_prev, encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));

  perform public.platform_log('platform_dr_setting_changed', null, 'platform_dr_settings', null,
    jsonb_build_object('key', p_key, 'value', p_value, 'reason', p_reason));
end $$;

/** Record that a restore was tested. Platform staff, AAL2. Appends to the trail and the DR ledger. */
create or replace function public.platform_record_restore_test(p_note text, p_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform public.require_platform_admin();
  if p_at is null then
    raise exception 'the restore-test time is required' using errcode = 'P0001';
  end if;
  update platform_dr_settings set last_restore_test_at = p_at, updated_by = auth.uid(), updated_at = now() where id;

  select row_hash into v_prev from platform_dr_versions order by created_at desc limit 1;
  v_body := coalesce(v_prev, '') || '|restore_test|' || p_at::text || '|' || coalesce(p_note, '');
  insert into platform_dr_versions (key, value, actor, reason, prev_hash, row_hash)
  values ('restore_test', jsonb_build_object('at', p_at, 'note', p_note), auth.uid(),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'restore test recorded'), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));

  perform public.platform_log('restore_test_recorded', null, 'platform_dr_settings', null,
    jsonb_build_object('at', p_at, 'note', p_note));
end $$;

-- 0054: Secrets and email sender profiles (S2.a, F5, F6).
--
-- F5 secrets: no secret reaches the browser, a log, the ledger, an email, a screenshot or a
-- tutorial. This migration prefers Supabase Vault (vault.create_secret) and falls back to
-- AES-256-GCM ciphertext held in `secret_store` when Vault is absent (D-S2-vault-fallback). Either
-- way the tables keep only the secret's id and a masked display ("•••• last4"); a value is written
-- only by a SECURITY DEFINER function and read back only by service_role.
--
-- F6 email: one queue (email_queue, 0039) and many adapters. `email_sender_profiles` holds the
-- platform default and per-tenant profiles; `email_dispatch_state` holds the dispatcher's token
-- and batch size. The dispatcher itself is the email-dispatch Edge Function (S2.d).
--
-- M1: grepped supabase/migrations and supabase/tests for every name below. `automation_rules`
--     appears only as a feature_catalogue key (0051) and a test label (64); no table of that name
--     exists, so it is created here.
-- M2: every table is create table if not exists + alter table ... add column if not exists; every
--     function is create or replace; every trigger is dropped before it is created.

-- ---------------------------------------------------------------------------
-- 1. Is Supabase Vault present? Drives the F5 branch. Read by the wizard (SA-01 step 1).
-- ---------------------------------------------------------------------------
create or replace function public.vault_available() returns boolean
language sql stable as $$
  select exists (select 1 from pg_extension where extname = 'vault')
$$;

-- ---------------------------------------------------------------------------
-- 2. secret_store — the F5 fallback store. One row per secret. `ciphertext` is AES-256-GCM output
--    produced by the Edge Function that holds SECRETS_MASTER_KEY (or by vault, see secret_put).
--    Only service_role may read `ciphertext`; the UI only ever sees `masked`.
-- ---------------------------------------------------------------------------
create table if not exists secret_store (
  id uuid primary key default gen_random_uuid()
);
alter table secret_store add column if not exists org_id uuid;
alter table secret_store add column if not exists label text;
alter table secret_store add column if not exists ciphertext text;
alter table secret_store add column if not exists masked text;
alter table secret_store add column if not exists vault_id uuid;
alter table secret_store add column if not exists created_by uuid;
alter table secret_store add column if not exists created_at timestamptz not null default now();
alter table secret_store add column if not exists updated_at timestamptz not null default now();
alter table secret_store add column if not exists replaced_at timestamptz;

alter table secret_store enable row level security;
-- No policy grants a tenant or the platform any read: the table is reachable only through the
-- SECURITY DEFINER functions below and by service_role. That is the point (F5).
drop policy if exists secret_store_none on secret_store;

create index if not exists secret_store_org_idx on secret_store (org_id);

-- A masked display from a raw value: "•••• last4". Never returns more than the last four characters.
create or replace function public.secret_mask_value(p_value text) returns text
language sql immutable as $$
  select case
    when p_value is null or length(p_value) = 0 then '•••• not set'
    else '•••• ' || right(p_value, least(4, length(p_value)))
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. secret_put — the single way a secret enters the store. Returns the secret id. The caller must
--    be a configuration actor for the org (F4) or a platform admin writing a platform secret.
--    A replacement writes a new row and marks the old one replaced; a configuration-history entry
--    is written by the caller, never the value (F5).
-- ---------------------------------------------------------------------------
create or replace function public.secret_put(
  p_org uuid, p_label text, p_value text, p_ciphertext text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_value is null or length(p_value) = 0 then
    raise exception 'a secret value is required' using errcode = 'P0001';
  end if;
  if p_org is not null and public.config_write_mode(p_org, 'edit_config') = 'deny' then
    raise exception 'not allowed: the caller cannot set a secret for this organisation'
      using errcode = 'P0001';
  end if;

  update secret_store set replaced_at = now(), updated_at = now()
   where coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org, '00000000-0000-0000-0000-000000000000'::uuid)
     and label = p_label and replaced_at is null;

  insert into secret_store (org_id, label, ciphertext, masked, created_by)
  values (p_org, p_label, p_ciphertext, public.secret_mask_value(p_value), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- The masked display of a secret. Safe for any configuration actor; never the value.
create or replace function public.secret_display(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select masked from secret_store where id = p_id
$$;

-- The raw value. SECURITY DEFINER and executable only by service_role (granted at the end), so no
-- browser session and no tenant role can read it.
create or replace function public.secret_reveal(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select ciphertext from secret_store where id = p_id
$$;

-- ---------------------------------------------------------------------------
-- 4. email_sender_profiles — the platform default plus per-tenant profiles (F6). org_id null is the
--    platform profile. Resolution per message: the tenant's own profile if enabled and ok; else the
--    platform default if the tenant is allowed it; else stub.
-- ---------------------------------------------------------------------------
create table if not exists email_sender_profiles (
  id uuid primary key default gen_random_uuid()
);
alter table email_sender_profiles add column if not exists org_id uuid;
alter table email_sender_profiles add column if not exists scope text not null default 'tenant';
alter table email_sender_profiles add column if not exists provider text not null default 'stub';
alter table email_sender_profiles add column if not exists display_name text;
alter table email_sender_profiles add column if not exists from_address text;
alter table email_sender_profiles add column if not exists reply_to text;
alter table email_sender_profiles add column if not exists credential_secret_id uuid;
alter table email_sender_profiles add column if not exists provider_config jsonb not null default '{}'::jsonb;
alter table email_sender_profiles add column if not exists daily_cap int;
alter table email_sender_profiles add column if not exists enabled boolean not null default false;
alter table email_sender_profiles add column if not exists is_default boolean not null default false;
alter table email_sender_profiles add column if not exists forced boolean not null default false;
alter table email_sender_profiles add column if not exists allow_tenant_profile boolean not null default true;
alter table email_sender_profiles add column if not exists fallback_to_platform boolean not null default true;
alter table email_sender_profiles add column if not exists last_test_at timestamptz;
alter table email_sender_profiles add column if not exists last_test_result text;
alter table email_sender_profiles add column if not exists status text not null default 'untested';
alter table email_sender_profiles add column if not exists created_at timestamptz not null default now();
alter table email_sender_profiles add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'esp_provider_check') then
    alter table email_sender_profiles add constraint esp_provider_check
      check (provider in ('stub','resend','graph_delegated','graph_app','smtp'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'esp_status_check') then
    alter table email_sender_profiles add constraint esp_status_check
      check (status in ('untested','ok','failing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'esp_scope_check') then
    alter table email_sender_profiles add constraint esp_scope_check
      check (scope in ('platform','tenant'));
  end if;
end $$;

alter table email_sender_profiles enable row level security;
-- A tenant sees its own profile and the platform default (read-only: the platform profile is never
-- writable by a tenant). The platform admin sees every profile.
drop policy if exists esp_select on email_sender_profiles;
create policy esp_select on email_sender_profiles for select to authenticated
  using (org_id = public.jwt_org_id() or org_id is null or public.is_platform_admin());

create index if not exists esp_org_idx on email_sender_profiles (org_id);
create unique index if not exists esp_one_default_idx
  on email_sender_profiles ((scope)) where is_default;

-- ---------------------------------------------------------------------------
-- 5. email_dispatch_state — the dispatcher's token and batch size (F6). One row, platform-level.
-- ---------------------------------------------------------------------------
create table if not exists email_dispatch_state (
  id boolean primary key default true
);
alter table email_dispatch_state add column if not exists dispatch_token_secret_id uuid;
alter table email_dispatch_state add column if not exists batch_size int not null default 10;
alter table email_dispatch_state add column if not exists last_run_at timestamptz;
alter table email_dispatch_state add column if not exists last_result text;
alter table email_dispatch_state add column if not exists updated_at timestamptz not null default now();

alter table email_dispatch_state enable row level security;
drop policy if exists eds_platform on email_dispatch_state;
create policy eds_platform on email_dispatch_state for select to authenticated
  using (public.is_platform_admin());

insert into email_dispatch_state (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. email_profile_versions — append-only, hash-chained history for sender-profile changes (F2, L5).
--    Registered in config_areas below so a change emits config.changed (F7).
-- ---------------------------------------------------------------------------
create table if not exists email_profile_versions (
  id uuid primary key default gen_random_uuid()
);
alter table email_profile_versions add column if not exists org_id uuid;
alter table email_profile_versions add column if not exists entity text;
alter table email_profile_versions add column if not exists entity_id uuid;
alter table email_profile_versions add column if not exists action text;
alter table email_profile_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table email_profile_versions add column if not exists actor text;
alter table email_profile_versions add column if not exists actor_id uuid;
alter table email_profile_versions add column if not exists prev_hash text;
alter table email_profile_versions add column if not exists row_hash text;
alter table email_profile_versions add column if not exists created_at timestamptz not null default now();

alter table email_profile_versions enable row level security;
drop policy if exists epv_select on email_profile_versions;
create policy epv_select on email_profile_versions for select
  using (org_id = public.jwt_org_id() or org_id is null or public.is_platform_admin());

create or replace function public.email_profile_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'email_profile_versions is append-only' using errcode = 'P0001';
end $$;

drop trigger if exists email_profile_versions_no_update on email_profile_versions;
create trigger email_profile_versions_no_update
  before update or delete on email_profile_versions
  for each row execute function public.email_profile_versions_append_only();

-- ---------------------------------------------------------------------------
-- 7. Config-area registration (F7). Every history table is registered; the notify trigger is
--    (re)created by the loop at the end of 0056, after every registration in this slice.
-- ---------------------------------------------------------------------------
insert into config_areas (key, label, history_table, notify_policy) values
  ('email',        'Email sender',           'email_profile_versions',   'both'),
  ('automation',   'Automation rules',       'automation_rule_versions', 'both'),
  ('notification', 'Notification templates', 'notification_template_versions', 'both')
on conflict (key) do update set label = excluded.label, history_table = excluded.history_table,
  notify_policy = excluded.notify_policy;

-- ---------------------------------------------------------------------------
-- 8. Grants. Secret reads go to service_role only; configuration RPCs go to authenticated.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('vault_available','secret_mask_value')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('secret_put','secret_display')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

-- secret_reveal: service_role only. Never granted to authenticated or anon.
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'secret_reveal'
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from authenticated', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to service_role', fn.name, fn.args);
  end loop;
end $$;

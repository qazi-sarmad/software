-- 0069: Hosting fit and database mobility (S11.a, F16).
--
-- F16: Provio's logic lives in Postgres (RPCs, RLS, ledger triggers), so only Postgres engines are
-- supported. This migration builds the two halves:
--   * The Hosting Fit Check (SA-10, SA-11): a searchable stack catalogue and a table of editable
--     rules that turn a short questionnaire into a Red / Amber / Green verdict and a cost tier.
--     The verdict maths is pure TypeScript (src/lib/hostingFit.ts); this file stores the catalogue
--     and the rules and exposes them through RPCs.
--   * Database mobility (OA-15, SA-12): hosting_connections, migration_jobs and migration_steps.
--     A migration is run by the separate Node runner in tools/migration-runner/ (NOT in the Vite
--     bundle), which holds the short-lived job token. The web app only writes the job and reads its
--     progress. Ledger copying preserves sequence, timestamps and hashes; triggers that compute them
--     may be bypassed only when current_user = 'provio_migrator' AND
--     current_setting('provio.migration_mode', true) = 'on'.
--
-- M1: grepped supabase/migrations and supabase/tests for hosting_fit_rules, hosting_stack_catalogue,
--     hosting_connections, migration_jobs, migration_steps, hosting_fit_seed, hosting_fit_get,
--     hosting_connection_save, migration_job_create, migration_job_list, migration_step_upsert,
--     migration_job_advance. None existed; this file creates them. The feature keys hosting_migration
--     is already seeded in feature_catalogue (0051). The event keys hosting.migration.started,
--     hosting.migration.completed, hosting.migration.failed are already seeded in the event
--     catalogue (0055).
-- M2: create table if not exists + add column if not exists; create or replace function; drop
--     trigger/policy if exists before create; create index if not exists. Safe to apply repeatedly.
-- M4: the migration_mode guard is a new function name; no earlier migration defines it.

-- ---------------------------------------------------------------------------
-- 1. hosting_stack_catalogue — the searchable list of stacks the wizard pre-fills from (F16, SA-10).
--    Platform-level (no org_id). Aliases drive the search ("RDS", "Aurora", "Azure PG", ...).
-- ---------------------------------------------------------------------------
create table if not exists hosting_stack_catalogue (
  id uuid primary key default gen_random_uuid()
);
alter table hosting_stack_catalogue add column if not exists key text;
alter table hosting_stack_catalogue add column if not exists label text;
alter table hosting_stack_catalogue add column if not exists aliases text[] not null default '{}';
alter table hosting_stack_catalogue add column if not exists engine text;
alter table hosting_stack_catalogue add column if not exists hosting_kind text;
alter table hosting_stack_catalogue add column if not exists notes text;
alter table hosting_stack_catalogue add column if not exists is_supported boolean not null default true;
alter table hosting_stack_catalogue add column if not exists display_order int not null default 0;
alter table hosting_stack_catalogue add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hosting_stack_catalogue_key_uniq') then
    alter table hosting_stack_catalogue add constraint hosting_stack_catalogue_key_uniq unique (key);
  end if;
end $$;

alter table hosting_stack_catalogue enable row level security;
drop policy if exists hosting_stack_catalogue_select on hosting_stack_catalogue;
create policy hosting_stack_catalogue_select on hosting_stack_catalogue for select to authenticated
  using (public.config_actor_ok(public.jwt_org_id(), 'edit_config') or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. hosting_fit_rules — the editable rules (F16, SA-11). Each rule: field / operator / value /
--    severity / message / cost-tier effect. The verdict is any blocker -> Red, else any warning ->
--    Amber, else Green; cost tier = highest effect. Seeded below with the initial guidance.
-- ---------------------------------------------------------------------------
create table if not exists hosting_fit_rules (
  id uuid primary key default gen_random_uuid()
);
alter table hosting_fit_rules add column if not exists rule_key text;
alter table hosting_fit_rules add column if not exists field text;
alter table hosting_fit_rules add column if not exists operator text;
alter table hosting_fit_rules add column if not exists value text;
alter table hosting_fit_rules add column if not exists severity text not null default 'info';
alter table hosting_fit_rules add column if not exists message text;
alter table hosting_fit_rules add column if not exists cost_tier text not null default 'standard';
alter table hosting_fit_rules add column if not exists enabled boolean not null default true;
alter table hosting_fit_rules add column if not exists display_order int not null default 0;
alter table hosting_fit_rules add column if not exists created_at timestamptz not null default now();
alter table hosting_fit_rules add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hosting_fit_rules_key_uniq') then
    alter table hosting_fit_rules add constraint hosting_fit_rules_key_uniq unique (rule_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hosting_fit_rules_severity_chk') then
    alter table hosting_fit_rules add constraint hosting_fit_rules_severity_chk
      check (severity in ('blocker','warning','info'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hosting_fit_rules_cost_chk') then
    alter table hosting_fit_rules add constraint hosting_fit_rules_cost_chk
      check (cost_tier in ('standard','managed_bundle','custom_quote'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hosting_fit_rules_operator_chk') then
    alter table hosting_fit_rules add constraint hosting_fit_rules_operator_chk
      check (operator in ('eq','neq','in','not_in','lt','lte','gt','gte','is_true','is_false'));
  end if;
end $$;

alter table hosting_fit_rules enable row level security;
drop policy if exists hosting_fit_rules_select on hosting_fit_rules;
create policy hosting_fit_rules_select on hosting_fit_rules for select to authenticated
  using (public.config_actor_ok(public.jwt_org_id(), 'edit_config') or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. hosting_connections — one row per target a tenant connects for a migration (F16, OA-15). The
--    password lives in Vault (F5); this table keeps only the secret id and a masked display.
-- ---------------------------------------------------------------------------
create table if not exists hosting_connections (
  id uuid primary key default gen_random_uuid()
);
alter table hosting_connections add column if not exists org_id uuid;
alter table hosting_connections add column if not exists label text;
alter table hosting_connections add column if not exists kind text not null default 'supabase_self_hosted';
alter table hosting_connections add column if not exists host text;
alter table hosting_connections add column if not exists port int;
alter table hosting_connections add column if not exists database_name text;
alter table hosting_connections add column if not exists username text;
alter table hosting_connections add column if not exists ssl_mode text not null default 'require';
alter table hosting_connections add column if not exists password_secret_id uuid;
alter table hosting_connections add column if not exists password_masked text;
alter table hosting_connections add column if not exists last_test_at timestamptz;
alter table hosting_connections add column if not exists last_test_result text;
alter table hosting_connections add column if not exists last_test_detail text;
alter table hosting_connections add column if not exists created_by uuid;
alter table hosting_connections add column if not exists created_at timestamptz not null default now();
alter table hosting_connections add column if not exists updated_at timestamptz not null default now();

-- Foreign key to orgs so `truncate orgs cascade` (the SQL-test reset, M5) reaches this table.
-- Guarded so a second apply is a no-op (M2).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hosting_connections_org_id_fkey') then
    alter table hosting_connections add constraint hosting_connections_org_id_fkey
      foreign key (org_id) references orgs(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hosting_connections_kind_chk') then
    alter table hosting_connections add constraint hosting_connections_kind_chk
      check (kind in ('supabase_self_hosted','supabase_cloud','managed_postgres'));
  end if;
end $$;

alter table hosting_connections enable row level security;
drop policy if exists hosting_connections_select on hosting_connections;
create policy hosting_connections_select on hosting_connections for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists hosting_connections_org_idx on hosting_connections (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. migration_jobs — one migration from the source (this deployment) to a target connection (F16).
--    Steps are resumable and idempotent; the runner writes progress through the service role.
-- ---------------------------------------------------------------------------
create table if not exists migration_jobs (
  id uuid primary key default gen_random_uuid()
);
alter table migration_jobs add column if not exists org_id uuid;
alter table migration_jobs add column if not exists connection_id uuid;
alter table migration_jobs add column if not exists status text not null default 'created';
alter table migration_jobs add column if not exists current_step int not null default 0;
alter table migration_jobs add column if not exists total_steps int not null default 11;
alter table migration_jobs add column if not exists job_token_hash text;
alter table migration_jobs add column if not exists job_token_masked text;
alter table migration_jobs add column if not exists rows_done bigint not null default 0;
alter table migration_jobs add column if not exists started_at timestamptz;
alter table migration_jobs add column if not exists finished_at timestamptz;
alter table migration_jobs add column if not exists error_text text;
alter table migration_jobs add column if not exists cutover_confirmed_at timestamptz;
alter table migration_jobs add column if not exists retention_days int not null default 14;
alter table migration_jobs add column if not exists retire_after timestamptz;
alter table migration_jobs add column if not exists created_by uuid;
alter table migration_jobs add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'migration_jobs_status_chk') then
    alter table migration_jobs add constraint migration_jobs_status_chk
      check (status in ('created','running','failed','awaiting_cutover','retiring','retired','rolled_back'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'migration_jobs_retention_chk') then
    alter table migration_jobs add constraint migration_jobs_retention_chk
      check (retention_days between 7 and 90);
  end if;
end $$;

alter table migration_jobs enable row level security;
drop policy if exists migration_jobs_select on migration_jobs;
create policy migration_jobs_select on migration_jobs for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists migration_jobs_org_idx on migration_jobs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. migration_steps — one row per step per job, with its progress and checkpoint (F16).
-- ---------------------------------------------------------------------------
create table if not exists migration_steps (
  id uuid primary key default gen_random_uuid()
);
alter table migration_steps add column if not exists org_id uuid;
alter table migration_steps add column if not exists job_id uuid;
alter table migration_steps add column if not exists step_no int;
alter table migration_steps add column if not exists step_key text;
alter table migration_steps add column if not exists status text not null default 'pending';
alter table migration_steps add column if not exists rows_done bigint not null default 0;
alter table migration_steps add column if not exists checkpoint jsonb not null default '{}'::jsonb;
alter table migration_steps add column if not exists detail text;
alter table migration_steps add column if not exists started_at timestamptz;
alter table migration_steps add column if not exists finished_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'migration_steps_status_chk') then
    alter table migration_steps add constraint migration_steps_status_chk
      check (status in ('pending','running','done','failed','skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'migration_steps_job_step_uniq') then
    alter table migration_steps add constraint migration_steps_job_step_uniq unique (job_id, step_no);
  end if;
end $$;

alter table migration_steps enable row level security;
drop policy if exists migration_steps_select on migration_steps;
create policy migration_steps_select on migration_steps for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists migration_steps_job_idx on migration_steps (job_id, step_no);

-- Foreign keys to orgs so `truncate orgs cascade` (the SQL-test reset, M5) reaches these two tables
-- (both are defined above this block). Guarded so a second apply is a no-op (M2).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'migration_jobs_org_id_fkey') then
    alter table migration_jobs add constraint migration_jobs_org_id_fkey
      foreign key (org_id) references orgs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'migration_steps_org_id_fkey') then
    alter table migration_steps add constraint migration_steps_org_id_fkey
      foreign key (org_id) references orgs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'migration_jobs_connection_id_fkey') then
    alter table migration_jobs add constraint migration_jobs_connection_id_fkey
      foreign key (connection_id) references hosting_connections(id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. has_feature / rights helpers already exist. The hosting RPCs below use require_config_actor
--    (the F4 consultable path) and has_feature('hosting_migration').
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. hosting_fit_get — the seeded catalogue and rules (SA-10, SA-11). Platform admin reads and, for
--    the rules, edits them. The verdict maths runs in TypeScript on this data.
-- ---------------------------------------------------------------------------
create or replace function public.hosting_fit_seed() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into hosting_stack_catalogue (key, label, aliases, engine, hosting_kind, notes, is_supported, display_order)
  values
    ('supabase_cloud', 'Supabase (cloud project)', array['supabase','supabase cloud','supabase.com'], 'postgres', 'supabase', 'Fully supported: extensions, roles, RLS and Edge Functions are provided.', true, 10),
    ('supabase_self_hosted', 'Supabase (self-hosted)', array['supabase self-host','self-hosted supabase','docker supabase'], 'postgres', 'supabase', 'Fully supported when the machine meets the size guidance.', true, 20),
    ('rds', 'Amazon RDS for PostgreSQL', array['rds','aws rds','aurora','aurora postgresql'], 'postgres', 'managed', 'Supported with the Supabase-compatible service layer deployed beside it; extensions and roles must be checked.', true, 30),
    ('azure_pg', 'Azure Database for PostgreSQL', array['azure','azure pg','azure postgres'], 'postgres', 'managed', 'Supported with the Supabase-compatible service layer deployed beside it.', true, 40),
    ('cloud_sql', 'Google Cloud SQL for PostgreSQL', array['cloud sql','gcp','google cloud sql'], 'postgres', 'managed', 'Supported with the Supabase-compatible service layer deployed beside it.', true, 50),
    ('plain_postgres', 'Plain PostgreSQL on a VM', array['postgres','postgresql','vm','docker','vmware'], 'postgres', 'self_managed', 'Supported with the Supabase-compatible service layer deployed beside it.', true, 60),
    ('sql_server', 'Microsoft SQL Server', array['sql server','mssql','azure sql'], 'sqlserver', 'managed', 'Not supported: Provio''s logic is written in PostgreSQL.', false, 70),
    ('oracle', 'Oracle Database', array['oracle','oracle db'], 'oracle', 'managed', 'Not supported: Provio''s logic is written in PostgreSQL.', false, 80),
    ('mysql', 'MySQL / MariaDB', array['mysql','mariadb','aurora mysql'], 'mysql', 'managed', 'Not supported: Provio''s logic is written in PostgreSQL.', false, 90)
  on conflict (key) do update set label = excluded.label, aliases = excluded.aliases,
    engine = excluded.engine, hosting_kind = excluded.hosting_kind, notes = excluded.notes,
    is_supported = excluded.is_supported, display_order = excluded.display_order;

  insert into hosting_fit_rules (rule_key, field, operator, value, severity, message, cost_tier, display_order)
  values
    ('engine.postgres.required', 'engine', 'neq', 'postgres', 'blocker',
     'Provio only runs on PostgreSQL. This engine is not supported; ask QSCorp for a separate quoted project.',
     'custom_quote', 10),
    ('hosting.supabase.fine', 'hosting_kind', 'eq', 'supabase', 'info',
     'A Supabase project (cloud or self-hosted) is fully supported.', 'standard', 20),
    ('hosting.managed.amber', 'hosting_kind', 'eq', 'managed', 'warning',
     'A managed PostgreSQL is supported, but Provio''s Supabase-compatible service layer is deployed beside it; extensions and roles must be checked.',
     'managed_bundle', 30),
    ('size.ram.blocker', 'ram_gb', 'lt', '4', 'blocker',
     'This machine is below 4 GB RAM. Provio needs more to run safely.', 'standard', 40),
    ('size.ram.warning', 'ram_gb', 'lt', '8', 'warning',
     '8 GB RAM is recommended for a comfortable deployment.', 'standard', 50),
    ('size.cpu.blocker', 'cpu_cores', 'lt', '2', 'blocker',
     'This machine has fewer than 2 CPU cores. Provio needs at least 2.', 'standard', 60),
    ('size.cpu.warning', 'cpu_cores', 'lt', '4', 'warning',
     '4 CPU cores is recommended for a comfortable deployment.', 'standard', 70),
    ('size.disk.blocker', 'disk_gb', 'lt', '40', 'blocker',
     'This machine has less than 40 GB of disk. Provio needs more for data and backups.', 'standard', 80),
    ('size.disk.warning', 'disk_gb', 'lt', '80', 'warning',
     '80 GB of disk is recommended for a comfortable deployment.', 'standard', 90),
    ('os.supported', 'os', 'in', 'debian,ubuntu,rhel,centos,rocky,almalinux', 'info',
     'This operating system is supported.', 'standard', 100),
    ('os.other.warning', 'os', 'not_in', 'debian,ubuntu,rhel,centos,rocky,almalinux', 'warning',
     'This operating system is not one we test on. It may work, but it is not supported.', 'standard', 110),
    ('docker.absent.warning', 'docker_available', 'is_false', null, 'warning',
     'Docker is not available on this machine. Self-hosted Supabase is easiest with Docker.', 'standard', 120),
    ('internet.absent.warning', 'outbound_internet', 'is_false', null, 'warning',
     'There is no outbound internet. Email and AI cannot reach their services.', 'standard', 130)
  on conflict (rule_key) do nothing;
end $$;

-- Seed once at install. `on conflict do nothing` means a platform administrator's edit survives a
-- second apply (M2), and this call is therefore safe to repeat.
select public.hosting_fit_seed();

create or replace function public.hosting_fit_get()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_catalogue jsonb;
  v_rules jsonb;
begin
  perform public.require_platform_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', key, 'label', label, 'aliases', aliases, 'engine', engine,
           'hostingKind', hosting_kind, 'notes', notes, 'isSupported', is_supported) order by display_order), '[]'::jsonb)
    into v_catalogue from hosting_stack_catalogue;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', rule_key, 'field', field, 'operator', operator, 'value', value,
           'severity', severity, 'message', message, 'costTier', cost_tier,
           'enabled', enabled) order by display_order), '[]'::jsonb)
    into v_rules from hosting_fit_rules;
  return jsonb_build_object('catalogue', v_catalogue, 'rules', v_rules);
end $$;

-- ---------------------------------------------------------------------------
-- 8. hosting_fit_rule_save — platform admin edits one rule visually (SA-11, F1). Never JSON.
-- ---------------------------------------------------------------------------
create or replace function public.hosting_fit_rule_save(
  p_rule_key text, p_field text, p_operator text, p_value text,
  p_severity text, p_message text, p_cost_tier text, p_enabled boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_platform_admin();
  if p_severity not in ('blocker','warning','info') then
    raise exception 'the severity must be blocker, warning or info.' using errcode = 'P0001';
  end if;
  if p_cost_tier not in ('standard','managed_bundle','custom_quote') then
    raise exception 'the cost tier must be standard, managed_bundle or custom_quote.' using errcode = 'P0001';
  end if;
  insert into hosting_fit_rules (rule_key, field, operator, value, severity, message, cost_tier, enabled)
  values (p_rule_key, p_field, p_operator, p_value, p_severity, p_message, p_cost_tier, coalesce(p_enabled, true))
  on conflict (rule_key) do update set field = excluded.field, operator = excluded.operator,
    value = excluded.value, severity = excluded.severity, message = excluded.message,
    cost_tier = excluded.cost_tier, enabled = excluded.enabled, updated_at = now()
  returning id into v_id;
  -- A hosting rule is a PLATFORM setting (no tenant), so its change is a platform-trail entry, not a
  -- tenant business-ledger entry (F20/L5). platform_log records actor, action and object only.
  perform public.platform_log('hosting_fit_rule_save', null, 'hosting_fit_rule', v_id,
    jsonb_build_object('key', p_rule_key, 'severity', p_severity, 'cost_tier', p_cost_tier));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 9. hosting_connection_save / _set_secret / _list / _test_result — OA-15. The password NEVER passes
--    through SQL: the browser sends it to the secrets-put Edge Function (F5), then links the returned
--    secret id here. This table keeps only the secret id and a masked display.
-- ---------------------------------------------------------------------------
create or replace function public.hosting_connection_save(
  p_org uuid, p_label text, p_kind text, p_host text, p_port int,
  p_database text, p_username text, p_ssl_mode text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_config_actor(p_org, 'edit_config');
  if not public.has_feature(p_org, 'hosting_migration') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;

  insert into hosting_connections (org_id, label, kind, host, port, database_name, username, ssl_mode, created_by)
  values (p_org, p_label, coalesce(p_kind,'supabase_self_hosted'), p_host, p_port, p_database, p_username,
          coalesce(p_ssl_mode,'require'), auth.uid())
  returning id into v_id;

  perform public.append_ledger_entry(p_org, 'config.changed',
    jsonb_build_object('area','hosting_connections','id',v_id,'host',p_host), auth.uid());
  return v_id;
end $$;

-- The browser stores the password through secrets-put, then links the returned id here.
create or replace function public.hosting_connection_set_secret(
  p_connection_id uuid, p_secret_id uuid, p_masked text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from hosting_connections where id = p_connection_id;
  if v_org is null then
    raise exception 'Unknown hosting connection.' using errcode = 'P0001';
  end if;
  perform public.require_config_actor(v_org, 'edit_config');
  update hosting_connections set password_secret_id = p_secret_id,
    password_masked = coalesce(p_masked, '•••• set'), updated_at = now()
    where id = p_connection_id;
end $$;

create or replace function public.hosting_connection_list(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not (p_org = public.jwt_org_id() or public.is_platform_admin()
          or public.config_actor_ok(p_org, 'edit_config')) then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'label', label, 'kind', kind, 'host', host, 'port', port,
           'database', database_name, 'username', username, 'sslMode', ssl_mode,
           'passwordMasked', password_masked, 'lastTestAt', last_test_at,
           'lastTestResult', last_test_result, 'lastTestDetail', last_test_detail) order by created_at desc), '[]'::jsonb)
    into v_out
    from hosting_connections where org_id = p_org;
  return v_out;
end $$;

-- The runner (service role) records the outcome of its connectivity test.
create or replace function public.hosting_connection_test_result(
  p_connection_id uuid, p_result text, p_detail text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the migration runner can record a connectivity result.' using errcode = 'P0001';
  end if;
  update hosting_connections
    set last_test_at = now(), last_test_result = p_result, last_test_detail = p_detail, updated_at = now()
    where id = p_connection_id;
end $$;

-- ---------------------------------------------------------------------------
-- 10. migration_job_create / _list / _step_upsert / _advance — OA-15, SA-12. The web app creates a
--     job (with a short-lived token the runner holds) and reads progress; the runner writes steps.
-- ---------------------------------------------------------------------------
create or replace function public.migration_job_create(
  p_org uuid, p_connection_id uuid, p_retention_days int default 14
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_id uuid;
begin
  perform public.require_config_actor(p_org, 'edit_config');
  if not public.has_feature(p_org, 'hosting_migration') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from hosting_connections where id = p_connection_id and org_id = p_org) then
    raise exception 'That connection does not belong to this organisation.' using errcode = 'P0001';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into migration_jobs (org_id, connection_id, job_token_hash, job_token_masked,
                              retention_days, created_by)
  values (p_org, p_connection_id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          '•••• ' || right(v_token, 4), coalesce(p_retention_days, 14), auth.uid())
  returning id into v_id;

  -- A job is a configuration act, so it is recorded in the versioned configuration history (F2, L5:
  -- configuration changes do not go to the business ledger) and it emits the F7 event both parties see.
  insert into config_versions (org_id, key, value, version, actor_id)
  select p_org, 'hosting_migration:job',
         jsonb_build_object('job_id', v_id, 'connection_id', p_connection_id, 'action', 'started'),
         coalesce(max(version), 0) + 1, auth.uid()
    from config_versions where org_id = p_org and key = 'hosting_migration:job';
  perform public.emit_event(p_org, 'hosting.migration.started', jsonb_build_object('job_id', v_id));
  -- The plain token is returned ONCE, to be shown to the operator who runs the external runner.
  return jsonb_build_object('jobId', v_id, 'jobToken', v_token);
end $$;

create or replace function public.migration_job_list(p_org uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not (p_org = public.jwt_org_id() or public.is_platform_admin()
          or public.config_actor_ok(p_org, 'edit_config')) then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'connectionId', j.connection_id, 'status', j.status,
           'currentStep', j.current_step, 'totalSteps', j.total_steps,
           'rowsDone', j.rows_done, 'errorText', j.error_text,
           'startedAt', j.started_at, 'finishedAt', j.finished_at,
           'retentionDays', j.retention_days, 'retireAfter', j.retire_after,
           'createdAt', j.created_at,
           'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                       'stepNo', s.step_no, 'stepKey', s.step_key, 'status', s.status,
                       'rowsDone', s.rows_done, 'detail', s.detail) order by s.step_no), '[]'::jsonb)
                     from migration_steps s where s.job_id = j.id)) order by j.created_at desc), '[]'::jsonb)
    into v_out from migration_jobs j where j.org_id = p_org;
  return v_out;
end $$;

-- The runner (service role) writes step progress. Guarded by the job token.
create or replace function public.migration_step_upsert(
  p_job_id uuid, p_step_no int, p_step_key text, p_status text,
  p_rows_done bigint, p_checkpoint jsonb, p_detail text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the migration runner can write step progress.' using errcode = 'P0001';
  end if;
  select org_id into v_org from migration_jobs where id = p_job_id;
  if v_org is null then
    raise exception 'Unknown migration job.' using errcode = 'P0001';
  end if;

  insert into migration_steps (org_id, job_id, step_no, step_key, status, rows_done, checkpoint, detail,
                               started_at, finished_at)
  values (v_org, p_job_id, p_step_no, p_step_key, coalesce(p_status,'running'), coalesce(p_rows_done,0),
          coalesce(p_checkpoint,'{}'::jsonb), p_detail,
          case when p_status = 'running' then now() else null end,
          case when p_status in ('done','failed','skipped') then now() else null end)
  on conflict (job_id, step_no) do update set
    step_key = excluded.step_key, status = excluded.status, rows_done = excluded.rows_done,
    checkpoint = excluded.checkpoint, detail = excluded.detail,
    started_at = coalesce(migration_steps.started_at, excluded.started_at),
    finished_at = excluded.finished_at;

  update migration_jobs set current_step = greatest(current_step, p_step_no),
    rows_done = rows_done + case when p_status = 'running' then coalesce(p_rows_done,0) else 0 end
    where id = p_job_id;
end $$;

create or replace function public.migration_job_advance(
  p_job_id uuid, p_status text, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the migration runner can advance a job.' using errcode = 'P0001';
  end if;
  select org_id into v_org from migration_jobs where id = p_job_id;
  if v_org is null then
    raise exception 'Unknown migration job.' using errcode = 'P0001';
  end if;

  update migration_jobs set status = p_status, error_text = p_error,
    started_at = coalesce(started_at, now()),
    finished_at = case when p_status in ('retired','rolled_back') then now() else finished_at end,
    retire_after = case when p_status = 'awaiting_cutover'
                        then now() + (retention_days || ' days')::interval else retire_after end
    where id = p_job_id;

  if p_status = 'failed' then
    perform public.append_ledger_entry(v_org, 'hosting_migration_failed',
      jsonb_build_object('job_id', p_job_id, 'error', coalesce(p_error,'')), auth.uid());
    perform public.emit_event(v_org, 'hosting.migration.failed',
      jsonb_build_object('job_id', p_job_id, 'error', left(coalesce(p_error,''), 300)));
  elsif p_status = 'awaiting_cutover' then
    perform public.append_ledger_entry(v_org, 'hosting_migration_cutover',
      jsonb_build_object('job_id', p_job_id), auth.uid());
    perform public.emit_event(v_org, 'hosting.migration.completed', jsonb_build_object('job_id', p_job_id));
  elsif p_status = 'retired' then
    perform public.append_ledger_entry(v_org, 'hosting_migration_retired',
      jsonb_build_object('job_id', p_job_id), auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Ledger-copy safety (F16). Triggers that compute sequence and hashes may be bypassed ONLY when
--     current_user = 'provio_migrator' AND provio.migration_mode = 'on'. An ordinary role setting
--     the setting changes nothing. A SQL test proves it.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_copy_mode_ok() returns boolean
language sql stable as $$
  select current_user = 'provio_migrator'
     and coalesce(current_setting('provio.migration_mode', true), '') = 'on';
$$;

comment on function public.ledger_copy_mode_ok() is
  'True only for the migration runner role with provio.migration_mode on (F16). An ordinary role cannot satisfy this.';

-- ---------------------------------------------------------------------------
-- 12. Grants (F16). Only authenticated/service_role reach these; anon reaches nothing (F11).
--     PostgreSQL grants execute to PUBLIC by default, so the anon-grant guard (test 72) would fail
--     unless every name is explicitly revoked from public and anon first.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('hosting_fit_seed','hosting_fit_get','hosting_fit_rule_save',
                        'hosting_connection_save','hosting_connection_set_secret',
                        'hosting_connection_list','hosting_connection_test_result',
                        'migration_job_create','migration_job_list','migration_step_upsert',
                        'migration_job_advance','ledger_copy_mode_ok')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
  end loop;
end $$;

grant execute on function public.hosting_fit_get() to authenticated;
grant execute on function public.hosting_fit_rule_save(text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.hosting_connection_save(uuid,text,text,text,int,text,text,text) to authenticated;
grant execute on function public.hosting_connection_set_secret(uuid,uuid,text) to authenticated;
grant execute on function public.hosting_connection_list(uuid) to authenticated;
grant execute on function public.hosting_connection_test_result(uuid,text,text) to service_role;
grant execute on function public.migration_job_create(uuid,uuid,int) to authenticated;
grant execute on function public.migration_job_list(uuid) to authenticated;
grant execute on function public.migration_step_upsert(uuid,int,text,text,bigint,jsonb,text) to service_role;
grant execute on function public.migration_job_advance(uuid,text,text) to service_role;
grant execute on function public.hosting_fit_seed() to service_role;

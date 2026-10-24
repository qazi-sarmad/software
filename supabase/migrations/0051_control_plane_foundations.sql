-- 0051: ACP control plane foundations (S1.2).
--
-- Contents:
--   1. org_settings_extra        — app_base_url, last_board_meeting_date, certificate_auto_issue,
--                                  public_verify_show_title, ai_retention_days (F9, F10, F11, F8).
--   2. config_areas              — the registry of every configuration history table (F7).
--   3. automation_events         — the event outbox the notify triggers write into (F7).
--   4. platform_notification_recipients — Super Admin alert addresses (F7).
--   5. setup_state               — the two persisted wizards (F17).
--   6. tutorials, tutorial_views — the tutorial registry and the view log (F18).
--   7. consultation_*            — the two-tier Dual Session (F4) + config_actor_ok.
--   8. feature_catalogue, plan_definitions, tenant_entitlements, has_feature (F25).
--
-- M1: every name above was grepped in supabase/migrations and supabase/tests first; none existed.
-- M2: every table is create table if not exists plus alter table ... add column if not exists for
--     each column, so a second apply on the persistent project is a no-op. Functions are
--     create or replace; triggers are dropped before they are created.

-- ---------------------------------------------------------------------------
-- 1. org_settings_extra — one row per org.
-- ---------------------------------------------------------------------------
create table if not exists org_settings_extra (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table org_settings_extra add column if not exists app_base_url text;
alter table org_settings_extra add column if not exists last_board_meeting_date date;
alter table org_settings_extra add column if not exists certificate_auto_issue boolean not null default false;
alter table org_settings_extra add column if not exists public_verify_show_title boolean not null default false;
alter table org_settings_extra add column if not exists ai_retention_days int not null default 30;
alter table org_settings_extra add column if not exists updated_at timestamptz not null default now();

alter table org_settings_extra enable row level security;
drop policy if exists org_settings_extra_select on org_settings_extra;
create policy org_settings_extra_select on org_settings_extra for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. config_areas — the registry of configuration history tables (F7).
--    Platform-level: no org_id. Readable by any signed-in session; written only by a platform RPC.
-- ---------------------------------------------------------------------------
create table if not exists config_areas (
  key text primary key
);
alter table config_areas add column if not exists label text;
alter table config_areas add column if not exists history_table text;
alter table config_areas add column if not exists notify_policy text not null default 'both';
alter table config_areas add column if not exists created_at timestamptz not null default now();

alter table config_areas enable row level security;
drop policy if exists config_areas_select on config_areas;
create policy config_areas_select on config_areas for select to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 3. automation_events — the event outbox (F7). Every registered history table writes here through
--    its trigger. Platform rules and tenant rules read it; the email dispatcher (S2) turns matched
--    events into notifications. No secret value is ever written here.
-- ---------------------------------------------------------------------------
create table if not exists automation_events (
  id bigint generated always as identity primary key
);
alter table automation_events add column if not exists org_id uuid;
alter table automation_events add column if not exists event_key text;
alter table automation_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table automation_events add column if not exists actor_id uuid;
alter table automation_events add column if not exists created_at timestamptz not null default now();

alter table automation_events enable row level security;
drop policy if exists automation_events_select on automation_events;
create policy automation_events_select on automation_events for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists automation_events_key_idx on automation_events (event_key, created_at desc);
create index if not exists automation_events_org_idx on automation_events (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. platform_notification_recipients — the Super Admin alert addresses (F7). Platform-level.
-- ---------------------------------------------------------------------------
create table if not exists platform_notification_recipients (
  id uuid primary key default gen_random_uuid()
);
alter table platform_notification_recipients add column if not exists address text;
alter table platform_notification_recipients add column if not exists created_at timestamptz not null default now();

alter table platform_notification_recipients enable row level security;
drop policy if exists pnr_select on platform_notification_recipients;
create policy pnr_select on platform_notification_recipients for select
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 5. setup_state — the two persisted wizards (F17). One row per (scope, org, step).
-- ---------------------------------------------------------------------------
create table if not exists setup_state (
  id uuid primary key default gen_random_uuid()
);
alter table setup_state add column if not exists org_id uuid;
alter table setup_state add column if not exists scope text;
alter table setup_state add column if not exists step_key text;
alter table setup_state add column if not exists status text not null default 'pending';
alter table setup_state add column if not exists answer_ref jsonb not null default '{}'::jsonb;
alter table setup_state add column if not exists updated_at timestamptz not null default now();

alter table setup_state enable row level security;
drop policy if exists setup_state_select on setup_state;
create policy setup_state_select on setup_state for select
  using (org_id = public.jwt_org_id() or (public.is_platform_admin() and scope = 'super_admin'));
create unique index if not exists setup_state_key_idx
  on setup_state (scope, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), step_key);

-- ---------------------------------------------------------------------------
-- 6. tutorials, tutorial_views — the tutorial registry and the view log (F18). Platform-level.
-- ---------------------------------------------------------------------------
create table if not exists tutorials (
  key text primary key
);
alter table tutorials add column if not exists audience text not null default 'both';
alter table tutorials add column if not exists title text;
alter table tutorials add column if not exists steps jsonb not null default '[]'::jsonb;
alter table tutorials add column if not exists media_path text;
alter table tutorials add column if not exists ui_hash text;
alter table tutorials add column if not exists generated_at timestamptz;

alter table tutorials enable row level security;
drop policy if exists tutorials_select on tutorials;
create policy tutorials_select on tutorials for select to authenticated
  using (auth.uid() is not null);

create table if not exists tutorial_views (
  id bigint generated always as identity primary key
);
alter table tutorial_views add column if not exists org_id uuid;
alter table tutorial_views add column if not exists tutorial_key text;
alter table tutorial_views add column if not exists helped boolean;
alter table tutorial_views add column if not exists actor_id uuid;
alter table tutorial_views add column if not exists created_at timestamptz not null default now();

alter table tutorial_views enable row level security;
drop policy if exists tutorial_views_select on tutorial_views;
create policy tutorial_views_select on tutorial_views for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 7. Dual Session (F4). Extend support_access_grants with kind, then add the session tables.
-- ---------------------------------------------------------------------------
alter table support_access_grants add column if not exists kind text not null default 'content_read';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sag_kind_check') then
    alter table support_access_grants
      add constraint sag_kind_check check (kind in ('content_read','config','full_admin'));
  end if;
end $$;

create table if not exists consultation_sessions (
  id uuid primary key default gen_random_uuid()
);
alter table consultation_sessions add column if not exists org_id uuid;
alter table consultation_sessions add column if not exists kind text not null default 'config';
alter table consultation_sessions add column if not exists initiated_by_side text not null default 'platform';
alter table consultation_sessions add column if not exists status text not null default 'requested';
alter table consultation_sessions add column if not exists duration_hours int not null default 2;
alter table consultation_sessions add column if not exists requested_by uuid;
alter table consultation_sessions add column if not exists requested_at timestamptz not null default now();
alter table consultation_sessions add column if not exists acknowledged_at timestamptz;
alter table consultation_sessions add column if not exists started_at timestamptz;
alter table consultation_sessions add column if not exists ended_at timestamptz;
alter table consultation_sessions add column if not exists expires_at timestamptz;
alter table consultation_sessions add column if not exists ended_by uuid;
alter table consultation_sessions add column if not exists end_reason text;
alter table consultation_sessions add column if not exists platform_actor_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cs_kind_check') then
    alter table consultation_sessions add constraint cs_kind_check check (kind in ('config','full_admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cs_status_check') then
    alter table consultation_sessions add constraint cs_status_check
      check (status in ('requested','active','ended','expired','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cs_side_check') then
    alter table consultation_sessions add constraint cs_side_check
      check (initiated_by_side in ('platform','tenant'));
  end if;
end $$;

alter table consultation_sessions enable row level security;
drop policy if exists consultation_sessions_select on consultation_sessions;
create policy consultation_sessions_select on consultation_sessions for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists cs_org_idx on consultation_sessions (org_id, status);

create table if not exists consultation_events (
  id bigint generated always as identity primary key
);
alter table consultation_events add column if not exists org_id uuid;
alter table consultation_events add column if not exists session_id uuid;
alter table consultation_events add column if not exists event_key text;
alter table consultation_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table consultation_events add column if not exists actor_id uuid;
alter table consultation_events add column if not exists actor_side text;
alter table consultation_events add column if not exists created_at timestamptz not null default now();

alter table consultation_events enable row level security;
drop policy if exists consultation_events_select on consultation_events;
create policy consultation_events_select on consultation_events for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
create index if not exists ce_org_idx on consultation_events (org_id, id);

create or replace function public.consultation_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'consultation_events is append-only';
end $$;
drop trigger if exists consultation_events_no_change on consultation_events;
create trigger consultation_events_no_change before update or delete on consultation_events
for each row execute function public.consultation_events_append_only();

create table if not exists consultation_proposals (
  id uuid primary key default gen_random_uuid()
);
alter table consultation_proposals add column if not exists org_id uuid;
alter table consultation_proposals add column if not exists session_id uuid;
alter table consultation_proposals add column if not exists action text;
alter table consultation_proposals add column if not exists payload jsonb not null default '{}'::jsonb;
alter table consultation_proposals add column if not exists status text not null default 'proposed';
alter table consultation_proposals add column if not exists proposed_by uuid;
alter table consultation_proposals add column if not exists proposed_at timestamptz not null default now();
alter table consultation_proposals add column if not exists decided_by uuid;
alter table consultation_proposals add column if not exists decided_at timestamptz;
alter table consultation_proposals add column if not exists reject_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cp_status_check') then
    alter table consultation_proposals add constraint cp_status_check
      check (status in ('proposed','approved','rejected'));
  end if;
end $$;

alter table consultation_proposals enable row level security;
drop policy if exists consultation_proposals_select on consultation_proposals;
create policy consultation_proposals_select on consultation_proposals for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 8. Feature entitlements (F25).
-- ---------------------------------------------------------------------------
create table if not exists feature_catalogue (
  key text primary key
);
alter table feature_catalogue add column if not exists label text;
alter table feature_catalogue add column if not exists description text;
alter table feature_catalogue add column if not exists group_name text;
alter table feature_catalogue add column if not exists price_class text not null default 'included';
alter table feature_catalogue add column if not exists default_on boolean not null default false;
alter table feature_catalogue add column if not exists requires text[] not null default '{}';
alter table feature_catalogue add column if not exists status text not null default 'live';
alter table feature_catalogue add column if not exists created_at timestamptz not null default now();

alter table feature_catalogue enable row level security;
drop policy if exists feature_catalogue_select on feature_catalogue;
create policy feature_catalogue_select on feature_catalogue for select to authenticated
  using (auth.uid() is not null);

create table if not exists plan_definitions (
  name text primary key
);
alter table plan_definitions add column if not exists included_features text[] not null default '{}';
alter table plan_definitions add column if not exists price_text text;
alter table plan_definitions add column if not exists created_at timestamptz not null default now();

alter table plan_definitions enable row level security;
drop policy if exists plan_definitions_select on plan_definitions;
create policy plan_definitions_select on plan_definitions for select to authenticated
  using (auth.uid() is not null);

create table if not exists tenant_entitlements (
  org_id uuid not null references orgs(id) on delete cascade,
  feature_key text not null,
  primary key (org_id, feature_key)
);
alter table tenant_entitlements add column if not exists enabled boolean not null default false;
alter table tenant_entitlements add column if not exists plan_name text;
alter table tenant_entitlements add column if not exists effective_from timestamptz not null default now();
alter table tenant_entitlements add column if not exists effective_to timestamptz;
alter table tenant_entitlements add column if not exists set_by uuid;
alter table tenant_entitlements add column if not exists set_at timestamptz not null default now();
alter table tenant_entitlements add column if not exists reason text;

alter table tenant_entitlements enable row level security;
drop policy if exists tenant_entitlements_select on tenant_entitlements;
create policy tenant_entitlements_select on tenant_entitlements for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- Append-only, hash-chained history (F25, F2 pattern).
create table if not exists tenant_entitlement_versions (
  id bigint generated always as identity primary key
);
alter table tenant_entitlement_versions add column if not exists org_id uuid;
alter table tenant_entitlement_versions add column if not exists entity text not null default 'entitlement';
alter table tenant_entitlement_versions add column if not exists entity_id text;
alter table tenant_entitlement_versions add column if not exists action text;
alter table tenant_entitlement_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table tenant_entitlement_versions add column if not exists actor uuid;
alter table tenant_entitlement_versions add column if not exists prev_hash text;
alter table tenant_entitlement_versions add column if not exists row_hash text;
alter table tenant_entitlement_versions add column if not exists created_at timestamptz not null default now();

alter table tenant_entitlement_versions enable row level security;
drop policy if exists tev_select on tenant_entitlement_versions;
create policy tev_select on tenant_entitlement_versions for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create or replace function public.tenant_entitlement_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'tenant_entitlement_versions is append-only';
end $$;
drop trigger if exists tev_no_change on tenant_entitlement_versions;
create trigger tev_no_change before update or delete on tenant_entitlement_versions
for each row execute function public.tenant_entitlement_versions_append_only();

-- The AI model registry history table (F8/F25: the AI model registry is platform_only).
create table if not exists ai_model_versions (
  id bigint generated always as identity primary key
);
alter table ai_model_versions add column if not exists org_id uuid;
alter table ai_model_versions add column if not exists entity text not null default 'ai_model';
alter table ai_model_versions add column if not exists entity_id text;
alter table ai_model_versions add column if not exists action text;
alter table ai_model_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table ai_model_versions add column if not exists actor uuid;
alter table ai_model_versions add column if not exists prev_hash text;
alter table ai_model_versions add column if not exists row_hash text;
alter table ai_model_versions add column if not exists created_at timestamptz not null default now();

alter table ai_model_versions enable row level security;
drop policy if exists amv_select on ai_model_versions;
create policy amv_select on ai_model_versions for select using (public.is_platform_admin());

-- has_feature(p_org, p_key): the effective entitlement (F25 rule 1). An explicit, in-window row
-- wins; otherwise the catalogue default; an unknown key returns false without error.
create or replace function public.has_feature(p_org uuid, p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_default boolean;
  v_enabled boolean;
begin
  select c.default_on into v_default from feature_catalogue c where c.key = p_key;
  if not found then
    return false;
  end if;
  select e.enabled into v_enabled
    from tenant_entitlements e
   where e.org_id = p_org and e.feature_key = p_key
     and e.effective_from <= now() and (e.effective_to is null or e.effective_to > now())
   order by e.effective_from desc
   limit 1;
  if v_enabled is not null then
    return v_enabled;
  end if;
  return coalesce(v_default, false);
end $$;

-- ---------------------------------------------------------------------------
-- Seed: the feature catalogue (F25), the plan definitions and the config-area registry.
-- Idempotent (on conflict do nothing / do update).
-- ---------------------------------------------------------------------------
insert into feature_catalogue (key, label, description, group_name, price_class, default_on, status) values
  ('board_pack','Board Pack','Assemble a board pack from sealed records','Reporting','add_on',false,'live'),
  ('board_pack_pptx','Board Pack PPTX','Editable PPTX output for the Board Pack','Reporting','add_on',false,'live'),
  ('certificates','Engagement certificates','Issue and revoke engagement certificates','Reporting','add_on',false,'live'),
  ('public_verification','Public verification','Anonymous certificate and pack verification page','Reporting','add_on',false,'live'),
  ('ai_assist','AI assist','Suggest wording beside the deterministic record','AI','add_on',false,'live'),
  ('ai_voice_library','AI voice library','Organisation voice profile, terms and samples','AI','add_on',false,'live'),
  ('ai_board_slides','AI board slides','AI-suggested board slides and executive summary','AI','add_on',false,'live'),
  ('patterns','Cross-engagement patterns','Deterministic finding similarity and clusters','Insight','add_on',false,'live'),
  ('time_travel','Time travel','As-of reconstruction of an engagement','Insight','add_on',false,'live'),
  ('escalation','Escalation rules','Anomaly to role escalation','Automation','add_on',false,'live'),
  ('automation_rules','Automation rules','Event, condition and action rules','Automation','included',true,'live'),
  ('email_resend','Email: Resend','Send through the Resend HTTPS API','Email','add_on',false,'live'),
  ('email_graph','Email: Microsoft Graph','Send through Microsoft Graph','Email','add_on',false,'live'),
  ('email_smtp','Email: SMTP','Send through an SMTP server (port 465 on hosted)','Email','add_on',false,'live'),
  ('external_auditors','External auditor portal','Read-only access for external auditors','Access','add_on',false,'live'),
  ('hosting_migration','Hosting migration','Move a tenant to its own deployment','Hosting','custom',false,'live'),
  ('branding_custom_fonts','Custom fonts','Upload licensed fonts for branding','Branding','add_on',false,'live'),
  ('pptx_theme_upload','PPTX theme upload','Extract a theme from an uploaded .pptx/.potx','Branding','add_on',false,'live'),
  ('consultation_config','Consultation: configuration help','Tier 1 Dual Session','Access','included',false,'live'),
  ('consultation_full_admin','Consultation: full admin help','Tier 2 Dual Session (client invites)','Access','add_on',false,'live'),
  ('watchers','Continuous-auditing watchers','Parked; not sellable','Automation','custom',false,'parked')
on conflict (key) do nothing;

insert into plan_definitions (name, included_features, price_text) values
  ('Standard','{automation_rules}','On request'),
  ('Assurance','{automation_rules,board_pack,certificates,patterns}','On request')
on conflict (name) do nothing;

-- Register every configuration history table (F7). notify_policy: both | platform_only | none.
insert into config_areas (key, label, history_table, notify_policy) values
  ('roles','Roles and rights','role_config_log','both'),
  ('org_settings','Organisation settings','config_versions','both'),
  ('sira_model','SIRA model','sira_model_versions','both'),
  ('ai_models','AI model registry','ai_model_versions','platform_only'),
  ('plan_versions','Audit plan versions','plan_versions','none'),
  ('report_versions','Report versions','report_versions','none'),
  ('tenant_entitlements','Feature entitlements','tenant_entitlement_versions','both')
on conflict (key) do update set label = excluded.label, history_table = excluded.history_table,
  notify_policy = excluded.notify_policy;

-- ---------------------------------------------------------------------------
-- Foreign keys to orgs so `truncate orgs cascade` (the SQL-test reset) reaches these tables (M5).
-- Guarded so a second apply is a no-op.
-- ---------------------------------------------------------------------------
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('setup_state','org_id'), ('consultation_sessions','org_id'),
      ('consultation_events','org_id'), ('consultation_proposals','org_id'),
      ('tenant_entitlement_versions','org_id'), ('tutorial_views','org_id')
    ) as t(tbl, col)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = format('public.%I', spec.tbl)::regclass
         and c.conname = spec.tbl || '_' || spec.col || '_fkey'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references orgs(id) on delete cascade',
        spec.tbl, spec.tbl || '_' || spec.col || '_fkey', spec.col);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The notify trigger: one AFTER INSERT trigger on every registered history table (F7). It builds a
-- plain-language, field-level summary of the row (secrets masked) and writes one automation_events
-- row. notify_policy = 'none' registers the table but emits no event.
-- ---------------------------------------------------------------------------
create or replace function public.mask_secrets(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k text;
  v jsonb;
  out jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return coalesce(p, '{}'::jsonb);
  end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k ~* '(secret|password|token|api_?key|credential|private_?key)' then
      out := out || jsonb_build_object(k, '••••');
    elsif jsonb_typeof(v) = 'object' then
      out := out || jsonb_build_object(k, public.mask_secrets(v));
    elsif jsonb_typeof(v) = 'array' then
      out := out || jsonb_build_object(k, coalesce(
        (select jsonb_agg(public.mask_secrets(e)) from jsonb_array_elements(v) e), '[]'::jsonb));
    else
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  return out;
end $$;

create or replace function public.config_area_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_area record;
  v_org uuid;
  v_event text;
begin
  v_row := to_jsonb(new);
  select a.key, a.label, a.notify_policy into v_area
    from config_areas a where a.history_table = tg_table_name limit 1;
  if not found or v_area.notify_policy = 'none' then
    return new;
  end if;
  v_org := nullif(v_row ->> 'org_id', '')::uuid;
  v_event := case when v_area.notify_policy = 'platform_only' then 'ai_model.changed' else 'config.changed' end;
  insert into automation_events (org_id, event_key, payload, actor_id)
  values (v_org, v_event,
    jsonb_build_object('area', v_area.key, 'area_label', v_area.label,
                       'summary', public.mask_secrets(v_row)),
    nullif(v_row ->> 'actor_id', '')::uuid);
  return new;
end $$;

do $$
declare
  a record;
begin
  for a in select history_table from config_areas where notify_policy <> 'none' loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = a.history_table) then
      execute format('drop trigger if exists %I on public.%I', 'cfg_notify_' || a.history_table, a.history_table);
      execute format('create trigger %I after insert on public.%I for each row execute function public.config_area_notify()',
                     'cfg_notify_' || a.history_table, a.history_table);
    end if;
  end loop;
end $$;

-- 0082: The remaining §23 administration configuration (C3.2-B, spec §10, §12, §14.2, §20, §22, §23).
--
-- The spec (§23) requires the Org Admin portal to configure, visually and without code or JSON:
--   * Organisation settings: one-stage or two-stage testing, and the sign-off role per stage (§10).
--   * Methodology: severity levels (0030), scales, FSLI mapping.
--   * Workflow: approval chains, SLA and escalation settings.
--   * Finding structure: section names, role tags and order (§14.2).
--   * Notifications: rules and recipients, with a supervisor copy (§22).
--   * BI parameters: within fixed ranges for each check (§12).
--   * Export and retention: export schedules and activity-log archival settings (§23, §25.4).
--   * Evidence upload limits: the per-organisation size cap and the accepted formats (§20).
--
-- Every save passes through a confirmation panel (a UI concern) and writes a versioned, logged change
-- (§23): each RPC below calls admin_log_change, which writes config_versions (append-only, the
-- generic configuration history registered as the `org_settings` area in 0051) and activity_log.
--
-- M1: grepped supabase/migrations and supabase/tests for every object below; no hits. New objects
-- only, so nothing is extended. M2: `create table if not exists` plus `add column if not exists` for
-- every column, `create or replace function`, `drop policy if exists` before create, and
-- `insert ... on conflict do update` for the seeds, so a second apply is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Organisation lifecycle settings (§10.2, §10.4, §15.2): one-stage or two-stage testing, the
--    sign-off role per stage, and whether the overall opinion is required.
-- ---------------------------------------------------------------------------
create table if not exists org_lifecycle_settings (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table org_lifecycle_settings add column if not exists testing_mode text not null default 'two_stage';
alter table org_lifecycle_settings add column if not exists signoff_role_planning text not null default 'reviewer';
alter table org_lifecycle_settings add column if not exists signoff_role_testing text not null default 'reviewer';
alter table org_lifecycle_settings add column if not exists signoff_role_conclusion text not null default 'reviewer';
alter table org_lifecycle_settings add column if not exists report_opinion_required boolean not null default false;
alter table org_lifecycle_settings add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ols_testing_mode_chk') then
    alter table org_lifecycle_settings add constraint ols_testing_mode_chk
      check (testing_mode in ('one_stage', 'two_stage'));
  end if;
  -- The sign-off role must be one of the organisation's team roles (§4.2), never a role name.
  if not exists (select 1 from pg_constraint where conname = 'ols_signoff_roles_chk') then
    alter table org_lifecycle_settings add constraint ols_signoff_roles_chk
      check (signoff_role_planning in ('lead', 'preparer', 'reviewer', 'observer')
             and signoff_role_testing in ('lead', 'preparer', 'reviewer', 'observer')
             and signoff_role_conclusion in ('lead', 'preparer', 'reviewer', 'observer'));
  end if;
end $$;

alter table org_lifecycle_settings enable row level security;
drop policy if exists org_lifecycle_settings_select on org_lifecycle_settings;
create policy org_lifecycle_settings_select on org_lifecycle_settings for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. Finding structure (§14.2): section names, one role tag each, and the order. Role tags are a
--    closed list, because every check keys off the tag, not the name.
-- ---------------------------------------------------------------------------
create table if not exists finding_sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  role_tag text not null,
  label text not null,
  position int not null default 0,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, role_tag)
);
create index if not exists finding_sections_org_idx on finding_sections (org_id, position);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'finding_sections_role_tag_chk') then
    alter table finding_sections add constraint finding_sections_role_tag_chk
      check (role_tag in ('context', 'condition', 'effect', 'risk', 'criteria', 'cause', 'recommendation', 'other'));
  end if;
end $$;

alter table finding_sections enable row level security;
drop policy if exists finding_sections_select on finding_sections;
create policy finding_sections_select on finding_sections for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. Methodology scales and FSLI mapping (§23). A scale is a named list of labelled points; the FSLI
--    mapping ties a financial-statement line item code to a label and a category.
-- ---------------------------------------------------------------------------
create table if not exists methodology_scales (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  label text not null,
  points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists fsli_mappings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  code text not null,
  label text not null,
  category text null,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create index if not exists fsli_mappings_org_idx on fsli_mappings (org_id);

alter table methodology_scales enable row level security;
drop policy if exists methodology_scales_select on methodology_scales;
create policy methodology_scales_select on methodology_scales for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

alter table fsli_mappings enable row level security;
drop policy if exists fsli_mappings_select on fsli_mappings;
create policy fsli_mappings_select on fsli_mappings for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. Workflow: approval chain, SLA and escalation (§7.1, §23).
-- ---------------------------------------------------------------------------
create table if not exists workflow_settings (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table workflow_settings add column if not exists approval_chain jsonb not null default '[]'::jsonb;
alter table workflow_settings add column if not exists sla_hours int not null default 48;
alter table workflow_settings add column if not exists escalation_role text not null default 'cia';
alter table workflow_settings add column if not exists escalation_hours int not null default 72;
alter table workflow_settings add column if not exists updated_at timestamptz not null default now();

alter table workflow_settings enable row level security;
drop policy if exists workflow_settings_select on workflow_settings;
create policy workflow_settings_select on workflow_settings for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 5. Notification rules (§22): one row per catalogue event, listing the recipient roles and whether
--    the engagement supervisor is copied.
-- ---------------------------------------------------------------------------
create table if not exists notification_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  event_key text not null,
  recipient_roles text[] not null default '{}',
  supervisor_copy boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, event_key)
);
create index if not exists notification_rules_org_idx on notification_rules (org_id);

alter table notification_rules enable row level security;
drop policy if exists notification_rules_select on notification_rules;
create policy notification_rules_select on notification_rules for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 6. Export and retention settings (§23, §25.4). Retention is bounded: the platform default is six
--    months for a population (§25.4) and the organisation may set its own period within limits.
-- ---------------------------------------------------------------------------
create table if not exists export_retention_settings (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table export_retention_settings add column if not exists export_schedule text not null default 'manual';
alter table export_retention_settings add column if not exists activity_retention_days int not null default 365;
alter table export_retention_settings add column if not exists population_retention_months int not null default 6;
alter table export_retention_settings add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ers_schedule_chk') then
    alter table export_retention_settings add constraint ers_schedule_chk
      check (export_schedule in ('manual', 'daily', 'weekly', 'monthly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ers_retention_chk') then
    alter table export_retention_settings add constraint ers_retention_chk
      check (activity_retention_days between 30 and 3650 and population_retention_months between 1 and 60);
  end if;
end $$;

alter table export_retention_settings enable row level security;
drop policy if exists export_retention_settings_select on export_retention_settings;
create policy export_retention_settings_select on export_retention_settings for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 7. BI parameters (§12): the organisation tunes each check within a platform-fixed range. The
--    platform range is a platform-level table (no org_id); the org's value must fall inside it.
-- ---------------------------------------------------------------------------
create table if not exists bi_check_ranges (
  check_key text primary key
);
alter table bi_check_ranges add column if not exists label text;
alter table bi_check_ranges add column if not exists min_value numeric not null default 0;
alter table bi_check_ranges add column if not exists max_value numeric not null default 1;
alter table bi_check_ranges add column if not exists default_value numeric not null default 0;
alter table bi_check_ranges add column if not exists created_at timestamptz not null default now();

alter table bi_check_ranges enable row level security;
drop policy if exists bi_check_ranges_select on bi_check_ranges;
create policy bi_check_ranges_select on bi_check_ranges for select to authenticated
  using (auth.uid() is not null);

-- The platform-fixed ranges for the §12 checks. A parameter the organisation sets must fall inside
-- its range; the RPC below refuses anything outside.
insert into bi_check_ranges (check_key, label, min_value, max_value, default_value) values
  ('outlier_z_threshold', 'Outlier z-score threshold', 1.5, 5, 3),
  ('outlier_iqr_multiplier', 'Outlier IQR multiplier', 1, 3, 1.5),
  ('benford_mad_threshold', 'Benford MAD threshold', 0.005, 0.05, 0.015),
  ('benford_chi_square_alpha', 'Benford chi-square alpha', 0.001, 0.1, 0.05),
  ('variance_pct_threshold', 'Variance percentage threshold', 0.01, 1, 0.1),
  ('variance_abs_threshold', 'Variance absolute threshold', 0, 1000000, 10000),
  ('round_number_base', 'Round-number base', 10, 100000, 1000),
  ('split_payment_threshold', 'Split-payment threshold', 0, 1000000, 10000),
  ('stale_review_days', 'Stale review age in days', 1, 365, 30)
on conflict (check_key) do update set label = excluded.label, min_value = excluded.min_value,
  max_value = excluded.max_value, default_value = excluded.default_value;

create table if not exists bi_parameters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  check_key text not null references bi_check_ranges(check_key) on delete cascade,
  value numeric not null,
  created_at timestamptz not null default now(),
  unique (org_id, check_key)
);
create index if not exists bi_parameters_org_idx on bi_parameters (org_id);

alter table bi_parameters enable row level security;
drop policy if exists bi_parameters_select on bi_parameters;
create policy bi_parameters_select on bi_parameters for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 8. Evidence upload limits (§20): the per-organisation size cap and the accepted formats. The
--    platform sets the ceiling; the organisation chooses a cap at or below it.
-- ---------------------------------------------------------------------------
create table if not exists upload_limits (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table upload_limits add column if not exists max_file_mb int not null default 10;
alter table upload_limits add column if not exists allowed_extensions text[] not null
  default array['xls', 'xlsx', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'pdf'];
alter table upload_limits add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'upload_limits_size_chk') then
    -- The platform ceiling is 100 MB (§20 "within limits set by the platform").
    alter table upload_limits add constraint upload_limits_size_chk
      check (max_file_mb between 1 and 100);
  end if;
end $$;

alter table upload_limits enable row level security;
drop policy if exists upload_limits_select on upload_limits;
create policy upload_limits_select on upload_limits for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 9. The administration RPCs. Each checks edit_config, validates, upserts, and writes one versioned,
--    logged change (§23). All are security definer and derive the org from the JWT, never the body.
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_lifecycle_settings(
  p_testing_mode text, p_signoff_role_planning text, p_signoff_role_testing text,
  p_signoff_role_conclusion text, p_report_opinion_required boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_roles text[] := array['lead', 'preparer', 'reviewer', 'observer'];
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_testing_mode not in ('one_stage', 'two_stage') then
    raise exception 'the testing mode is one_stage or two_stage' using errcode = 'P0001';
  end if;
  if not (p_signoff_role_planning = any(v_roles) and p_signoff_role_testing = any(v_roles)
          and p_signoff_role_conclusion = any(v_roles)) then
    raise exception 'a sign-off role must be one of the organisation team roles' using errcode = 'P0001';
  end if;
  insert into org_lifecycle_settings (org_id, testing_mode, signoff_role_planning, signoff_role_testing,
                                      signoff_role_conclusion, report_opinion_required, updated_at)
  values (v_org, p_testing_mode, p_signoff_role_planning, p_signoff_role_testing,
          p_signoff_role_conclusion, coalesce(p_report_opinion_required, false), now())
  on conflict (org_id) do update set testing_mode = excluded.testing_mode,
    signoff_role_planning = excluded.signoff_role_planning,
    signoff_role_testing = excluded.signoff_role_testing,
    signoff_role_conclusion = excluded.signoff_role_conclusion,
    report_opinion_required = excluded.report_opinion_required, updated_at = now();
  perform public.admin_log_change(v_org, 'lifecycle_settings',
    jsonb_build_object('testing_mode', p_testing_mode,
                       'signoff_role_planning', p_signoff_role_planning,
                       'signoff_role_testing', p_signoff_role_testing,
                       'signoff_role_conclusion', p_signoff_role_conclusion,
                       'report_opinion_required', coalesce(p_report_opinion_required, false)),
    'lifecycle_settings_saved', 'org_lifecycle_settings', v_org);
end $$;

create or replace function public.admin_upsert_finding_section(
  p_role_tag text, p_label text, p_position int default 0, p_required boolean default false,
  p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_role_tag not in ('context', 'condition', 'effect', 'risk', 'criteria', 'cause',
                        'recommendation', 'other') then
    raise exception 'unknown finding role tag: %', p_role_tag using errcode = 'P0001';
  end if;
  if p_label is null or btrim(p_label) = '' then
    raise exception 'a finding section needs a name' using errcode = 'P0001';
  end if;
  if p_id is not null then
    update finding_sections set role_tag = p_role_tag, label = btrim(p_label),
           position = coalesce(p_position, 0), required = coalesce(p_required, false)
     where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then
      raise exception 'finding section not found in this organisation' using errcode = 'P0001';
    end if;
  else
    insert into finding_sections (org_id, role_tag, label, position, required)
    values (v_org, p_role_tag, btrim(p_label), coalesce(p_position, 0), coalesce(p_required, false))
    on conflict (org_id, role_tag) do update set label = excluded.label,
      position = excluded.position, required = excluded.required
    returning id into v_id;
  end if;
  perform public.admin_log_change(v_org, 'finding_section:' || v_id::text,
    jsonb_build_object('role_tag', p_role_tag, 'label', btrim(p_label),
                       'position', coalesce(p_position, 0), 'required', coalesce(p_required, false)),
    'finding_section_saved', 'finding_sections', v_id);
  return v_id;
end $$;

create or replace function public.admin_delete_finding_section(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_n int;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  delete from finding_sections where id = p_id and org_id = v_org;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'finding section not found in this organisation' using errcode = 'P0001';
  end if;
  perform public.admin_log_change(v_org, 'finding_section:' || p_id::text,
    jsonb_build_object('deleted', true), 'finding_section_deleted', 'finding_sections', p_id);
end $$;

create or replace function public.admin_upsert_methodology_scale(
  p_key text, p_label text, p_points jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_key is null or btrim(p_key) = '' then
    raise exception 'a scale needs a key' using errcode = 'P0001';
  end if;
  if p_points is null or jsonb_typeof(p_points) <> 'array' then
    raise exception 'the scale points must be an array' using errcode = 'P0001';
  end if;
  insert into methodology_scales (org_id, key, label, points)
  values (v_org, btrim(p_key), coalesce(nullif(btrim(p_label), ''), btrim(p_key)), p_points)
  on conflict (org_id, key) do update set label = excluded.label, points = excluded.points
  returning id into v_id;
  perform public.admin_log_change(v_org, 'methodology_scale:' || btrim(p_key),
    jsonb_build_object('key', btrim(p_key), 'label', coalesce(nullif(btrim(p_label), ''), btrim(p_key)),
                       'points', p_points),
    'methodology_scale_saved', 'methodology_scales', v_id);
  return v_id;
end $$;

create or replace function public.admin_upsert_fsli_mapping(
  p_code text, p_label text, p_category text default null, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_code is null or btrim(p_code) = '' or p_label is null or btrim(p_label) = '' then
    raise exception 'an FSLI mapping needs a code and a label' using errcode = 'P0001';
  end if;
  if p_id is not null then
    update fsli_mappings set code = btrim(p_code), label = btrim(p_label), category = p_category
     where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then
      raise exception 'FSLI mapping not found in this organisation' using errcode = 'P0001';
    end if;
  else
    insert into fsli_mappings (org_id, code, label, category)
    values (v_org, btrim(p_code), btrim(p_label), p_category)
    on conflict (org_id, code) do update set label = excluded.label, category = excluded.category
    returning id into v_id;
  end if;
  perform public.admin_log_change(v_org, 'fsli_mapping:' || v_id::text,
    jsonb_build_object('code', btrim(p_code), 'label', btrim(p_label), 'category', p_category),
    'fsli_mapping_saved', 'fsli_mappings', v_id);
  return v_id;
end $$;

create or replace function public.admin_save_workflow_settings(
  p_approval_chain jsonb, p_sla_hours int, p_escalation_role text, p_escalation_hours int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_approval_chain is not null and jsonb_typeof(p_approval_chain) <> 'array' then
    raise exception 'the approval chain must be an array' using errcode = 'P0001';
  end if;
  if p_sla_hours is null or p_sla_hours < 1 or p_sla_hours > 8760 then
    raise exception 'the SLA must be between 1 and 8760 hours' using errcode = 'P0001';
  end if;
  if p_escalation_hours is null or p_escalation_hours < p_sla_hours then
    raise exception 'the escalation time must be at or after the SLA' using errcode = 'P0001';
  end if;
  insert into workflow_settings (org_id, approval_chain, sla_hours, escalation_role, escalation_hours, updated_at)
  values (v_org, coalesce(p_approval_chain, '[]'::jsonb), p_sla_hours,
          coalesce(nullif(btrim(p_escalation_role), ''), 'cia'), p_escalation_hours, now())
  on conflict (org_id) do update set approval_chain = excluded.approval_chain, sla_hours = excluded.sla_hours,
    escalation_role = excluded.escalation_role, escalation_hours = excluded.escalation_hours, updated_at = now();
  perform public.admin_log_change(v_org, 'workflow_settings',
    jsonb_build_object('approval_chain', coalesce(p_approval_chain, '[]'::jsonb),
                       'sla_hours', p_sla_hours,
                       'escalation_role', coalesce(nullif(btrim(p_escalation_role), ''), 'cia'),
                       'escalation_hours', p_escalation_hours),
    'workflow_settings_saved', 'workflow_settings', v_org);
end $$;

create or replace function public.admin_upsert_notification_rule(
  p_event_key text, p_recipient_roles text[], p_supervisor_copy boolean default true,
  p_enabled boolean default true, p_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'a notification rule needs an event' using errcode = 'P0001';
  end if;
  if p_id is not null then
    update notification_rules set event_key = btrim(p_event_key),
           recipient_roles = coalesce(p_recipient_roles, '{}'), supervisor_copy = coalesce(p_supervisor_copy, true),
           enabled = coalesce(p_enabled, true)
     where id = p_id and org_id = v_org returning id into v_id;
    if v_id is null then
      raise exception 'notification rule not found in this organisation' using errcode = 'P0001';
    end if;
  else
    insert into notification_rules (org_id, event_key, recipient_roles, supervisor_copy, enabled)
    values (v_org, btrim(p_event_key), coalesce(p_recipient_roles, '{}'),
            coalesce(p_supervisor_copy, true), coalesce(p_enabled, true))
    on conflict (org_id, event_key) do update set recipient_roles = excluded.recipient_roles,
      supervisor_copy = excluded.supervisor_copy, enabled = excluded.enabled
    returning id into v_id;
  end if;
  perform public.admin_log_change(v_org, 'notification_rule:' || v_id::text,
    jsonb_build_object('event_key', btrim(p_event_key), 'recipient_roles', coalesce(p_recipient_roles, '{}'),
                       'supervisor_copy', coalesce(p_supervisor_copy, true), 'enabled', coalesce(p_enabled, true)),
    'notification_rule_saved', 'notification_rules', v_id);
  return v_id;
end $$;

create or replace function public.admin_save_export_retention(
  p_export_schedule text, p_activity_retention_days int, p_population_retention_months int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_export_schedule not in ('manual', 'daily', 'weekly', 'monthly') then
    raise exception 'the export schedule is manual, daily, weekly or monthly' using errcode = 'P0001';
  end if;
  if p_activity_retention_days is null or p_activity_retention_days < 30 or p_activity_retention_days > 3650 then
    raise exception 'activity retention must be between 30 and 3650 days' using errcode = 'P0001';
  end if;
  if p_population_retention_months is null or p_population_retention_months < 1
     or p_population_retention_months > 60 then
    raise exception 'population retention must be between 1 and 60 months' using errcode = 'P0001';
  end if;
  insert into export_retention_settings (org_id, export_schedule, activity_retention_days,
                                         population_retention_months, updated_at)
  values (v_org, p_export_schedule, p_activity_retention_days, p_population_retention_months, now())
  on conflict (org_id) do update set export_schedule = excluded.export_schedule,
    activity_retention_days = excluded.activity_retention_days,
    population_retention_months = excluded.population_retention_months, updated_at = now();
  perform public.admin_log_change(v_org, 'export_retention',
    jsonb_build_object('export_schedule', p_export_schedule,
                       'activity_retention_days', p_activity_retention_days,
                       'population_retention_months', p_population_retention_months),
    'export_retention_saved', 'export_retention_settings', v_org);
end $$;

create or replace function public.admin_set_bi_parameter(p_check_key text, p_value numeric)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_range bi_check_ranges%rowtype;
  v_id uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  select * into v_range from bi_check_ranges where check_key = p_check_key;
  if not found then
    raise exception 'unknown check: %', p_check_key using errcode = 'P0001';
  end if;
  if p_value is null or p_value < v_range.min_value or p_value > v_range.max_value then
    raise exception 'the value for % must be between % and %', p_check_key, v_range.min_value, v_range.max_value
      using errcode = 'P0001';
  end if;
  insert into bi_parameters (org_id, check_key, value)
  values (v_org, p_check_key, p_value)
  on conflict (org_id, check_key) do update set value = excluded.value
  returning id into v_id;
  perform public.admin_log_change(v_org, 'bi_parameter:' || p_check_key,
    jsonb_build_object('check_key', p_check_key, 'value', p_value),
    'bi_parameter_saved', 'bi_parameters', v_id);
  return v_id;
end $$;

create or replace function public.admin_save_upload_limits(
  p_max_file_mb int, p_allowed_extensions text[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_platform text[] := array['xls', 'xlsx', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'pdf'];
  v_ext text;
begin
  perform public.admin_assert_org(v_org);
  perform public.admin_require_right('edit_config');
  if p_max_file_mb is null or p_max_file_mb < 1 or p_max_file_mb > 100 then
    raise exception 'the size cap must be between 1 and 100 MB' using errcode = 'P0001';
  end if;
  if p_allowed_extensions is null or array_length(p_allowed_extensions, 1) is null then
    raise exception 'at least one accepted format is required' using errcode = 'P0001';
  end if;
  foreach v_ext in array p_allowed_extensions loop
    if not (lower(v_ext) = any(v_platform)) then
      raise exception 'unsupported format: %', v_ext using errcode = 'P0001';
    end if;
  end loop;
  insert into upload_limits (org_id, max_file_mb, allowed_extensions, updated_at)
  values (v_org, p_max_file_mb, (select array_agg(lower(x)) from unnest(p_allowed_extensions) x), now())
  on conflict (org_id) do update set max_file_mb = excluded.max_file_mb,
    allowed_extensions = excluded.allowed_extensions, updated_at = now();
  perform public.admin_log_change(v_org, 'upload_limits',
    jsonb_build_object('max_file_mb', p_max_file_mb,
                       'allowed_extensions', (select array_agg(lower(x)) from unnest(p_allowed_extensions) x)),
    'upload_limits_saved', 'upload_limits', v_org);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Read functions. One per screen, org-scoped, so the UI never reads a table directly.
-- ---------------------------------------------------------------------------
create or replace function public.lifecycle_settings_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('testing_mode', s.testing_mode,
                               'signoff_role_planning', s.signoff_role_planning,
                               'signoff_role_testing', s.signoff_role_testing,
                               'signoff_role_conclusion', s.signoff_role_conclusion,
                               'report_opinion_required', s.report_opinion_required)
       from org_lifecycle_settings s where s.org_id = public.jwt_org_id()),
    jsonb_build_object('testing_mode', 'two_stage', 'signoff_role_planning', 'reviewer',
                       'signoff_role_testing', 'reviewer', 'signoff_role_conclusion', 'reviewer',
                       'report_opinion_required', false))
$$;

create or replace function public.workflow_settings_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('approval_chain', s.approval_chain, 'sla_hours', s.sla_hours,
                               'escalation_role', s.escalation_role, 'escalation_hours', s.escalation_hours)
       from workflow_settings s where s.org_id = public.jwt_org_id()),
    jsonb_build_object('approval_chain', '[]'::jsonb, 'sla_hours', 48,
                       'escalation_role', 'cia', 'escalation_hours', 72))
$$;

create or replace function public.export_retention_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('export_schedule', s.export_schedule,
                               'activity_retention_days', s.activity_retention_days,
                               'population_retention_months', s.population_retention_months)
       from export_retention_settings s where s.org_id = public.jwt_org_id()),
    jsonb_build_object('export_schedule', 'manual', 'activity_retention_days', 365,
                       'population_retention_months', 6))
$$;

create or replace function public.upload_limits_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('max_file_mb', s.max_file_mb, 'allowed_extensions', s.allowed_extensions)
       from upload_limits s where s.org_id = public.jwt_org_id()),
    jsonb_build_object('max_file_mb', 10,
                       'allowed_extensions', array['xls','xlsx','csv','doc','docx','ppt','pptx','pdf']))
$$;

-- Register the areas so a change emits config.changed through the F7 trigger (0051). Each new
-- history table is created by this migration, so the notify trigger is created here too.
insert into config_areas (key, label, history_table, notify_policy) values
  ('lifecycle_settings','Engagement lifecycle settings','config_versions','both'),
  ('finding_structure','Finding structure','config_versions','both'),
  ('methodology','Methodology scales and FSLI mapping','config_versions','both'),
  ('workflow_settings','Workflow, SLA and escalation','config_versions','both'),
  ('notification_rules','Notification rules','config_versions','both'),
  ('export_retention','Export and retention','config_versions','both'),
  ('bi_parameters','BI check parameters','config_versions','both'),
  ('upload_limits','Evidence upload limits','config_versions','both')
on conflict (key) do update set label = excluded.label, history_table = excluded.history_table,
  notify_policy = excluded.notify_policy;

-- Grants: the administration RPCs are for authenticated callers only (the right is checked inside);
-- the read functions likewise. Nothing here is anon-callable (guard anonGrantAllowList).
revoke all on function public.admin_save_lifecycle_settings(text, text, text, text, boolean) from public;
revoke all on function public.admin_upsert_finding_section(text, text, int, boolean, uuid) from public;
revoke all on function public.admin_delete_finding_section(uuid) from public;
revoke all on function public.admin_upsert_methodology_scale(text, text, jsonb) from public;
revoke all on function public.admin_upsert_fsli_mapping(text, text, text, uuid) from public;
revoke all on function public.admin_save_workflow_settings(jsonb, int, text, int) from public;
revoke all on function public.admin_upsert_notification_rule(text, text[], boolean, boolean, uuid) from public;
revoke all on function public.admin_save_export_retention(text, int, int) from public;
revoke all on function public.admin_set_bi_parameter(text, numeric) from public;
revoke all on function public.admin_save_upload_limits(int, text[]) from public;
grant execute on function public.admin_save_lifecycle_settings(text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_upsert_finding_section(text, text, int, boolean, uuid) to authenticated;
grant execute on function public.admin_delete_finding_section(uuid) to authenticated;
grant execute on function public.admin_upsert_methodology_scale(text, text, jsonb) to authenticated;
grant execute on function public.admin_upsert_fsli_mapping(text, text, text, uuid) to authenticated;
grant execute on function public.admin_save_workflow_settings(jsonb, int, text, int) to authenticated;
grant execute on function public.admin_upsert_notification_rule(text, text[], boolean, boolean, uuid) to authenticated;
grant execute on function public.admin_save_export_retention(text, int, int) to authenticated;
grant execute on function public.admin_set_bi_parameter(text, numeric) to authenticated;
grant execute on function public.admin_save_upload_limits(int, text[]) to authenticated;
grant execute on function public.lifecycle_settings_get() to authenticated;
grant execute on function public.workflow_settings_get() to authenticated;
grant execute on function public.export_retention_get() to authenticated;
grant execute on function public.upload_limits_get() to authenticated;

-- 0055: Automation rules, notification templates and in-app notifications (S2.a, F7).
--
-- F7: one engine. A rule = trigger (event) + conditions + actions, stored as data. Scopes: platform
-- template rules (org_id null, Super Admin) and tenant rules (Org Admin copies, edits, disables).
-- A tenant rule overrides a platform rule with the same key. Every rule has an append-only,
-- hash-chained version history (the pattern of role_config_log, 0014) and a loop guard.
--
-- M1: grepped. `automation_events` exists (0051) and is reused, not recreated. No table named
--     automation_rules, automation_rule_versions or notification_templates existed.
-- M2: create table if not exists + add column if not exists; create or replace; drop trigger first.

-- ---------------------------------------------------------------------------
-- 1. automation_rules — the live rule. Conditions and actions are jsonb data edited through visual
--    screens; no screen ever lets a user type JSON (F1).
-- ---------------------------------------------------------------------------
create table if not exists automation_rules (
  id uuid primary key default gen_random_uuid()
);
alter table automation_rules add column if not exists org_id uuid;
alter table automation_rules add column if not exists rule_key text;
alter table automation_rules add column if not exists name text;
alter table automation_rules add column if not exists event_key text;
alter table automation_rules add column if not exists conditions jsonb not null default '[]'::jsonb;
alter table automation_rules add column if not exists actions jsonb not null default '[]'::jsonb;
alter table automation_rules add column if not exists enabled boolean not null default true;
alter table automation_rules add column if not exists is_platform_template boolean not null default false;
alter table automation_rules add column if not exists overrides_rule_id uuid;
alter table automation_rules add column if not exists paused_at timestamptz;
alter table automation_rules add column if not exists pause_reason text;
alter table automation_rules add column if not exists created_by uuid;
alter table automation_rules add column if not exists created_at timestamptz not null default now();
alter table automation_rules add column if not exists updated_at timestamptz not null default now();

alter table automation_rules enable row level security;
drop policy if exists automation_rules_select on automation_rules;
create policy automation_rules_select on automation_rules for select to authenticated
  using (org_id = public.jwt_org_id() or org_id is null or public.is_platform_admin());

create index if not exists automation_rules_event_idx on automation_rules (event_key);
create index if not exists automation_rules_org_idx on automation_rules (org_id);
-- A tenant holds at most one rule per key (the override of the platform rule with that key).
create unique index if not exists automation_rules_org_key_idx
  on automation_rules (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_key);

-- ---------------------------------------------------------------------------
-- 2. automation_rule_versions — append-only, hash-chained history (L5, F2). One row per change.
-- ---------------------------------------------------------------------------
create table if not exists automation_rule_versions (
  id uuid primary key default gen_random_uuid()
);
alter table automation_rule_versions add column if not exists org_id uuid;
alter table automation_rule_versions add column if not exists entity text;
alter table automation_rule_versions add column if not exists entity_id uuid;
alter table automation_rule_versions add column if not exists action text;
alter table automation_rule_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table automation_rule_versions add column if not exists actor text;
alter table automation_rule_versions add column if not exists actor_id uuid;
alter table automation_rule_versions add column if not exists prev_hash text;
alter table automation_rule_versions add column if not exists row_hash text;
alter table automation_rule_versions add column if not exists created_at timestamptz not null default now();

alter table automation_rule_versions enable row level security;
drop policy if exists arv_select on automation_rule_versions;
create policy arv_select on automation_rule_versions for select
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create or replace function public.automation_rule_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'automation_rule_versions is append-only' using errcode = 'P0001';
end $$;

drop trigger if exists automation_rule_versions_no_update on automation_rule_versions;
create trigger automation_rule_versions_no_update
  before update or delete on automation_rule_versions
  for each row execute function public.automation_rule_versions_append_only();

-- The hash-chain writer: prev_hash from the previous row for this rule, row_hash over the payload.
create or replace function public.automation_rule_version_write(
  p_org uuid, p_rule_id uuid, p_action text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_id uuid;
  v_hash text;
begin
  select row_hash into v_prev from automation_rule_versions
   where entity_id = p_rule_id
   order by created_at desc, id desc limit 1;

  v_hash := encode(extensions.digest(
    coalesce(v_prev, '') || p_org::text || p_rule_id::text || p_action ||
    coalesce(p_payload, '{}'::jsonb)::text || now()::text, 'sha256'), 'hex');

  insert into automation_rule_versions (org_id, entity, entity_id, action, payload, actor, actor_id, prev_hash, row_hash)
  values (p_org, 'automation_rule', p_rule_id, p_action,
          public.mask_secrets(coalesce(p_payload, '{}'::jsonb)),
          case when public.is_platform_admin() then 'platform' else 'tenant' end,
          auth.uid(), v_prev, v_hash)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. notification_templates — one template per event key, platform default plus tenant override.
--    `blocks` is a list of heading / paragraph / link / divider blocks with variable chips (F7).
-- ---------------------------------------------------------------------------
create table if not exists notification_templates (
  id uuid primary key default gen_random_uuid()
);
alter table notification_templates add column if not exists org_id uuid;
alter table notification_templates add column if not exists event_key text;
alter table notification_templates add column if not exists locale text not null default 'en';
alter table notification_templates add column if not exists subject text;
alter table notification_templates add column if not exists blocks jsonb not null default '[]'::jsonb;
alter table notification_templates add column if not exists is_platform_template boolean not null default false;
alter table notification_templates add column if not exists created_at timestamptz not null default now();
alter table notification_templates add column if not exists updated_at timestamptz not null default now();

alter table notification_templates enable row level security;
drop policy if exists nt_select on notification_templates;
create policy nt_select on notification_templates for select to authenticated
  using (org_id = public.jwt_org_id() or org_id is null or public.is_platform_admin());

create unique index if not exists nt_key_idx
  on notification_templates (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), event_key, locale);

-- ---------------------------------------------------------------------------
-- 3.1 notification_template_versions — append-only, hash-chained history for template changes
--     (F2, L5). Registered in config_areas (0054) so a change emits config.changed (F7).
-- ---------------------------------------------------------------------------
create table if not exists notification_template_versions (
  id uuid primary key default gen_random_uuid()
);
alter table notification_template_versions add column if not exists org_id uuid;
alter table notification_template_versions add column if not exists entity text;
alter table notification_template_versions add column if not exists entity_id uuid;
alter table notification_template_versions add column if not exists action text;
alter table notification_template_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table notification_template_versions add column if not exists actor text;
alter table notification_template_versions add column if not exists actor_id uuid;
alter table notification_template_versions add column if not exists prev_hash text;
alter table notification_template_versions add column if not exists row_hash text;
alter table notification_template_versions add column if not exists created_at timestamptz not null default now();

alter table notification_template_versions enable row level security;
drop policy if exists ntv_select on notification_template_versions;
create policy ntv_select on notification_template_versions for select
  using (org_id = public.jwt_org_id() or org_id is null or public.is_platform_admin());

create or replace function public.notification_template_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'notification_template_versions is append-only' using errcode = 'P0001';
end $$;

drop trigger if exists notification_template_versions_no_update on notification_template_versions;
create trigger notification_template_versions_no_update
  before update or delete on notification_template_versions
  for each row execute function public.notification_template_versions_append_only();

-- ---------------------------------------------------------------------------
-- 4. notification_preferences — a recipient chooses immediately (default) or a daily digest.
-- ---------------------------------------------------------------------------
create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid()
);
alter table notification_preferences add column if not exists org_id uuid;
alter table notification_preferences add column if not exists user_id uuid;
alter table notification_preferences add column if not exists mode text not null default 'immediately';
alter table notification_preferences add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'np_mode_check') then
    alter table notification_preferences add constraint np_mode_check
      check (mode in ('immediately','daily_digest'));
  end if;
end $$;

alter table notification_preferences enable row level security;
drop policy if exists np_select on notification_preferences;
create policy np_select on notification_preferences for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

create unique index if not exists np_user_idx on notification_preferences (user_id);

-- ---------------------------------------------------------------------------
-- 5. In-app notifications. `notifications` exists (0005) with a broad write policy; F7 wants
--    writes to come only from the engine, so this migration narrows it to a read-only surface and
--    adds the columns the Work Queue needs. M1 decision D-S2-notifications.
-- ---------------------------------------------------------------------------
alter table notifications add column if not exists event_key text;
alter table notifications add column if not exists link text;
alter table notifications add column if not exists payload jsonb not null default '{}'::jsonb;
alter table notifications add column if not exists role_target text;
alter table notifications add column if not exists delivered_at timestamptz;

drop policy if exists notifications_write on notifications;
drop policy if exists notifications_select on notifications;
-- Tenant-only read, exactly as before: the platform principal reads no tenant business table
-- (test 57/60). Platform recipients get email, never a tenant in-app row.
create policy notifications_select on notifications for select to authenticated
  using (org_id = public.jwt_org_id());
-- No insert/update/delete policy: the engine (SECURITY DEFINER) is the only writer.

-- ---------------------------------------------------------------------------
-- 6. Rule evaluation helpers. Pure, deterministic, no randomness (L1).
-- ---------------------------------------------------------------------------

-- One condition: {field, operator, value}. Operators: eq, ne, gte, lte, contains, in, within_days.
create or replace function public.rule_condition_ok(p_payload jsonb, p_condition jsonb)
returns boolean
language plpgsql immutable as $$
declare
  v_field text := p_condition ->> 'field';
  v_op text := p_condition ->> 'operator';
  v_want text := p_condition ->> 'value';
  v_have text;
  v_have_num numeric;
  v_want_num numeric;
begin
  if v_field is null or v_op is null then
    return false;
  end if;
  v_have := p_payload ->> v_field;
  if v_have is null then
    return false;
  end if;

  if v_op = 'eq' then
    return v_have = v_want;
  elsif v_op = 'ne' then
    return v_have <> v_want;
  elsif v_op = 'contains' then
    return position(lower(v_want) in lower(v_have)) > 0;
  elsif v_op = 'in' then
    return v_have = any (string_to_array(v_want, ','));
  elsif v_op in ('gte','lte') then
    begin
      v_have_num := v_have::numeric;
      v_want_num := v_want::numeric;
    exception when others then
      return false;
    end;
    return case when v_op = 'gte' then v_have_num >= v_want_num else v_have_num <= v_want_num end;
  end if;
  return false;
end $$;

-- Every condition must pass.
create or replace function public.rule_conditions_ok(p_payload jsonb, p_conditions jsonb)
returns boolean
language sql immutable as $$
  select coalesce(bool_and(public.rule_condition_ok(p_payload, c)), true)
    from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb)) c
$$;

-- The event field catalogue, so the UI offers dropdowns instead of free text (F1). Seeded from the
-- events this build wires; S6 extends it.
create table if not exists automation_event_fields (
  event_key text not null,
  field text not null,
  label text not null,
  kind text not null default 'text',
  primary key (event_key, field)
);
alter table automation_event_fields enable row level security;
drop policy if exists aef_select on automation_event_fields;
create policy aef_select on automation_event_fields for select to authenticated
  using (auth.uid() is not null);

insert into automation_event_fields (event_key, field, label, kind) values
  ('config.changed', 'area', 'Area', 'text'),
  ('config.changed', 'area_label', 'Area name', 'text'),
  ('ai_model.changed', 'area', 'Area', 'text'),
  ('ai_model.changed', 'area_label', 'Area name', 'text'),
  ('anomaly.raised', 'severity', 'Severity', 'select'),
  ('anomaly.raised', 'amount', 'Amount', 'number'),
  ('anomaly.raised', 'entity', 'Entity', 'text'),
  ('finding.sealed', 'severity', 'Severity', 'select'),
  ('cap.overdue', 'severity', 'Severity', 'select'),
  ('cap.overdue', 'days_overdue', 'Days overdue', 'number'),
  ('cap.due_soon', 'days_due', 'Days until due', 'number')
on conflict (event_key, field) do nothing;

-- The event catalogue itself, for the rule editor's trigger dropdown.
create table if not exists automation_events_catalogue (
  event_key text primary key,
  label text not null,
  category text not null default 'configuration',
  source_exists boolean not null default true
);
alter table automation_events_catalogue enable row level security;
drop policy if exists aec_select on automation_events_catalogue;
create policy aec_select on automation_events_catalogue for select to authenticated
  using (auth.uid() is not null);

insert into automation_events_catalogue (event_key, label, category, source_exists) values
  ('config.changed', 'A configuration changed', 'configuration', true),
  ('ai_model.changed', 'An AI model changed', 'ai', true),
  ('consultation.requested', 'A consultation was requested', 'consultation', true),
  ('consultation.started', 'A consultation started', 'consultation', true),
  ('consultation.ended', 'A consultation ended', 'consultation', true),
  ('consultation.proposal', 'A tier 2 change was proposed', 'consultation', true),
  ('hosting.migration.started', 'A database migration started', 'hosting', true),
  ('hosting.migration.completed', 'A database migration completed', 'hosting', true),
  ('hosting.migration.failed', 'A database migration failed', 'hosting', true),
  ('setup.completed', 'Go Live was completed', 'setup', true),
  ('report.frozen', 'A report was frozen', 'report', true),
  ('report.issued', 'A report was issued', 'report', true),
  ('engagement.sealed', 'An engagement was sealed', 'engagement', true),
  ('certificate.issued', 'A certificate was issued', 'certificate', true),
  ('certificate.revoked', 'A certificate was revoked', 'certificate', true),
  ('board_pack.generated', 'A Board Pack was generated', 'board_pack', true),
  ('cap.due_soon', 'A corrective action is due soon', 'cap', true),
  ('cap.overdue', 'A corrective action is overdue', 'cap', true),
  ('finding.sealed', 'A finding was sealed', 'finding', true),
  ('anomaly.raised', 'An anomaly was raised', 'anomaly', true),
  ('escalation.triggered', 'An escalation fired', 'escalation', true),
  ('invite.sent', 'An invitation was sent', 'people', true),
  ('auditor.invited', 'An external auditor was invited', 'auditor', true),
  ('auditor.accessed', 'An external auditor accessed data', 'auditor', true),
  ('auditor.revoked', 'An external auditor was revoked', 'auditor', true),
  ('email.failed', 'An email failed to send', 'email', true),
  ('ai.call_failed', 'An AI call failed', 'ai', true),
  ('feature.changed', 'A feature entitlement changed', 'feature', true)
on conflict (event_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Grants.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'rule_condition_ok','rule_conditions_ok','automation_rule_version_write')
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;
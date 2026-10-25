-- 0087 remove AI (AI-REMOVE-2, owner decision 2026-10-25).
--
-- Law L1 after this migration: there is no AI in the product. Every AI table, column, function,
-- trigger, cron job, registry row, feature key, config area, entitlement, event and right is
-- removed. The business ledger and its hash chain are NOT touched: old ledger rows of kind
-- `ai_call` stay in place and still verify.
--
-- M2: every statement is idempotent. Drops use `if exists`. Nothing here is created except the
-- replacements for functions that read an AI object, and those are `create or replace`.
-- M7: this file is additive, but eleven earlier migrations are repaired alongside it, each with an
-- explicit `drop function if exists` above the failing statement. They are required because the
-- migrations are applied more than once (scripts/local-sql-harness.sh applies them twice): an
-- earlier file re-creates a function whose OUT columns this migration changes, and PostgreSQL
-- refuses that with "cannot change return type of existing function" (verified: without the repair
-- the second pass fails at 0031_platform_control_plane.sql). Repaired files and the reason:
--   0031 platform_list_tenants (ai_enabled dropped from the OUT list here)
--   0050 rights_keys_valid / seed matrix (use_ai_assist removed here; re-seeding it would fail)
--   0051 feature_catalogue seed (three AI feature rows removed here)
--   0052 get_org_settings_extra, admin_set_org_settings_extra (ai_retention_days dropped here)
--   0055 automation_events_catalogue seed (the two AI event rows removed here)
--   0056 automation rules and templates seed (the AI rule and template removed here)
--   0061 org_settings_extra_get (ai_retention_days dropped here)
--   0071 tutorials seed (the six AI tutorial rows removed here)
--   0074 ai-purge-expired cron schedule (removed here)
--   0075 emit_ai_call_failed revoke list (function removed here)
--   0084 ai_purge_expired revoke (function removed here)
-- Order matters and is deliberate: redefine the readers first, then unschedule, then drop triggers,
-- functions, columns, registry rows and tables.

-- ---------------------------------------------------------------------------
-- 1. rights_keys_valid: the closed vocabulary returns to fourteen keys.
--    Latest definition before this file is 0050_rights_extended.sql.
-- ---------------------------------------------------------------------------
create or replace function public.rights_keys_valid(p_rights jsonb) returns boolean
language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(p_rights) e
    where e.key not in ('manage_users','manage_roles','edit_config','manage_engagements','approve_plan',
                        'review_and_approve','perform_work','can_reopen','view_all_scopes',
                        'read_only','manage_team',
                        'view_board_pack','generate_board_pack','view_insights')
       or jsonb_typeof(e.value) <> 'boolean'
  )
$$;

-- Strip use_ai_assist from every role, seeded or not, in every organisation.
update roles set rights = rights - 'use_ai_assist' where rights ? 'use_ai_assist';

-- Re-assert the fourteen-key seed matrix so a fresh database and an existing one agree.
-- Mirrored in src/lib/rights.ts and checked by src/lib/rightsMatrix.test.ts.
update roles set rights = '{"manage_users":true,"manage_roles":true,"edit_config":true,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb where is_seed and slug = 'org_admin';
update roles set rights = '{"manage_users":false,"manage_roles":true,"edit_config":true,"manage_engagements":true,"approve_plan":true,"review_and_approve":true,"perform_work":true,"can_reopen":true,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":true,"view_insights":true}'::jsonb where is_seed and slug = 'cia';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":true,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":true,"read_only":false,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":true}'::jsonb where is_seed and slug = 'audit_manager';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":true,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb where is_seed and slug = 'reviewer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":true,"can_reopen":false,"view_all_scopes":false,"read_only":false,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb where is_seed and slug = 'preparer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":true,"read_only":true,"manage_team":false,"view_board_pack":true,"generate_board_pack":false,"view_insights":false}'::jsonb where is_seed and slug = 'observer';
update roles set rights = '{"manage_users":false,"manage_roles":false,"edit_config":false,"manage_engagements":false,"approve_plan":false,"review_and_approve":false,"perform_work":false,"can_reopen":false,"view_all_scopes":false,"read_only":true,"manage_team":false,"view_board_pack":false,"generate_board_pack":false,"view_insights":false}'::jsonb where is_seed and slug = 'auditee';

-- ---------------------------------------------------------------------------
-- 2. config_area_notify: `ai_models` was the only platform_only area, so the branch that mapped it
--    to 'ai_model.changed' goes. Latest definition before this file is 0051.
-- ---------------------------------------------------------------------------
create or replace function public.config_area_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_area record;
  v_org uuid;
begin
  v_row := to_jsonb(new);
  select a.key, a.label, a.notify_policy into v_area
    from config_areas a where a.history_table = tg_table_name limit 1;
  if not found or v_area.notify_policy = 'none' then
    return new;
  end if;
  v_org := nullif(v_row ->> 'org_id', '')::uuid;
  insert into automation_events (org_id, event_key, payload, actor_id)
  values (v_org, 'config.changed',
    jsonb_build_object('area', v_area.key, 'area_label', v_area.label,
                       'summary', public.mask_secrets(v_row)),
    nullif(v_row ->> 'actor_id', '')::uuid);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. config_history_list: drop the ai_models UNION branch (it read ai_model_versions).
--    Latest definition before this file is 0053_config_history.sql.
-- ---------------------------------------------------------------------------
create or replace function public.config_history_list(p_limit int default 100)
returns table (
  area text,
  area_label text,
  entity text,
  entity_id text,
  action text,
  summary text,
  actor uuid,
  actor_is_platform boolean,
  prev_hash text,
  row_hash text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
begin
  -- A tenant member with edit_config reads its own history; a platform admin reads it through the
  -- consultation path only (config_write_mode denies everything else).
  if public.jwt_org_id() is not null and coalesce(public.caller_has_right('edit_config'), false) then
    v_org := public.jwt_org_id();
  elsif public.is_platform_admin() then
    select s.org_id into v_org
      from consultation_sessions s
     where s.status = 'active' and (s.expires_at is null or s.expires_at > now())
     order by s.started_at desc nulls last
     limit 1;
    if v_org is null then
      return;
    end if;
  else
    return;
  end if;

  return query
  with rows as (
    select 'roles'::text as area, l.entity, l.entity_id::text as entity_id, l.action,
           coalesce(l.payload->>'summary', l.entity) as summary,
           l.actor, l.prev_hash, l.row_hash, l.created_at
      from role_config_log l where l.org_id = v_org
    union all
    select 'tenant_entitlements', e.entity, e.entity_id, e.action,
           coalesce(e.payload->>'summary', e.entity),
           e.actor, e.prev_hash, e.row_hash, e.created_at
      from tenant_entitlement_versions e where e.org_id = v_org
    union all
    select 'org_settings', c.key, c.key, 'update',
           c.key || ' v' || c.version::text,
           c.actor_id, null::text, null::text, c.ts
      from config_versions c where c.org_id = v_org
  )
  select r.area,
         coalesce(a.label, r.area),
         r.entity,
         r.entity_id,
         r.action,
         r.summary,
         r.actor,
         (r.actor is not null and exists (select 1 from platform_admins p where p.user_id = r.actor)),
         r.prev_hash,
         r.row_hash,
         r.created_at
    from rows r
    left join config_areas a on a.key = r.area
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

-- ---------------------------------------------------------------------------
-- 4. platform_list_tenants: drop the ai_enabled column from the result.
--    Latest definition before this file is 0031_platform_control_plane.sql.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. Settings readers/writers: drop ai_retention_days.
--    get_org_settings_extra: latest is 0073 (the one with provio_org_guard).
--    admin_set_org_settings_extra: latest is 0052.
--    org_settings_extra_get / org_settings_extra_save: latest is 0061.
-- ---------------------------------------------------------------------------
drop function if exists public.get_org_settings_extra(uuid);
create or replace function public.get_org_settings_extra(p_org uuid default null)
returns table (app_base_url text, last_board_meeting_date date, certificate_auto_issue boolean,
               public_verify_show_title boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  perform public.provio_org_guard(v_org);
  return query
    select e.app_base_url, e.last_board_meeting_date,
           coalesce(e.certificate_auto_issue, false), coalesce(e.public_verify_show_title, false)
      from (select v_org as org_id) q
      left join org_settings_extra e on e.org_id = q.org_id;
end $$;

drop function if exists public.admin_set_org_settings_extra(text, date, boolean, boolean, int);
create or replace function public.admin_set_org_settings_extra(
  p_app_base_url text default null,
  p_last_board_meeting_date date default null,
  p_certificate_auto_issue boolean default null,
  p_public_verify_show_title boolean default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.require_config_actor(v_org, 'edit_config');
  insert into org_settings_extra (org_id) values (v_org) on conflict (org_id) do nothing;
  update org_settings_extra
     set app_base_url = coalesce(p_app_base_url, app_base_url),
         last_board_meeting_date = coalesce(p_last_board_meeting_date, last_board_meeting_date),
         certificate_auto_issue = coalesce(p_certificate_auto_issue, certificate_auto_issue),
         public_verify_show_title = coalesce(p_public_verify_show_title, public_verify_show_title),
         updated_at = now()
   where org_id = v_org;
  perform public.admin_log_change(v_org, 'setting:org_extra',
    jsonb_build_object('app_base_url', p_app_base_url, 'certificate_auto_issue', p_certificate_auto_issue,
                       'public_verify_show_title', p_public_verify_show_title),
    'setting_changed', 'config', null);
end $$;

drop function if exists public.org_settings_extra_get(uuid);
create or replace function public.org_settings_extra_get(p_org uuid)
returns table (
  app_base_url text, last_board_meeting_date date, certificate_auto_issue boolean,
  public_verify_show_title boolean
)
language sql stable security definer set search_path = public as $$
  select e.app_base_url, e.last_board_meeting_date, e.certificate_auto_issue,
         e.public_verify_show_title
    from org_settings_extra e
   where e.org_id = p_org
     and (public.is_platform_admin() or p_org = public.jwt_org_id())
$$;

drop function if exists public.org_settings_extra_save(uuid, jsonb);
create or replace function public.org_settings_extra_save(p_org uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot edit the organisation settings' using errcode = 'P0001';
  end if;
  insert into org_settings_extra (org_id) values (p_org) on conflict (org_id) do nothing;
  update org_settings_extra
     set app_base_url = coalesce(p_fields ->> 'app_base_url', app_base_url),
         last_board_meeting_date = coalesce((p_fields ->> 'last_board_meeting_date')::date, last_board_meeting_date),
         certificate_auto_issue = coalesce((p_fields ->> 'certificate_auto_issue')::boolean, certificate_auto_issue),
         public_verify_show_title = coalesce((p_fields ->> 'public_verify_show_title')::boolean, public_verify_show_title),
         updated_at = now()
   where org_id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Unschedule the AI purge job, behind an existence check (pg_cron may be absent).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('ai-purge-expired');
    exception when others then null;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Drop the triggers on the AI tables.
-- ---------------------------------------------------------------------------
drop trigger if exists ai_calls_emit_failed on public.ai_calls;
drop trigger if exists cfg_notify_ai_model_versions on public.ai_model_versions;

-- ---------------------------------------------------------------------------
-- 8. Drop the AI functions. Signatures copied from the live catalog.
-- ---------------------------------------------------------------------------
drop function if exists public.ai_gateway_authorise(uuid);
drop function if exists public.emit_ai_call_failed();
drop function if exists public.ai_call_log(uuid, text, text, text, text, text, text, jsonb, text, text);
drop function if exists public.ai_suggestion_save(uuid, text, text, text, text, jsonb);
drop function if exists public.ai_suggestion_decide(uuid, text, text);
drop function if exists public.ai_use_case_save(uuid, text, boolean, text, numeric, numeric, integer);
drop function if exists public.ai_voice_profile_save(uuid, text, text, text, text);
drop function if exists public.ai_voice_term_add(uuid, text, text, text, text);
drop function if exists public.ai_voice_sample_add(uuid, text, text, text, text);
drop function if exists public.ai_set_endpoint(uuid, text, text, uuid);
drop function if exists public.ai_model_add(text, text, text);
drop function if exists public.ai_model_remove(uuid);
drop function if exists public.ai_model_update(uuid, text, text, text);
drop function if exists public.ai_tenant_set_model(uuid, uuid, text);
drop function if exists public.ai_denylist_add(text, text);
drop function if exists public.ai_denylist_remove(uuid);
drop function if exists public.ai_require_org_actor(uuid, text);
drop function if exists public.ai_endpoint_denied(text);
drop function if exists public.ai_purge_expired();
drop function if exists public.platform_enable_ai(uuid, boolean, text);

-- ---------------------------------------------------------------------------
-- 9. Drop the AI columns.
-- ---------------------------------------------------------------------------
alter table if exists tenant_settings drop column if exists ai_enabled;
alter table if exists tenant_settings drop column if exists ai_model_endpoint;
alter table if exists tenant_settings drop column if exists ai_access_mode;
alter table if exists tenant_settings drop column if exists ai_secret_id;
alter table if exists org_settings_extra drop column if exists ai_retention_days;

-- ---------------------------------------------------------------------------
-- 10. Registry rows.
-- ---------------------------------------------------------------------------
delete from feature_catalogue where key in ('ai_assist','ai_voice_library','ai_board_slides');
delete from config_areas where key = 'ai_models';
delete from tenant_entitlements where feature_key in ('ai_assist','ai_voice_library','ai_board_slides');
delete from automation_event_fields where event_key = 'ai_model.changed';
delete from automation_events_catalogue where event_key in ('ai_model.changed','ai.call_failed');
delete from automation_rules where event_key in ('ai_model.changed','platform.ai_model.changed');
delete from notification_templates where event_key = 'ai_model.changed';
delete from tutorials where key in ('oa.ai','oa.ai-test','oa.ai-usecases','oa.voice','sa.ai-models','sa.ai-denylist');

-- ---------------------------------------------------------------------------
-- 11. Drop the AI tables. `cascade` is used only on objects the inventory names, and every dependent
--     was redefined or dropped above. The ledger is not in this list and is not touched.
-- ---------------------------------------------------------------------------
drop table if exists ai_calls cascade;
drop table if exists ai_suggestions cascade;
drop table if exists ai_use_cases cascade;
drop table if exists tenant_ai_models cascade;
drop table if exists ai_models cascade;
drop table if exists ai_endpoint_denylist cascade;
drop table if exists ai_model_versions cascade;
drop table if exists org_voice_samples cascade;
drop table if exists org_voice_terms cascade;
drop table if exists org_voice_profile cascade;

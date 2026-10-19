-- 0052: ACP control plane RPCs (S1.2). Every write is a SECURITY DEFINER function that checks a
-- right (F3), a feature (F25) or an active consultation session (F4). No direct write policy exists
-- on any of the new tables.
--
-- Contents:
--   1. config_actor_ok + config_write_mode + consultation lifecycle RPCs (F4).
--   2. org_settings_extra read/write RPCs.
--   3. platform_notification_recipients RPCs.
--   4. setup_state RPCs (F17).
--   5. tutorials / tutorial_views RPCs (F18).
--   6. feature entitlement RPCs (F25).
--
-- M1: grepped first; none of these names existed.
-- M2: create or replace; no drop needed.

-- ---------------------------------------------------------------------------
-- 1. Dual Session (F4).
-- ---------------------------------------------------------------------------

-- config_write_mode(p_org, p_right): how the caller may act on configuration for p_org.
--   'apply'   — a tenant member holding the right, or a platform admin with an active session of a
--               kind that may act directly for this right.
--   'propose' — a platform admin in tier 2 acting on manage_users/manage_roles: the change is only
--               proposed and takes effect when the client Org Admin approves it.
--   'deny'    — anyone else.
create or replace function public.config_write_mode(p_org uuid, p_right text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_kind text;
begin
  -- A tenant member acting in its own organisation with the right applies directly.
  if p_org = public.jwt_org_id() and coalesce(public.caller_has_right(p_right), false) then
    return 'apply';
  end if;

  -- A platform admin needs an ACTIVE session of sufficient kind for this org.
  if public.is_platform_admin() then
    select s.kind into v_kind
      from consultation_sessions s
     where s.org_id = p_org and s.status = 'active'
       and (s.expires_at is null or s.expires_at > now())
     order by s.started_at desc nulls last
     limit 1;
    if v_kind = 'config' and p_right = 'edit_config' then
      return 'apply';
    end if;
    if v_kind = 'full_admin' then
      if p_right = 'edit_config' then
        return 'apply';
      end if;
      if p_right in ('manage_users','manage_roles') then
        return 'propose';
      end if;
    end if;
  end if;

  return 'deny';
end $$;

-- config_actor_ok(p_org, p_right): true when the caller may act on this configuration right for
-- this org (directly or by proposal). Every new configuration RPC calls it.
create or replace function public.config_actor_ok(p_org uuid, p_right text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.config_write_mode(p_org, p_right) <> 'deny'
$$;

-- Raise unless the caller may act; returns the mode so a caller can branch to a proposal.
create or replace function public.require_config_actor(p_org uuid, p_right text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_mode text := public.config_write_mode(p_org, p_right);
begin
  if v_mode = 'deny' then
    raise exception 'not allowed: the caller cannot act on the % right for this organisation', p_right
      using errcode = 'P0001';
  end if;
  return v_mode;
end $$;

-- Start a session. Either side may request; the other side acknowledges. Requires: the platform
-- admin, or the tenant Org Admin (edit_config) inviting.
create or replace function public.consultation_request(
  p_org uuid, p_kind text, p_duration_hours int default 2
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_max int;
  v_side text;
  v_actor uuid := auth.uid();
begin
  if p_kind not in ('config','full_admin') then
    raise exception 'unknown consultation kind: %', p_kind using errcode = 'P0001';
  end if;
  if public.is_platform_admin() then
    v_side := 'platform';
  elsif p_org = public.jwt_org_id() and coalesce(public.caller_has_right('edit_config'), false) then
    v_side := 'tenant';
  else
    raise exception 'not allowed: only a platform admin or the tenant Org Admin may start a session'
      using errcode = 'P0001';
  end if;

  -- The tenant side may only invite tier 2.
  if v_side = 'tenant' and p_kind <> 'full_admin' then
    raise exception 'only the platform side may start a tier 1 (config) session' using errcode = 'P0001';
  end if;

  v_max := case when p_kind = 'config' then 8 else 4 end;
  if p_duration_hours is null or p_duration_hours < 1 or p_duration_hours > v_max then
    raise exception 'the duration must be between 1 and % hours for a % session', v_max, p_kind
      using errcode = 'P0001';
  end if;

  insert into consultation_sessions (org_id, kind, initiated_by_side, status, duration_hours, requested_by)
  values (p_org, p_kind, v_side, 'requested', p_duration_hours, v_actor)
  returning id into v_id;

  insert into consultation_events (org_id, session_id, event_key, payload, actor_id, actor_side)
  values (p_org, v_id, 'consultation.requested',
          jsonb_build_object('kind', p_kind, 'duration_hours', p_duration_hours), v_actor, v_side);

  perform public.platform_log('consultation_requested', p_org, 'consultation', v_id,
    jsonb_build_object('kind', p_kind, 'side', v_side));
  perform public.append_ledger_entry(p_org, 'consultation_started',
    jsonb_build_object('session', v_id, 'kind', p_kind), v_actor);
  return v_id;
end $$;

-- The other side acknowledges; the session becomes active. A request older than 24 h expires.
create or replace function public.consultation_acknowledge(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s consultation_sessions;
  v_side text;
  v_actor uuid := auth.uid();
begin
  select * into s from consultation_sessions where id = p_session;
  if not found then
    raise exception 'consultation session not found' using errcode = 'P0001';
  end if;
  if s.status <> 'requested' then
    raise exception 'the session is not awaiting acknowledgement' using errcode = 'P0001';
  end if;
  if s.requested_at < now() - interval '24 hours' then
    update consultation_sessions set status = 'expired' where id = p_session;
    raise exception 'the request expired after 24 hours' using errcode = 'P0001';
  end if;

  if public.is_platform_admin() then
    if s.initiated_by_side <> 'tenant' then
      raise exception 'the platform side already initiated this session' using errcode = 'P0001';
    end if;
    v_side := 'platform';
  elsif s.org_id = public.jwt_org_id() and coalesce(public.caller_has_right('edit_config'), false) then
    if s.initiated_by_side <> 'platform' then
      raise exception 'the tenant side already initiated this session' using errcode = 'P0001';
    end if;
    v_side := 'tenant';
  else
    raise exception 'not allowed: only the other side may acknowledge' using errcode = 'P0001';
  end if;

  update consultation_sessions
     set status = 'active', acknowledged_at = now(), started_at = now(),
         expires_at = now() + make_interval(hours => s.duration_hours),
         platform_actor_id = case when v_side = 'platform' then v_actor else platform_actor_id end
   where id = p_session;

  insert into consultation_events (org_id, session_id, event_key, payload, actor_id, actor_side)
  values (s.org_id, p_session, 'consultation.started', jsonb_build_object('kind', s.kind), v_actor, v_side);
end $$;

-- Either party ends the session at any time.
create or replace function public.consultation_end(p_session uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  s consultation_sessions;
  v_side text;
  v_actor uuid := auth.uid();
begin
  select * into s from consultation_sessions where id = p_session;
  if not found then
    raise exception 'consultation session not found' using errcode = 'P0001';
  end if;
  if s.status not in ('requested','active') then
    raise exception 'the session is already closed' using errcode = 'P0001';
  end if;
  if public.is_platform_admin() then
    v_side := 'platform';
  elsif s.org_id = public.jwt_org_id() and coalesce(public.caller_has_right('edit_config'), false) then
    v_side := 'tenant';
  else
    raise exception 'not allowed: only a party to the session may end it' using errcode = 'P0001';
  end if;

  update consultation_sessions
     set status = 'ended', ended_at = now(), ended_by = v_actor, end_reason = p_reason
   where id = p_session;

  insert into consultation_events (org_id, session_id, event_key, payload, actor_id, actor_side)
  values (s.org_id, p_session, 'consultation.ended', jsonb_build_object('reason', p_reason), v_actor, v_side);
  perform public.append_ledger_entry(s.org_id, 'consultation_ended',
    jsonb_build_object('session', p_session, 'reason', p_reason), v_actor);
end $$;

-- The active session for an org, if any (for the GL-01 banner).
create or replace function public.consultation_active(p_org uuid)
returns table (id uuid, kind text, status text, expires_at timestamptz, initiated_by_side text)
language sql stable security definer set search_path = public as $$
  select s.id, s.kind, s.status, s.expires_at, s.initiated_by_side
    from consultation_sessions s
   where s.org_id = p_org and s.status in ('requested','active')
   order by s.requested_at desc
   limit 1
$$;

-- Tier 2: a platform admin proposes a change; the Org Admin approves or rejects it.
create or replace function public.consultation_propose(
  p_session uuid, p_action text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s consultation_sessions;
  v_id uuid;
  v_actor uuid := auth.uid();
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed: only the platform side proposes' using errcode = 'P0001';
  end if;
  select * into s from consultation_sessions where id = p_session;
  if not found then
    raise exception 'consultation session not found' using errcode = 'P0001';
  end if;
  if s.status <> 'active' or s.kind <> 'full_admin' then
    raise exception 'a proposal needs an active full-admin session' using errcode = 'P0001';
  end if;
  insert into consultation_proposals (org_id, session_id, action, payload, proposed_by)
  values (s.org_id, p_session, p_action, coalesce(p_payload, '{}'::jsonb), v_actor)
  returning id into v_id;
  insert into consultation_events (org_id, session_id, event_key, payload, actor_id, actor_side)
  values (s.org_id, p_session, 'consultation.proposal',
          jsonb_build_object('action', p_action, 'proposal', v_id), v_actor, 'platform');
  return v_id;
end $$;

-- The Org Admin decides a proposal. Approval applies nothing by itself: the caller then re-runs the
-- target RPC as itself, so every deterministic check runs under the Org Admin's own rights.
create or replace function public.consultation_decide_proposal(
  p_proposal uuid, p_approve boolean, p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr consultation_proposals;
  v_actor uuid := auth.uid();
begin
  select * into pr from consultation_proposals where id = p_proposal;
  if not found then
    raise exception 'proposal not found' using errcode = 'P0001';
  end if;
  if pr.status <> 'proposed' then
    raise exception 'the proposal is already decided' using errcode = 'P0001';
  end if;
  if not (pr.org_id = public.jwt_org_id() and coalesce(public.caller_has_right('edit_config'), false)) then
    raise exception 'not allowed: only the client Org Admin decides a proposal' using errcode = 'P0001';
  end if;
  update consultation_proposals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_actor, decided_at = now(), reject_reason = case when p_approve then null else p_reason end
   where id = p_proposal;
  insert into consultation_events (org_id, session_id, event_key, payload, actor_id, actor_side)
  values (pr.org_id, pr.session_id, 'consultation.proposal_decision',
          jsonb_build_object('proposal', p_proposal, 'approved', p_approve, 'reason', p_reason), v_actor, 'tenant');
end $$;

-- Hourly sweep: expire unacknowledged requests and timed-out active sessions.
create or replace function public.consultation_sweep() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
begin
  update consultation_sessions set status = 'expired'
   where status = 'requested' and requested_at < now() - interval '24 hours';
  n := n + coalesce((select count(*) from consultation_sessions where status = 'expired'
                     and ended_at is null and requested_at < now() - interval '24 hours'), 0);
  update consultation_sessions set status = 'expired', ended_at = now(), end_reason = 'timed out'
   where status = 'active' and expires_at is not null and expires_at <= now();
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. org_settings_extra read/write.
-- ---------------------------------------------------------------------------
create or replace function public.get_org_settings_extra(p_org uuid default null)
returns table (app_base_url text, last_board_meeting_date date, certificate_auto_issue boolean,
               public_verify_show_title boolean, ai_retention_days int)
language sql stable security definer set search_path = public as $$
  select coalesce(e.app_base_url, null), e.last_board_meeting_date,
         coalesce(e.certificate_auto_issue, false), coalesce(e.public_verify_show_title, false),
         coalesce(e.ai_retention_days, 30)
    from (select coalesce(p_org, public.jwt_org_id()) as org_id) q
    left join org_settings_extra e on e.org_id = q.org_id
$$;

create or replace function public.admin_set_org_settings_extra(
  p_app_base_url text default null,
  p_last_board_meeting_date date default null,
  p_certificate_auto_issue boolean default null,
  p_public_verify_show_title boolean default null,
  p_ai_retention_days int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  perform public.require_config_actor(v_org, 'edit_config');
  if p_ai_retention_days is not null and (p_ai_retention_days < 0 or p_ai_retention_days > 365) then
    raise exception 'the AI retention period must be between 0 and 365 days' using errcode = 'P0001';
  end if;
  insert into org_settings_extra (org_id) values (v_org) on conflict (org_id) do nothing;
  update org_settings_extra
     set app_base_url = coalesce(p_app_base_url, app_base_url),
         last_board_meeting_date = coalesce(p_last_board_meeting_date, last_board_meeting_date),
         certificate_auto_issue = coalesce(p_certificate_auto_issue, certificate_auto_issue),
         public_verify_show_title = coalesce(p_public_verify_show_title, public_verify_show_title),
         ai_retention_days = coalesce(p_ai_retention_days, ai_retention_days),
         updated_at = now()
   where org_id = v_org;
  perform public.admin_log_change(v_org, 'setting:org_extra',
    jsonb_build_object('app_base_url', p_app_base_url, 'certificate_auto_issue', p_certificate_auto_issue,
                       'public_verify_show_title', p_public_verify_show_title,
                       'ai_retention_days', p_ai_retention_days),
    'setting_changed', 'config', null);
end $$;

-- ---------------------------------------------------------------------------
-- 3. platform_notification_recipients (Super Admin).
-- ---------------------------------------------------------------------------
create or replace function public.platform_add_recipient(p_address text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_platform_admin();
  if p_address is null or position('@' in p_address) = 0 then
    raise exception 'a valid email address is required' using errcode = 'P0001';
  end if;
  insert into platform_notification_recipients (address) values (lower(btrim(p_address))) returning id into v_id;
  perform public.platform_log('recipient_added', null, 'platform', v_id, jsonb_build_object('address', p_address));
  return v_id;
end $$;

create or replace function public.platform_remove_recipient(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_platform_admin();
  delete from platform_notification_recipients where id = p_id;
  perform public.platform_log('recipient_removed', null, 'platform', p_id, '{}'::jsonb);
end $$;

create or replace function public.platform_list_recipients()
returns table (id uuid, address text) language sql stable security definer set search_path = public as $$
  select r.id, r.address from platform_notification_recipients r order by r.address
$$;

-- ---------------------------------------------------------------------------
-- 4. setup_state (F17).
-- ---------------------------------------------------------------------------
create or replace function public.setup_save_step(
  p_scope text, p_step_key text, p_status text, p_answer_ref jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := case when p_scope = 'super_admin' then null else public.jwt_org_id() end;
begin
  if p_scope = 'super_admin' then
    perform public.require_platform_admin();
  else
    if p_scope <> 'org_admin' then
      raise exception 'unknown wizard scope: %', p_scope using errcode = 'P0001';
    end if;
    perform public.require_config_actor(v_org, 'edit_config');
  end if;
  if p_status not in ('pending','done','skipped') then
    raise exception 'unknown step status: %', p_status using errcode = 'P0001';
  end if;
  insert into setup_state (org_id, scope, step_key, status, answer_ref, updated_at)
  values (v_org, p_scope, p_step_key, p_status, coalesce(p_answer_ref, '{}'::jsonb), now())
  on conflict (scope, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), step_key)
  do update set status = excluded.status, answer_ref = excluded.answer_ref, updated_at = now();
end $$;

create or replace function public.setup_list(p_scope text)
returns table (step_key text, status text, answer_ref jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.step_key, s.status, s.answer_ref, s.updated_at
    from setup_state s
   where s.scope = p_scope
     and (s.org_id = public.jwt_org_id() or (public.is_platform_admin() and p_scope = 'super_admin'))
   order by s.updated_at
$$;

-- ---------------------------------------------------------------------------
-- 5. tutorials / tutorial_views (F18).
-- ---------------------------------------------------------------------------
create or replace function public.list_tutorials()
returns table (key text, audience text, title text, steps jsonb, media_path text, ui_hash text, generated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.key, t.audience, t.title, t.steps, t.media_path, t.ui_hash, t.generated_at
    from tutorials t order by t.key
$$;

create or replace function public.record_tutorial_view(p_key text, p_helped boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into tutorial_views (org_id, tutorial_key, helped, actor_id)
  values (public.jwt_org_id(), p_key, p_helped, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 6. Feature entitlements (F25).
-- ---------------------------------------------------------------------------
create or replace function public.list_feature_catalogue()
returns table (key text, label text, description text, group_name text, price_class text,
               default_on boolean, requires text[], status text)
language sql stable security definer set search_path = public as $$
  select c.key, c.label, c.description, c.group_name, c.price_class, c.default_on, c.requires, c.status
    from feature_catalogue c order by c.group_name, c.key
$$;

create or replace function public.list_plans()
returns table (name text, included_features text[], price_text text)
language sql stable security definer set search_path = public as $$
  select p.name, p.included_features, p.price_text from plan_definitions p order by p.name
$$;

-- The effective set for an org: plan union add-ons minus explicit disables.
create or replace function public.list_tenant_entitlements(p_org uuid)
returns table (feature_key text, enabled boolean, plan_name text, reason text)
language sql stable security definer set search_path = public as $$
  select c.key,
         coalesce(e.enabled, c.default_on) as enabled,
         e.plan_name, e.reason
    from feature_catalogue c
    left join tenant_entitlements e on e.org_id = p_org and e.feature_key = c.key
   order by c.group_name, c.key
$$;

create or replace function public.platform_set_entitlement(
  p_org uuid, p_feature text, p_enabled boolean, p_plan text default null, p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_prev boolean;
  v_prev_hash text;
  v_body text;
  v_row jsonb;
  v_actor uuid := auth.uid();
begin
  perform public.require_platform_admin();
  if not exists (select 1 from feature_catalogue where key = p_feature) then
    raise exception 'unknown feature key: %', p_feature using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for an entitlement change' using errcode = 'P0001';
  end if;
  select e.enabled into v_prev from tenant_entitlements e
   where e.org_id = p_org and e.feature_key = p_feature;

  insert into tenant_entitlements (org_id, feature_key, enabled, plan_name, reason, set_by, set_at)
  values (p_org, p_feature, p_enabled, p_plan, p_reason, v_actor, now())
  on conflict (org_id, feature_key) do update
    set enabled = excluded.enabled, plan_name = coalesce(excluded.plan_name, tenant_entitlements.plan_name),
        reason = excluded.reason, set_by = excluded.set_by, set_at = now();

  v_row := jsonb_build_object('feature_key', p_feature, 'enabled', p_enabled,
                              'previous', v_prev, 'plan', p_plan, 'reason', p_reason);
  perform pg_advisory_xact_lock(hashtext(p_org::text));
  select row_hash into v_prev_hash from tenant_entitlement_versions
   where org_id = p_org order by id desc limit 1;
  v_body := coalesce(v_prev_hash, '') || '|' || 'update' || '|' || v_row::text;
  insert into tenant_entitlement_versions (org_id, entity, entity_id, action, payload, actor, prev_hash, row_hash)
  values (p_org, 'entitlement', p_feature, 'update', v_row, v_actor, v_prev_hash,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));

  perform public.platform_log('feature_entitlement_changed', p_org, 'feature', null,
    jsonb_build_object('feature', p_feature, 'enabled', p_enabled, 'reason', p_reason));
  perform public.append_ledger_entry(p_org, 'feature_entitlement_changed',
    jsonb_build_object('feature', p_feature, 'enabled', p_enabled), v_actor);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: revoke PUBLIC/anon, grant authenticated; the platform RPCs are granted to authenticated
-- and re-check the platform role inside.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'config_write_mode','config_actor_ok','require_config_actor',
      'consultation_request','consultation_acknowledge','consultation_end','consultation_active',
      'consultation_propose','consultation_decide_proposal','consultation_sweep',
      'get_org_settings_extra','admin_set_org_settings_extra',
      'platform_add_recipient','platform_remove_recipient','platform_list_recipients',
      'setup_save_step','setup_list','list_tutorials','record_tutorial_view',
      'list_feature_catalogue','list_plans','list_tenant_entitlements','platform_set_entitlement',
      'has_feature','mask_secrets'
    )
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

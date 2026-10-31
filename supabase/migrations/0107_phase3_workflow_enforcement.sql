-- 0107: Phase 3 — make the workflow settings honest (3.1, 3.2, 3.3).
--
-- The audit found three settings that the Org Admin screen saves and displays but no function ever
-- reads, so changing them had no effect:
--
--   * workflow_settings.sla_hours        — the org SLA for a deployment request
--   * workflow_settings.escalation_hours — how long a pending request waits before it escalates
--   * workflow_settings.escalation_role  — the team role told when an escalation fires
--   * org_lifecycle_settings.signoff_role_testing — the role that must sign a workpaper
--
-- This migration gives each one a real effect, read in the database:
--
--   1. request_combined_deployment computes sla_due_at from workflow_settings.sla_hours when the org
--      has configured one, falling back to engagement_gate_settings.sla_hours (the pre-0107 source)
--      and then 48 hours. An org that has never opened the workflow screen is unchanged.
--   2. escalate_overdue_deployment_requests and deployment_requests_escalate_all escalate a pending
--      request once it is older than workflow_settings.escalation_hours, when configured; otherwise
--      they keep the pre-0107 rule (past sla_due_at). Both notify workflow_settings.escalation_role.
--   3. sign_off_workpaper now requires the caller to meet the configured signoff_role_testing, the
--      same caller_meets_signoff_role helper the planning and conclusion stages already use.
--
-- M2: create or replace; every read is a left join, so a missing settings row changes nothing.

-- ---------------------------------------------------------------------------
-- 1. request_combined_deployment (3.1) — the SLA now honours workflow_settings.sla_hours.
--    Body is the 0023 definition with the one added read.
-- ---------------------------------------------------------------------------
create or replace function public.request_combined_deployment(
  p_universe uuid, p_entity uuid, p_period text default null, p_title text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sla int;
  v_wf_sla int;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes where id = p_universe and org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from entities where id = p_entity and org_id = v_org) then
    raise exception 'entity not found in this organisation' using errcode = 'P0001';
  end if;
  perform public.seed_engagement_gate_settings(v_org);
  select sla_hours into v_sla from engagement_gate_settings where org_id = v_org;
  -- Phase 3.1: the org's workflow SLA overrides the gate default when it has been configured.
  select w.sla_hours into v_wf_sla from workflow_settings w where w.org_id = v_org;

  insert into deployment_requests (org_id, universe_id, entity_id, period, title, status,
                                   requested_by, sla_due_at)
  values (v_org, p_universe, p_entity, p_period,
          coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Audit'), 'pending',
          auth.uid(), now() + make_interval(hours => coalesce(v_wf_sla, v_sla, 48)))
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'deployment_requested', 'deployment_request', v_id,
          jsonb_build_object('universe_id', p_universe, 'entity_id', p_entity, 'period', p_period));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. escalate_overdue_deployment_requests (3.2, 3.3) — escalate by escalation_hours and notify
--    escalation_role. Body is the 0023 definition with the two added reads.
-- ---------------------------------------------------------------------------
create or replace function public.escalate_overdue_deployment_requests() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_esc text;
  v_wf_hours int;
  v_wf_role text;
  v_n int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_engagement_gate_settings(v_org);
  select escalate_right into v_esc from engagement_gate_settings where org_id = v_org;
  select w.escalation_hours, w.escalation_role into v_wf_hours, v_wf_role
    from workflow_settings w where w.org_id = v_org;

  update deployment_requests
     set status = 'escalated', escalated_at = now(), escalated_to_right = v_esc
   where org_id = v_org and status = 'pending'
     and case when v_wf_hours is not null
              then created_at + make_interval(hours => v_wf_hours) < now()
              else sla_due_at < now() end;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into activity_log (org_id, actor_id, action, object_type, detail)
    values (v_org, auth.uid(), 'deployment_requests_escalated', 'deployment_request',
            jsonb_build_object('count', v_n, 'escalate_right', v_esc, 'escalation_role', v_wf_role));
    if v_wf_role is not null then
      insert into notifications (org_id, user_id, kind, body, event_key, role_target, payload)
      values (v_org, null, 'deployment.escalated',
              format('%s overdue deployment request(s) escalated', v_n),
              'deployment.escalated', v_wf_role,
              jsonb_build_object('count', v_n, 'escalate_right', v_esc));
    end if;
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. deployment_requests_escalate_all (3.2, 3.3) — the platform-wide wrapper, same rule per org.
-- ---------------------------------------------------------------------------
create or replace function public.deployment_requests_escalate_all()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_esc text;
  v_wf_hours int;
  v_wf_role text;
  v_n int;
  v_total int := 0;
begin
  for v_org in select id from orgs loop
    perform public.seed_engagement_gate_settings(v_org);
    select escalate_right into v_esc from engagement_gate_settings where org_id = v_org;
    select w.escalation_hours, w.escalation_role into v_wf_hours, v_wf_role
      from workflow_settings w where w.org_id = v_org;

    update deployment_requests
       set status = 'escalated', escalated_at = now(), escalated_to_right = v_esc
     where org_id = v_org and status = 'pending'
       and case when v_wf_hours is not null
                then created_at + make_interval(hours => v_wf_hours) < now()
                else sla_due_at < now() end;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into activity_log (org_id, actor_id, action, object_type, detail)
      values (v_org, null, 'deployment_requests_escalated', 'deployment_request',
              jsonb_build_object('count', v_n, 'escalate_right', v_esc, 'escalation_role', v_wf_role));
      perform public.emit_event(v_org, 'escalation.triggered',
        jsonb_build_object('kind', 'deployment_request', 'count', v_n, 'escalate_right', v_esc));
      if v_wf_role is not null then
        insert into notifications (org_id, user_id, kind, body, event_key, role_target, payload)
        values (v_org, null, 'deployment.escalated',
                format('%s overdue deployment request(s) escalated', v_n),
                'deployment.escalated', v_wf_role,
                jsonb_build_object('count', v_n, 'escalate_right', v_esc));
      end if;
    end if;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 4. sign_off_workpaper (3.4 → signoff_role_testing) — the caller must meet the configured testing
--    sign-off role, exactly as sign_planning and sign_conclusion already do. Body is the 0028
--    definition plus the one new check, placed after the workpaper is located.
-- ---------------------------------------------------------------------------
create or replace function public.sign_off_workpaper(p_workpaper_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
  v_rows int;
  v_unresolved int;
  v_self int;
  v_role text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  -- Phase 3.4: the configured testing sign-off role narrows who may sign (§10.4).
  select coalesce(s.signoff_role_testing, 'reviewer') into v_role
    from (select 1) x left join org_lifecycle_settings s on s.org_id = v_org;
  if not public.caller_meets_signoff_role(v_wp.engagement_id, v_role) then
    raise exception 'signoff_role: workpaper sign-off requires the % team role', v_role using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: workpaper is already signed off' using errcode = 'P0001';
  end if;

  select count(*) into v_rows from workpaper_rows where workpaper_id = p_workpaper_id and org_id = v_org;
  if v_rows = 0 then
    raise exception 'no rows to sign off on workpaper %', p_workpaper_id using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org and result is null;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % row(s) have no result', v_unresolved using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org
     and result in ('cross', 'unverifiable') and not exception_flag;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % exception row(s) are not flagged', v_unresolved using errcode = 'P0001';
  end if;

  select count(*) into v_self from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org and prepared_by = auth.uid();
  if v_self = v_rows then
    raise exception 'four_eyes: the signer prepared every row' using errcode = 'P0001';
  end if;

  update workpapers
     set status = 'signed_off', signed_off_at = now(), signed_off_by = auth.uid(), prepared = true
   where id = p_workpaper_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'workpaper_signed_off',
    jsonb_build_object('workpaper_id', p_workpaper_id, 'engagement_id', v_wp.engagement_id, 'rows', v_rows),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'workpaper_signed_off', 'workpaper', p_workpaper_id,
          jsonb_build_object('rows', v_rows));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants: the replaced functions keep their existing grants. The two sweeps stay service-only.
-- ---------------------------------------------------------------------------
revoke execute on function public.deployment_requests_escalate_all() from public, anon, authenticated;
grant execute on function public.request_combined_deployment(uuid, uuid, text, text) to authenticated;
grant execute on function public.escalate_overdue_deployment_requests() to authenticated;
grant execute on function public.sign_off_workpaper(uuid) to authenticated;

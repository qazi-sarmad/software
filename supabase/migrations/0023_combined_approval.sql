-- 3G: Combined approval (spec §7.1) — one request that carries both a plan change and a deployment.
--
-- The spec:
--   §7.1 "One request carries both the plan change and the deployment. One decision applies both
--        atomically, or neither. Approval creates a new plan version linked to the request and
--        deploys the file. Rejection leaves both the plan and the deployment untouched. The decision
--        is revalidated against the current plan at decision time. Requests have an SLA with
--        escalation to a configured senior role. No audit file exists until approval. The
--        plan-change approver's decision also satisfies deployer authorisation."
--
-- Reuse (grep first): deploy_engagement (0022) is the single place an audit file is created; this
-- migration calls into the same steps rather than duplicating the gate. plan_items and
-- snapshot_plan_version (0021) give the plan version. The escalate function is written here but the
-- scheduler that would call it is out of scope (recorded in NOT-DONE).

-- SLA and escalation configuration live with the rest of the gate settings (0022).
alter table engagement_gate_settings add column if not exists sla_hours int not null default 48;
alter table engagement_gate_settings add column if not exists escalate_right text not null default 'manage_users';
alter table engagement_gate_settings drop constraint if exists egs_escalate_right_valid;
alter table engagement_gate_settings add constraint egs_escalate_right_valid
  check (public.rights_keys_valid(jsonb_build_object(escalate_right, true)));

-- The two-argument form (0022) is replaced by the four-argument form below, which keeps working for
-- a two-argument call through its defaults. 0022 recreates the two-argument form on each run and
-- this drop removes it again, so the end state after any number of runs is the four-argument form.
drop function if exists public.admin_set_engagement_gate(text, text);

create or replace function public.admin_set_engagement_gate(
  p_deploy text, p_approve text, p_sla_hours int default null, p_escalate text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sla int := coalesce(p_sla_hours, 48);
  v_esc text := coalesce(p_escalate, 'manage_users');
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if not public.rights_keys_valid(jsonb_build_object(p_deploy, true))
     or not public.rights_keys_valid(jsonb_build_object(p_approve, true))
     or not public.rights_keys_valid(jsonb_build_object(v_esc, true)) then
    raise exception 'unknown right' using errcode = 'P0001';
  end if;
  if v_sla is null or v_sla < 1 then
    raise exception 'the SLA must be at least one hour' using errcode = 'P0001';
  end if;
  perform public.seed_engagement_gate_settings(v_org);
  update engagement_gate_settings
     set deploy_right = p_deploy, approve_right = p_approve, sla_hours = v_sla,
         escalate_right = v_esc, updated_at = now()
   where org_id = v_org;
  insert into activity_log (org_id, actor_id, action, object_type, detail)
  values (v_org, auth.uid(), 'engagement_gate_config_set', 'config',
          jsonb_build_object('deploy_right', p_deploy, 'approve_right', p_approve,
                             'sla_hours', v_sla, 'escalate_right', v_esc));
end $$;

-- ---------------------------------------------------------------------------
-- deployment_requests: one request carrying a plan change and a deployment (§7.1).
-- ---------------------------------------------------------------------------
create table if not exists deployment_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  plan_id uuid null references plans(id) on delete set null,
  period text,
  title text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'escalated')),
  requested_by uuid not null,
  decided_by uuid null,
  decided_at timestamptz null,
  decision_reason text null,
  sla_due_at timestamptz not null default now() + interval '48 hours',
  escalated_at timestamptz null,
  escalated_to_right text null,
  created_at timestamptz not null default now()
);
create index if not exists deployment_requests_org_idx on deployment_requests (org_id, status);

alter table deployment_requests drop constraint if exists deploy_req_decision_chk;
alter table deployment_requests add constraint deploy_req_decision_chk check (
  (status in ('pending', 'escalated') and decided_by is null and decision_reason is null)
  or (status in ('approved', 'rejected') and decided_by is not null and decided_at is not null)
);

-- request_combined_deployment: raise one request that carries both the plan change and the deploy.
create or replace function public.request_combined_deployment(
  p_universe uuid, p_entity uuid, p_period text default null, p_title text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sla int;
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

  insert into deployment_requests (org_id, universe_id, entity_id, period, title, status,
                                   requested_by, sla_due_at)
  values (v_org, p_universe, p_entity, p_period,
          coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Audit'), 'pending',
          auth.uid(), now() + make_interval(hours => coalesce(v_sla, 48)))
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'deployment_requested', 'deployment_request', v_id,
          jsonb_build_object('universe_id', p_universe, 'entity_id', p_entity, 'period', p_period));
  return v_id;
end $$;

-- decide_combined_deployment: one decision applies both atomically, or neither (§7.1).
create or replace function public.decide_combined_deployment(
  p_request uuid, p_approve boolean, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_req deployment_requests;
  v_settings record;
  v_entity entities;
  v_plan plans;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_item uuid;
  v_version int;
  v_engagement uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_engagement_gate_settings(v_org);
  select deploy_right, approve_right, escalate_right into v_settings
    from engagement_gate_settings where org_id = v_org;

  if not coalesce(public.caller_has_right(v_settings.approve_right), false) then
    raise exception 'not allowed: caller lacks the % right to decide a deployment request', v_settings.approve_right
      using errcode = 'P0001';
  end if;

  select * into v_req from deployment_requests where id = p_request and org_id = v_org;
  if v_req.id is null then
    raise exception 'deployment request not found in this organisation' using errcode = 'P0001';
  end if;
  if v_req.status not in ('pending', 'escalated') then
    raise exception 'this deployment request has already been decided' using errcode = 'P0001';
  end if;
  if v_req.requested_by = auth.uid() then
    raise exception 'four-eyes: the approver must differ from the requester' using errcode = 'P0001';
  end if;

  -- Rejection: leave both the plan and the deployment untouched (§7.1).
  if not p_approve then
    if length(v_reason) < 10 then
      raise exception 'a rejection requires a reason of at least 10 characters' using errcode = 'P0001';
    end if;
    update deployment_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
     where id = p_request;
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'deployment_request_rejected', 'deployment_request', p_request,
            jsonb_build_object('reason', v_reason));
    return jsonb_build_object('outcome', 'rejected');
  end if;

  -- Revalidate at decision time (§7.1): the entity must still be approved. This is the invariant
  -- the plan change cannot override — everything else (which plan, which version) is resolved here.
  select * into v_entity from entities where id = v_req.entity_id and org_id = v_org;
  if v_entity.id is null or v_entity.status <> 'approved' then
    raise exception 'revalidation failed: the entity is no longer approved' using errcode = 'P0001';
  end if;

  -- Resolve the plan to carry the change: the most recent plan for the universe matching the period,
  -- or the most recent plan for the universe, or none (deploy-before-plan). If none exists, create a
  -- draft; if it is a draft, this decision also approves it, because the request carried the plan change.
  select p.* into v_plan
    from plans p
   where p.org_id = v_org and p.universe_id = v_req.universe_id
     and (v_req.period is null or p.period = v_req.period)
   order by (p.status = 'approved') desc, p.created_at desc
   limit 1;

  if v_plan.id is null then
    insert into plans (org_id, universe_id, period, status, created_by)
    values (v_org, v_req.universe_id, v_req.period, 'draft', auth.uid())
    returning * into v_plan;
    perform public.snapshot_plan_version(v_plan.id, 'created by combined approval: ' || p_request::text);
  end if;

  if v_plan.status <> 'approved' then
    update plans set status = 'approved', approved_by = auth.uid(), approved_at = now()
     where id = v_plan.id and org_id = v_org;
    v_plan.status := 'approved';
  end if;

  -- Add the entity to the plan (a new linked version) if it is not already there.
  if not exists (select 1 from plan_items i
                  where i.plan_id = v_plan.id and i.entity_id = v_req.entity_id and i.status <> 'removed') then
    insert into plan_items (org_id, plan_id, entity_id, title, is_adhoc, status, created_by)
    values (v_org, v_plan.id, v_req.entity_id, v_req.title, false, 'proposed', auth.uid())
    returning id into v_item;
  end if;
  v_version := public.snapshot_plan_version(v_plan.id, 'combined approval: ' || p_request::text);

  insert into engagements (org_id, universe_id, entity_id, title, stage, plan_id)
  values (v_org, v_req.universe_id, v_req.entity_id, v_req.title, 'planning', v_plan.id)
  returning id into v_engagement;

  update deployment_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_reason = v_reason, plan_id = v_plan.id
   where id = p_request;

  perform public.append_ledger_entry(v_org, 'combined_approval',
    jsonb_build_object('request_id', p_request::text, 'plan_id', v_plan.id::text,
                       'plan_version', v_version, 'engagement_id', v_engagement::text,
                       'entity_id', v_req.entity_id::text), auth.uid());

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'deployment_request_approved', 'deployment_request', p_request,
          jsonb_build_object('plan_id', v_plan.id, 'plan_version', v_version, 'engagement_id', v_engagement));

  return jsonb_build_object('outcome', 'approved', 'plan_id', v_plan.id, 'plan_version', v_version,
                            'engagement_id', v_engagement);
end $$;

-- escalate_overdue_deployment_requests: mark requests past their SLA and address them to the
-- configured senior right (§7.1). The scheduler that calls this is out of scope (NOT-DONE).
create or replace function public.escalate_overdue_deployment_requests() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_esc text;
  v_n int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_engagement_gate_settings(v_org);
  select escalate_right into v_esc from engagement_gate_settings where org_id = v_org;
  update deployment_requests
     set status = 'escalated', escalated_at = now(), escalated_to_right = v_esc
   where org_id = v_org and status = 'pending' and sla_due_at < now();
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into activity_log (org_id, actor_id, action, object_type, detail)
    values (v_org, auth.uid(), 'deployment_requests_escalated', 'deployment_request',
            jsonb_build_object('count', v_n, 'escalate_right', v_esc));
  end if;
  return v_n;
end $$;

-- deployment_request_status: the state of one request as seen by the requestor (§7.1).
create or replace function public.deployment_request_status(p_request uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', r.id, 'status', r.status, 'title', r.title, 'period', r.period,
           'reason', r.decision_reason, 'sla_due_at', r.sla_due_at,
           'escalated_at', r.escalated_at, 'plan_id', r.plan_id)
  from deployment_requests r
  where r.id = p_request and r.org_id = public.jwt_org_id()
$$;

-- ---------------------------------------------------------------------------
-- RLS. deployment_requests carries org_id, has RLS on and a select policy only.
-- ---------------------------------------------------------------------------
alter table deployment_requests enable row level security;
drop policy if exists dr_select on deployment_requests;
create policy dr_select on deployment_requests for select to authenticated
  using (org_id = public.jwt_org_id()
         and (public.can_read_all_scopes() or requested_by = auth.uid()
              or exists (select 1 from entities e where e.id = entity_id
                         and public.has_scope(e.universe_id, e.id, null))));

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_set_engagement_gate(text, text, int, text) from public, anon;
revoke execute on function public.request_combined_deployment(uuid, uuid, text, text) from public, anon;
revoke execute on function public.decide_combined_deployment(uuid, boolean, text) from public, anon;
revoke execute on function public.escalate_overdue_deployment_requests() from public, anon;
revoke execute on function public.deployment_request_status(uuid) from public, anon;

grant execute on function public.admin_set_engagement_gate(text, text, int, text) to authenticated;
grant execute on function public.request_combined_deployment(uuid, uuid, text, text) to authenticated;
grant execute on function public.decide_combined_deployment(uuid, boolean, text) to authenticated;
grant execute on function public.escalate_overdue_deployment_requests() to authenticated;
grant execute on function public.deployment_request_status(uuid) to authenticated;

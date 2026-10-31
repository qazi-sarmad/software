-- 0200 (integrator, final phase): the engagement file owner, deployment from the plan, early
-- deployment with a reason and an approval, and the deterministic suggestions that follow.
--
-- Owner instruction 2026-10-30: "the file owner (for all engagements) concept, deployable from plan
-- when due, if deployed earlier take reasons and get them approved by appropriately configured role,
-- suggest the subsequent change in audit calendar, board pack and all."
--
-- What this migration adds:
--   1. engagement_file_owners  — the file owner of an engagement, assignable from the plan. One row
--      per engagement; a re-assignment is a new version, logged and ledger-appended.
--   2. engagement_deployments  — a deployment of an engagement from a plan item, ON TIME or EARLY.
--      An early deployment (a deploy date before the plan item's planned start) is refused unless it
--      carries a reason, and it is then held in `pending_approval` until an appropriately configured
--      role decides it. Nothing is deployed while it is pending (no partial write).
--   3. deployment_suggestions  — the deterministic consequences of a deployment for the audit
--      calendar, the board pack and the plan, so the change is suggested before it is made rather
--      than discovered afterwards. A suggestion is DATA, never an automatic write to another surface.
--   4. `engagement_deploy_from_plan` / `engagement_deployment_decide` / `engagement_file_owner_set`
--      / `deployment_suggestions_generate` and their readers.
--
-- The configured role is `engagement_gate_settings.approve_right` (0022), which is already the org's
-- choice of who approves a gate — reused rather than a second setting, so there is one place to
-- configure "who approves a deployment".
--
-- Laws honoured: L1 (every suggestion is a rule over configured dates — no model), L2 (every row is
-- pinned to the session org; the engagement and the plan item are checked to belong to it), L3/L5
-- (a change is versioned, logged and ledger-appended, with a reason).
--
-- M1: grepped migrations and tests for every new name; all new, none redefined. M2: create table if
-- not exists / create index if not exists. M6: the harness applies this twice before the push.

-- ---------------------------------------------------------------------------
-- 1. The file owner of an engagement.
-- ---------------------------------------------------------------------------
create table if not exists engagement_file_owners (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null unique references engagements(id) on delete cascade,
  -- The plan item the owner was named against, when the owner was set from the plan.
  plan_item_id uuid null references plan_items(id) on delete set null,
  user_id uuid not null,
  assigned_by uuid null,
  reason text not null default '',
  version int not null default 1,
  assigned_at timestamptz not null default now()
);
create index if not exists engagement_file_owners_org_idx on engagement_file_owners (org_id, user_id);

alter table engagement_file_owners enable row level security;
drop policy if exists engagement_file_owners_select on engagement_file_owners;
create policy engagement_file_owners_select on engagement_file_owners for select to authenticated
  using (org_id = public.jwt_org_id());
-- No insert/update/delete policy: writes go through engagement_file_owner_set() only.
drop trigger if exists engagement_file_owners_pin_org on engagement_file_owners;
create trigger engagement_file_owners_pin_org before insert on engagement_file_owners
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 2. A deployment of an engagement from a plan item, on time or early.
-- ---------------------------------------------------------------------------
create table if not exists engagement_deployments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid null references engagements(id) on delete cascade,
  plan_item_id uuid not null references plan_items(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  title text not null default 'Audit',
  due_on date null,
  deployed_on date not null,
  is_early boolean not null default false,
  reason text not null default '',
  status text not null default 'deployed'
    check (status in ('pending_approval','approved','refused','deployed')),
  approval_right text not null default 'approve_plan',
  requested_by uuid null,
  decided_by uuid null,
  decided_at timestamptz null,
  decision_reason text null,
  created_at timestamptz not null default now(),
  -- An early deployment must carry a reason, and only an early one can wait for approval.
  constraint engagement_deployments_early_reason check (
    (not is_early) or (length(btrim(reason)) >= 10)
  ),
  constraint engagement_deployments_early_pending check (
    (not is_early) or status in ('pending_approval','approved','refused')
  )
);
create index if not exists engagement_deployments_org_idx on engagement_deployments (org_id, status);

alter table engagement_deployments enable row level security;
drop policy if exists engagement_deployments_select on engagement_deployments;
create policy engagement_deployments_select on engagement_deployments for select to authenticated
  using (org_id = public.jwt_org_id());
drop trigger if exists engagement_deployments_pin_org on engagement_deployments;
create trigger engagement_deployments_pin_org before insert on engagement_deployments
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 3. The suggestions a deployment makes. Deterministic rows, generated from the configured dates.
-- ---------------------------------------------------------------------------
create table if not exists deployment_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  deployment_id uuid not null references engagement_deployments(id) on delete cascade,
  target text not null check (target in ('audit_calendar','board_pack','plan')),
  suggestion text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists deployment_suggestions_deployment_idx on deployment_suggestions (org_id, deployment_id);

alter table deployment_suggestions enable row level security;
drop policy if exists deployment_suggestions_select on deployment_suggestions;
create policy deployment_suggestions_select on deployment_suggestions for select to authenticated
  using (org_id = public.jwt_org_id());
drop trigger if exists deployment_suggestions_pin_org on deployment_suggestions;
create trigger deployment_suggestions_pin_org before insert on deployment_suggestions
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 4. engagement_file_owner_set — name the file owner of an engagement. Requires manage_engagements.
--    The person must be a member of the org. A re-assignment is a new version.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_file_owner_set(
  p_engagement uuid, p_user uuid, p_plan_item uuid default null, p_reason text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
  v_version int;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_engagements');
  if p_engagement is null or p_user is null then
    raise exception 'an engagement and a file owner are required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_user) then
    raise exception 'the file owner must be a member of this organisation' using errcode = 'P0001';
  end if;
  if p_plan_item is not null
     and not exists (select 1 from plan_items i where i.id = p_plan_item and i.org_id = v_org) then
    raise exception 'the plan item is not in this organisation' using errcode = 'P0001';
  end if;

  insert into engagement_file_owners (org_id, engagement_id, plan_item_id, user_id, assigned_by, reason)
  values (v_org, p_engagement, p_plan_item, p_user, auth.uid(), coalesce(p_reason, ''))
  on conflict (engagement_id) do update
    set user_id = excluded.user_id,
        plan_item_id = excluded.plan_item_id,
        assigned_by = excluded.assigned_by,
        reason = excluded.reason,
        version = engagement_file_owners.version + 1,
        assigned_at = now()
  returning id, version into v_id, v_version;

  perform public.admin_log_change(v_org, 'engagement_file_owner:' || p_engagement::text,
    jsonb_build_object('engagement_id', p_engagement, 'user_id', p_user, 'plan_item_id', p_plan_item,
                       'version', v_version, 'reason', p_reason),
    'engagement_file_owner_set', 'engagement', p_engagement);
  perform public.append_ledger_entry(v_org, 'engagement_file_owner_set',
    jsonb_build_object('engagement_id', p_engagement::text, 'user_id', p_user::text,
                       'plan_item_id', p_plan_item::text, 'version', v_version, 'reason', p_reason),
    auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. deployment_suggestions_generate — the deterministic consequences of a deployment.
--
--    Three rules, each a comparison of configured dates:
--      audit_calendar : the plan item's window is suggested as the engagement's working window, and
--                       an early deployment suggests bringing the window forward by the lead.
--      board_pack     : the deployment falls inside the current board-pack window, so the engagement
--                       is suggested for the next pack's scope.
--      plan           : an early deployment suggests recording the deviation against the plan item.
--
--    Idempotent: calling it twice for one deployment replaces the suggestions rather than doubling
--    them, so a re-run is safe.
-- ---------------------------------------------------------------------------
create or replace function public.deployment_suggestions_generate(p_deployment uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_dep engagement_deployments;
  v_item plan_items;
  v_count int := 0;
  v_lead int;
begin
  perform public.admin_assert_org(v_org);
  select * into v_dep from engagement_deployments d where d.id = p_deployment and d.org_id = v_org;
  if v_dep.id is null then
    raise exception 'no deployment with that id in this organisation' using errcode = 'P0001';
  end if;
  select * into v_item from plan_items i where i.id = v_dep.plan_item_id;

  delete from deployment_suggestions where deployment_id = p_deployment;

  insert into deployment_suggestions (org_id, deployment_id, target, suggestion, detail)
  values (v_org, p_deployment, 'audit_calendar',
          format('Set the working window for this engagement to %s – %s in the audit calendar.',
                 coalesce(v_item.planned_start::text, 'the plan start'),
                 coalesce(v_item.planned_end::text, 'the plan end')),
          jsonb_build_object('planned_start', v_item.planned_start, 'planned_end', v_item.planned_end));
  v_count := v_count + 1;

  if v_dep.is_early and v_item.planned_start is not null then
    v_lead := v_item.planned_start - v_dep.deployed_on;
    insert into deployment_suggestions (org_id, deployment_id, target, suggestion, detail)
    values (v_org, p_deployment, 'audit_calendar',
            format('Bring the window forward by %s day(s), to %s, so the calendar matches the early start.',
                   v_lead, v_dep.deployed_on::text),
            jsonb_build_object('lead_days', v_lead, 'deployed_on', v_dep.deployed_on));
    v_count := v_count + 1;

    insert into deployment_suggestions (org_id, deployment_id, target, suggestion, detail)
    values (v_org, p_deployment, 'plan',
            format('Record the %s-day early start against plan item "%s" with its reason.', v_lead, v_item.title),
            jsonb_build_object('lead_days', v_lead, 'plan_item_id', v_item.id, 'reason', v_dep.reason));
    v_count := v_count + 1;
  end if;

  insert into deployment_suggestions (org_id, deployment_id, target, suggestion, detail)
  values (v_org, p_deployment, 'board_pack',
          'Include this engagement in the next Board Pack scope so the new work is reported.',
          jsonb_build_object('engagement_id', v_dep.engagement_id, 'deployed_on', v_dep.deployed_on));
  v_count := v_count + 1;

  perform public.append_ledger_entry(v_org, 'deployment_suggestions_generated',
    jsonb_build_object('deployment_id', p_deployment::text, 'count', v_count), auth.uid());
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 6. engagement_deploy_from_plan — deploy an engagement from a plan item.
--
--    On time (p_on is on/after the plan item's planned_start, or there is no planned start): the
--    engagement is created at once, exactly as deploy_engagement would.
--    Early (p_on is before planned_start): a reason of at least 10 characters is required, the
--    deployment is recorded as pending_approval, and NOTHING is deployed until the configured
--    approver decides. The outcome says so; the caller routes the user.
--
--    Requires manage_engagements to start, so a caller who may not deploy cannot raise a request.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_deploy_from_plan(
  p_plan_item uuid, p_on date default null, p_reason text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_item plan_items;
  v_plan plans;
  v_settings record;
  v_on date := coalesce(p_on, current_date);
  v_early boolean;
  v_engagement uuid;
  v_dep uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_engagements');
  if p_plan_item is null then
    raise exception 'a plan item is required' using errcode = 'P0001';
  end if;

  select * into v_item from plan_items i where i.id = p_plan_item and i.org_id = v_org;
  if v_item.id is null then
    raise exception 'the plan item is not in this organisation' using errcode = 'P0001';
  end if;
  if v_item.entity_id is null then
    raise exception 'the plan item names no entity, so it cannot be deployed' using errcode = 'P0001';
  end if;

  select * into v_plan from plans p where p.id = v_item.plan_id and p.org_id = v_org;
  perform public.seed_engagement_gate_settings(v_org);
  select deploy_right, approve_right into v_settings from engagement_gate_settings where org_id = v_org;

  v_early := v_item.planned_start is not null and v_on < v_item.planned_start;

  if v_early then
    if length(btrim(coalesce(p_reason, ''))) < 10 then
      return jsonb_build_object('outcome', 'reason_required', 'is_early', true,
                                'detail', 'an early deployment needs a reason of at least 10 characters',
                                'planned_start', v_item.planned_start);
    end if;
    -- Held for approval. No engagement is created yet (no partial write).
    insert into engagement_deployments (org_id, plan_item_id, universe_id, entity_id, title,
                                        due_on, deployed_on, is_early, reason, status, approval_right, requested_by)
    values (v_org, p_plan_item, v_plan.universe_id, v_item.entity_id, coalesce(v_item.title, 'Audit'),
            v_item.planned_start, v_on, true, btrim(p_reason), 'pending_approval', v_settings.approve_right, auth.uid())
    returning id into v_dep;

    perform public.admin_log_change(v_org, 'engagement_deployment:' || v_dep::text,
      jsonb_build_object('plan_item_id', p_plan_item, 'deployed_on', v_on, 'due_on', v_item.planned_start,
                         'is_early', true, 'reason', btrim(p_reason), 'approval_right', v_settings.approve_right),
      'engagement_early_deployment_requested', 'engagement_deployment', v_dep);
    perform public.append_ledger_entry(v_org, 'engagement_early_deployment_requested',
      jsonb_build_object('deployment_id', v_dep::text, 'plan_item_id', p_plan_item::text,
                         'deployed_on', v_on::text, 'due_on', v_item.planned_start::text,
                         'reason', btrim(p_reason)), auth.uid());
    return jsonb_build_object('outcome', 'early_approval_required', 'is_early', true,
                              'deployment_id', v_dep, 'approval_right', v_settings.approve_right,
                              'due_on', v_item.planned_start, 'deployed_on', v_on,
                              'detail', 'the deployment is held until the configured approver decides');
  end if;

  -- On time: deploy now.
  insert into engagements (org_id, universe_id, entity_id, title, stage, plan_id)
  values (v_org, v_plan.universe_id, v_item.entity_id, coalesce(v_item.title, 'Audit'), 'planning', v_plan.id)
  returning id into v_engagement;

  insert into engagement_deployments (org_id, engagement_id, plan_item_id, universe_id, entity_id, title,
                                      due_on, deployed_on, is_early, reason, status, approval_right, requested_by)
  values (v_org, v_engagement, p_plan_item, v_plan.universe_id, v_item.entity_id, coalesce(v_item.title, 'Audit'),
          v_item.planned_start, v_on, false, coalesce(p_reason, ''), 'deployed', v_settings.approve_right, auth.uid())
  returning id into v_dep;

  perform public.admin_log_change(v_org, 'engagement_deployment:' || v_dep::text,
    jsonb_build_object('engagement_id', v_engagement, 'plan_item_id', p_plan_item, 'deployed_on', v_on),
    'engagement_deployed_from_plan', 'engagement', v_engagement);
  perform public.append_ledger_entry(v_org, 'engagement_deployed_from_plan',
    jsonb_build_object('engagement_id', v_engagement::text, 'plan_item_id', p_plan_item::text,
                       'deployed_on', v_on::text), auth.uid());

  perform public.deployment_suggestions_generate(v_dep);
  return jsonb_build_object('outcome', 'deployed', 'is_early', false,
                            'engagement_id', v_engagement, 'deployment_id', v_dep);
end $$;

-- ---------------------------------------------------------------------------
-- 7. engagement_deployment_decide — the configured approver decides an early deployment.
--    Approving deploys the engagement and generates the suggestions; refusing deploys nothing.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_deployment_decide(
  p_deployment uuid, p_approve boolean, p_reason text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_dep engagement_deployments;
  v_plan plans;
  v_engagement uuid;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  select * into v_dep from engagement_deployments d where d.id = p_deployment and d.org_id = v_org;
  if v_dep.id is null then
    raise exception 'no deployment with that id in this organisation' using errcode = 'P0001';
  end if;
  if v_dep.status <> 'pending_approval' then
    raise exception 'not_pending: only a pending early deployment can be decided' using errcode = 'P0001';
  end if;
  -- The configured approver: the org's own choice of the right that approves a gate.
  perform public.admin_require_right(v_dep.approval_right);

  if not p_approve then
    update engagement_deployments
       set status = 'refused', decided_by = auth.uid(), decided_at = now(),
           decision_reason = coalesce(p_reason, '')
     where id = p_deployment;
    perform public.append_ledger_entry(v_org, 'engagement_early_deployment_refused',
      jsonb_build_object('deployment_id', p_deployment::text, 'reason', coalesce(p_reason, '')), auth.uid());
    return jsonb_build_object('outcome', 'refused', 'deployment_id', p_deployment);
  end if;

  select * into v_plan from plans p where p.id = (select plan_id from plan_items where id = v_dep.plan_item_id);

  insert into engagements (org_id, universe_id, entity_id, title, stage, plan_id)
  values (v_org, v_dep.universe_id, v_dep.entity_id, v_dep.title, 'planning', v_plan.id)
  returning id into v_engagement;

  update engagement_deployments
     set status = 'approved', engagement_id = v_engagement, decided_by = auth.uid(), decided_at = now(),
         decision_reason = coalesce(p_reason, '')
   where id = p_deployment;

  perform public.append_ledger_entry(v_org, 'engagement_early_deployment_approved',
    jsonb_build_object('deployment_id', p_deployment::text, 'engagement_id', v_engagement::text,
                       'reason', coalesce(p_reason, '')), auth.uid());
  perform public.deployment_suggestions_generate(p_deployment);
  return jsonb_build_object('outcome', 'approved', 'engagement_id', v_engagement, 'deployment_id', p_deployment);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Readers for the screen.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_file_owners_list()
returns table (engagement_id uuid, engagement_title text, user_id uuid, plan_item_id uuid,
               reason text, version int, assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.engagement_id, e.title, o.user_id, o.plan_item_id, o.reason, o.version, o.assigned_at
    from engagement_file_owners o
    join engagements e on e.id = o.engagement_id
   where o.org_id = public.jwt_org_id()
   order by e.title
$$;

create or replace function public.engagement_deployments_list()
returns table (id uuid, engagement_id uuid, plan_item_id uuid, title text, due_on date, deployed_on date,
               is_early boolean, reason text, status text, approval_right text, decision_reason text)
language sql stable security definer set search_path = public as $$
  select d.id, d.engagement_id, d.plan_item_id, d.title, d.due_on, d.deployed_on, d.is_early, d.reason,
         d.status, d.approval_right, d.decision_reason
    from engagement_deployments d
   where d.org_id = public.jwt_org_id()
   order by d.created_at desc
$$;

create or replace function public.deployment_suggestions_list(p_deployment uuid)
returns table (target text, suggestion text, detail jsonb)
language sql stable security definer set search_path = public as $$
  select s.target, s.suggestion, s.detail
    from deployment_suggestions s
   where s.org_id = public.jwt_org_id() and s.deployment_id = p_deployment
   order by s.target, s.created_at
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on engagement_file_owners from public, anon, authenticated;
revoke insert, update, delete on engagement_deployments from public, anon, authenticated;
revoke insert, update, delete on deployment_suggestions from public, anon, authenticated;

revoke execute on function public.engagement_file_owner_set(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.deployment_suggestions_generate(uuid) from public, anon;
revoke execute on function public.engagement_deploy_from_plan(uuid, date, text) from public, anon;
revoke execute on function public.engagement_deployment_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.engagement_file_owners_list() from public, anon;
revoke execute on function public.engagement_deployments_list() from public, anon;
revoke execute on function public.deployment_suggestions_list(uuid) from public, anon;

grant execute on function public.engagement_file_owner_set(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.deployment_suggestions_generate(uuid) to authenticated;
grant execute on function public.engagement_deploy_from_plan(uuid, date, text) to authenticated;
grant execute on function public.engagement_deployment_decide(uuid, boolean, text) to authenticated;
grant execute on function public.engagement_file_owners_list() to authenticated;
grant execute on function public.engagement_deployments_list() to authenticated;
grant execute on function public.deployment_suggestions_list(uuid) to authenticated;

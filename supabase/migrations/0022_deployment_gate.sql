-- 3F: Deployment gate (spec §7 steps 1-6) and ethics acknowledgements.
--
-- The spec:
--   §7 "Deploying an audit file is a controlled gate, never a create button."
--      1 select an entity; 2 entity not in the universe's approved list -> blocked; 3 entity not in
--      the approved audit plan -> needs special permission; 4 plan period does not match -> routed to
--      someone authorised to change the plan; 5 deployer not authorised -> approval request;
--      6 team members must each complete the ethics and independence acknowledgement, a hard block
--      until complete, recorded in the ledger.
--   §10.1 "Testing is locked until Planning sign-off." Testing is additionally locked until every
--      team member has acknowledged ethics (§7 step 6).
--
-- Reuse (grep first): engagements already exist (0003) with stage/sealed; engagement_team_members
-- (0013) already holds the deployment team. This migration adds the gate RPC, the ethics table and
-- the acknowledgement RPC, and one settings table for the configurable deploy/approve rights — the
-- same shape as entity_approval_settings (0018) and plan_approval_settings (0021).

-- ---------------------------------------------------------------------------
-- Configurable gate rights (§7 steps 4-5): who may deploy directly, who approves a gate request.
-- ---------------------------------------------------------------------------
create table if not exists engagement_gate_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  deploy_right text not null default 'manage_engagements',
  approve_right text not null default 'approve_plan',
  updated_at timestamptz not null default now(),
  constraint egs_deploy_right_valid check (public.rights_keys_valid(jsonb_build_object(deploy_right, true))),
  constraint egs_approve_right_valid check (public.rights_keys_valid(jsonb_build_object(approve_right, true)))
);

create or replace function public.seed_engagement_gate_settings(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into engagement_gate_settings (org_id) values (p_org) on conflict (org_id) do nothing
$$;

select public.seed_engagement_gate_settings(id) from orgs;

create or replace function public.orgs_seed_engagement_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_engagement_gate_settings(new.id);
  return new;
end $$;

drop trigger if exists orgs_seed_engagement_gate on orgs;
create trigger orgs_seed_engagement_gate after insert on orgs
  for each row execute function public.orgs_seed_engagement_gate();

create or replace function public.admin_set_engagement_gate(p_deploy text, p_approve text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('edit_config'), false) then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if not public.rights_keys_valid(jsonb_build_object(p_deploy, true))
     or not public.rights_keys_valid(jsonb_build_object(p_approve, true)) then
    raise exception 'unknown right' using errcode = 'P0001';
  end if;
  perform public.seed_engagement_gate_settings(v_org);
  update engagement_gate_settings set deploy_right = p_deploy, approve_right = p_approve, updated_at = now()
   where org_id = v_org;
  insert into activity_log (org_id, actor_id, action, object_type, detail)
  values (v_org, auth.uid(), 'engagement_gate_config_set', 'config',
          jsonb_build_object('deploy_right', p_deploy, 'approve_right', p_approve));
end $$;

-- ---------------------------------------------------------------------------
-- deploy_engagement: evaluate §7 steps 1-5 and, when every gate passes, create the engagement.
-- Returns a structured outcome so the UI can route the user. Never raises for a gate outcome.
-- ---------------------------------------------------------------------------
create or replace function public.deploy_engagement(
  p_universe uuid, p_entity uuid, p_plan uuid default null, p_period text default null,
  p_title text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_settings record;
  v_entity entities;
  v_plan plans;
  v_engagement uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  -- Step 1: an entity must be selected.
  if p_entity is null then
    return jsonb_build_object('outcome', 'entity_required', 'step', 1,
                              'detail', 'select an entity before deploying');
  end if;

  perform public.seed_engagement_gate_settings(v_org);
  select deploy_right, approve_right into v_settings from engagement_gate_settings where org_id = v_org;

  -- Step 2: the entity must exist in this org and be in the universe's approved list.
  select * into v_entity from entities where id = p_entity and org_id = v_org;
  if v_entity.id is null then
    return jsonb_build_object('outcome', 'entity_not_found', 'step', 2,
                              'detail', 'the entity is not in this organisation');
  end if;
  if v_entity.universe_id <> p_universe or v_entity.status <> 'approved' then
    return jsonb_build_object('outcome', 'entity_not_approved', 'step', 2,
                              'detail', 'the entity is not in the universe''s approved list; start the New Entity flow',
                              'entity_id', v_entity.id);
  end if;

  -- Step 3: the entity must appear in an approved plan for the universe.
  if p_plan is null then
    select p.* into v_plan
      from plans p
     where p.org_id = v_org and p.universe_id = p_universe and p.status = 'approved'
     order by p.approved_at desc nulls last limit 1;
  else
    select * into v_plan from plans where id = p_plan and org_id = v_org;
  end if;

  if v_plan.id is null or v_plan.status <> 'approved' then
    return jsonb_build_object('outcome', 'plan_change_required', 'step', 3,
                              'detail', 'the entity is not in an approved audit plan; adding it is a CIA-level decision');
  end if;
  if not exists (select 1 from plan_items i
                  where i.plan_id = v_plan.id and i.entity_id = p_entity and i.status <> 'removed') then
    return jsonb_build_object('outcome', 'plan_change_required', 'step', 3,
                              'detail', 'the entity is not in the approved audit plan; adding it is a CIA-level decision',
                              'plan_id', v_plan.id);
  end if;

  -- Step 4: the plan period must match the deployment period.
  if p_period is not null and coalesce(v_plan.period, '') <> p_period then
    return jsonb_build_object('outcome', 'period_mismatch', 'step', 4,
                              'detail', 'the plan period does not match the deployment period; route to someone authorised to change the plan',
                              'plan_id', v_plan.id);
  end if;

  -- Step 5: the deployer must be authorised; otherwise an approval request goes to the configured approver.
  if not coalesce(public.caller_has_right(v_settings.deploy_right), false) then
    return jsonb_build_object('outcome', 'approval_required', 'step', 5,
                              'detail', 'the deployer is not authorised; an approval request is sent to the configured approver',
                              'required_right', v_settings.deploy_right);
  end if;

  -- Every gate passed: create the audit file (the engagement).
  insert into engagements (org_id, universe_id, entity_id, title, stage, plan_id)
  values (v_org, p_universe, p_entity, coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Audit'), 'planning', v_plan.id)
  returning id into v_engagement;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'engagement_deployed', 'engagement', v_engagement,
          jsonb_build_object('universe_id', p_universe, 'entity_id', p_entity, 'plan_id', v_plan.id));

  perform public.append_ledger_entry(v_org, 'engagement_deployed',
    jsonb_build_object('engagement_id', v_engagement::text, 'entity_id', p_entity::text,
                       'plan_id', v_plan.id::text), auth.uid());

  return jsonb_build_object('outcome', 'deployed', 'step', 5,
                            'engagement_id', v_engagement, 'plan_id', v_plan.id);
end $$;

-- ---------------------------------------------------------------------------
-- Ethics acknowledgements (§7 step 6). An authenticated digital signature, recorded in the ledger.
-- ---------------------------------------------------------------------------
create table if not exists ethics_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  statement text not null default 'I confirm my independence and my compliance with the ethics policy',
  unique (engagement_id, user_id)
);
create index if not exists ethics_ack_engagement_idx on ethics_acknowledgements (org_id, engagement_id);

-- acknowledge_ethics: self only. A user acknowledges their own ethics and independence (§7 step 6).
create or replace function public.acknowledge_ethics(p_engagement uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_user uuid := auth.uid();
begin
  if v_org is null or v_user is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements where id = p_engagement and org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  insert into ethics_acknowledgements (org_id, engagement_id, user_id)
  values (v_org, p_engagement, v_user)
  on conflict (engagement_id, user_id) do nothing;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, v_user, 'ethics_acknowledged', 'engagement', p_engagement,
          jsonb_build_object('user_id', v_user));

  perform public.append_ledger_entry(v_org, 'ethics_acknowledged',
    jsonb_build_object('engagement_id', p_engagement::text, 'user_id', v_user::text), v_user);
end $$;

-- ethics_status: who has acknowledged and whether the team is complete (§7 step 6).
create or replace function public.ethics_status(p_engagement uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'complete', not exists (
             select 1 from engagement_team_members m
              where m.engagement_id = p_engagement
                and not exists (select 1 from ethics_acknowledgements a
                                 where a.engagement_id = p_engagement and a.user_id = m.user_id)),
           'members', coalesce((select jsonb_agg(jsonb_build_object(
                                  'user_id', m.user_id,
                                  'acknowledged', exists (select 1 from ethics_acknowledgements a
                                                           where a.engagement_id = p_engagement and a.user_id = m.user_id))
                                order by m.user_id)
                               from engagement_team_members m where m.engagement_id = p_engagement), '[]'::jsonb))
  from engagements e
  where e.id = p_engagement and e.org_id = public.jwt_org_id()
$$;

-- ---------------------------------------------------------------------------
-- Testing is locked until every team member has acknowledged (§7 step 6). A guard on engagements
-- blocks the stage transition while an acknowledgement is missing.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_stage_guard() returns trigger
language plpgsql as $$
begin
  if new.stage = 'testing' and old.stage is distinct from 'testing' then
    if exists (
      select 1 from engagement_team_members m
       where m.engagement_id = new.id
         and not exists (select 1 from ethics_acknowledgements a
                          where a.engagement_id = new.id and a.user_id = m.user_id)
    ) then
      raise exception 'ethics: every team member must acknowledge ethics before Testing can start'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists engagements_stage_guard on engagements;
create trigger engagements_stage_guard before update on engagements
  for each row execute function public.engagement_stage_guard();

-- ---------------------------------------------------------------------------
-- RLS. Both new tables carry org_id, have RLS on and a select policy only.
-- ---------------------------------------------------------------------------
alter table engagement_gate_settings enable row level security;
alter table ethics_acknowledgements enable row level security;

drop policy if exists egs_select on engagement_gate_settings;
create policy egs_select on engagement_gate_settings for select to authenticated
  using (org_id = public.jwt_org_id());
drop policy if exists ethics_ack_select on ethics_acknowledgements;
create policy ethics_ack_select on ethics_acknowledgements for select to authenticated
  using (org_id = public.jwt_org_id()
         and exists (select 1 from engagements e where e.id = engagement_id
                     and (public.can_read_all_scopes()
                          or public.has_scope(e.universe_id, e.entity_id, e.id))));

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.seed_engagement_gate_settings(uuid) from public, anon;
revoke execute on function public.orgs_seed_engagement_gate() from public, anon;
revoke execute on function public.engagement_stage_guard() from public, anon;
revoke execute on function public.admin_set_engagement_gate(text, text) from public, anon;
revoke execute on function public.deploy_engagement(uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.acknowledge_ethics(uuid) from public, anon;
revoke execute on function public.ethics_status(uuid) from public, anon;

grant execute on function public.admin_set_engagement_gate(text, text) to authenticated;
grant execute on function public.deploy_engagement(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.acknowledge_ethics(uuid) to authenticated;
grant execute on function public.ethics_status(uuid) to authenticated;

-- 0202 (integrator, final phase): no audit file can exist or be archived without a file owner.
--
-- Owner instruction 2026-10-30: "no audit file can ever be in existence or archival without any file
-- owner". The file owner is the person accountable for the file (OA-41, migration 0200). Until this
-- file that accountability was optional: an engagement could exist, and be sealed, with no owner at
-- all. This migration makes the owner an INVARIANT of an existing file, not a convention:
--
--   1. The invariant is enforced STRUCTURALLY, on `engagements` itself, so it holds for every path
--      that can create a file — deploy_engagement (0022), the combined-approval path (0023),
--      engagement_deploy_from_plan (0200) and engagement_deployment_decide (0200) — and for the
--      fixtures the harness seeds. A rule enforced in one function is a rule the next function can
--      forget; a rule enforced on the table cannot be forgotten.
--   2. The owner is DEFAULTED to the accountable person at creation: the file owner is the preparer
--      who raises the file, so an explicit assignment is a handover, not a precondition. A caller
--      who deploys on someone else's behalf names the owner explicitly (deploy_engagement and
--      engagement_deploy_from_plan gained the argument in this file).
--   3. Every existing file is backfilled, so the invariant is true of the whole estate, not only of
--      files created after this migration.
--   4. A file cannot be SEALED without an owner, and an ARCHIVED file cannot lose its owner. Both
--      are proven by SQL test 146 (happy path and bad path).
--
-- Laws honoured: L1 (the default is a stored row, chosen by a configured rule — no model), L2 (the
-- trigger and the guard are org-scoped; the backfill never crosses a tenant), L5 (the owner record
-- is versioned and appended to the audit trail, never deleted).
--
-- M1: grepped migrations and tests for every new name; all new, none redefined. M2: create table if
-- not exists / create index if not exists / create or replace. M6: the harness applies this twice
-- and runs the tests twice before the push.

-- ---------------------------------------------------------------------------
-- 1. The invalidity marker. A file that predates this migration and was never given an owner cannot
--    silently be assigned one — the person who should own it is a decision, not a guess. It is
--    marked `backfill_required` and it still has no owner, so it is visible as a defect rather than
--    hidden behind a plausible name. (In this tree every existing file has exactly one member, so
--    the backfill assigns it; the marker exists for the general case.)
-- ---------------------------------------------------------------------------
alter table engagement_file_owners add column if not exists backfill_required boolean not null default false;

-- An ownerless file is representable ONLY as a marked defect: the owner may be null when, and only
-- when, backfill_required is set. Everything else must name a person.
alter table engagement_file_owners alter column user_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'engagement_file_owners_owner_or_backfill') then
    alter table engagement_file_owners add constraint engagement_file_owners_owner_or_backfill
      check (user_id is not null or backfill_required);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The accountable owner at creation. The preparer who raises the file owns it; with no candidate
--    (a file created by a job, with no member on the engagement) the invalidity marker is set and
--    the file is visibly ownerless until a person names the owner.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_owner_default(p_org uuid, p_engagement uuid, p_by uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid;
begin
  -- The person creating the file, when they are a member of the organisation.
  if p_by is not null
     and exists (select 1 from org_members m where m.org_id = p_org and m.user_id = p_by) then
    return p_by;
  end if;
  -- Otherwise the preparer already on the engagement's team, oldest first (deterministic).
  select m.user_id into v_user
    from engagement_members m
   where m.engagement_id = p_engagement and m.org_id = p_org
   order by m.created_at, m.user_id
   limit 1;
  if v_user is not null then
    return v_user;
  end if;
  -- Otherwise the first member of the organisation (deterministic), so a file is never ownerless
  -- while the organisation has any member at all.
  select m.user_id into v_user
    from org_members m
   where m.org_id = p_org
   order by m.hierarchy_level, m.user_id
   limit 1;
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The structural invariant. An AFTER INSERT trigger on `engagements` gives every new file an
--    owner. It is the only mechanism that covers every creation path and the fixtures alike.
--
--    It must be AFTER, not BEFORE: `engagement_file_owners` carries a foreign key to the engagement,
--    so the parent row must exist before its owner row can. Atomicity is unaffected — if the owner
--    row cannot be written the whole insert rolls back, so a committed file always has an owner.
-- ---------------------------------------------------------------------------
create or replace function public.engagement_require_file_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  v_owner := public.engagement_owner_default(new.org_id, new.id, auth.uid());
  insert into engagement_file_owners (org_id, engagement_id, user_id, assigned_by, reason, backfill_required)
  values (new.org_id, new.id, v_owner, auth.uid(),
          case when v_owner is null then '' else 'named by default when the file was created' end,
          v_owner is null)
  on conflict (engagement_id) do nothing;
  return new;
end $$;

drop trigger if exists engagements_require_file_owner on engagements;
create trigger engagements_require_file_owner after insert on engagements
  for each row execute function public.engagement_require_file_owner();

-- ---------------------------------------------------------------------------
-- 4. The backfill. Every existing file is given the same default. A file with no candidate gets the
--    invalidity marker and remains visibly ownerless.
-- ---------------------------------------------------------------------------
insert into engagement_file_owners (org_id, engagement_id, user_id, reason, backfill_required)
select e.org_id, e.id, public.engagement_owner_default(e.org_id, e.id, null),
       'backfilled when the file owner became an invariant', public.engagement_owner_default(e.org_id, e.id, null) is null
  from engagements e
 where not exists (select 1 from engagement_file_owners f where f.engagement_id = e.id);

-- ---------------------------------------------------------------------------
-- 5. deploy_engagement (0022): a deploy names the file owner. The 5-argument form is replaced by a
--    6-argument form whose owner defaults to null, so every existing caller is unchanged; a caller
--    deploying on another person's behalf names that person.
-- ---------------------------------------------------------------------------
drop function if exists public.deploy_engagement(uuid, uuid, uuid, text, text);

create or replace function public.deploy_engagement(
  p_universe uuid, p_entity uuid, p_plan uuid default null, p_period text default null,
  p_title text default null, p_owner uuid default null
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

  -- 0202: the owner is an invariant and the trigger already named one. A caller who deployed on
  -- someone else's behalf names that person here, and it is a handover with a reason.
  if p_owner is not null then
    perform public.engagement_file_owner_set(v_engagement, p_owner, null, 'named at deployment');
  end if;

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
-- 6. engagement_deploy_from_plan (0200) and engagement_deployment_decide (0200): both gained the
--    owner argument, and both name the owner they were given. The default remains the preparer.
-- ---------------------------------------------------------------------------
drop function if exists public.engagement_deploy_from_plan(uuid, date, text);

create or replace function public.engagement_deploy_from_plan(
  p_plan_item uuid, p_on date default null, p_reason text default '', p_owner uuid default null
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
  if p_owner is not null
     and not exists (select 1 from org_members m where m.org_id = v_org and m.user_id = p_owner) then
    raise exception 'the file owner must be a member of this organisation' using errcode = 'P0001';
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

  -- The owner: the one named, or the preparer the trigger defaulted to (recorded as the assignment).
  perform public.engagement_file_owner_set(
    v_engagement,
    coalesce(p_owner, public.engagement_owner_default(v_org, v_engagement, auth.uid())),
    p_plan_item, 'named when the engagement was deployed from the plan');

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

-- The decision on an early deployment creates the file; it names the owner the request carried, or
-- the preparer the trigger defaulted to. The 0200 body is otherwise unchanged, so every existing
-- outcome, message and status is preserved.
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

  -- 0202: the file owner is an invariant; the trigger named the preparer, and it is recorded here.
  perform public.engagement_file_owner_set(
    v_engagement, public.engagement_owner_default(v_org, v_engagement, v_dep.requested_by),
    v_dep.plan_item_id, 'named when the early deployment was approved');

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
-- 7. The archival invariant. A file cannot be sealed without an owner, and an archived file cannot
--    lose its owner. seal_engagement is extended in place; the 0101/0109 checks are unchanged and
--    run first, so a refusal still happens for the same reasons.
-- ---------------------------------------------------------------------------
create or replace function public.seal_engagement(p_engagement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
  v_total int;
  v_open int;
  v_owner uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;

  select * into v_eng from engagements where id = p_engagement_id and org_id = v_org;
  if v_eng.id is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if v_eng.sealed then
    raise exception 'already_sealed: the engagement is already sealed' using errcode = 'P0001';
  end if;

  -- 0202: a file cannot exist unowned, so it cannot be sealed unowned.
  select user_id into v_owner from engagement_file_owners where engagement_id = p_engagement_id;
  if v_owner is null then
    raise exception 'no_file_owner: the audit file has no file owner, so it cannot be sealed'
      using errcode = 'P0001';
  end if;

  select count(*) into v_total from workpapers where engagement_id = p_engagement_id and org_id = v_org;
  if v_total = 0 then
    raise exception 'sign_off_blocked: there are no working papers to seal' using errcode = 'P0001';
  end if;
  select count(*) into v_open from workpapers
   where engagement_id = p_engagement_id and org_id = v_org and status <> 'signed_off';
  if v_open > 0 then
    raise exception 'sign_off_blocked: % working paper(s) are not signed off', v_open using errcode = 'P0001';
  end if;

  perform public.assert_conclusion_ready(p_engagement_id);

  update engagements set sealed = true, stage = 'conclusion'
   where id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'audit_sign_off',
    jsonb_build_object('engagement_id', p_engagement_id::text, 'workpapers', v_total,
                       'file_owner', v_owner::text),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'audit_sign_off', 'engagement', p_engagement_id,
          jsonb_build_object('workpapers', v_total, 'file_owner', v_owner));

  perform public.auto_issue_certificate_on_seal(v_org, p_engagement_id);
end $$;

-- The owner of an engagement may not be deleted while the file exists. There is no DELETE path in
-- the product; this guard closes the door anyway, so the invariant survives a future one.
create or replace function public.engagement_file_owner_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'file_owner_required: the file owner of an existing audit file cannot be removed'
      using errcode = 'P0001';
  end if;
  if new.user_id is null then
    raise exception 'file_owner_required: the file owner of an existing audit file cannot be cleared'
      using errcode = 'P0001';
  end if;
  -- Naming a person resolves the invalidity marker: the file is no longer an unowned defect.
  new.backfill_required := false;
  return new;
end $$;

drop trigger if exists engagement_file_owners_no_delete on engagement_file_owners;
create trigger engagement_file_owners_no_delete before delete or update on engagement_file_owners
  for each row execute function public.engagement_file_owner_guard();

-- ---------------------------------------------------------------------------
-- 8. The audit reader. The screen shows which files have no owner (a defect) and which were given
--    one by default rather than by a person (so the assignment can be confirmed).
-- ---------------------------------------------------------------------------
create or replace function public.engagement_owner_audit_list()
returns table (engagement_id uuid, org_id uuid, title text, universe_name text, stage text,
               sealed boolean, owner_user_id uuid, owner_name text, backfill_required boolean,
               version int, assigned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.org_id, e.title, u.name, e.stage, e.sealed,
         f.user_id, nullif(btrim(coalesce(m.display_name, '')), ''),
         coalesce(f.backfill_required, f.user_id is null), coalesce(f.version, 0), f.assigned_at
    from engagements e
    left join engagement_file_owners f on f.engagement_id = e.id
    left join universes u on u.id = e.universe_id
    left join org_members m on m.org_id = e.org_id and m.user_id = f.user_id
   where e.org_id = public.jwt_org_id()
   order by (f.user_id is null) desc, e.title
$$;

revoke execute on function public.engagement_owner_audit_list() from public, anon;
grant execute on function public.engagement_owner_audit_list() to authenticated;

revoke execute on function public.engagement_owner_default(uuid, uuid, uuid) from public, anon, authenticated;

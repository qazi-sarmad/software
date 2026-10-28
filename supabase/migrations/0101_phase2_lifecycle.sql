-- 0101 phase2 lifecycle — make the engagement lifecycle and its governance settings real.
--
-- Phase 2 of docs/SCALE-TASKS.md. Four settings were stored and versioned but no code ever read
-- them, and the lifecycle itself had no durable path:
--
--   2.1 engagements.stage was only ever changed in React state (AppContext.signOffEngagement). There
--       was no RPC that writes stage, so planning -> testing -> conclusion was a UI illusion. This
--       migration adds set_engagement_stage() with an append-only transition log.
--   2.2 org_lifecycle_settings.signoff_role_planning / _testing / _conclusion were saved and never
--       read. sign_planning() / sign_conclusion() now require the configured team role.
--   2.3 org_lifecycle_settings.testing_mode (one_stage / two_stage) had no behavioural effect. The
--       stage transition to 'conclusion' now enforces it.
--   2.4 workflow_settings.approval_chain was stored and never consulted. approve_plan() now requires
--       every step of the chain to be recorded, in order, before the plan can be approved.
--
-- Reuse (grep first): engagements.stage and its CHECK (0003), the testing-lock trigger
-- (0025/0095 guard_testing_lock + testing_lock_active), the ethics guard (0022
-- engagement_stage_guard), team_role_rights (0013, team role -> rights), is_head (0095),
-- append_ledger_entry (0011), pin_org_id (0009). Nothing is redefined; every function below is a
-- create or replace of a name that did not exist, except sign_planning / sign_conclusion /
-- approve_plan, which are extended in place and keep their signatures.
--
-- M2: create table if not exists / add column if not exists / create or replace, so a second apply
-- is a no-op. M8: one client. Grants: application roles only.

-- ---------------------------------------------------------------------------
-- 1. The transition log (2.1). Append-only: a row per legal stage change, with the actor and the
--    from/to stages. The guard below refuses any UPDATE or DELETE, so the history cannot be rewritten.
-- ---------------------------------------------------------------------------
create table if not exists engagement_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  from_stage text null,
  to_stage text not null,
  note text null,
  actor_id uuid null,
  created_at timestamptz not null default now()
);
create index if not exists est_engagement_idx
  on engagement_stage_transitions (org_id, engagement_id, created_at);

-- Append-only. A transition is a historical fact; editing it would break the audit trail.
create or replace function public.guard_stage_transition_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'engagement_stage_transitions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists engagement_stage_transitions_immutable on engagement_stage_transitions;
create trigger engagement_stage_transitions_immutable
  before update or delete on engagement_stage_transitions
  for each row execute function public.guard_stage_transition_immutable();

drop trigger if exists engagement_stage_transitions_pin_org on engagement_stage_transitions;
create trigger engagement_stage_transitions_pin_org before insert on engagement_stage_transitions
  for each row execute function public.pin_org_id();

alter table engagement_stage_transitions enable row level security;
drop policy if exists est_select on engagement_stage_transitions;
create policy est_select on engagement_stage_transitions for select to authenticated
  using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- 2. Team-role helpers (2.2). A team role names a set of rights (team_role_rights, 0013).
--    caller_holds_team_role_rights is true when the caller holds every right the role confers.
-- ---------------------------------------------------------------------------
create or replace function public.caller_holds_team_role_rights(p_team_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_and(public.caller_has_right(e.key)), false)
  from team_role_rights t
  cross join lateral jsonb_each_text(t.rights) e(key, value)
  where t.team_role = p_team_role and (e.value)::boolean
$$;

create or replace function public.engagement_has_team_role(p_engagement_id uuid, p_team_role text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from engagement_team_members m
     where m.engagement_id = p_engagement_id and m.org_id = public.jwt_org_id()
       and m.team_role = p_team_role)
$$;

create or replace function public.caller_is_engagement_team_role(p_engagement_id uuid, p_team_role text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from engagement_team_members m
     where m.engagement_id = p_engagement_id and m.org_id = public.jwt_org_id()
       and m.user_id = auth.uid() and m.team_role = p_team_role)
$$;

-- The sign-off rule (§10.4: "every stage sign-off requires review by a role configured for that
-- stage"). The caller must hold the configured team role's rights; and when the engagement has a
-- member in that role, the caller must be that member. So assigning a reviewer to an engagement
-- genuinely narrows who may sign, and leaving the engagement team empty falls back to the rights
-- the role confers (the CIA's review_and_approve still signs, exactly as before).
create or replace function public.caller_meets_signoff_role(p_engagement_id uuid, p_signoff_role text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_signoff_role is null then
    return true;
  end if;
  if not public.caller_holds_team_role_rights(p_signoff_role) then
    return false;
  end if;
  if public.engagement_has_team_role(p_engagement_id, p_signoff_role) then
    return public.caller_is_engagement_team_role(p_engagement_id, p_signoff_role);
  end if;
  return true;
end $$;

-- assert_conclusion_ready (2.3): the testing_mode rule, shared by set_engagement_stage and
-- seal_engagement. In two-stage testing the design (DEA) and operating (OET) workpapers must both
-- exist and be signed off; in one-stage testing only the operating workpaper is required. The mode
-- is read here, in the database, so the setting has a real effect.
create or replace function public.assert_conclusion_ready(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_mode text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select coalesce(s.testing_mode, 'two_stage') into v_mode
    from (select 1) x left join org_lifecycle_settings s on s.org_id = v_org;

  if exists (select 1 from workpapers w where w.engagement_id = p_engagement_id and w.org_id = v_org
              and coalesce(w.test_phase, 'oet') = 'oet' and w.status <> 'signed_off') then
    raise exception 'testing_incomplete: the operating (OET) workpaper is not signed off' using errcode = 'P0001';
  end if;

  if v_mode = 'two_stage' then
    if not exists (select 1 from workpapers w where w.engagement_id = p_engagement_id and w.org_id = v_org
                    and coalesce(w.test_phase, 'oet') = 'dea') then
      raise exception 'two_stage_testing: a design-effectiveness (DEA) workpaper is required before Conclusion'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from workpapers w where w.engagement_id = p_engagement_id and w.org_id = v_org
                and coalesce(w.test_phase, 'oet') = 'dea' and w.status <> 'signed_off') then
      raise exception 'testing_incomplete: the design (DEA) workpaper is not signed off' using errcode = 'P0001';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. set_engagement_stage (2.1 + 2.3). The one write path for engagements.stage.
--    p_expected_stage is optimistic concurrency: the caller states the stage it saw, and the
--    transition is refused if the row has moved. Legal moves are forward only
--    (planning -> testing -> conclusion); a reopen is reopen_engagement(), not a backward stage move.
-- ---------------------------------------------------------------------------
create or replace function public.set_engagement_stage(
  p_engagement_id uuid, p_to_stage text, p_expected_stage text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_to_stage not in ('planning', 'testing', 'conclusion') then
    raise exception 'unknown stage: %', p_to_stage using errcode = 'P0001';
  end if;

  select * into v_eng from engagements where id = p_engagement_id and org_id = v_org;
  if v_eng.id is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if p_expected_stage is not null and v_eng.stage is distinct from p_expected_stage then
    raise exception 'stage_conflict: the engagement is at % but % was expected', v_eng.stage, p_expected_stage
      using errcode = 'P0001';
  end if;
  if v_eng.stage = p_to_stage then
    raise exception 'no_change: the engagement is already at %', p_to_stage using errcode = 'P0001';
  end if;

  -- Forward only. planning(1) < testing(2) < conclusion(3).
  if array_position(array['planning', 'testing', 'conclusion'], p_to_stage)
     < array_position(array['planning', 'testing', 'conclusion'], v_eng.stage) then
    raise exception 'illegal_transition: % -> % is not a forward stage move', v_eng.stage, p_to_stage
      using errcode = 'P0001';
  end if;

  -- §10.1: Testing is locked until Planning sign-off (honouring the org's grace period, exactly as
  -- the workpaper trigger does). The workpapers guard covers workpaper rows; the engagement row
  -- itself needs this check.
  if p_to_stage = 'testing' and public.testing_lock_active(p_engagement_id) then
    raise exception 'testing_locked: planning must be signed off before testing (engagement %)', p_engagement_id
      using errcode = 'P0001';
  end if;

  -- 2.3: testing_mode. Two-stage testing needs a design (DEA) and an operating (OET) workpaper,
  -- both signed off, before Conclusion. One-stage needs only the operating workpaper.
  if p_to_stage = 'conclusion' then
    perform public.assert_conclusion_ready(p_engagement_id);
  end if;

  -- The UPDATE fires the existing guards: engagement_stage_guard (ethics, 0022) and
  -- workpapers_testing_lock / testing_lock_active (0025/0095) for a workpaper move. The engagement
  -- row itself is guarded by engagement_stage_guard on 'testing'.
  update engagements set stage = p_to_stage where id = p_engagement_id and org_id = v_org;

  insert into engagement_stage_transitions (org_id, engagement_id, from_stage, to_stage, actor_id)
  values (v_org, p_engagement_id, v_eng.stage, p_to_stage, auth.uid());

  perform public.append_ledger_entry(v_org, 'stage_changed',
    jsonb_build_object('engagement_id', p_engagement_id::text, 'from', v_eng.stage, 'to', p_to_stage),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'stage_changed', 'engagement', p_engagement_id,
          jsonb_build_object('from', v_eng.stage, 'to', p_to_stage));
end $$;

-- ---------------------------------------------------------------------------
-- 4. approval_chain (2.4). workflow_settings.approval_chain is an ordered array of
--    {"role": <slug>} steps. Before a plan can be approved, every step must be recorded in order by
--    a caller holding that role (an organisation role slug, or the special 'head' for is_head()).
--    With the default empty chain the gate is inactive, so existing flows are unchanged.
-- ---------------------------------------------------------------------------
create table if not exists approval_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  step_index int not null,
  role_slug text not null,
  decided_by uuid null,
  decided_at timestamptz not null default now(),
  unique (subject_type, subject_id, step_index)
);
create index if not exists approval_steps_subject_idx on approval_steps (org_id, subject_type, subject_id);

drop trigger if exists approval_steps_pin_org on approval_steps;
create trigger approval_steps_pin_org before insert on approval_steps
  for each row execute function public.pin_org_id();

alter table approval_steps enable row level security;
drop policy if exists approval_steps_select on approval_steps;
create policy approval_steps_select on approval_steps for select to authenticated
  using (org_id = public.jwt_org_id());

-- The caller's organisation role slug (roles.slug for the member's role_id).
create or replace function public.caller_role_slug() returns text
language sql stable security definer set search_path = public as $$
  select r.slug from org_members m join roles r on r.id = m.role_id
   where m.org_id = public.jwt_org_id() and m.user_id = auth.uid()
$$;

create or replace function public.approval_chain_for(p_org_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select w.approval_chain from workflow_settings w where w.org_id = p_org_id), '[]'::jsonb)
$$;

-- True when the chain is empty, or every step has been recorded in order.
create or replace function public.approval_chain_ready(
  p_org_id uuid, p_subject_type text, p_subject_id uuid
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_chain jsonb := public.approval_chain_for(p_org_id);
  v_len int := jsonb_array_length(public.approval_chain_for(p_org_id));
  v_done int;
begin
  if v_chain is null or v_len = 0 then
    return true;
  end if;
  select count(*) into v_done from approval_steps
   where org_id = p_org_id and subject_type = p_subject_type and subject_id = p_subject_id
     and step_index < v_len;
  return v_done >= v_len;
end $$;

-- Record the caller's approval for the next step of the chain. The step's role must be the caller's
-- organisation role slug, or 'head' for a caller who is a Head (is_head(1)).
create or replace function public.approval_step_decide(p_subject_type text, p_subject_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_chain jsonb;
  v_len int;
  v_next int;
  v_role text;
  v_slug text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  v_chain := public.approval_chain_for(v_org);
  v_len := jsonb_array_length(v_chain);
  if v_len = 0 then
    raise exception 'no approval chain is configured' using errcode = 'P0001';
  end if;
  select coalesce(max(step_index) + 1, 0) into v_next from approval_steps
   where org_id = v_org and subject_type = p_subject_type and subject_id = p_subject_id;
  if v_next >= v_len then
    raise exception 'the approval chain is already complete' using errcode = 'P0001';
  end if;
  v_role := v_chain -> v_next ->> 'role';
  v_slug := public.caller_role_slug();
  if not ((v_role = v_slug) or (v_role = 'head' and coalesce(public.is_head(1), false))) then
    raise exception 'approval_step: step % requires role %', v_next + 1, v_role using errcode = 'P0001';
  end if;
  insert into approval_steps (org_id, subject_type, subject_id, step_index, role_slug, decided_by)
  values (v_org, p_subject_type, p_subject_id, v_next, v_role, auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'approval_step', p_subject_type, p_subject_id,
          jsonb_build_object('step_index', v_next, 'role', v_role));
  return v_next + 1;
end $$;

-- approve_plan, extended in place: the chain gate runs after the right check and before the write.
create or replace function public.approve_plan(p_plan uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_right text;
  v_status text;
  v_version int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  perform public.seed_plan_approval_settings(v_org);
  select approve_right into v_right from plan_approval_settings where org_id = v_org;
  if not coalesce(public.caller_has_right(v_right), false) then
    raise exception 'not allowed: caller lacks the % right', v_right using errcode = 'P0001';
  end if;
  select status into v_status from plans where id = p_plan and org_id = v_org;
  if v_status is null then
    raise exception 'plan not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'approved' then
    raise exception 'plan is already approved' using errcode = 'P0001';
  end if;
  if exists (select 1 from plan_items where plan_id = p_plan and status = 'pending_adhoc') then
    raise exception 'a plan with a pending ad-hoc item cannot be approved' using errcode = 'P0001';
  end if;
  -- 2.4: the workflow approval chain must be satisfied first.
  if not public.approval_chain_ready(v_org, 'plan', p_plan) then
    raise exception 'approval_chain: every configured approval step must be recorded before the plan is approved'
      using errcode = 'P0001';
  end if;
  update plans set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_plan and org_id = v_org;
  v_version := public.snapshot_plan_version(p_plan, 'approved');
  perform public.append_ledger_entry(v_org, 'plan_approved',
    jsonb_build_object('plan_id', p_plan::text, 'version', v_version), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'plan_approved', 'plan', p_plan, jsonb_build_object('version', v_version));
  return v_version;
end $$;

-- ---------------------------------------------------------------------------
-- 5. test_phase (2.3). Two-stage testing has a design (DEA) and an operating (OET) workpaper; one
--    stage has only the operating workpaper. Default 'oet' keeps every existing workpaper valid.
-- ---------------------------------------------------------------------------
alter table workpapers add column if not exists test_phase text not null default 'oet';
alter table workpapers drop constraint if exists workpapers_test_phase_chk;
alter table workpapers add constraint workpapers_test_phase_chk check (test_phase in ('dea', 'oet'));

-- ---------------------------------------------------------------------------
-- 6. sign_planning (2.2), extended in place: after the right check, the caller must meet the
--    configured signoff_role_planning. Body is the 0044 definition plus the one new check.
-- ---------------------------------------------------------------------------
create or replace function public.sign_planning(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sections int;
  v_self int;
  v_unconfirmed int;
  v_role text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  select coalesce(s.signoff_role_planning, 'reviewer') into v_role
    from (select 1) x left join org_lifecycle_settings s on s.org_id = v_org;
  if not public.caller_meets_signoff_role(p_engagement_id, v_role) then
    raise exception 'signoff_role: planning sign-off requires the % team role', v_role using errcode = 'P0001';
  end if;
  if public.planning_signed_off(p_engagement_id) then
    raise exception 'planning_locked: planning sections are already signed off' using errcode = 'P0001';
  end if;

  select count(*) into v_sections from planning_sections
   where engagement_id = p_engagement_id and org_id = v_org;
  if v_sections = 0 then
    raise exception 'no planning sections to sign off' using errcode = 'P0001';
  end if;

  select count(*) into v_self from planning_sections
   where engagement_id = p_engagement_id and org_id = v_org and prepared_by = auth.uid();
  if v_self = v_sections then
    raise exception 'four_eyes: the signer prepared every planning section' using errcode = 'P0001';
  end if;

  if not public.check_planning_reconciliation(p_engagement_id)
     and not exists (select 1 from planning_reconciliation_acks a
                     where a.engagement_id = p_engagement_id and a.org_id = v_org) then
    raise exception 'planning_reconciliation: risks do not match the current SIRA and no discrepancy is acknowledged'
      using errcode = 'P0001';
  end if;

  v_unconfirmed := public.unconfirmed_prior_year_imports(p_engagement_id);
  if v_unconfirmed > 0 then
    raise exception 'unconfirmed_imports: % prior-year item(s) are imported but not confirmed', v_unconfirmed
      using errcode = 'P0001';
  end if;

  update planning_sections
     set signed_off_at = now(), signed_off_by = auth.uid()
   where engagement_id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'planning_signed_off',
    jsonb_build_object('engagement_id', p_engagement_id, 'sections', v_sections), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'planning_signed_off', 'engagement', p_engagement_id,
          jsonb_build_object('sections', v_sections));
end $$;

-- ---------------------------------------------------------------------------
-- 7. sign_conclusion (2.2), extended in place: after the right check, the caller must meet the
--    configured signoff_role_conclusion. Body is the 0034 definition plus the one new check.
-- ---------------------------------------------------------------------------
create or replace function public.sign_conclusion(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec conclusion_records;
  v_opinion_required boolean;
  v_role text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  select coalesce(s.signoff_role_conclusion, 'reviewer') into v_role
    from (select 1) x left join org_lifecycle_settings s on s.org_id = v_org;
  if not public.caller_meets_signoff_role(p_engagement_id, v_role) then
    raise exception 'signoff_role: conclusion sign-off requires the % team role', v_role using errcode = 'P0001';
  end if;

  select * into v_rec from conclusion_records c
   where c.engagement_id = p_engagement_id and c.org_id = v_org;
  if v_rec.id is null then
    raise exception 'conclusion_missing: pull the Testing exceptions before signing off'
      using errcode = 'P0001';
  end if;
  if v_rec.locked_at is not null then
    raise exception 'conclusion_locked: the conclusion is already signed off' using errcode = 'P0001';
  end if;

  if v_rec.prepared_by is not null and v_rec.prepared_by = auth.uid() then
    raise exception 'four_eyes: the signer pulled the exceptions' using errcode = 'P0001';
  end if;

  select coalesce((select (v.value)::boolean from config_versions v
                    where v.org_id = v_org and v.key = 'conclusion.opinion_required'
                    order by v.version desc limit 1), false)
    into v_opinion_required;
  if v_opinion_required and nullif(btrim(coalesce(v_rec.overall_opinion, '')), '') is null then
    raise exception 'opinion_required: this organisation requires an overall opinion before sign-off'
      using errcode = 'P0001';
  end if;

  update conclusion_records c
     set signed_off_at = now(), signed_off_by = auth.uid(), locked_at = now()
   where c.id = v_rec.id;

  update engagements set sealed = true where id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'conclusion_signed_off',
    jsonb_build_object('engagement_id', p_engagement_id,
                       'exceptions', jsonb_array_length(v_rec.exceptions)), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'conclusion_signed_off', 'engagement', p_engagement_id,
          jsonb_build_object('exceptions', jsonb_array_length(v_rec.exceptions)));
end $$;

-- ---------------------------------------------------------------------------
-- 8. seal_engagement (2.3), extended in place: the same testing_mode rule that gates the Conclusion
--    stage transition also gates the file seal, so the two paths cannot disagree. Body is the 0100
--    definition plus the assert_conclusion_ready call.
-- ---------------------------------------------------------------------------
create or replace function public.seal_engagement(p_engagement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
  v_total int;
  v_open int;
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
    jsonb_build_object('engagement_id', p_engagement_id::text, 'workpapers', v_total),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'audit_sign_off', 'engagement', p_engagement_id,
          jsonb_build_object('workpapers', v_total));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.assert_conclusion_ready(uuid) from public, anon;
revoke execute on function public.guard_stage_transition_immutable() from public, anon;
revoke execute on function public.caller_holds_team_role_rights(text) from public, anon;
revoke execute on function public.engagement_has_team_role(uuid, text) from public, anon;
revoke execute on function public.caller_is_engagement_team_role(uuid, text) from public, anon;
revoke execute on function public.caller_meets_signoff_role(uuid, text) from public, anon;
revoke execute on function public.set_engagement_stage(uuid, text, text) from public, anon;
revoke execute on function public.caller_role_slug() from public, anon;
revoke execute on function public.approval_chain_for(uuid) from public, anon;
revoke execute on function public.approval_chain_ready(uuid, text, uuid) from public, anon;
revoke execute on function public.approval_step_decide(text, uuid) from public, anon;

grant execute on function public.caller_holds_team_role_rights(text) to authenticated;
grant execute on function public.assert_conclusion_ready(uuid) to authenticated;
grant execute on function public.engagement_has_team_role(uuid, text) to authenticated;
grant execute on function public.caller_is_engagement_team_role(uuid, text) to authenticated;
grant execute on function public.caller_meets_signoff_role(uuid, text) to authenticated;
grant execute on function public.set_engagement_stage(uuid, text, text) to authenticated;
grant execute on function public.caller_role_slug() to authenticated;
grant execute on function public.approval_chain_for(uuid) to authenticated;
grant execute on function public.approval_chain_ready(uuid, text, uuid) to authenticated;
grant execute on function public.approval_step_decide(text, uuid) to authenticated;

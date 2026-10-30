-- 0114 (Phase 5, C4/C5/C6): act on an alert — raise an ad-hoc audit, remediate, and triage.
--
-- C3 (0113) delivered a firing alert to the people who can triage it. This migration gives those
-- people the things to DO with it, all pre-filled from the enrichment C2 (0112) already resolved, so
-- nobody retypes what the platform already knows:
--
--   C4  alert_adhoc_suggestion / alert_adhoc_audit_raise — an ad-hoc audit suggestion pre-filled
--       with the alert's entity, department and controls, raised as a pending ad-hoc plan item
--       through the existing add_plan_item (0021), which keeps the approval rule intact.
--   C5  alert_raise_finding — an observation with the four mandatory readability sections pre-filled
--       from the alert, promoted to a finding through the existing promote_to_finding (0030).
--       alert_raise_cap — a CAP row on the register (0038); the register has a select policy and no
--       tenant insert path, so this RPC is the only honest way to add one.
--       alert_request_evidence — an evidence request recorded against the alert, so "request
--       evidence" is a real, listable object rather than a notification that vanishes.
--       alert_escalate — an escalated alert becomes an observation, through alert_triage_record
--       (0090) plus create_observation, and the observation id is stored on the triage row.
--   C6  The triage path already gates on `review_and_approve` (alert_triage_record, 0090). The
--       remediation actions here gate on the right each one actually needs — `perform_work` to do
--       the work (matching create_observation / update_cap), `review_and_approve` to escalate and to
--       triage — so the UI can hide exactly what the caller cannot do.
--
-- Everything is a thin wrapper over an RPC that already exists; nothing re-implements the finding,
-- CAP or plan machinery. Every action writes an activity_log row naming the alert, so the trail from
-- alert to consequence is complete.
--
-- M1: grepped migrations and tests for alert_adhoc_suggestion, alert_adhoc_audit_raise,
--     alert_raise_finding, alert_raise_cap, alert_request_evidence, alert_escalate, evidence_requests;
--     all are new. The joins and the RPCs they call already exist.
-- M2: every object is `create or replace` / `create table if not exists`.
-- M6: applied twice and all SQL tests run twice against a local Postgres before the push.

-- ---------------------------------------------------------------------------
-- 1. evidence_requests — a request for evidence raised from an alert (C5 "request evidence"). It is
--    a durable, listable object with a status, not a notification. A tenant may read its own rows;
--    writes go through the RPC below.
-- ---------------------------------------------------------------------------
create table if not exists evidence_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  alert_id uuid null,
  engagement_id uuid null references engagements(id) on delete set null,
  requested_from text not null default '',
  description text not null default '',
  due_date date null,
  status text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists evidence_requests_org_idx on evidence_requests (org_id, created_at desc);
create index if not exists evidence_requests_alert_idx on evidence_requests (org_id, alert_id);

alter table evidence_requests enable row level security;
drop policy if exists evidence_requests_select on evidence_requests;
create policy evidence_requests_select on evidence_requests for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.evidence_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A guard every action shares: the alert must exist in the caller's organisation.
-- ---------------------------------------------------------------------------
create or replace function public.alert_in_org(p_org uuid, p_alert_id uuid)
returns monitor_alerts
language plpgsql stable security definer set search_path = public as $$
declare v_alert monitor_alerts;
begin
  perform public.provio_org_guard(p_org);
  select * into v_alert from monitor_alerts a where a.id = p_alert_id and a.org_id = p_org;
  if v_alert.id is null then
    raise exception 'no such alert in this organisation' using errcode = 'P0001';
  end if;
  return v_alert;
end $$;

-- ---------------------------------------------------------------------------
-- 3. C4 — the ad-hoc audit suggestion. Read-only: it resolves the pre-fill so the UI can show the
--    user exactly what the audit would be before they confirm it. `plan_id` is the newest draft plan
--    for the alert entity's universe, or null when there is none (the caller then creates one).
-- ---------------------------------------------------------------------------
create or replace function public.alert_adhoc_suggestion(p_org uuid, p_alert_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_entity_name text;
  v_universe_name text;
  v_plan uuid;
  v_dept text;
begin
  v_alert := public.alert_in_org(p_org, p_alert_id);

  select e.name into v_entity_name from entities e where e.id = v_alert.entity_id;
  select u.name into v_universe_name from universes u where u.id = v_alert.universe_id;
  v_dept := coalesce(v_alert.department, v_entity_name);

  if v_alert.universe_id is not null then
    select p.id into v_plan from plans p
     where p.org_id = p_org and p.universe_id = v_alert.universe_id and p.status = 'draft'
     order by p.created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'alert_id', v_alert.id,
    'rule_id', v_alert.rule_id,
    'rule_version', v_alert.rule_version,
    'entity_id', v_alert.entity_id,
    'entity_name', v_entity_name,
    'universe_id', v_alert.universe_id,
    'universe_name', v_universe_name,
    'department', v_dept,
    'engagement_id', v_alert.engagement_id,
    'control_ids', to_jsonb(v_alert.control_ids),
    'control_count', coalesce(array_length(v_alert.control_ids, 1), 0),
    'residual_band', v_alert.residual_band,
    'sira_risk_name', v_alert.sira_risk_name,
    'plan_id', v_plan,
    'title', format('Ad-hoc audit: %s', coalesce(v_dept, v_alert.rule_id)),
    'justification', format(
      'Raised from monitor alert %s (rule %s v%s): %s', v_alert.id, v_alert.rule_id,
      v_alert.rule_version, v_alert.reason));
end $$;

-- alert_adhoc_audit_raise: turn the suggestion into a pending ad-hoc plan item. It delegates to
-- add_plan_item (0021), so the plan's create right and the ad-hoc justification rule are enforced
-- exactly as they are for any other ad-hoc item — this adds no second approval path.
create or replace function public.alert_adhoc_audit_raise(
  p_org uuid, p_alert_id uuid, p_plan uuid, p_title text,
  p_justification text, p_start date default null, p_end date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_item uuid;
begin
  v_alert := public.alert_in_org(p_org, p_alert_id);
  if p_plan is null then
    raise exception 'an ad-hoc audit needs a plan' using errcode = 'P0001';
  end if;

  v_item := public.add_plan_item(
    p_plan, coalesce(nullif(btrim(coalesce(p_title, '')), ''), format('Ad-hoc audit: %s', v_alert.rule_id)),
    v_alert.entity_id, v_alert.engagement_id, p_start, p_end, true,
    coalesce(nullif(btrim(coalesce(p_justification, '')), ''),
             format('Raised from monitor alert %s (rule %s): %s', v_alert.id, v_alert.rule_id, v_alert.reason)));

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), 'alert_adhoc_audit_raised', 'plan_item', v_item,
          jsonb_build_object('alert_id', p_alert_id, 'plan_id', p_plan, 'rule_id', v_alert.rule_id));
  return v_item;
end $$;

-- ---------------------------------------------------------------------------
-- 4. C5 — raise a finding from the alert. The four mandatory readability sections are pre-filled from
--    the alert so promote_to_finding passes; the caller may override any of them.
-- ---------------------------------------------------------------------------
create or replace function public.alert_raise_finding(
  p_org uuid, p_alert_id uuid, p_engagement uuid, p_title text default null,
  p_context text default null, p_condition text default null,
  p_effect text default null, p_risk text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_obs uuid;
  v_finding uuid;
  v_sections jsonb;
begin
  v_alert := public.alert_in_org(p_org, p_alert_id);
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_engagement is null then
    raise exception 'a finding needs an engagement' using errcode = 'P0001';
  end if;

  v_sections := jsonb_build_object(
    'context', coalesce(nullif(btrim(coalesce(p_context, '')), ''),
      format('Continuous-monitoring alert %s (rule %s v%s) fired%s.', v_alert.id, v_alert.rule_id,
             v_alert.rule_version,
             case when v_alert.department is not null then ' on ' || v_alert.department else '' end)),
    'condition', coalesce(nullif(btrim(coalesce(p_condition, '')), ''), v_alert.reason),
    'effect', coalesce(nullif(btrim(coalesce(p_effect, '')), ''),
      coalesce('SIRA residual risk ' || v_alert.residual_band || '.',
               'The condition was matched by a released monitor rule.')),
    'risk', coalesce(nullif(btrim(coalesce(p_risk, '')), ''),
      coalesce(v_alert.sira_risk_name, v_alert.inherent_risk_label, 'Continuous-monitoring risk.')),
    'alert_id', v_alert.id, 'rule_id', v_alert.rule_id, 'rule_version', v_alert.rule_version,
    'control_ids', to_jsonb(v_alert.control_ids));

  v_obs := public.create_observation(p_engagement, null,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), format('Monitor alert %s', v_alert.rule_id)),
    v_sections);
  v_finding := public.promote_to_finding(v_obs, null);

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), 'alert_finding_raised', 'finding', v_finding,
          jsonb_build_object('alert_id', p_alert_id, 'observation_id', v_obs, 'rule_id', v_alert.rule_id));
  return v_finding;
end $$;

-- alert_raise_cap: a CAP row on the register (0038) for a finding raised from the alert. The register
-- has a select policy and no tenant insert path, so this RPC is the only way to add one.
create or replace function public.alert_raise_cap(
  p_org uuid, p_alert_id uuid, p_finding_id uuid, p_responsible_dept text,
  p_due_date date, p_action_description text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_cap uuid;
  v_engagement uuid;
begin
  v_alert := public.alert_in_org(p_org, p_alert_id);
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_finding_id is null then
    raise exception 'a CAP names a finding' using errcode = 'P0001';
  end if;
  if not exists (select 1 from findings f where f.id = p_finding_id and f.org_id = p_org) then
    raise exception 'finding not found in this organisation' using errcode = 'P0001';
  end if;

  select coalesce(e.id, v_alert.engagement_id) into v_engagement
    from findings f left join engagements e on e.entity_id = f.entity_id and e.org_id = p_org
   where f.id = p_finding_id limit 1;

  insert into caps (org_id, engagement_id, finding_id, responsible_dept, due_date, action_description, status)
  values (p_org, coalesce(v_engagement, v_alert.engagement_id), p_finding_id,
          coalesce(nullif(btrim(coalesce(p_responsible_dept, '')), ''), v_alert.department),
          p_due_date, coalesce(p_action_description, format('Remediate monitor alert %s: %s',
          v_alert.rule_id, v_alert.reason)), 'open')
  returning id into v_cap;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), 'alert_cap_raised', 'cap', v_cap,
          jsonb_build_object('alert_id', p_alert_id, 'finding_id', p_finding_id));
  return v_cap;
end $$;

-- alert_request_evidence: record a request for evidence against the alert (C5). perform_work.
create or replace function public.alert_request_evidence(
  p_org uuid, p_alert_id uuid, p_engagement uuid, p_requested_from text,
  p_description text, p_due_date date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_id uuid;
begin
  v_alert := public.alert_in_org(p_org, p_alert_id);
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_requested_from), '') = '' or coalesce(btrim(p_description), '') = '' then
    raise exception 'an evidence request needs who it is from and what is wanted' using errcode = 'P0001';
  end if;

  insert into evidence_requests (org_id, alert_id, engagement_id, requested_from, description, due_date, created_by)
  values (p_org, p_alert_id, coalesce(p_engagement, v_alert.engagement_id),
          btrim(p_requested_from), btrim(p_description), p_due_date, auth.uid())
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), 'alert_evidence_requested', 'evidence_request', v_id,
          jsonb_build_object('alert_id', p_alert_id, 'requested_from', p_requested_from));
  return v_id;
end $$;

-- alert_escalate: an escalated alert becomes an observation (C5 "escalate"), recorded through
-- alert_triage_record so the disposition path is unchanged, with the observation id stored on the
-- triage row so the alert and the work it created are linked. review_and_approve, as triage requires.
create or replace function public.alert_escalate(
  p_org uuid, p_alert_id uuid, p_engagement uuid, p_title text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_obs uuid;
begin
  v_alert := public.alert_in_org(p_org, p_alert_id);
  if p_engagement is null then
    raise exception 'an escalation needs an engagement' using errcode = 'P0001';
  end if;

  perform public.alert_triage_record(p_org, p_alert_id, 'escalated', null, null);

  v_obs := public.create_observation(p_engagement, null,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), format('Escalated alert %s', v_alert.rule_id)),
    jsonb_build_object(
      'context', format('Monitor alert %s (rule %s v%s) was escalated.', v_alert.id, v_alert.rule_id, v_alert.rule_version),
      'condition', v_alert.reason,
      'effect', coalesce('SIRA residual risk ' || v_alert.residual_band || '.', 'Escalated for review.'),
      'risk', coalesce(v_alert.sira_risk_name, v_alert.inherent_risk_label, 'Continuous-monitoring risk.'),
      'alert_id', v_alert.id, 'rule_id', v_alert.rule_id, 'rule_version', v_alert.rule_version));

  update alert_triage set observation_id = v_obs, triaged_at = now()
   where org_id = p_org and alert_id = p_alert_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (p_org, auth.uid(), 'alert_escalated', 'observation', v_obs,
          jsonb_build_object('alert_id', p_alert_id, 'rule_id', v_alert.rule_id));
  return v_obs;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Grants. Every action is tenant-callable; the alert_in_org guard is internal.
-- ---------------------------------------------------------------------------
revoke execute on function public.alert_in_org(uuid, uuid) from public, anon, authenticated;

do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('alert_adhoc_suggestion', 'alert_adhoc_audit_raise', 'alert_raise_finding',
                         'alert_raise_cap', 'alert_request_evidence', 'alert_escalate')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

comment on function public.alert_adhoc_suggestion(uuid, uuid) is
  'C4: the pre-fill for an ad-hoc audit raised from an alert (entity, department, controls, plan).';
comment on function public.alert_raise_finding(uuid, uuid, uuid, text, text, text, text, text) is
  'C5: raise a finding from an alert, with the mandatory readability sections pre-filled.';
comment on function public.alert_raise_cap(uuid, uuid, uuid, text, date, text) is
  'C5: raise a CAP on the register for a finding raised from an alert.';
comment on function public.alert_request_evidence(uuid, uuid, uuid, text, text, date) is
  'C5: record a request for evidence against an alert.';
comment on function public.alert_escalate(uuid, uuid, uuid, text) is
  'C5: escalate an alert into an observation and link the triage row to it.';

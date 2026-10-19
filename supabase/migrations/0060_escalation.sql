-- 0060: Escalation rules and Work Queue proposals (S6.a, F12).
--
-- F12: anomaly to role escalation. Built on the F7 engine: a rule is a trigger event + conditions +
-- outcomes. The recommendation ("Audit required: Yes / No / Needs review") is DETERMINISTIC: it is
-- filled from the event fields by a rule-defined template, never by AI (L1). A "mini-engagement
-- draft" proposal a CIA converts through the normal plan and deployment-gate flow never bypasses the
-- gate or L3. Continuous-auditing watchers (file drop, HTTP polling, database view) are PARKED and
-- are not built; the event interface stays generic so a future watcher.signal event can plug in.
--
-- M1: grepped supabase/migrations and supabase/tests for escalation_events, work_queue_proposals,
--     escalation_rule_save, escalation_recommendation, work_queue_proposal_create,
--     work_queue_proposal_list, work_queue_proposal_convert; none existed. The engine tables
--     automation_rules, automation_rule_versions, automation_events and notifications (F7) exist and
--     are extended, not recreated.
-- M2: create table if not exists + add column if not exists; create or replace; drop trigger/policy
--     if exists before create; create index if not exists. Safe to apply repeatedly.

-- ---------------------------------------------------------------------------
-- 1. escalation_events — append-only log of every escalation that fired (F12). Visible in the Work
--    Queue to the targeted roles. A recommendation is stored with its reason, filled from the event
--    fields; the recommendation is never AI-decided.
-- ---------------------------------------------------------------------------
create table if not exists escalation_events (
  id uuid primary key default gen_random_uuid()
);
alter table escalation_events add column if not exists org_id uuid;
alter table escalation_events add column if not exists rule_id uuid;
alter table escalation_events add column if not exists rule_key text;
alter table escalation_events add column if not exists source_event_key text;
alter table escalation_events add column if not exists source_event_id bigint;
alter table escalation_events add column if not exists severity text;
alter table escalation_events add column if not exists recommendation text;
alter table escalation_events add column if not exists reason text;
alter table escalation_events add column if not exists target_roles text[] not null default '{}';
alter table escalation_events add column if not exists payload jsonb not null default '{}'::jsonb;
alter table escalation_events add column if not exists actor_id uuid;
alter table escalation_events add column if not exists created_at timestamptz not null default now();

alter table escalation_events enable row level security;
drop policy if exists escalation_events_select on escalation_events;
create policy escalation_events_select on escalation_events for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create index if not exists escalation_events_org_idx on escalation_events (org_id, created_at desc);
create index if not exists escalation_events_rule_idx on escalation_events (rule_id);

-- ---------------------------------------------------------------------------
-- 2. work_queue_proposals — a deterministic proposal an escalation creates (F12). A CIA converts it
--    through the normal plan and deployment-gate flow; the proposal never bypasses the gate or L3.
-- ---------------------------------------------------------------------------
create table if not exists work_queue_proposals (
  id uuid primary key default gen_random_uuid()
);
alter table work_queue_proposals add column if not exists org_id uuid;
alter table work_queue_proposals add column if not exists kind text not null default 'mini_engagement_draft';
alter table work_queue_proposals add column if not exists title text;
alter table work_queue_proposals add column if not exists body text;
alter table work_queue_proposals add column if not exists status text not null default 'proposed';
alter table work_queue_proposals add column if not exists target_roles text[] not null default '{}';
alter table work_queue_proposals add column if not exists source_escalation_id uuid;
alter table work_queue_proposals add column if not exists created_by uuid;
alter table work_queue_proposals add column if not exists created_at timestamptz not null default now();
alter table work_queue_proposals add column if not exists decided_by uuid;
alter table work_queue_proposals add column if not exists decided_at timestamptz;
alter table work_queue_proposals add column if not exists engagement_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'work_queue_proposals_status_chk'
  ) then
    alter table work_queue_proposals
      add constraint work_queue_proposals_status_chk
      check (status in ('proposed','converted','dismissed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'work_queue_proposals_kind_chk'
  ) then
    alter table work_queue_proposals
      add constraint work_queue_proposals_kind_chk
      check (kind in ('mini_engagement_draft','review_note'));
  end if;
end $$;

alter table work_queue_proposals enable row level security;
drop policy if exists work_queue_proposals_select on work_queue_proposals;
create policy work_queue_proposals_select on work_queue_proposals for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create index if not exists work_queue_proposals_org_idx on work_queue_proposals (org_id, status, created_at desc);
create index if not exists work_queue_proposals_escalation_idx on work_queue_proposals (source_escalation_id);

-- ---------------------------------------------------------------------------
-- 3. escalation_recommendation(p_payload, p_template) — the DETERMINISTIC recommendation. It reads
--    the event fields named in a rule-defined template and returns Yes / No / Needs review with a
--    plain reason. No AI, no randomness (L1). The template is a small list of {field, contains,
--    equals, recommend, reason} rules evaluated in order; the first match wins.
-- ---------------------------------------------------------------------------
create or replace function public.escalation_recommendation(p_payload jsonb, p_template jsonb)
returns table (recommendation text, reason text)
language plpgsql immutable set search_path = public as $$
declare
  v_rule jsonb;
  v_field text;
  v_value text;
  v_contains text;
  v_equals text;
  v_hit boolean;
begin
  if p_template is null or jsonb_typeof(p_template) <> 'array' then
    return query select 'Needs review'::text, 'No recommendation template is configured for this rule.';
    return;
  end if;

  for v_rule in select * from jsonb_array_elements(p_template) loop
    v_field := v_rule ->> 'field';
    v_value := coalesce(p_payload ->> v_field, '');
    v_contains := v_rule ->> 'contains';
    v_equals := v_rule ->> 'equals';
    v_hit := false;

    if v_equals is not null then
      v_hit := lower(v_value) = lower(v_equals);
    elsif v_contains is not null then
      v_hit := position(lower(v_contains) in lower(v_value)) > 0;
    end if;

    if v_hit then
      return query select
        coalesce(v_rule ->> 'recommend', 'Needs review'),
        coalesce(v_rule ->> 'reason', format('%s is %s.', coalesce(v_field, 'the value'), v_value));
      return;
    end if;
  end loop;

  return query select
    coalesce(p_template -> -1 ->> 'default_recommend', 'Needs review'),
    coalesce(p_template -> -1 ->> 'default_reason', 'No rule matched; a person should review this.');
end $$;

-- ---------------------------------------------------------------------------
-- 4. escalation_evaluate(p_event_id) — the F12 hook into the F7 engine. For an event whose key is
--    matched by an enabled escalation rule, evaluate it and act. It reads the same automation_rules
--    store the engine reads (F7), so a tenant rule overrides a platform rule with the same key. It
--    is idempotent per event: re-evaluating an event fires nothing more. Returns the number of
--    escalations that fired.
-- ---------------------------------------------------------------------------
create or replace function public.escalation_evaluate(p_event_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_event automation_events;
  v_rule record;
  v_action jsonb;
  v_rec record;
  v_fired int := 0;
  v_proposal_id uuid;
  v_escalation_id uuid;
  v_title text;
  v_roles text[];
begin
  select * into v_event from automation_events where id = p_event_id;
  if not found then
    return 0;
  end if;

  for v_rule in
    select r.* from automation_rules r
     where r.enabled and r.paused_at is null
       and r.event_key = v_event.event_key
       and (r.actions @> '[{"type":"escalate"}]'::jsonb)
       and (r.org_id = v_event.org_id
            or (r.org_id is null and not exists (
                  select 1 from automation_rules t
                   where t.org_id = v_event.org_id and t.rule_key = r.rule_key)))
     order by r.org_id nulls last, r.rule_key
  loop
    -- Idempotent per event: this rule has already escalated this event.
    if exists (select 1 from escalation_events
                where source_event_id = p_event_id and rule_id = v_rule.id) then
      continue;
    end if;
    if not public.rule_conditions_ok(v_event.payload, v_rule.conditions) then
      continue;
    end if;
    if not public.rule_loop_guard(v_rule.id) then
      continue;
    end if;

    for v_action in select * from jsonb_array_elements(v_rule.actions)
    loop
      if v_action ->> 'type' <> 'escalate' then
        continue;
      end if;

      select * into v_rec from public.escalation_recommendation(v_event.payload, v_action -> 'recommendation');

      v_roles := coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(v_action -> 'to_roles')), '{}');

      insert into escalation_events (org_id, rule_id, rule_key, source_event_key, source_event_id,
                                     severity, recommendation, reason, target_roles, payload, actor_id)
      values (v_event.org_id, v_rule.id, v_rule.rule_key, v_event.event_key, p_event_id,
              coalesce(v_event.payload ->> 'severity', v_action ->> 'severity'),
              v_rec.recommendation, v_rec.reason, v_roles, v_event.payload, auth.uid())
      returning id into v_escalation_id;

      insert into notifications (org_id, user_id, kind, body, event_key, payload, role_target)
      values (v_event.org_id, null, 'escalation.triggered',
              format('%s — %s', v_rec.recommendation, v_rec.reason),
              'escalation.triggered',
              jsonb_build_object('escalation_id', v_escalation_id, 'recommendation', v_rec.recommendation,
                                 'reason', v_rec.reason, 'payload', v_event.payload),
              coalesce(v_action ->> 'role_target', v_roles[1], 'all'));

      if coalesce((v_action ->> 'create_proposal')::boolean, false) then
        v_title := coalesce(v_action ->> 'proposal_title', 'Mini-engagement draft');
        insert into work_queue_proposals (org_id, kind, title, body, status, target_roles,
                                          source_escalation_id, created_by)
        values (v_event.org_id, 'mini_engagement_draft', v_title,
                format('%s — %s', v_rec.recommendation, v_rec.reason),
                'proposed', v_roles, v_escalation_id, auth.uid())
        returning id into v_proposal_id;
      end if;

      -- The escalation is logged to the ledger too (L5).
      perform public.append_ledger_entry(v_event.org_id, 'escalation_triggered',
        jsonb_build_object('rule_key', v_rule.rule_key, 'recommendation', v_rec.recommendation,
                           'reason', v_rec.reason, 'source_event', v_event.event_key), auth.uid());
      v_fired := v_fired + 1;
    end loop;
  end loop;

  return v_fired;
end $$;

-- ---------------------------------------------------------------------------
-- 5. work_queue_proposal_list(p_org) — the proposals visible to the caller. A row is visible when the
--    caller holds a right listed in its target_roles, or is a CIA (view_all_scopes). The proposal
--    never bypasses the gate: convert opens the normal plan flow.
-- ---------------------------------------------------------------------------
create or replace function public.work_queue_proposal_list(p_org uuid)
returns table (
  id uuid, kind text, title text, body text, status text, target_roles text[],
  source_escalation_id uuid, created_at timestamptz, decided_at timestamptz, engagement_id uuid
)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind, p.title, p.body, p.status, p.target_roles,
         p.source_escalation_id, p.created_at, p.decided_at, p.engagement_id
    from work_queue_proposals p
   where p.org_id = p_org
     and (public.is_platform_admin() or public.caller_has_right('view_all_scopes')
          or exists (
            select 1 from roles r
             where r.org_id = p_org
               and r.slug = any(p.target_roles)
               and exists (
                 select 1 from org_members m
                  where m.org_id = p_org and m.role_id = r.id and m.user_id = auth.uid())))
   order by p.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- 6. work_queue_proposal_decide(p_id, p_status, p_engagement_id) — a CIA (manage_engagements)
--    converts or dismisses a proposal. Conversion links the created engagement; it does NOT bypass
--    the deployment gate or L3.
-- ---------------------------------------------------------------------------
create or replace function public.work_queue_proposal_decide(
  p_id uuid, p_status text, p_engagement_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if p_status not in ('converted','dismissed') then
    raise exception 'unknown proposal status: %', p_status using errcode = 'P0001';
  end if;
  select org_id into v_org from work_queue_proposals where id = p_id;
  if v_org is null then
    raise exception 'unknown proposal' using errcode = 'P0001';
  end if;
  if not public.config_actor_ok(v_org, 'manage_engagements') then
    raise exception 'not allowed: the caller cannot convert a Work Queue proposal' using errcode = 'P0001';
  end if;
  if not public.has_feature(v_org, 'escalation') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;

  update work_queue_proposals
     set status = p_status, engagement_id = p_engagement_id, decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  perform public.append_ledger_entry(v_org, 'work_queue_proposal_' || p_status,
    jsonb_build_object('proposal_id', p_id, 'engagement_id', p_engagement_id), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 6b. escalation_event_list(p_org) — the escalations visible to the caller (F12). A row is visible
--     when the caller holds a right listed in its target_roles or is a CIA (view_all_scopes).
-- ---------------------------------------------------------------------------
create or replace function public.escalation_event_list(p_org uuid)
returns table (
  id uuid, rule_key text, source_event_key text, severity text, recommendation text,
  reason text, target_roles text[], payload jsonb, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select e.id, e.rule_key, e.source_event_key, e.severity, e.recommendation,
         e.reason, e.target_roles, e.payload, e.created_at
    from escalation_events e
   where e.org_id = p_org
     and (public.is_platform_admin() or public.caller_has_right('view_all_scopes')
          or exists (
            select 1 from roles r
             where r.org_id = p_org
               and r.slug = any(e.target_roles)
               and exists (
                 select 1 from org_members m
                  where m.org_id = p_org and m.role_id = r.id and m.user_id = auth.uid())))
   order by e.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- 7. escalation_rule_save — a thin wrapper over automation_rule_save that guarantees the escalate
--    action carries a deterministic recommendation template. Refuses an action without one, so a
--    rule can never fall back to an AI decision (L1).
-- ---------------------------------------------------------------------------
create or replace function public.escalation_rule_save(
  p_org uuid, p_rule_key text, p_name text, p_event_key text,
  p_conditions jsonb, p_actions jsonb, p_enabled boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_action jsonb;
  v_id uuid;
begin
  perform public.require_config_actor(p_org, 'edit_config');
  if not public.has_feature(p_org, 'escalation') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;

  for v_action in select * from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) loop
    if v_action ->> 'type' = 'escalate'
       and (v_action -> 'recommendation' is null
            or jsonb_typeof(v_action -> 'recommendation') <> 'array'
            or jsonb_array_length(v_action -> 'recommendation') = 0) then
      raise exception 'an escalation rule needs a recommendation template' using errcode = 'P0001';
    end if;
  end loop;

  v_id := public.automation_rule_save(p_org, p_rule_key, p_name, p_event_key,
                                      p_conditions, p_actions, p_enabled);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Seed three platform template escalation rules (F12). The Org Admin copies and edits them. The
--    recommendation is deterministic and filled from the event fields. Idempotent by rule_key.
-- ---------------------------------------------------------------------------
insert into automation_rules (org_id, rule_key, name, event_key, conditions, actions, enabled, is_platform_template)
values
  (null, 'platform.escalation.high_anomaly', 'Escalate a high-severity anomaly', 'anomaly.raised',
   jsonb_build_array(jsonb_build_object('field','severity','operator','in','value','high,critical')),
   jsonb_build_array(
     jsonb_build_object('type','escalate','severity','high',
       'to_roles', jsonb_build_array('cia'),
       'role_target','cia',
       'create_proposal', true,
       'proposal_title','Mini-engagement draft: high-severity anomaly',
       'recommendation', jsonb_build_array(
         jsonb_build_object('field','severity','equals','critical','recommend','Yes',
           'reason','A critical-severity anomaly was raised.'),
         jsonb_build_object('field','severity','equals','high','recommend','Yes',
           'reason','A high-severity anomaly was raised.'),
         jsonb_build_object('field','severity','equals','medium','recommend','Needs review',
           'reason','A medium-severity anomaly was raised; a person should review it.'),
         jsonb_build_object('default_recommend','Needs review',
           'default_reason','An anomaly was raised; a person should review it.')))),
   true, true),
  (null, 'platform.escalation.repeated_anomaly', 'Escalate a repeated anomaly', 'anomaly.raised',
   jsonb_build_array(jsonb_build_object('field','recurrence_count','operator','gte','value','3')),
   jsonb_build_array(
     jsonb_build_object('type','escalate','severity','high',
       'to_roles', jsonb_build_array('cia','audit_manager'),
       'role_target','cia',
       'create_proposal', true,
       'proposal_title','Mini-engagement draft: repeated anomaly',
       'recommendation', jsonb_build_array(
         jsonb_build_object('field','recurrence_count','equals','3','recommend','Yes',
           'reason','The same anomaly was raised three or more times.'),
         jsonb_build_object('default_recommend','Needs review',
           'default_reason','A repeated anomaly was raised; a person should review it.')))),
   true, true),
  (null, 'platform.escalation.overdue_cap', 'Escalate an overdue critical CAP', 'cap.overdue',
   jsonb_build_array(jsonb_build_object('field','severity','operator','in','value','critical,high')),
   jsonb_build_array(
     jsonb_build_object('type','escalate','severity','high',
       'to_roles', jsonb_build_array('cia'),
       'role_target','cia',
       'create_proposal', true,
       'proposal_title','Mini-engagement draft: overdue critical CAP',
       'recommendation', jsonb_build_array(
         jsonb_build_object('field','severity','equals','critical','recommend','Yes',
           'reason','A critical corrective action is overdue.'),
         jsonb_build_object('field','severity','equals','high','recommend','Yes',
           'reason','A high-severity corrective action is overdue.'),
         jsonb_build_object('default_recommend','Needs review',
           'default_reason','A corrective action is overdue; a person should review it.')))),
   true, true)
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Grants. The read path is a plain select under RLS (as for every tenant table; 0008's blanket
--    grant reaches a table only on a later apply, so it is stated here explicitly and
--    deterministically). Writes have no policy, so they are refused; every write goes through an RPC.
--    RPCs to authenticated (each re-checks its right); nothing to anon.
-- ---------------------------------------------------------------------------
grant select on public.escalation_events to authenticated;
grant select on public.work_queue_proposals to authenticated;

do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'escalation_recommendation','escalation_evaluate','escalation_rule_save','escalation_event_list',
      'work_queue_proposal_list','work_queue_proposal_decide'
    )
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

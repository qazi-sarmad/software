-- 0114: the guided integrity incident (T6; spec §11.3a).
--
-- T7 built the ALARM: detection, the severity rule, the fan-out, the gated read and the
-- acknowledgement. What was still missing is the RESPONSE — what a human does next. Spec §11.3a
-- asks for a guided wizard that shows, in plain words, what changed, when and by whom, and what it
-- affects, then offers restore / re-derive and re-seal / freeze the engagement / escalate, each
-- requiring a reason, each appending to the ledger, and re-runs verification at the end so the
-- incident closes on PROOF rather than on assertion.
--
-- The incident record is itself append-only. `integrity_incidents` is immutable (select-only policy,
-- no update grant) and every step — an annotation, an action, a verification — is a row in
-- `integrity_incident_actions`, which is append-only by the same construction. An incident that can
-- be quietly edited is not evidence. The incident's STATUS is therefore DERIVED from its actions by
-- the pure layer (src/lib/incidentWizard.ts), never stored and mutated.
--
-- BOUNDARY (never blurred): tamper-EVIDENCE, not tamper-prevention. Restore re-checks that a record
-- once again agrees with what was sealed; it cannot conjure back bytes that were never kept. Where a
-- record cannot be restored the wizard says so plainly rather than offering a button that pretends.
--
-- Laws: L2 (only hashes, ids and the actor leave; nothing here reads tenant content), rights not
-- role names, idempotent (the harness applies every migration twice), additive only, every write is
-- a security-definer RPC with an explicit caller check, and the clock is read only where a row's own
-- default or an explicit action requires it.

-- ---------------------------------------------------------------------------
-- 1. engagements freeze. A freeze for an incident must stop the engagement moving or sealing,
--    regardless of workpaper state, so it is a guard of its own rather than a re-run of the
--    sign-off checks. Additive columns; the trigger below is the enforcement.
-- ---------------------------------------------------------------------------
alter table engagements add column if not exists frozen_at timestamptz;
alter table engagements add column if not exists frozen_reason text;
alter table engagements add column if not exists frozen_by_incident uuid;

create or replace function public.guard_engagement_frozen() returns trigger
language plpgsql as $$
begin
  -- The freeze action itself only sets the frozen_* columns, leaving stage and sealed untouched, so
  -- it passes. Any later attempt to move the stage or seal the engagement is refused.
  if old.frozen_at is not null
     and (new.stage is distinct from old.stage or new.sealed is distinct from old.sealed) then
    raise exception 'engagement_frozen: the engagement is frozen for an integrity incident and cannot move'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists engagements_frozen_guard on engagements;
create trigger engagements_frozen_guard
  before update on engagements
  for each row execute function public.guard_engagement_frozen();

-- ---------------------------------------------------------------------------
-- 2. integrity_incidents — the incident header. Immutable: a select policy and nothing else, so the
--    only writer is integrity_incident_open (security definer).
-- ---------------------------------------------------------------------------
create table if not exists integrity_incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  alert_id uuid references integrity_alerts(id) on delete set null,
  kind text not null,
  severity text not null default 'warning' check (severity in ('warning', 'incident')),
  object_type text not null,
  object_id uuid,
  -- The engagement the affected object belongs to, resolved once at open time so the wizard can show
  -- what it affects without the caller needing a second read. Null when the object is org-level.
  engagement_id uuid references engagements(id) on delete set null,
  expected_hash text,
  actual_hash text,
  detail jsonb not null default '{}'::jsonb,
  opened_by uuid,
  opened_at timestamptz not null default now()
);
create index if not exists integrity_incidents_org_idx on integrity_incidents (org_id, opened_at desc);
create unique index if not exists integrity_incidents_alert_idx on integrity_incidents (alert_id)
  where alert_id is not null;

alter table integrity_incidents enable row level security;
drop policy if exists integrity_incidents_select on integrity_incidents;
create policy integrity_incidents_select on integrity_incidents for select to authenticated
  using (org_id = public.jwt_org_id());
revoke insert, update, delete on public.integrity_incidents from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. integrity_incident_actions — the append-only trail. An annotation, an action and a verification
--    are all rows here; the status is derived from them, never written back to the header.
-- ---------------------------------------------------------------------------
create table if not exists integrity_incident_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  incident_id uuid not null references integrity_incidents(id) on delete cascade,
  action text not null check (action in
    ('annotate', 'restore', 'rederive', 'freeze', 'escalate', 'verify', 'open')),
  reason text not null default '',
  -- The deterministic outcome the action computed, e.g. 'restored', 'still_mismatched', 'intact',
  -- 'broken', 'frozen', 'escalated', 'matches', 'diverges', 'no_sealed_copy', 'not_applicable'.
  outcome text not null default '',
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists integrity_incident_actions_idx
  on integrity_incident_actions (org_id, incident_id, created_at);

alter table integrity_incident_actions enable row level security;
drop policy if exists integrity_incident_actions_select on integrity_incident_actions;
create policy integrity_incident_actions_select on integrity_incident_actions for select to authenticated
  using (org_id = public.jwt_org_id());
revoke insert, update, delete on public.integrity_incident_actions from public, anon, authenticated;

-- Append-only, exactly as engagement_stage_transitions is (0101): no role may rewrite the trail.
create or replace function public.guard_incident_actions_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'integrity_incident_actions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists integrity_incident_actions_immutable on integrity_incident_actions;
create trigger integrity_incident_actions_immutable
  before update or delete on integrity_incident_actions
  for each row execute function public.guard_incident_actions_immutable();

drop trigger if exists integrity_incidents_pin_org on integrity_incidents;
create trigger integrity_incidents_pin_org before insert on integrity_incidents
  for each row execute function public.pin_org_id();
drop trigger if exists integrity_incident_actions_pin_org on integrity_incident_actions;
create trigger integrity_incident_actions_pin_org before insert on integrity_incident_actions
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 4. integrity_incident_engagement — resolve the engagement an alert's object belongs to. Read-only,
--    org-guarded. Null means the object is org-level (an activity archive), which the wizard shows as
--    "this organisation" rather than inventing an engagement.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_incident_engagement(p_object_type text, p_object_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng uuid;
begin
  if p_object_id is null then
    return null;
  end if;
  case p_object_type
    when 'evidence_file' then
      select e.engagement_id into v_eng from evidence_files e
       where e.id = p_object_id and e.org_id = v_org;
    when 'population_archive' then
      select a.engagement_id into v_eng from population_archives a
       where a.id = p_object_id and a.org_id = v_org;
    when 'report_graph' then
      select rv.engagement_id into v_eng
        from report_graphs g join report_versions rv on rv.id = g.report_version_id
       where g.id = p_object_id and g.org_id = v_org;
    when 'report_version' then
      select rv.engagement_id into v_eng from report_versions rv
       where rv.id = p_object_id and rv.org_id = v_org;
    else
      v_eng := null;
  end case;
  return v_eng;
end $$;

revoke execute on function public.integrity_incident_engagement(text, uuid) from public, anon;
grant execute on function public.integrity_incident_engagement(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. integrity_incident_open — open (or return) the incident for an alert. Idempotent per alert: a
--    second call returns the existing incident rather than a duplicate. Records the 'open' action so
--    the trail is complete from the first row.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_incident_open(p_alert_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_alert integrity_alerts;
  v_eng uuid;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('review_and_approve')
          or public.caller_has_right('edit_config')
          or public.caller_head_level() >= 1
          or public.is_platform_admin()) then
    raise exception 'not permitted: an integrity owner is required' using errcode = 'P0001';
  end if;

  select * into v_alert from integrity_alerts a where a.id = p_alert_id and a.org_id = v_org;
  if not found then
    raise exception 'no such integrity alert in this organisation' using errcode = 'P0001';
  end if;

  select id into v_id from integrity_incidents where alert_id = p_alert_id;
  if v_id is not null then
    return v_id;
  end if;

  v_eng := public.integrity_incident_engagement(v_alert.object_type, v_alert.object_id);

  insert into integrity_incidents (
    org_id, alert_id, kind, severity, object_type, object_id, engagement_id,
    expected_hash, actual_hash, detail, opened_by)
  values (
    v_org, p_alert_id, v_alert.kind, public.integrity_alert_severity(v_alert.kind),
    v_alert.object_type, v_alert.object_id, v_eng,
    v_alert.expected_hash, v_alert.actual_hash, coalesce(v_alert.detail, '{}'::jsonb), auth.uid())
  returning id into v_id;

  insert into integrity_incident_actions (org_id, incident_id, action, reason, outcome, detail, actor_id)
  values (v_org, v_id, 'open', 'opened from the integrity alarm', 'open',
          jsonb_build_object('alert_id', p_alert_id, 'kind', v_alert.kind), auth.uid());

  perform public.append_ledger_entry(v_org, 'integrity_incident_opened',
    jsonb_build_object('incident_id', v_id, 'alert_id', p_alert_id, 'kind', v_alert.kind,
                       'object_type', v_alert.object_type, 'object_id', v_alert.object_id),
    auth.uid());

  return v_id;
end $$;

revoke execute on function public.integrity_incident_open(uuid) from public, anon;
grant execute on function public.integrity_incident_open(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. integrity_incidents_list — the org's incidents with their append-only trail, newest first, for
--    its integrity owners. Returns an empty set for a caller with the right and no incidents.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_incidents_list()
returns table (
  id uuid, alert_id uuid, kind text, severity text, object_type text, object_id uuid,
  engagement_id uuid, expected_hash text, actual_hash text, detail jsonb,
  opened_by uuid, opened_at timestamptz, actions jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('review_and_approve')
          or public.caller_has_right('edit_config')
          or public.caller_head_level() >= 1
          or public.is_platform_admin()) then
    raise exception 'not permitted: an integrity owner is required' using errcode = 'P0001';
  end if;

  return query
    select i.id, i.alert_id, i.kind, i.severity, i.object_type, i.object_id, i.engagement_id,
           i.expected_hash, i.actual_hash, i.detail, i.opened_by, i.opened_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', a.id, 'action', a.action, 'reason', a.reason, 'outcome', a.outcome,
               'detail', a.detail, 'actor_id', a.actor_id, 'created_at', a.created_at)
               order by a.created_at, a.id)
             from integrity_incident_actions a
            where a.incident_id = i.id and a.org_id = v_org), '[]'::jsonb)
      from integrity_incidents i
     where i.org_id = v_org
     order by i.opened_at desc
     limit 200;
end $$;

comment on function public.integrity_incidents_list() is
  'T6: the org''s integrity incidents with their append-only action trail, for its integrity owners.';

revoke execute on function public.integrity_incidents_list() from public, anon;
grant execute on function public.integrity_incidents_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The deterministic outcome of each action. A pure-in-SQL rule: given the incident and the action
--    requested, compute what actually happened. Nothing here guesses; where an action cannot apply it
--    says so ('not_applicable', 'no_sealed_copy') rather than reporting success.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_incident_outcome(p_incident integrity_incidents, p_action text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_now text;
  v_broken bigint;
begin
  if p_action = 'restore' then
    -- A restore is possible only when a sealed copy exists. The check is whether the record NOW
    -- agrees with what was sealed: for an evidence file its stored hash, for a population or
    -- activity archive its content hash. No bytes are conjured; this proves agreement or its absence.
    case p_incident.object_type
      when 'evidence_file' then
        select e.content_sha256 into v_now from evidence_files e where e.id = p_incident.object_id;
      when 'population_archive' then
        select a.content_hash into v_now from population_archives a where a.id = p_incident.object_id;
      when 'archive_job' then
        select j.content_hash into v_now from archive_jobs j where j.id = p_incident.object_id;
      else
        return 'not_applicable';
    end case;
    if v_now is null then
      return 'no_sealed_copy';
    end if;
    return case when v_now = p_incident.expected_hash then 'restored' else 'still_mismatched' end;
  end if;

  if p_action = 'rederive' then
    -- Re-derive the object's root from the facts held now and compare it to what was sealed. For the
    -- ledger that is a full chain walk; for a report graph it is a re-fold of the recorded leaves.
    if p_incident.object_type = 'ledger' then
      v_broken := public.verify_ledger(p_incident.org_id);
      return case when v_broken is null then 'intact' else 'broken' end;
    end if;
    if p_incident.object_type = 'report_graph' then
      select case when public.report_graph_root_of(
                    (select coalesce(array_agg(c.leaf_hash order by c.position, c.claim_id), array[]::text[])
                       from report_claims c
                      where c.report_version_id = g.report_version_id and c.leaf_hash <> ''))
                  = g.graph_root then 'matches' else 'diverges' end
        into v_now
        from report_graphs g where g.id = p_incident.object_id;
      return coalesce(v_now, 'not_applicable');
    end if;
    return 'not_applicable';
  end if;

  if p_action = 'freeze' then
    return case when p_incident.engagement_id is null then 'no_engagement' else 'frozen' end;
  end if;

  if p_action = 'escalate' then
    return 'escalated';
  end if;

  if p_action = 'verify' then
    -- The closing proof: re-run the object's own verification and report the plain result.
    if p_incident.object_type = 'ledger' then
      v_broken := public.verify_ledger(p_incident.org_id);
      return case when v_broken is null then 'intact' else 'broken' end;
    end if;
    case p_incident.object_type
      when 'evidence_file' then
        select e.content_sha256 into v_now from evidence_files e where e.id = p_incident.object_id;
      when 'population_archive' then
        select a.content_hash into v_now from population_archives a where a.id = p_incident.object_id;
      when 'archive_job' then
        select j.content_hash into v_now from archive_jobs j where j.id = p_incident.object_id;
      else
        return 'not_applicable';
    end case;
    if v_now is null then
      return 'no_sealed_copy';
    end if;
    return case when v_now = p_incident.expected_hash then 'verified' else 'mismatch' end;
  end if;

  return 'not_applicable';
end $$;

revoke execute on function public.integrity_incident_outcome(integrity_incidents, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. integrity_incident_action — perform one guided step. A reason is mandatory for every action, as
--    spec §11.3a requires; the outcome is computed, recorded in the append-only trail and ledged.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_incident_action(
  p_incident_id uuid, p_action text, p_reason text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_inc integrity_incidents;
  v_outcome text;
  v_owner uuid;
  v_emails text[];
  v_summary text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('review_and_approve')
          or public.caller_has_right('edit_config')
          or public.caller_head_level() >= 1
          or public.is_platform_admin()) then
    raise exception 'not permitted: an integrity owner is required' using errcode = 'P0001';
  end if;
  if p_action not in ('annotate', 'restore', 'rederive', 'freeze', 'escalate') then
    raise exception 'unknown incident action: %', p_action using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a_reason_is_required: every incident step must carry a reason' using errcode = 'P0001';
  end if;

  select * into v_inc from integrity_incidents i where i.id = p_incident_id and i.org_id = v_org;
  if not found then
    raise exception 'no such integrity incident in this organisation' using errcode = 'P0001';
  end if;

  v_outcome := public.integrity_incident_outcome(v_inc, p_action);

  if p_action = 'freeze' and v_outcome = 'frozen' then
    update engagements
       set frozen_at = coalesce(frozen_at, now()),
           frozen_reason = p_reason,
           frozen_by_incident = p_incident_id
     where id = v_inc.engagement_id and org_id = v_org;
  end if;

  if p_action = 'escalate' then
    -- Escalation tells BOTH the tenant's integrity owners (so the org keeps an in-app record) and the
    -- platform's own alert addresses (SA-05 `platform_notification_recipients` — the designed channel
    -- for a platform alert, an address list that needs no org membership). Only the object type, the
    -- object id and the two hashes leave (Law L2). A notification failure must never lose the step,
    -- so the fan-out is best-effort: the ledger entry below is the record of truth.
    v_summary := format('Integrity incident escalated: %s %s (%s).',
                        v_inc.object_type, coalesce(v_inc.object_id::text, '(org-level)'), v_inc.kind);
    begin
      for v_owner in
        select distinct m.user_id
          from org_members m
          left join roles r on r.id = m.role_id
         where m.org_id = v_org and m.user_id is not null
           and (coalesce((r.rights ->> 'review_and_approve')::boolean, false)
                or coalesce((r.rights ->> 'edit_config')::boolean, false)
                or coalesce(m.head_level, 0) >= 1)
      loop
        perform public.notification_emit(
          v_org, v_owner, 'integrity_incident_escalated', v_summary,
          jsonb_build_object('incident_id', p_incident_id, 'kind', v_inc.kind,
                             'object_type', v_inc.object_type, 'object_id', v_inc.object_id,
                             'reason', p_reason));
      end loop;
    exception when others then
      null;
    end;

    select array_agg(distinct address) into v_emails from platform_notification_recipients;
    if v_emails is not null and array_length(v_emails, 1) > 0 then
      begin
        perform public.queue_email(
          v_org, v_emails,
          'Provio integrity INCIDENT escalated',
          format('<p>%s</p>', v_summary),
          v_summary,
          jsonb_build_object('incident_id', p_incident_id, 'kind', v_inc.kind,
                             'object_type', v_inc.object_type, 'object_id', v_inc.object_id));
      exception when others then
        null;
      end;
    end if;

    begin
      perform public.emit_event(v_org, 'integrity.incident_escalated', jsonb_build_object(
        'incident_id', p_incident_id, 'kind', v_inc.kind, 'object_type', v_inc.object_type,
        'object_id', v_inc.object_id));
    exception when others then
      null;
    end;

    -- A durable platform-side trace: the platform admin can read this even with no org membership.
    begin
      perform public.platform_log('integrity_incident_escalated', v_org, 'integrity_incident',
                                  p_incident_id, jsonb_build_object('kind', v_inc.kind,
                                  'object_type', v_inc.object_type, 'object_id', v_inc.object_id));
    exception when others then
      null;
    end;
  end if;

  insert into integrity_incident_actions (org_id, incident_id, action, reason, outcome, detail, actor_id)
  values (v_org, p_incident_id, p_action, p_reason, v_outcome,
          jsonb_build_object('object_type', v_inc.object_type, 'object_id', v_inc.object_id,
                             'expected_hash', v_inc.expected_hash, 'actual_hash', v_inc.actual_hash),
          auth.uid());

  perform public.append_ledger_entry(v_org, 'integrity_incident_' || p_action,
    jsonb_build_object('incident_id', p_incident_id, 'action', p_action, 'outcome', v_outcome,
                       'reason', p_reason, 'object_type', v_inc.object_type,
                       'object_id', v_inc.object_id),
    auth.uid());

  return v_outcome;
end $$;

revoke execute on function public.integrity_incident_action(uuid, text, text) from public, anon;
grant execute on function public.integrity_incident_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. integrity_incident_verify — re-run verification and record the result, so an incident closes on
--    proof rather than assertion. `p_reason` is optional here: the run itself is the evidence.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_incident_verify(p_incident_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_inc integrity_incidents;
  v_outcome text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not (public.caller_has_right('review_and_approve')
          or public.caller_has_right('edit_config')
          or public.caller_head_level() >= 1
          or public.is_platform_admin()) then
    raise exception 'not permitted: an integrity owner is required' using errcode = 'P0001';
  end if;

  select * into v_inc from integrity_incidents i where i.id = p_incident_id and i.org_id = v_org;
  if not found then
    raise exception 'no such integrity incident in this organisation' using errcode = 'P0001';
  end if;

  v_outcome := public.integrity_incident_outcome(v_inc, 'verify');

  insert into integrity_incident_actions (org_id, incident_id, action, reason, outcome, detail, actor_id)
  values (v_org, p_incident_id, 'verify', 're-run verification', v_outcome,
          jsonb_build_object('object_type', v_inc.object_type, 'object_id', v_inc.object_id),
          auth.uid());

  perform public.append_ledger_entry(v_org, 'integrity_incident_verify',
    jsonb_build_object('incident_id', p_incident_id, 'outcome', v_outcome,
                       'object_type', v_inc.object_type, 'object_id', v_inc.object_id),
    auth.uid());

  return v_outcome;
end $$;

revoke execute on function public.integrity_incident_verify(uuid) from public, anon;
grant execute on function public.integrity_incident_verify(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Grants for the helpers the wizard calls. The guard functions are trigger-only.
-- ---------------------------------------------------------------------------
revoke execute on function public.guard_engagement_frozen() from public, anon;
revoke execute on function public.guard_incident_actions_immutable() from public, anon;

-- 0075 (C2.3): an emitter for every catalogue event that has a source.
--
-- The measured position before this migration (docs/COMPLETION-EVENTS.md): of the 28 keys in
-- automation_events_catalogue, only five had an emitter — config.changed and ai_model.changed (the
-- 0051 configuration-area trigger), cap.due_soon and cap.overdue (0074) and the three
-- hosting.migration.* keys (0069). Everything else was a rule the owner could select but that could
-- never fire.
--
-- This migration adds one AFTER INSERT/UPDATE trigger per source table, all routed through
-- public.emit_catalogue_event, which refuses a key that is not in the catalogue. It also seeds
-- event_emitter_allowlist with the two keys that genuinely have no server-side source, each with its
-- reason; SQL test 84 enumerates the catalogue and fails on any key that has neither an emitter nor
-- an allow-list row, so a new catalogue key without an emitter cannot pass CI.
--
-- M1: grepped supabase/migrations and supabase/tests for every name below. `emit_catalogue_event`
-- and `event_emitter_allowlist` are new; no existing trigger is replaced.
-- M2: `create table if not exists`, `create or replace function`, `drop trigger if exists` before
-- every create, and every insert is `on conflict do nothing`, so a repeat apply is safe.
-- L1: every emitter is deterministic — it copies fields from the row that changed, and no emitter
-- invents a value.

-- ---------------------------------------------------------------------------
-- 1. emit_catalogue_event — the one door. A key not in the catalogue is refused, so an emitter can
--    never widen the catalogue by accident.
-- ---------------------------------------------------------------------------
create or replace function public.emit_catalogue_event(p_org uuid, p_event_key text, p_payload jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_org is null then
    return null;
  end if;
  if not exists (select 1 from automation_events_catalogue c where c.event_key = p_event_key) then
    raise exception 'unknown event key: %', p_event_key using errcode = 'P0001';
  end if;
  select public.emit_event(p_org, p_event_key, coalesce(p_payload, '{}'::jsonb)) into v_id;
  return v_id;
end $$;

comment on function public.emit_catalogue_event(uuid, text, jsonb) is
  'C2.3: the one door an emitter uses. Refuses a key that is not in automation_events_catalogue.';

-- ---------------------------------------------------------------------------
-- 2. The allow-list. A key here is a key that has no server-side source, with the reason. It is a
--    table, not a comment, so test 84 can read it.
-- ---------------------------------------------------------------------------
create table if not exists event_emitter_allowlist (
  event_key text primary key,
  reason text not null
);
alter table event_emitter_allowlist enable row level security;
drop policy if exists event_emitter_allowlist_select on event_emitter_allowlist;
create policy event_emitter_allowlist_select on event_emitter_allowlist for select to authenticated
  using (auth.uid() is not null);

insert into event_emitter_allowlist (event_key, reason) values
  ('anomaly.raised',
   'Anomaly detection is a pure client-side function over the sample rows (src/lib/analytics.ts). '
   'There is no server-side anomaly record to emit from; emitting a guess would break L1. The rule '
   'stays selectable but cannot fire until a server-side detector exists.'),
  ('watcher.signal',
   'Reserved for the parked watchers feature (NOT-DONE: watchers). Not in the catalogue; listed so '
   'the allow-list is the complete record of keys without an emitter.')
on conflict (event_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Engagement sealed (§10.4). The seal is the false -> true flip of engagements.sealed.
-- ---------------------------------------------------------------------------
-- A finding has no separate seal column: it becomes read-only when its engagement seals (0034's
-- conclusion sign-off sets engagements.sealed, and the row guards then refuse writes). So
-- finding.sealed is emitted per finding of the engagement at that moment, once.
create or replace function public.emit_engagement_sealed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_finding record;
begin
  if coalesce(new.sealed, false) and not coalesce(old.sealed, false) then
    perform public.emit_catalogue_event(new.org_id, 'engagement.sealed', jsonb_build_object(
      'engagement_id', new.id, 'entity_id', new.entity_id, 'title', new.title,
      'sealed_at', now()));
    -- A finding reaches its engagement either through its observation or, when it was created
    -- without one, through the engagement's entity.
    for v_finding in
      select f.id, f.severity from findings f
       where f.org_id = new.org_id
         and (f.observation_id in (select o.id from observations o where o.engagement_id = new.id)
              or (f.observation_id is null and f.entity_id = new.entity_id))
    loop
      perform public.emit_catalogue_event(new.org_id, 'finding.sealed', jsonb_build_object(
        'finding_id', v_finding.id, 'engagement_id', new.id, 'severity', v_finding.severity));
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists engagements_emit_sealed on engagements;
create trigger engagements_emit_sealed after update on engagements
  for each row execute function public.emit_engagement_sealed();

-- ---------------------------------------------------------------------------
-- 4. Certificates (§16). Issued when a row first reaches status 'issued'; revoked on the transition.
-- ---------------------------------------------------------------------------
create or replace function public.emit_certificate_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'issued' then
    perform public.emit_catalogue_event(new.org_id, 'certificate.issued', jsonb_build_object(
      'certificate_id', new.id, 'engagement_id', new.engagement_id,
      'version', new.version, 'cert_hash', new.cert_hash));
  elsif tg_op = 'UPDATE' and new.status = 'issued' and coalesce(old.status, '') <> 'issued' then
    perform public.emit_catalogue_event(new.org_id, 'certificate.issued', jsonb_build_object(
      'certificate_id', new.id, 'engagement_id', new.engagement_id,
      'version', new.version, 'cert_hash', new.cert_hash));
  elsif tg_op = 'UPDATE' and new.status = 'revoked' and coalesce(old.status, '') <> 'revoked' then
    perform public.emit_catalogue_event(new.org_id, 'certificate.revoked', jsonb_build_object(
      'certificate_id', new.id, 'engagement_id', new.engagement_id,
      'reason', new.revoke_reason));
  end if;
  return new;
end $$;

drop trigger if exists certificates_emit_change on engagement_certificates;
create trigger certificates_emit_change after insert or update on engagement_certificates
  for each row execute function public.emit_certificate_change();

-- ---------------------------------------------------------------------------
-- 5. Board Pack generated (§18). One row in board_pack_history is one generated pack.
-- ---------------------------------------------------------------------------
create or replace function public.emit_board_pack_generated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_catalogue_event(new.org_id, 'board_pack.generated', jsonb_build_object(
    'board_pack_id', new.id, 'scope_key', new.scope_key, 'boundary_kind', new.boundary_kind,
    'data_hash', new.data_hash, 'generated_at', new.generated_at));
  return new;
end $$;

drop trigger if exists board_pack_history_emit_generated on board_pack_history;
create trigger board_pack_history_emit_generated after insert on board_pack_history
  for each row execute function public.emit_board_pack_generated();

-- ---------------------------------------------------------------------------
-- 6. Report frozen and issued (§15.5). The transition of report_versions.status.
-- ---------------------------------------------------------------------------
create or replace function public.emit_report_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'frozen' and coalesce(old.status, '') <> 'frozen' then
    perform public.emit_catalogue_event(new.org_id, 'report.frozen', jsonb_build_object(
      'report_version_id', new.id, 'engagement_id', new.engagement_id,
      'version', new.version_number, 'frozen_at', new.frozen_at));
  end if;
  if new.status like 'issued%' and coalesce(old.status, '') not like 'issued%' then
    perform public.emit_catalogue_event(new.org_id, 'report.issued', jsonb_build_object(
      'report_version_id', new.id, 'engagement_id', new.engagement_id,
      'version', new.version_number, 'issued_at', new.issued_at));
  end if;
  return new;
end $$;

drop trigger if exists report_versions_emit_change on report_versions;
create trigger report_versions_emit_change after update on report_versions
  for each row execute function public.emit_report_change();

-- ---------------------------------------------------------------------------
-- 7. Invitations (spec §22, C2.4). A queued invitation is a row in auth_invites.
-- ---------------------------------------------------------------------------
create or replace function public.emit_invite_sent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_catalogue_event(new.org_id, 'invite.sent', jsonb_build_object(
    'email', new.email, 'role_slug', new.role_slug, 'kind', new.kind,
    'invite_id', new.id, 'expires_at', new.expires_at));
  return new;
end $$;

drop trigger if exists auth_invites_emit_sent on auth_invites;
create trigger auth_invites_emit_sent after insert on auth_invites
  for each row execute function public.emit_invite_sent();

-- ---------------------------------------------------------------------------
-- 8. External auditors (§24). Invited on the invite row; revoked when the access row is
--    deactivated (by the administrator or by the C2.2 expiry sweep).
-- ---------------------------------------------------------------------------
create or replace function public.emit_auditor_invited() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_catalogue_event(new.org_id, 'auditor.invited', jsonb_build_object(
    'email', new.email, 'invite_id', new.id, 'expiry_kind', new.expiry_kind,
    'expires_at', new.expires_at));
  return new;
end $$;

drop trigger if exists external_auditor_invites_emit_invited on external_auditor_invites;
create trigger external_auditor_invites_emit_invited after insert on external_auditor_invites
  for each row execute function public.emit_auditor_invited();

create or replace function public.emit_auditor_revoked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.active, true) and coalesce(old.active, true) then
    perform public.emit_catalogue_event(new.org_id, 'auditor.revoked', jsonb_build_object(
      'email', new.email, 'user_id', new.user_id, 'revoked_at', new.revoked_at));
  end if;
  return new;
end $$;

drop trigger if exists external_auditor_access_emit_revoked on external_auditor_access;
create trigger external_auditor_access_emit_revoked after update on external_auditor_access
  for each row execute function public.emit_auditor_revoked();

-- ---------------------------------------------------------------------------
-- 9. auditor.accessed — the external auditor read trail (0066). The log row is the source.
-- ---------------------------------------------------------------------------
create or replace function public.emit_auditor_accessed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_catalogue_event(new.org_id, 'auditor.accessed', jsonb_build_object(
    'user_id', new.user_id, 'engagement_id', new.engagement_id,
    'function_name', new.function_name, 'outcome', new.outcome));
  return new;
end $$;

drop trigger if exists external_access_log_emit_accessed on external_access_log;
create trigger external_access_log_emit_accessed after insert on external_access_log
  for each row execute function public.emit_auditor_accessed();

-- ---------------------------------------------------------------------------
-- 10. email.failed — a queue row that the dispatcher gave up on (§22).
-- ---------------------------------------------------------------------------
create or replace function public.emit_email_failed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and coalesce(old.status, '') <> 'failed' then
    perform public.emit_catalogue_event(new.org_id, 'email.failed', jsonb_build_object(
      'subject', new.subject, 'attempts', new.attempts,
      'error_text', public.mask_secrets_text(coalesce(new.error_text, ''))));
  end if;
  return new;
end $$;

drop trigger if exists email_queue_emit_failed on email_queue;
create trigger email_queue_emit_failed after update on email_queue
  for each row execute function public.emit_email_failed();

-- ---------------------------------------------------------------------------
-- 11. ai.call_failed — the gateway records a failed call through ai_call_log with flags.ok = false
--     (F8). The stored row is the source; the prompt and response are never in the payload.
-- ---------------------------------------------------------------------------
create or replace function public.emit_ai_call_failed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.flags is not null and (new.flags ->> 'ok') = 'false' then
    perform public.emit_catalogue_event(new.org_id, 'ai.call_failed', jsonb_build_object(
      'use_case', new.use_case, 'model_name', new.model_name,
      'error', public.mask_secrets_text(coalesce(new.flags ->> 'error', 'unknown'))));
  end if;
  return new;
end $$;

drop trigger if exists ai_calls_emit_failed on ai_calls;
create trigger ai_calls_emit_failed after insert on ai_calls
  for each row execute function public.emit_ai_call_failed();

-- ---------------------------------------------------------------------------
-- 12. feature.changed — an entitlement row was inserted or its switch moved.
-- ---------------------------------------------------------------------------
create or replace function public.emit_feature_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.enabled is distinct from old.enabled
     or new.plan_name is distinct from old.plan_name then
    perform public.emit_catalogue_event(new.org_id, 'feature.changed', jsonb_build_object(
      'feature_key', new.feature_key, 'enabled', new.enabled,
      'plan_name', new.plan_name, 'reason', new.reason));
  end if;
  return new;
end $$;

drop trigger if exists tenant_entitlements_emit_changed on tenant_entitlements;
create trigger tenant_entitlements_emit_changed after insert or update on tenant_entitlements
  for each row execute function public.emit_feature_changed();

-- ---------------------------------------------------------------------------
-- 13. setup.completed — the Go Live step of the tenant setup wizard reached 'done'.
--     The scope and the key are the ones the app writes (src/data/setup.ts SetupScope 'org_admin',
--     src/lib/wizardSteps.ts ORG_WIZARD_STEPS key 'org.golive').
-- ---------------------------------------------------------------------------
create or replace function public.emit_setup_completed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.scope = 'org_admin' and new.step_key = 'org.golive' and new.status = 'done'
     and coalesce(old.status, '') <> 'done' then
    perform public.emit_catalogue_event(new.org_id, 'setup.completed', jsonb_build_object(
      'step_key', new.step_key, 'scope', new.scope, 'completed_at', now()));
  end if;
  return new;
end $$;

drop trigger if exists setup_state_emit_completed on setup_state;
create trigger setup_state_emit_completed after update on setup_state
  for each row execute function public.emit_setup_completed();

-- ---------------------------------------------------------------------------
-- 14. The consultation keys. The session rows are the source; the consultation_events rows carry the
--     key already, so the emitter reads them and re-emits into the automation outbox.
-- ---------------------------------------------------------------------------
create or replace function public.emit_consultation_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.event_key in ('consultation.requested', 'consultation.started',
                       'consultation.ended', 'consultation.proposal') then
    perform public.emit_catalogue_event(new.org_id, new.event_key, jsonb_build_object(
      'session_id', new.session_id, 'actor_side', new.actor_side,
      'detail', public.mask_secrets(coalesce(new.payload, '{}'::jsonb))));
  end if;
  return new;
end $$;

drop trigger if exists consultation_events_emit on consultation_events;
create trigger consultation_events_emit after insert on consultation_events
  for each row execute function public.emit_consultation_event();

-- ---------------------------------------------------------------------------
-- 15. Grants. The emitters run as the owner (a trigger function is SECURITY DEFINER), so they do not
--     depend on the caller's rights; the emitter door and the outbox are not reachable from a
--     browser session.
-- ---------------------------------------------------------------------------
revoke execute on function public.emit_catalogue_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.emit_catalogue_event(uuid, text, jsonb) to service_role;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'emit_engagement_sealed()', 'emit_certificate_change()', 'emit_board_pack_generated()',
    'emit_report_change()', 'emit_invite_sent()', 'emit_auditor_invited()', 'emit_auditor_revoked()',
    'emit_auditor_accessed()', 'emit_email_failed()', 'emit_ai_call_failed()',
    'emit_feature_changed()', 'emit_setup_completed()', 'emit_consultation_event()'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
  end loop;
end $$;

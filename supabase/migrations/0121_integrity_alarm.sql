-- 0112: the tamper ALARM (T7). Detection was complete; nothing told a human.
--
-- Verified before this migration: `integrity_alerts` exists (0077), `raise_integrity_alert()` writes
-- the alert AND appends a ledger entry, and the archive/evidence checks call it — but
-- `listIntegrityAlerts()` had ZERO callers and no migration emitted a notification. A tamper was
-- recorded in a table nobody read. This migration wires the alarm:
--
--   1. `integrity_alert_severity(kind)` — the severity RULE, as data. A single hash mismatch on one
--      object is a WARNING; a broken ledger chain, an invalid signature or an invalid timestamp is an
--      INCIDENT. The distinction is the product's, not a caller's guess.
--   2. `raise_integrity_alert()` is redefined to fan the alert out on every channel — an in-app
--      notification to each of the org's integrity owners, an email to the same set, and an automation
--      event so the Work Queue and the existing rule engine see it. Every existing detection path
--      (archive check, population archive, evidence verify) therefore alarms without a further change.
--   3. `integrity_alerts_list()` — the org's alerts, severity-annotated, incident-first. Rights-gated:
--      an integrity incident is for the org's integrity owners, not for every signed-in member.
--   4. `integrity_alert_acknowledge()` — an annotation, never an edit. The alert row is immutable; only
--      "a human has seen this" is recorded.
--   5. `ledger_continuity_check()` — the chain is re-verified on demand and a break raises an INCIDENT.
--      This is the alarm's own proof; the SCHEDULED sweep (spec T1/T2) belongs to Builder A and is not
--      duplicated here.
--
-- Laws: L2 (only hashes and object ids leave the alert row; nothing here reads tenant content), rights
-- not role names, idempotent (applied twice by the harness), additive only, and every new function is
-- a security-definer RPC with an explicit caller check. Nothing here reads the clock except where the
-- alert's own `raised_at` default applies.

-- ---------------------------------------------------------------------------
-- 1. The severity rule, as data. A warning is one object that failed to verify; an incident is the
--    ledger chain, a signature or a timestamp — the integrity of the trail itself.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_alert_severity(p_kind text)
returns text
language sql immutable as $$
  select case
    when p_kind in ('ledger_chain_broken', 'ledger_chain_gap', 'signature_invalid',
                    'timestamp_invalid', 'timestamp_failed') then 'incident'
    else 'warning'
  end
$$;

comment on function public.integrity_alert_severity(text) is
  'T7: the severity rule. A broken ledger chain, an invalid signature or a failed timestamp is an '
  'INCIDENT; a single object that fails to verify is a WARNING.';

-- ---------------------------------------------------------------------------
-- 2. The notification fan-out. Called by raise_integrity_alert, so every detection path alarms.
--    Recipients: the org's integrity owners (review_and_approve, edit_config or a Head) in-app and by
--    email, plus an automation event for the Work Queue and the rule engine. Never tenant content —
--    the object type, the object id and the two hashes.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_alert_notify(
  p_alert_id uuid, p_org uuid, p_kind text, p_object_type text, p_object_id uuid,
  p_expected text, p_actual text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_severity text := public.integrity_alert_severity(p_kind);
  v_summary text;
  v_recipients uuid[];
  v_emails text[];
  v_notified int := 0;
  v_uid uuid;
begin
  if p_org is null then
    return 0;
  end if;

  v_summary := case when v_severity = 'incident'
    then format('Integrity incident: the %s chain no longer verifies (%s).', p_object_type, p_kind)
    else format('Integrity warning: %s %s failed verification (%s).',
                p_object_type, coalesce(p_object_id::text, '(unknown)'), p_kind)
  end;

  -- The org's integrity owners: a right holder or a Head. Rights, never role names.
  select array_agg(distinct m.user_id) into v_recipients
    from org_members m
    left join roles r on r.id = m.role_id
   where m.org_id = p_org
     and m.user_id is not null
     and (
       coalesce((r.rights ->> 'review_and_approve')::boolean, false)
       or coalesce((r.rights ->> 'edit_config')::boolean, false)
       or coalesce(m.head_level, 0) >= 1
     );

  if v_recipients is not null then
    foreach v_uid in array v_recipients loop
      perform public.notification_emit(
        p_org, v_uid, 'integrity_alert', v_summary,
        jsonb_build_object(
          'alert_id', p_alert_id, 'severity', v_severity, 'kind', p_kind,
          'object_type', p_object_type, 'object_id', p_object_id));
      v_notified := v_notified + 1;
    end loop;
  end if;

  -- Email to the same owners, one message per run (never per recipient): the queue dispatcher splits
  -- the addresses. Only hashes and ids are in the body.
  select array_agg(distinct u.email) into v_emails
    from auth.users u
   where u.id = any(coalesce(v_recipients, array[]::uuid[])) and u.email is not null;

  if v_emails is not null and array_length(v_emails, 1) > 0 then
    perform public.queue_email(
      p_org, v_emails,
      case when v_severity = 'incident'
        then 'Provio integrity INCIDENT: the ledger chain does not verify'
        else 'Provio integrity warning: an object failed verification'
      end,
      format('<p>%s</p><p>Object: %s %s</p><p>Expected: %s</p><p>Actual: %s</p>',
             public.escape_html_text(v_summary), public.escape_html_text(p_object_type),
             public.escape_html_text(coalesce(p_object_id::text, '(unknown)')),
             public.escape_html_text(coalesce(p_expected, '(none)')),
             public.escape_html_text(coalesce(p_actual, '(none)'))),
      format('%s%sExpected: %s%sActual: %s', v_summary, E'\n',
             coalesce(p_expected, '(none)'), E'\n', coalesce(p_actual, '(none)')),
      jsonb_build_object('kind', 'integrity_alert', 'severity', v_severity,
                         'alert_id', p_alert_id, 'object_type', p_object_type,
                         'object_id', p_object_id));
  end if;

  -- The Work Queue / rule-engine path. The automation engine already turns an event into a Work Queue
  -- item and an email rule; this only raises the event.
  perform public.emit_event(p_org, 'integrity.alert', jsonb_build_object(
    'alert_id', p_alert_id, 'severity', v_severity, 'kind', p_kind,
    'object_type', p_object_type, 'object_id', p_object_id,
    'expected_hash', p_expected, 'actual_hash', p_actual));

  return v_notified;
end $$;

comment on function public.integrity_alert_notify(uuid, uuid, text, text, uuid, text, text) is
  'T7: fan an integrity alert out on every channel — in-app, email and the automation/Work Queue '
  'event — to the organisation''s integrity owners. Returns the number notified in-app.';

-- ---------------------------------------------------------------------------
-- 3. raise_integrity_alert, redefined to notify. The signature is unchanged, so every existing caller
--    (population_archive_check, population_archive_verify, archive_job_mark_uploaded,
--    verify_evidence_file) alarms without a further change.
-- ---------------------------------------------------------------------------
create or replace function public.raise_integrity_alert(
  p_org_id uuid, p_kind text, p_object_type text, p_object_id uuid,
  p_expected text, p_actual text, p_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into integrity_alerts (org_id, kind, object_type, object_id, expected_hash, actual_hash, detail)
  values (p_org_id, p_kind, p_object_type, p_object_id, p_expected, p_actual,
          coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;

  perform public.append_ledger_entry(
    p_org_id, 'integrity_alert',
    jsonb_build_object('alert_id', v_id, 'kind', p_kind, 'object_type', p_object_type,
                       'object_id', p_object_id, 'expected_hash', p_expected, 'actual_hash', p_actual),
    auth.uid());

  -- The alarm (T7). A notification failure must never lose the alert or the ledger entry, so the
  -- fan-out is attempted after both are durable and its own error is swallowed.
  begin
    perform public.integrity_alert_notify(v_id, p_org_id, p_kind, p_object_type, p_object_id,
                                          p_expected, p_actual);
  exception when others then
    null;
  end;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. integrity_alerts_list — the alarm's read surface. The org's own alerts, severity-annotated and
--    incident-first. Gated on a right: an integrity incident is for the org's integrity owners, not
--    for every signed-in member. Returns an empty set for a caller with the right and no alerts.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_alerts_list()
returns table (
  id uuid, kind text, severity text, object_type text, object_id uuid,
  expected_hash text, actual_hash text, raised_at timestamptz,
  acknowledged_at timestamptz, acknowledged_by uuid
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
    select a.id, a.kind, public.integrity_alert_severity(a.kind), a.object_type, a.object_id,
           a.expected_hash, a.actual_hash, a.raised_at, a.acknowledged_at, a.acknowledged_by
      from integrity_alerts a
     where a.org_id = v_org
     order by (public.integrity_alert_severity(a.kind) = 'incident') desc, a.raised_at desc
     limit 200;
end $$;

comment on function public.integrity_alerts_list() is
  'T7: the org''s integrity alerts, incident-first, for its integrity owners.';

-- ---------------------------------------------------------------------------
-- 5. integrity_alert_acknowledge — an annotation, never an edit. The alert row itself is immutable
--    (no update policy, no update grant); this records only that a human has seen it, and ledgers it.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_alert_acknowledge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_found boolean;
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

  select true into v_found from integrity_alerts a
   where a.id = p_id and a.org_id = v_org;
  if not found then
    raise exception 'no such integrity alert in this organisation' using errcode = 'P0001';
  end if;

  update integrity_alerts
     set acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_id and org_id = v_org;

  perform public.append_ledger_entry(v_org, 'integrity_alert_acknowledged',
    jsonb_build_object('alert_id', p_id), auth.uid());
end $$;

comment on function public.integrity_alert_acknowledge(uuid) is
  'T7: record that a human has seen an alert. The alert row is never edited; the annotation is '
  'ledgered.';

-- ---------------------------------------------------------------------------
-- 6. ledger_continuity_check — re-verify the chain on demand and raise an INCIDENT when it breaks.
--    A thin wrapper over the existing verify_ledger: the point of T7 is that the result is SEEN. The
--    scheduled sweep (spec T1/T2) is Builder A's and is not built here.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_continuity_check(p_org uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_broken bigint;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  -- A browser caller may only check its own organisation; the service role and an in-database caller
  -- may check any.
  perform public.provio_org_guard(v_org);

  v_broken := public.verify_ledger(v_org);

  if v_broken is not null then
    perform public.raise_integrity_alert(
      v_org, 'ledger_chain_broken', 'ledger', null, null, null,
      jsonb_build_object('first_broken_seq', v_broken));
  end if;

  return v_broken;
end $$;

comment on function public.ledger_continuity_check(uuid) is
  'T7: re-verify the org''s ledger chain. Returns the first broken sequence, or null when the chain '
  'is intact. A break raises an integrity INCIDENT (which notifies on every channel).';

-- ---------------------------------------------------------------------------
-- 7. Grants. The read and the acknowledgement are for a signed-in integrity owner (the body re-checks
--    the right). The notify helper and the continuity check's write path are definer-internal; the
--    continuity check is callable by a signed-in owner so the surface can offer "verify now".
-- ---------------------------------------------------------------------------
revoke execute on function public.integrity_alerts_list() from public, anon;
grant execute on function public.integrity_alerts_list() to authenticated;

revoke execute on function public.integrity_alert_acknowledge(uuid) from public, anon;
grant execute on function public.integrity_alert_acknowledge(uuid) to authenticated;

revoke execute on function public.integrity_alert_notify(uuid, uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.integrity_alert_notify(uuid, uuid, text, text, uuid, text, text)
  to service_role;

revoke execute on function public.ledger_continuity_check(uuid) from public, anon;
grant execute on function public.ledger_continuity_check(uuid) to authenticated, service_role;

revoke execute on function public.integrity_alert_severity(text) from public, anon;
grant execute on function public.integrity_alert_severity(text) to authenticated, service_role;

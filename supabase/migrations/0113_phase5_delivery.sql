-- 0113 (Phase 5, C3): delivery — a firing monitor alert reaches the Work Queue in-app and by email.
--
-- The defect this closes, verified in the code: C1 (0111) evaluates the rules and writes a
-- hash-chained alert, and C2 (0112) enriches it with the entity, department, SIRA position and
-- affected controls. But nothing *delivered* the alert. `alert_record` writes `monitor_alerts` and
-- its trigger emits the `watcher.signal` catalogue event; the dispatcher (`automation_dispatch_pending`)
-- drains that event through `rule_engine_process`, which finds no rule for `watcher.signal` and
-- therefore notifies nobody. And the escalation path writes `notifications` with `user_id = null`
-- and a `role_target`, but `notifications_list()` filters `user_id = auth.uid()`, so a role-targeted
-- row is visible to no one in the Work Queue. So an alert reached the `monitor_alerts` table and
-- stopped there.
--
-- The shape, and why it is not a rule and not a trigger:
--   * NOT an `automation_rules` row for `watcher.signal`. A rule notifies a *role slug*, and the
--     people who triage an alert are the holders of the `review_and_approve` RIGHT (that is what
--     `alert_triage_record` requires), not a role name — the rights model (0016) exists precisely so
--     a role's rights can change without a code change. A rule would also double-deliver: the engine
--     would fire on the `watcher.signal` event the alert trigger already emitted.
--   * NOT a trigger on `monitor_alerts`. The delivery writes `notifications` and `email_queue`; a
--     trigger would run inside `alert_record`'s transaction and a single unexpected row (no
--     recipient, no email address) would roll the alert write back. The runner must never lose an
--     alert because delivery had a problem.
--   * The explicit call is `monitor_alert_notify(org, alert_id)`, called once at the end of
--     `alert_record` — the single write path for an alert — so no alert can be written undelivered.
--     It is idempotent per alert, so a replay or a second caller never duplicates a delivery.
--
-- In-app delivery is a per-recipient `notifications` row (one row per triager, `user_id` set), which
-- is exactly what `notifications_list()` returns and what `useLiveNotifications` subscribes to over
-- Realtime with the poll fallback (src/lib/liveSync.ts). Email delivery is a per-recipient
-- `email_queue` row through `queue_email` (0039), which the existing email-dispatch pipeline sends.
--
-- M1: grepped migrations and tests for `monitor_alert_notify`; it is new. `alert_record` is extended
--     in place (same signature) with the 0112 body plus the delivery call.
-- M2: every object is `create or replace`; the platform template insert is `on conflict do nothing`.
-- M6: applied twice and all SQL tests run twice against a local Postgres before the push.

-- ---------------------------------------------------------------------------
-- 1. A platform notification template for the `watcher.signal` event, so the email pipeline has a
--    subject and a plain-language frame. The alert-specific detail (rule, reason, department, SIRA
--    position) is composed inline in `monitor_alert_notify`, because a template block is static text
--    and this body names the specific alert's enrichment. The template is the fallback frame; it is
--    seeded as a platform row (org_id null) so every tenant has it and any tenant may override it.
-- ---------------------------------------------------------------------------
insert into notification_templates (org_id, event_key, locale, subject, blocks, is_platform_template)
values
  (null, 'watcher.signal', 'en', 'Provio: a continuous-monitoring rule fired',
   jsonb_build_array(
     jsonb_build_object('type', 'heading', 'text', 'A continuous-monitoring rule fired'),
     jsonb_build_object('type', 'paragraph', 'text',
       'A rule over your connected records matched. The alert names the rule, the reason it fired and the records it fired on.'),
     jsonb_build_object('type', 'paragraph', 'text',
       'It is waiting in your Work Queue for triage: dismiss it with a reason, snooze it, or escalate it to a finding.')),
   true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. monitor_alert_notify(org, alert_id) — deliver one alert to the people who can triage it.
--    Resolves the recipients (org members whose role holds `review_and_approve`), writes one in-app
--    notification per recipient and queues one email per recipient that has an address. Returns the
--    number of recipients notified. Idempotent per alert: a second call for the same alert writes
--    nothing.
-- ---------------------------------------------------------------------------
create or replace function public.monitor_alert_notify(p_org uuid, p_alert_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_alert monitor_alerts;
  v_body text;
  v_subject text;
  v_html text;
  v_payload jsonb;
  v_recipient record;
  v_count int := 0;
  v_links text;
begin
  perform public.provio_org_guard(p_org);
  if p_org is null or p_alert_id is null then
    return 0;
  end if;

  select * into v_alert from monitor_alerts a where a.id = p_alert_id and a.org_id = p_org;
  if not found then
    return 0;
  end if;

  -- Idempotent per alert: if a delivery already exists for this alert, do nothing.
  if exists (
    select 1 from notifications n
     where n.org_id = p_org and n.event_key = 'watcher.signal'
       and n.payload ->> 'alert_id' = p_alert_id::text
  ) then
    return 0;
  end if;

  -- The body names what C2 resolved. Every clause is optional: an alert whose records are not tied
  -- to an engagement keeps the rule and the reason and nothing else.
  v_links :=
    coalesce(case when v_alert.department is not null then ' Department: ' || v_alert.department || '.' else '' end, '')
    || coalesce(case when v_alert.residual_band is not null then ' SIRA residual risk: ' || v_alert.residual_band || '.' else '' end, '')
    || coalesce(case when v_alert.inherent_risk_label is not null then ' Inherent risk: ' || v_alert.inherent_risk_label || '.' else '' end, '')
    || coalesce(case when v_alert.sira_risk_name is not null then ' Risk: ' || v_alert.sira_risk_name || '.' else '' end, '')
    || coalesce(case when coalesce(array_length(v_alert.control_ids, 1), 0) > 0
        then ' Affected controls: ' || array_length(v_alert.control_ids, 1)::text || '.' else '' end, '');

  v_body := format('Monitor alert: %s (v%s) fired — %s.%s', v_alert.rule_id, v_alert.rule_version,
                   v_alert.reason, v_links);
  v_subject := format('Provio: monitor alert — %s', v_alert.rule_id);
  v_html := '<p>' || public.escape_html_text(v_body) || '</p>';

  v_payload := jsonb_build_object(
    'alert_id', v_alert.id, 'rule_id', v_alert.rule_id, 'rule_version', v_alert.rule_version,
    'kind', v_alert.kind, 'reason', v_alert.reason, 'lineage_hash', v_alert.lineage_hash,
    'reference_count', jsonb_array_length(v_alert.refs),
    'entity_id', v_alert.entity_id, 'department', v_alert.department,
    'engagement_id', v_alert.engagement_id, 'sira_risk_name', v_alert.sira_risk_name,
    'inherent_risk_label', v_alert.inherent_risk_label, 'residual_band', v_alert.residual_band,
    'control_ids', to_jsonb(v_alert.control_ids));

  -- The recipients: every member of the organisation whose role holds the right that triage
  -- requires (`alert_triage_record` checks `review_and_approve`). Rights, never a role name.
  for v_recipient in
    select distinct m.user_id, u.email
      from org_members m
      join roles r on r.id = m.role_id
      left join auth.users u on u.id = m.user_id
     where m.org_id = p_org
       and coalesce((r.rights ->> 'review_and_approve')::boolean, false)
     order by m.user_id
  loop
    insert into notifications (org_id, user_id, kind, body, event_key, payload, role_target)
    values (p_org, v_recipient.user_id, 'monitor.alert', v_body, 'watcher.signal', v_payload,
            'review_and_approve');

    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (p_org, null, 'monitor_alert_notified', 'notification', p_alert_id,
            jsonb_build_object('recipient', v_recipient.user_id, 'rule_id', v_alert.rule_id));

    if v_recipient.email is not null and btrim(v_recipient.email) <> '' then
      perform public.queue_email(p_org, array[v_recipient.email], v_subject, v_html,
        v_body, jsonb_build_object('event_key', 'watcher.signal', 'alert_id', p_alert_id));
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

comment on function public.monitor_alert_notify(uuid, uuid) is
  'C3: delivers one monitor alert to the organisation''s triagers — one in-app notification and one '
  'email per member holding review_and_approve. Idempotent per alert.';

-- ---------------------------------------------------------------------------
-- 3. alert_record is extended IN PLACE (same signature) so every alert is delivered as it is
--    written. The 0112 body is unchanged; the delivery call is added at the end.
-- ---------------------------------------------------------------------------
create or replace function public.alert_record(
  p_org uuid, p_rule_id text, p_rule_version int, p_kind text, p_reason text,
  p_references jsonb, p_evaluated_at timestamptz, p_window_start timestamptz, p_lineage_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_enr jsonb;
begin
  perform public.provio_org_guard(p_org);
  v_enr := public.alert_enrichment(p_org, p_references);
  insert into monitor_alerts (
    org_id, rule_id, rule_version, kind, reason, refs, evaluated_at, window_start, lineage_hash,
    entity_id, department, engagement_id, universe_id, sira_risk_id, sira_risk_name,
    inherent_risk, inherent_risk_label, residual_risk, residual_band, control_ids)
  values (
    p_org, p_rule_id, p_rule_version, p_kind, p_reason, coalesce(p_references, '[]'::jsonb),
    coalesce(p_evaluated_at, now()), p_window_start, p_lineage_hash,
    (v_enr->>'entity_id')::uuid, v_enr->>'department', (v_enr->>'engagement_id')::uuid,
    (v_enr->>'universe_id')::uuid, (v_enr->>'sira_risk_id')::uuid, v_enr->>'sira_risk_name',
    (v_enr->>'inherent_risk')::numeric, v_enr->>'inherent_risk_label',
    (v_enr->>'residual_risk')::numeric, v_enr->>'residual_band',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_enr->'control_ids') x), '{}'::uuid[]))
  returning id into v_id;

  -- C3: deliver the alert to the people who can triage it. Deliberately after the insert and
  -- deliberately non-fatal: delivery is best-effort, the alert is the durable record.
  perform public.monitor_alert_notify(p_org, v_id);

  return v_id;
end $$;

comment on function public.alert_record(uuid, text, int, text, text, jsonb, timestamptz, timestamptz, text) is
  'C1/C2/C3: writes a hash-chained, enriched alert and delivers it to the organisation''s triagers.';

-- ---------------------------------------------------------------------------
-- 4. Grants. The delivery function is internal — the security-definer `alert_record` calls it, so no
--    client role needs it. It is service-only, like the rest of the runner.
-- ---------------------------------------------------------------------------
revoke execute on function public.monitor_alert_notify(uuid, uuid) from public, anon, authenticated;
grant execute on function public.monitor_alert_notify(uuid, uuid) to service_role;

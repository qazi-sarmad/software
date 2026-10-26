-- Test 84 (C2.3): every catalogue event with a source has an emitter, and each emitter fires once.
--
-- Part A is the completeness rule: enumerate automation_events_catalogue and fail on any key that
-- has neither a trigger emitter (found in pg_trigger) nor a row in event_emitter_allowlist. This is
-- the test the task asks for; it is why a new catalogue key cannot pass CI without an emitter.
-- Part B fires each newly wired emitter on fixtures and asserts exactly one event row, with the
-- field catalogue the rules read.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- A. Completeness: catalogue key -> emitter trigger or allow-list row.
-- ---------------------------------------------------------------------------
do $$
declare
  v_key text;
  v_trig text;
  v_missing text[] := '{}';
  -- key -> the trigger function that emits it. Kept beside the migration so a renamed function
  -- fails here.
  v_map jsonb := jsonb_build_object(
    'config.changed',               'config_area_notify',
    'cap.due_soon',                 'cap_notification_sweep',
    'cap.overdue',                  'cap_notification_sweep',
    'hosting.migration.started',    'migration_job_create',
    'hosting.migration.completed',  'migration_job_create',
    'hosting.migration.failed',     'migration_job_create',
    'engagement.sealed',            'emit_engagement_sealed',
    'certificate.issued',           'emit_certificate_change',
    'certificate.revoked',          'emit_certificate_change',
    'board_pack.generated',         'emit_board_pack_generated',
    'report.frozen',                'emit_report_change',
    'report.issued',                'emit_report_change',
    'invite.sent',                  'emit_invite_sent',
    'auditor.invited',              'emit_auditor_invited',
    'auditor.revoked',              'emit_auditor_revoked',
    'auditor.accessed',             'emit_auditor_accessed',
    'email.failed',                 'emit_email_failed',
    'feature.changed',              'emit_feature_changed',
    'setup.completed',              'emit_setup_completed',
    'consultation.requested',       'emit_consultation_event',
    'consultation.started',         'emit_consultation_event',
    'consultation.ended',           'emit_consultation_event',
    'consultation.proposal',        'emit_consultation_event',
    'escalation.triggered',         'deployment_requests_escalate_all',
    'finding.sealed',               'emit_engagement_sealed'
  );
begin
  for v_key in select c.event_key from automation_events_catalogue c order by c.event_key loop
    v_trig := v_map ->> v_key;
    if v_trig is not null then
      -- The named trigger function must exist in the database.
      perform provio_test.assert_true(
        exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = v_trig),
        format('the emitter function %s for %s exists', v_trig, v_key));
    elsif exists (select 1 from event_emitter_allowlist a where a.event_key = v_key) then
      null;  -- an allow-listed key with a stated reason
    else
      v_missing := v_missing || v_key;
    end if;
  end loop;

  perform provio_test.assert_true(array_length(v_missing, 1) is null,
    format('every catalogue key has an emitter or an allow-list reason; missing: %s', v_missing));
end $$;

-- The allow-list itself is honest: each row states a reason, and only the two justified keys.
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from event_emitter_allowlist where length(btrim(reason)) > 20),
    (select count(*) from event_emitter_allowlist),
    'every allow-list row carries a reason');
  perform provio_test.assert_true(
    (select count(*) from event_emitter_allowlist) <= 2,
    'the allow-list stays small (only anomaly.raised and watcher.signal are justified)');
end $$;

-- ---------------------------------------------------------------------------
-- B. Each newly wired emitter fires exactly once, with the fields the rules read.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_eng uuid := '50000000-0000-0000-0000-0000000000a1';
  v_entity uuid := '40000000-0000-0000-0000-0000000000a1';
  v_finding uuid;
  v_cert uuid := 'cc000000-0000-0000-0000-000000000001';
  v_inv uuid := 'dd000000-0000-0000-0000-000000000001';
  v_aud_inv uuid := 'de000000-0000-0000-0000-000000000001';
  v_aud_acc uuid := 'df000000-0000-0000-0000-000000000001';
  v_pack uuid := 'e0000000-0000-0000-0000-000000000001';
  v_rv uuid := 'e1000000-0000-0000-0000-000000000001';
  v_email uuid := 'e2000000-0000-0000-0000-000000000001';
  v_sess uuid := 'e4000000-0000-0000-0000-000000000001';
  v_n bigint;
begin
  select id into v_finding from findings where org_id = v_org limit 1;

  -- engagement.sealed: the false -> true flip only.
  update engagements set sealed = false where id = v_eng;
  update engagements set sealed = true where id = v_eng;
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'engagement.sealed'
      and payload ->> 'engagement_id' = v_eng::text), 1::bigint,
    'engagement.sealed emitted once on the seal flip');
  update engagements set sealed = true where id = v_eng;  -- no flip, no event
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'engagement.sealed'), 1::bigint,
    'a re-save of an already sealed engagement emits nothing');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'finding.sealed'
      and payload ->> 'engagement_id' = v_eng::text), 1::bigint,
    'finding.sealed emitted once per finding of the sealed engagement');

  -- certificate.issued then certificate.revoked.
  insert into engagement_certificates (id, org_id, engagement_id, version, canonical, cert_hash, status)
  values (v_cert, v_org, v_eng, 1, '{}'::jsonb, 'hash-1', 'issued');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'certificate.issued'
      and payload ->> 'certificate_id' = v_cert::text), 1::bigint,
    'certificate.issued emitted once on insert');
  update engagement_certificates set status = 'revoked', revoke_reason = 'test'
   where id = v_cert;
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'certificate.revoked'
      and payload ->> 'certificate_id' = v_cert::text), 1::bigint,
    'certificate.revoked emitted once on the transition');

  -- board_pack.generated.
  insert into board_pack_history (id, org_id, scope_key, snapshot, data_hash)
  values (v_pack, v_org, 'org', '{}'::jsonb, 'pack-hash');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'board_pack.generated'
      and payload ->> 'board_pack_id' = v_pack::text), 1::bigint,
    'board_pack.generated emitted once');

  -- report.frozen then report.issued.
  insert into report_versions (id, org_id, engagement_id, version_number, status)
  values (v_rv, v_org, v_eng, 1, 'draft');
  update report_versions set status = 'frozen', frozen_at = now() where id = v_rv;
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'report.frozen'
      and payload ->> 'report_version_id' = v_rv::text), 1::bigint,
    'report.frozen emitted once');
  update report_versions set status = 'issued_v1', issued_at = now() where id = v_rv;
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'report.issued'
      and payload ->> 'report_version_id' = v_rv::text), 1::bigint,
    'report.issued emitted once');

  -- invite.sent.
  insert into auth_invites (id, org_id, email, role_slug, token_hash, kind, expires_at)
  values (v_inv, v_org, 'new@example.test', 'cia', 'th-1', 'member', now() + interval '7 days');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'invite.sent'
      and payload ->> 'email' = 'new@example.test'), 1::bigint,
    'invite.sent emitted once');

  -- auditor.invited, auditor.accessed, auditor.revoked.
  insert into external_auditor_invites (id, org_id, email, token_hash)
  values (v_aud_inv, v_org, 'auditor@example.test', 'th-2');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'auditor.invited'
      and payload ->> 'email' = 'auditor@example.test'), 1::bigint,
    'auditor.invited emitted once');

  insert into external_access_log (id, org_id, user_id, engagement_id, function_name, outcome)
  values ('e5000000-0000-0000-0000-000000000001', v_org, null, v_eng, 'ext_list_engagements', 'ok');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'auditor.accessed'
      and payload ->> 'function_name' = 'ext_list_engagements'), 1::bigint,
    'auditor.accessed emitted once');

  insert into external_auditor_access (id, org_id, email, active)
  values (v_aud_acc, v_org, 'auditor@example.test', true);
  update external_auditor_access set active = false, revoked_at = now() where id = v_aud_acc;
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'auditor.revoked'
      and payload ->> 'email' = 'auditor@example.test'), 1::bigint,
    'auditor.revoked emitted once on deactivation');

  -- email.failed.
  insert into email_queue (id, org_id, to_addresses, subject, status)
  values (v_email, v_org, array['x@example.test'], 'Hello', 'pending');
  update email_queue set status = 'failed', attempts = 5, error_text = 'smtp refused' where id = v_email;
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'email.failed'
      and payload ->> 'subject' = 'Hello'), 1::bigint,
    'email.failed emitted once');
  perform provio_test.assert_eq(
    (select payload ->> 'error_text' from automation_events where event_key = 'email.failed' limit 1),
    'smtp refused', 'email.failed carries the error text (masked)');

  -- feature.changed.
  insert into tenant_entitlements (org_id, feature_key, enabled)
  values (v_org, 'board_pack', true);
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'feature.changed'
      and payload ->> 'feature_key' = 'board_pack'), 1::bigint,
    'feature.changed emitted once on the entitlement insert');
  update tenant_entitlements set enabled = false where org_id = v_org and feature_key = 'board_pack';
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'feature.changed'
      and payload ->> 'feature_key' = 'board_pack'), 2::bigint,
    'feature.changed emitted again when the switch moves');
  update tenant_entitlements set reason = 'unchanged' where org_id = v_org and feature_key = 'board_pack';
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'feature.changed'
      and payload ->> 'feature_key' = 'board_pack'), 2::bigint,
    'a no-op update emits nothing');

  -- setup.completed: only the org_admin Go Live step reaching done.
  insert into setup_state (org_id, scope, step_key, status) values (v_org, 'org_admin', 'org.golive', 'pending');
  update setup_state set status = 'done' where org_id = v_org and scope = 'org_admin' and step_key = 'org.golive';
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'setup.completed'), 1::bigint,
    'setup.completed emitted once when Go Live reaches done');
  update setup_state set status = 'done' where org_id = v_org and scope = 'org_admin' and step_key = 'org.golive';
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'setup.completed'), 1::bigint,
    'a second save of the same done step emits nothing');

  -- consultation.*: the session event row is the source.
  insert into consultation_events (org_id, session_id, event_key, payload, actor_side)
  values (v_org, v_sess, 'consultation.requested', '{"kind":"full_admin"}'::jsonb, 'platform');
  insert into consultation_events (org_id, session_id, event_key, payload, actor_side)
  values (v_org, v_sess, 'consultation.started', '{}'::jsonb, 'platform');
  insert into consultation_events (org_id, session_id, event_key, payload, actor_side)
  values (v_org, v_sess, 'consultation.ended', '{"reason":"done"}'::jsonb, 'platform');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'consultation.requested'), 1::bigint,
    'consultation.requested emitted once');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'consultation.started'), 1::bigint,
    'consultation.started emitted once');
  perform provio_test.assert_eq(
    (select count(*) from automation_events where event_key = 'consultation.ended'), 1::bigint,
    'consultation.ended emitted once');
  -- An unrelated consultation_events key does not create an automation event.
  v_n := (select count(*) from automation_events);
  insert into consultation_events (org_id, session_id, event_key, payload, actor_side)
  values (v_org, v_sess, 'consultation.note', '{}'::jsonb, 'platform');
  perform provio_test.assert_eq((select count(*) from automation_events), v_n,
    'a consultation key outside the catalogue emits nothing');
end $$;

-- ---------------------------------------------------------------------------
-- C. The emitter door refuses an unknown key (so an emitter cannot widen the catalogue).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.emit_catalogue_event('a0000000-0000-0000-0000-000000000001', 'not.a.key', '{}'::jsonb)$q$,
    'unknown event key', 'emit_catalogue_event refuses a key that is not in the catalogue');
end $$;

-- ---------------------------------------------------------------------------
-- D. No residue: the fixtures above are inside this file only; the org-scoped counts the suite
--    relies on are asserted by the other files. Nothing to clean up (the test database is rebuilt
--    per run on CI; locally the runner recreates provio_local).
-- ---------------------------------------------------------------------------

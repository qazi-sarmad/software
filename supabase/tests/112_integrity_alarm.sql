-- Test 112 (T7): the integrity alarm. Detection existed and nothing told a human; this proves the
-- alarm fires on every channel, that the severity split is a rule, that the read surface is gated to
-- an integrity owner, that acknowledgement is an annotation (never an edit) and is ledgered, and that
-- the ledger-continuity check re-verifies the chain and raises an incident when it breaks.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The email channel needs real addresses: integrity_alert_notify reads auth.users for the owners it
-- notifies. The fixture users are seeded in org_members but not in auth.users, so add them here.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'cia@org-a.test'),
  ('10000000-0000-0000-0000-0000000000a3', 'orgadmin@org-a.test'),
  ('10000000-0000-0000-0000-0000000000a4', 'auditmanager@org-a.test'),
  ('10000000-0000-0000-0000-0000000000a2', 'preparer@org-a.test')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- a. The severity rule, as data. A single object that fails to verify is a warning; the trail itself
--    (ledger chain, signature, timestamp) failing is an incident.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_eq(public.integrity_alert_severity('archive_hash_mismatch'), 'warning',
    'T7: a single archive hash mismatch is a warning');
  perform provio_test.assert_eq(public.integrity_alert_severity('evidence_hash_mismatch'), 'warning',
    'T7: a single evidence hash mismatch is a warning');
  perform provio_test.assert_eq(public.integrity_alert_severity('ledger_chain_broken'), 'incident',
    'T7: a broken ledger chain is an incident');
  perform provio_test.assert_eq(public.integrity_alert_severity('ledger_chain_gap'), 'incident',
    'T7: a ledger chain gap is an incident');
  perform provio_test.assert_eq(public.integrity_alert_severity('signature_invalid'), 'incident',
    'T7: an invalid signature is an incident');
  perform provio_test.assert_eq(public.integrity_alert_severity('timestamp_invalid'), 'incident',
    'T7: an invalid timestamp is an incident');
  perform provio_test.assert_eq(public.integrity_alert_severity('something_new'), 'warning',
    'T7: an unknown kind is never silently upgraded to an incident');
end $$;

-- ---------------------------------------------------------------------------
-- b. Raising an alert notifies on every channel: an in-app notification to each integrity owner, an
--    email to the same owners, and an automation event. It also writes the alert and a ledger entry.
--    Org A's owners are cia_a (review_and_approve) and orgadmin_a (edit_config); preparer_a (only
--    perform_work) must NOT be notified.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  v_id uuid;
begin
  v_id := public.raise_integrity_alert(
    'a0000000-0000-0000-0000-000000000001', 'archive_hash_mismatch', 'archive_job',
    'c2000000-0000-0000-0000-000000000001', repeat('a', 64), repeat('b', 64));
  perform provio_test.assert_true(v_id is not null, 'T7: an alert is recorded');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where action = 'integrity_alert'),
    'T7: raising an alert appends a ledger entry');
end $$;

do $$
declare
  v_n int;
begin
  -- In-app notifications to the org's three integrity owners: cia_a (review_and_approve +
  -- edit_config), orgadmin_a (edit_config) and audit_manager_a (review_and_approve).
  select count(*) into v_n from notifications
   where org_id = 'a0000000-0000-0000-0000-000000000001' and kind = 'integrity_alert';
  perform provio_test.assert_eq(v_n, 3, 'T7: every integrity owner is notified in-app');

  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and user_id = '10000000-0000-0000-0000-0000000000a1'
               and kind = 'integrity_alert'),
    'T7: the review_and_approve owner is notified');
  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and user_id = '10000000-0000-0000-0000-0000000000a3'
               and kind = 'integrity_alert'),
    'T7: the edit_config owner is notified');
  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and user_id = '10000000-0000-0000-0000-0000000000a4'
               and kind = 'integrity_alert'),
    'T7: the audit-manager owner is notified');
  perform provio_test.assert_true(
    not exists (select 1 from notifications
                 where org_id = 'a0000000-0000-0000-0000-000000000001'
                   and user_id = '10000000-0000-0000-0000-0000000000a2'
                   and kind = 'integrity_alert'),
    'T7: a caller with no integrity right is not notified');

  -- The email path.
  perform provio_test.assert_true(
    exists (select 1 from email_queue
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and metadata ->> 'kind' = 'integrity_alert'),
    'T7: an integrity email is queued to the owners');

  -- The automation event (the Work Queue / rule-engine path).
  perform provio_test.assert_true(
    exists (select 1 from automation_events
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and event_key = 'integrity.alert'),
    'T7: an automation event is raised for the Work Queue');
end $$;

-- The payload carries the severity, so a downstream rule can split incident from warning.
do $$
begin
  perform provio_test.assert_eq(
    (select payload ->> 'severity' from automation_events
      where event_key = 'integrity.alert' and org_id = 'a0000000-0000-0000-0000-000000000001'
      order by created_at desc limit 1),
    'warning', 'T7: the automation event carries the severity');
end $$;

-- ---------------------------------------------------------------------------
-- c. The read surface is gated to an integrity owner and annotates severity. Org B sees only its own
--    alerts; a caller with no right is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
begin
  perform public.raise_integrity_alert(
    'b0000000-0000-0000-0000-000000000001', 'ledger_chain_broken', 'ledger', null, null, null,
    '{"first_broken_seq": 3}'::jsonb);
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_n int;
  v_sev text;
begin
  select count(*) into v_n from public.integrity_alerts_list();
  perform provio_test.assert_eq(v_n, 1, 'T7: Org A sees only its own single alert');
  select severity into v_sev from public.integrity_alerts_list() limit 1;
  perform provio_test.assert_eq(v_sev, 'warning', 'T7: the warning is annotated as a warning');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_sev text;
begin
  perform provio_test.assert_eq(
    (select count(*) from public.integrity_alerts_list()), 1::bigint,
    'T7: Org B sees only its own alert');
  select severity into v_sev from public.integrity_alerts_list() limit 1;
  perform provio_test.assert_eq(v_sev, 'incident', 'T7: a broken ledger chain is annotated as an incident');
end $$;
select provio_test.as_owner();

-- A caller without an integrity right cannot read the alarm.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises('select * from public.integrity_alerts_list()',
    'an integrity owner is required', 'T7: a caller with no integrity right cannot read the alarm');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- d. Acknowledgement is an annotation, never an edit: the alert row's own values are unchanged, and
--    the annotation is ledgered. Acknowledge twice is idempotent on the timestamp.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_first timestamptz;
begin
  select id into v_id from integrity_alerts
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform public.integrity_alert_acknowledge(v_id);
  select acknowledged_at into v_first from integrity_alerts where id = v_id;
  perform provio_test.assert_true(v_first is not null, 'T7: acknowledgement records a timestamp');
  perform provio_test.assert_eq(
    (select acknowledged_by from integrity_alerts where id = v_id),
    '10000000-0000-0000-0000-0000000000a1'::uuid, 'T7: acknowledgement records who saw it');
  -- The alert's own values are untouched.
  perform provio_test.assert_eq(
    (select kind from integrity_alerts where id = v_id), 'archive_hash_mismatch',
    'T7: acknowledgement never edits the alert kind');

  perform public.integrity_alert_acknowledge(v_id);
  perform provio_test.assert_eq(
    (select acknowledged_at from integrity_alerts where id = v_id), v_first,
    'T7: acknowledging twice does not move the timestamp');

  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where action = 'integrity_alert_acknowledged'),
    'T7: the acknowledgement is ledgered');
end $$;
select provio_test.as_owner();

-- A caller cannot acknowledge an alert in another organisation.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_other uuid;
begin
  select id into v_other from integrity_alerts
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_raises(
    format('select public.integrity_alert_acknowledge(%L)', v_other),
    'no such integrity alert', 'T7: an alert in another org cannot be acknowledged');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- e. The ledger-continuity check. An intact chain returns null and raises nothing; a broken chain
--    returns the first broken sequence and raises an INCIDENT.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_before int;
  v_after int;
  v_broken bigint;
begin
  select count(*) into v_before from integrity_alerts where kind = 'ledger_chain_broken';

  -- The seeded ledger has one row, so the chain is trivially intact.
  v_broken := public.ledger_continuity_check();
  perform provio_test.assert_eq(v_broken, null::bigint, 'T7: an intact chain returns null');
  select count(*) into v_after from integrity_alerts where kind = 'ledger_chain_broken';
  perform provio_test.assert_eq(v_after, v_before, 'T7: an intact chain raises no incident');
end $$;
select provio_test.as_owner();

-- Break the chain: tamper a committed payload so the stored hash no longer matches. The append-only
-- trigger is disabled deliberately (a test-only write as the owner, exactly as test 10 does),
-- modelling the out-of-band tamper the alarm exists to catch.
do $$
begin
  alter table ledger_entries disable trigger ledger_entries_append_only;
  update ledger_entries set payload = '{"org":"TAMPERED"}'
   where org_id = 'a0000000-0000-0000-0000-000000000001' and seq = 1;
  alter table ledger_entries enable trigger ledger_entries_append_only;
end $$;

-- The tamper alone raises nothing: detection is on demand (the scheduled sweep is Builder A's).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_n int;
begin
  select count(*) into v_n from integrity_alerts
   where org_id = 'a0000000-0000-0000-0000-000000000001' and kind = 'ledger_chain_broken';
  perform provio_test.assert_eq(v_n, 0, 'T7: the tamper alone raises nothing until it is checked');
end $$;
select provio_test.as_owner();

-- The continuity check, as the signed-in integrity owner, finds the break and raises an INCIDENT.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_seq bigint;
begin
  select seq into v_seq from ledger_entries
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by seq limit 1;

  perform provio_test.assert_eq(public.ledger_continuity_check(), v_seq,
    'T7: the continuity check finds the first broken sequence');

  perform provio_test.assert_true(
    exists (select 1 from integrity_alerts
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and kind = 'ledger_chain_broken'),
    'T7: the broken chain raises an incident');
  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and kind = 'integrity_alert'
               and payload ->> 'kind' = 'ledger_chain_broken'),
    'T7: the incident notifies on the in-app channel');
end $$;
select provio_test.as_owner();

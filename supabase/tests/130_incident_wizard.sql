-- Test 130 (T6): the guided integrity incident wizard.
--
-- Proves: an alert opens (idempotently) into an incident that resolves what it affects; every guided
-- step requires a reason and appends to the ledger; the append-only trail is immutable; the outcome
-- of each action is computed deterministically (restore proves agreement or its absence, re-derive
-- re-folds the graph root, freeze blocks the engagement, escalate notifies the platform admin);
-- verification closes on proof; the incident read is rights-gated; org B cannot see org A's incident.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 0. An evidence file in org A whose stored hash is the TAMPERED value, and an integrity alert on it
--    (the sealed hash is what the alert expects; the record now holds something else).
-- ===========================================================================
select provio_test.as_owner();
insert into evidence_files (id, org_id, engagement_id, workpaper_id, filename, content_sha256, created_by)
values ('e0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
        'bank-confirmation.pdf', repeat('2', 64), '10000000-0000-0000-0000-0000000000a1');

do $$
declare v_alert uuid;
begin
  v_alert := public.raise_integrity_alert(
    'a0000000-0000-0000-0000-000000000001', 'evidence_hash_mismatch', 'evidence_file',
    'e0000000-0000-0000-0000-0000000000a1', repeat('1', 64), repeat('2', 64),
    jsonb_build_object('filename', 'bank-confirmation.pdf'));
  perform provio_test.assert_true(v_alert is not null, 'T6: an alert was raised');
end $$;

-- ===========================================================================
-- 1. The engagement resolution maps the affected object to its engagement (as a signed-in owner).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    public.integrity_incident_engagement('evidence_file', 'e0000000-0000-0000-0000-0000000000a1'),
    '50000000-0000-0000-0000-0000000000a1'::uuid,
    'T6: an evidence file resolves to its engagement');
  perform provio_test.assert_true(
    public.integrity_incident_engagement('ledger', null) is null,
    'T6: an org-level object resolves to no engagement');
end $$;

-- ===========================================================================
-- 2. A preparer (no integrity right) cannot open or read an incident.
-- ===========================================================================
-- Resolve the alert id as a signed-in owner first; the preparer cannot list it.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
create temp table t6_alert as select id from public.integrity_alerts_list() limit 1;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_alert uuid;
begin
  select id into v_alert from t6_alert;
  perform provio_test.assert_raises(
    format('select public.integrity_incident_open(%L)', v_alert),
    'not permitted', 'T6: a Preparer may not open an incident');
  perform provio_test.assert_raises(
    'select * from public.integrity_incidents_list()',
    'not permitted', 'T6: a Preparer may not list incidents');
end $$;

-- ===========================================================================
-- 3. A CIA (integrity owner) opens the incident; it is idempotent per alert.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_alert uuid;
  v_first uuid;
  v_second uuid;
begin
  select id into v_alert from t6_alert;

  v_first := public.integrity_incident_open(v_alert);
  v_second := public.integrity_incident_open(v_alert);
  perform provio_test.assert_true(v_first is not null, 'T6: the incident opens');
  perform provio_test.assert_eq(v_second, v_first, 'T6: opening twice returns the same incident');

  perform provio_test.assert_eq(
    (select engagement_id from integrity_incidents where id = v_first),
    '50000000-0000-0000-0000-0000000000a1'::uuid,
    'T6: the incident records what it affects');
  perform provio_test.assert_eq(
    (select count(*) from integrity_incident_actions where incident_id = v_first and action = 'open'),
    1::bigint, 'T6: the trail has exactly one open row');
end $$;

-- ===========================================================================
-- 4. Every action requires a reason.
-- ===========================================================================
do $$
declare v_inc uuid;
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_raises(
    format('select public.integrity_incident_action(%L, ''annotate'', '''')', v_inc),
    'a_reason_is_required', 'T6: an empty reason is refused');
  perform provio_test.assert_raises(
    format('select public.integrity_incident_action(%L, ''annotate'', null)', v_inc),
    'a_reason_is_required', 'T6: a null reason is refused');
  perform provio_test.assert_raises(
    format('select public.integrity_incident_action(%L, ''nonsense'', ''why'')', v_inc),
    'unknown incident action', 'T6: an unknown action is refused');
end $$;

-- ===========================================================================
-- 5. The outcomes are computed, not asserted. Restore proves agreement: the record still holds the
--    tampered hash, so it reports 'still_mismatched' — never success.
-- ===========================================================================
do $$
declare v_inc uuid;
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_eq(
    public.integrity_incident_action(v_inc, 'restore', 'attempted a restore from the sealed copy'),
    'still_mismatched', 'T6: restore reports the mismatch honestly');
  perform provio_test.assert_eq(
    public.integrity_incident_action(v_inc, 'rederive', 're-derived the root from the facts'),
    'not_applicable', 'T6: re-derive says not_applicable for an evidence file');
end $$;

-- ===========================================================================
-- 6. Escalate notifies the platform admin and records the step.
-- ===========================================================================
do $$
declare v_inc uuid;
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_eq(
    public.integrity_incident_action(v_inc, 'escalate', 'escalated to the platform admin'),
    'escalated', 'T6: escalate records its outcome');
end $$;

select provio_test.as_owner();
do $$
begin
  -- The org's own integrity owners get an in-app notification (the org keeps a record)...
  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and user_id = '10000000-0000-0000-0000-0000000000a1'
               and kind = 'integrity_incident_escalated'),
    'T6: the org''s integrity owner is notified in-app');
  -- ...the automation event fires...
  perform provio_test.assert_true(
    exists (select 1 from automation_events
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and event_key = 'integrity.incident_escalated'),
    'T6: the escalation raises the automation event');
  -- ...and a durable platform-side trace exists that needs no org membership.
  perform provio_test.assert_true(
    exists (select 1 from platform_trail
             where action = 'integrity_incident_escalated'
               and tenant_id = 'a0000000-0000-0000-0000-000000000001'),
    'T6: the escalation is recorded on the platform trail');
end $$;

-- ===========================================================================
-- 7. Freeze blocks the engagement from moving or sealing, and the wizard reports it.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_inc uuid;
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_eq(
    public.integrity_incident_action(v_inc, 'freeze', 'froze the engagement pending investigation'),
    'frozen', 'T6: freeze records its outcome');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    (select frozen_at is not null from engagements where id = '50000000-0000-0000-0000-0000000000a1'),
    'T6: the engagement is frozen');
  perform provio_test.assert_raises(
    $q$update engagements set stage = 'conclusion' where id = '50000000-0000-0000-0000-0000000000a1'$q$,
    'engagement_frozen', 'T6: a frozen engagement cannot move');
  perform provio_test.assert_raises(
    $q$update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a1'$q$,
    'engagement_frozen', 'T6: a frozen engagement cannot seal');
  perform provio_test.assert_true(
    (select frozen_reason from engagements where id = '50000000-0000-0000-0000-0000000000a1')
      = 'froze the engagement pending investigation',
    'T6: the freeze reason is preserved');
end $$;

-- ===========================================================================
-- 8. Verify records the closing proof (still a mismatch, because the hash still diverges).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_inc uuid;
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_eq(
    public.integrity_incident_verify(v_inc),
    'mismatch', 'T6: verification reports the mismatch that closes or holds the incident');
end $$;

-- ===========================================================================
-- 9. The trail is append-only and complete.
-- ===========================================================================
select provio_test.as_owner();
do $$
declare
  v_inc uuid;
  v_actions text[];
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  select array_agg(action order by created_at, id) into v_actions
    from integrity_incident_actions where incident_id = v_inc;
  perform provio_test.assert_eq(v_actions[1], 'open', 'T6: the trail starts with open');
  perform provio_test.assert_true('restore' = any(v_actions), 'T6: the restore step is in the trail');
  perform provio_test.assert_true('escalate' = any(v_actions), 'T6: the escalate step is in the trail');
  perform provio_test.assert_true('freeze' = any(v_actions), 'T6: the freeze step is in the trail');
  perform provio_test.assert_true('verify' = any(v_actions), 'T6: the verify step is in the trail');

  perform provio_test.assert_raises(
    format('update integrity_incident_actions set reason = ''edited'' where incident_id = %L', v_inc),
    'append-only', 'T6: the incident trail cannot be edited');
  perform provio_test.assert_raises(
    format('delete from integrity_incident_actions where incident_id = %L', v_inc),
    'append-only', 'T6: the incident trail cannot be deleted');
end $$;

-- The incident header is immutable for an application role: no update grant, no update policy.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_inc uuid;
begin
  select id into v_inc from integrity_incidents
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform provio_test.assert_raises(
    format('update integrity_incidents set kind = ''edited'' where id = %L', v_inc),
    'permission denied', 'T6: the incident header cannot be edited');
end $$;

-- ===========================================================================
-- 10. Every step is ledged.
-- ===========================================================================
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and action = 'integrity_incident_opened'),
    'T6: opening the incident is ledged');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and action = 'integrity_incident_freeze'),
    'T6: the freeze step is ledged');
end $$;

-- ===========================================================================
-- 11. The list read is gated and org-scoped: org A sees its incident, org B sees none.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_actions jsonb;
begin
  perform provio_test.assert_eq(
    (select count(*) from public.integrity_incidents_list()),
    1::bigint, 'T6: org A sees its one incident');
  select actions into v_actions from public.integrity_incidents_list();
  perform provio_test.assert_true(jsonb_array_length(v_actions) >= 6,
    'T6: the incident carries its full trail');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.integrity_incidents_list()),
    0::bigint, 'T6: org B sees none of org A''s incidents');
end $$;

-- ===========================================================================
-- 12. A ledger incident: re-derive and verify walk the chain.
-- ===========================================================================
select provio_test.as_owner();
do $$
declare v_alert uuid;
begin
  -- Raise the ledger incident the way the alarm's own continuity check does on a break: a
  -- ledger_chain_broken alert on the ledger object. (The seeded chain's state is not asserted here;
  -- what is proved is that a ledger incident re-derives and verifies the chain rather than a record.)
  v_alert := public.raise_integrity_alert(
    'a0000000-0000-0000-0000-000000000001', 'ledger_chain_broken', 'ledger', null, null, null,
    jsonb_build_object('first_broken_seq', 1));
  perform provio_test.assert_true(v_alert is not null, 'T6: a ledger-chain alert exists');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_alert uuid;
  v_inc uuid;
begin
  select id into v_alert from public.integrity_alerts_list() where kind = 'ledger_chain_broken' limit 1;
  perform provio_test.assert_true(v_alert is not null, 'T6: the ledger alert is readable by an owner');

  v_inc := public.integrity_incident_open(v_alert);
  perform provio_test.assert_true(
    (select engagement_id is null from integrity_incidents where id = v_inc),
    'T6: a ledger incident affects no single engagement');
  perform provio_test.assert_true(
    public.integrity_incident_action(v_inc, 'rederive', 're-walked the chain') in ('intact', 'broken'),
    'T6: re-derive walks the ledger chain');
  perform provio_test.assert_true(
    public.integrity_incident_verify(v_inc) in ('intact', 'broken'),
    'T6: verify walks the ledger chain');
end $$;

select provio_test.as_owner();


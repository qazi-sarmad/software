-- Test 115 (Phase 5, C4/C5/C6): act on an alert.
--
-- C3 (0113) delivered an alert to the people who can triage it. This test proves the things they can
-- then DO, all pre-filled from the C2 enrichment (0112), and that each is gated by the right it
-- needs:
--   C4  an ad-hoc audit suggestion pre-filled with entity / department / controls, raised as a
--       pending ad-hoc plan item through add_plan_item (so the plan's approval rule is unchanged).
--   C5  raise a finding (observation -> finding with the mandatory readability sections), raise a
--       CAP on the register, request evidence, escalate into an observation.
--   C6  the remediation actions are gated: a member without perform_work cannot raise a finding.
--
-- The fixtures are the seed (00_lib.sql) plus a population-linked staged record, so the alert's
-- enrichment (and therefore the pre-fill) is the real resolved chain, not an asserted-around one.
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'cia@orga.test'),
  ('10000000-0000-0000-0000-0000000000a2', 'preparer@orga.test')
on conflict (id) do update set email = excluded.email;

-- Build the enrichment chain: publish the SIRA cycle, set the entity kind, link a staged record to
-- the population, then write one alert through alert_record so the alert carries the linkage.
select provio_test.as_owner();
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  update entities set kind = 'Treasury' where id = '40000000-0000-0000-0000-0000000000a1';
  update sira_scores set factor_values = '{"inherent_risk": 4}'
   where org_id = v_org and cycle_id = 'a1000000-0000-0000-0000-0000000000a1';
  update sira_cycles set status = 'published', published_at = now()
   where id = 'a1000000-0000-0000-0000-0000000000a1';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'ledger-feed',
  'Test ledger', '{}'::jsonb, null);
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
  null, 'ledger', 'c4e1', repeat('c', 64), '2026-10-27T10:00:00.000Z'::timestamptz,
  '{"amount":500}', '[]');
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  update staged_records set population_id = '70000000-0000-0000-0000-0000000000a1'
   where org_id = v_org and source = 'ledger' and source_id = 'c4e1';
end $$;

-- One alert, written as the org's CIA through the real path, so its enrichment is resolved.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.alert_record('a0000000-0000-0000-0000-000000000001', 'mon.c4', 1, 'threshold',
  'the ledger balance is 9, which is gt the threshold 8',
  jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:c4e1', 'contentHash', repeat('c', 64))),
  now(), null, repeat('7', 64));

-- ===========================================================================
-- C4. The suggestion is pre-filled from the enrichment.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert uuid;
  v_sug jsonb;
begin
  select id into v_alert from monitor_alerts where org_id = v_org and rule_id = 'mon.c4';
  v_sug := public.alert_adhoc_suggestion(v_org, v_alert);

  perform provio_test.assert_eq(v_sug->>'entity_id', '40000000-0000-0000-0000-0000000000a1',
    'C4: the suggestion carries the resolved entity');
  perform provio_test.assert_eq(v_sug->>'department', 'Treasury',
    'C4: the suggestion carries the department');
  perform provio_test.assert_eq(v_sug->>'engagement_id', '50000000-0000-0000-0000-0000000000a1',
    'C4: the suggestion carries the resolved engagement');
  perform provio_test.assert_eq((v_sug->>'control_count')::int, 1,
    'C4: the suggestion carries the affected controls');
  perform provio_test.assert_eq(v_sug->>'plan_id', 'a2000000-0000-0000-0000-0000000000a1',
    'C4: the suggestion points at the newest draft plan for the alert universe');
  perform provio_test.assert_true((v_sug->>'title') like 'Ad-hoc audit:%',
    'C4: the suggestion carries a pre-filled title');
  perform provio_test.assert_true((v_sug->>'justification') like '%mon.c4%',
    'C4: the suggestion carries a justification naming the rule');
end $$;

-- Raising it creates a pending ad-hoc plan item, through add_plan_item.
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert uuid;
  v_item uuid;
  v_status text;
  v_adhoc boolean;
begin
  select id into v_alert from monitor_alerts where org_id = v_org and rule_id = 'mon.c4';
  v_item := public.alert_adhoc_audit_raise(v_org, v_alert,
    'a2000000-0000-0000-0000-0000000000a1', null, null, '2026-11-01'::date, '2026-11-30'::date);

  select status, is_adhoc into v_status, v_adhoc from plan_items where id = v_item;
  perform provio_test.assert_eq(v_status, 'pending_adhoc',
    'C4: the raised audit is a pending ad-hoc item');
  perform provio_test.assert_true(v_adhoc, 'C4: the item is flagged ad-hoc');
  perform provio_test.assert_eq(
    (select entity_id from plan_items where id = v_item), '40000000-0000-0000-0000-0000000000a1',
    'C4: the item carries the alert entity');
  perform provio_test.assert_eq(
    (select justification from plan_items where id = v_item) like '%mon.c4%', true,
    'C4: the item justification names the rule');
end $$;

-- A plan that does not exist is refused (delegation keeps the plan rule intact).
do $$
begin
  perform provio_test.assert_raises(
    format('select public.alert_adhoc_audit_raise(%L, %L, null, null, null)',
      'a0000000-0000-0000-0000-000000000001',
      (select id from monitor_alerts where rule_id = 'mon.c4')),
    'needs a plan', 'C4: an ad-hoc audit without a plan is refused');
end $$;

-- ===========================================================================
-- C5. Raise a finding from the alert, with the readability sections pre-filled.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert uuid;
  v_finding uuid;
  v_obs uuid;
  v_sections jsonb;
begin
  select id into v_alert from monitor_alerts where org_id = v_org and rule_id = 'mon.c4';
  v_finding := public.alert_raise_finding(v_org, v_alert, '50000000-0000-0000-0000-0000000000a1', null, null, null, null, null);

  select observation_id into v_obs from findings where id = v_finding;
  perform provio_test.assert_true(v_obs is not null, 'C5: a finding was created from the alert');

  select sections into v_sections from observations where id = v_obs;
  -- The four mandatory tags are all non-empty, so promote_to_finding passed on real content.
  perform provio_test.assert_true(btrim(coalesce(v_sections->>'context', '')) <> '',
    'C5: the finding context is pre-filled');
  perform provio_test.assert_true(btrim(coalesce(v_sections->>'condition', '')) <> '',
    'C5: the finding condition is the alert reason');
  perform provio_test.assert_true(btrim(coalesce(v_sections->>'effect', '')) <> '',
    'C5: the finding effect is pre-filled');
  perform provio_test.assert_true(btrim(coalesce(v_sections->>'risk', '')) <> '',
    'C5: the finding risk is pre-filled');
  perform provio_test.assert_eq(v_sections->>'alert_id', v_alert::text,
    'C5: the observation records the alert it came from');
  perform provio_test.assert_true(public.check_readability(v_obs),
    'C5: the pre-filled observation passes the readability check');
end $$;

-- Raise a CAP on the register for that finding.
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert uuid;
  v_finding uuid;
  v_cap uuid;
begin
  select id into v_alert from monitor_alerts where org_id = v_org and rule_id = 'mon.c4';
  select f.id into v_finding from findings f
    join observations o on o.id = f.observation_id
   where o.sections->>'alert_id' = v_alert::text limit 1;

  v_cap := public.alert_raise_cap(v_org, v_alert, v_finding, null, '2026-12-01'::date, null);
  perform provio_test.assert_eq((select finding_id from caps where id = v_cap), v_finding,
    'C5: the CAP names the finding');
  perform provio_test.assert_eq((select responsible_dept from caps where id = v_cap), 'Treasury',
    'C5: the CAP responsible department defaults to the alert department');
  perform provio_test.assert_eq((select status from caps where id = v_cap), 'open',
    'C5: the CAP starts open');
end $$;

-- Request evidence.
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert uuid;
  v_req uuid;
begin
  select id into v_alert from monitor_alerts where org_id = v_org and rule_id = 'mon.c4';
  v_req := public.alert_request_evidence(v_org, v_alert, '50000000-0000-0000-0000-0000000000a1',
    'Treasury operations', 'The bank reconciliation for October.', '2026-11-15'::date);
  perform provio_test.assert_eq((select status from evidence_requests where id = v_req), 'open',
    'C5: the evidence request is open');
  perform provio_test.assert_eq((select alert_id from evidence_requests where id = v_req), v_alert,
    'C5: the evidence request names the alert');

  perform provio_test.assert_raises(
    format('select public.alert_request_evidence(%L, %L, null, %L, %L)',
      v_org, v_alert, '', 'something'),
    'needs who', 'C5: an evidence request without a requester is refused');
end $$;

-- Escalate into an observation; the triage row links to it.
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert uuid;
  v_obs uuid;
begin
  select id into v_alert from monitor_alerts where org_id = v_org and rule_id = 'mon.c4';
  v_obs := public.alert_escalate(v_org, v_alert, '50000000-0000-0000-0000-0000000000a1', null);
  perform provio_test.assert_true(v_obs is not null, 'C5: escalation creates an observation');
  perform provio_test.assert_eq(
    (select disposition from alert_triage where org_id = v_org and alert_id = v_alert), 'escalated',
    'C5: escalation records the disposition through alert_triage_record');
  perform provio_test.assert_eq(
    (select observation_id from alert_triage where org_id = v_org and alert_id = v_alert), v_obs,
    'C5: the triage row is linked to the observation it created');
end $$;

-- ===========================================================================
-- C6. The remediation actions are gated by the right they need. A member without perform_work
--     (the org admin here) cannot raise a finding from an alert.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    format('select public.alert_raise_finding(%L, %L, %L)',
      'a0000000-0000-0000-0000-000000000001',
      (select id from monitor_alerts where rule_id = 'mon.c4'),
      '50000000-0000-0000-0000-0000000000a1'),
    'perform_work', 'C6: a caller without perform_work cannot raise a finding');
end $$;

-- ===========================================================================
-- 7. Cross-organisation: org B cannot act on org A's alert.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    format('select public.alert_adhoc_suggestion(%L, %L)',
      'a0000000-0000-0000-0000-000000000001',
      (select id from monitor_alerts where rule_id = 'mon.c4')),
    'not the caller', 'C6: org B cannot read org A''s alert suggestion');
  perform provio_test.assert_raises(
    format('select public.alert_raise_finding(%L, %L, %L)',
      'a0000000-0000-0000-0000-000000000001',
      (select id from monitor_alerts where rule_id = 'mon.c4'),
      '50000000-0000-0000-0000-0000000000a1'),
    'not the caller', 'C6: org B cannot raise a finding on org A''s alert');
end $$;

-- ===========================================================================
-- 8. RLS on evidence_requests and the grants.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'evidence_requests' and c.relrowsecurity)::int, 1,
    'C5: evidence_requests has RLS enabled');
  perform provio_test.assert_eq(
    (select count(*) from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = 'evidence_requests'
        and g.grantee in ('anon', 'authenticated', 'public')
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int, 0,
    'C5: evidence_requests takes no direct write from a tenant');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.alert_raise_finding(uuid, uuid, uuid, text, text, text, text, text)', 'execute'),
    'C5: anon cannot raise a finding from an alert');
  perform provio_test.assert_true(
    has_function_privilege('authenticated', 'public.alert_raise_finding(uuid, uuid, uuid, text, text, text, text, text)', 'execute'),
    'C5: a signed-in tenant can call alert_raise_finding');
end $$;

select provio_test.as_owner();

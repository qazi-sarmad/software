-- Test 112 (Phase 5, C1): the monitor runner and the automation-event dispatcher.
--
-- Before migration 0111 the monitor engine existed in TypeScript only: `runMonitors` had no
-- production caller, `automation_events` was written but never drained, and no monitor rule ever
-- produced an alert. 0111 adds `monitor_runner_sweep`, which evaluates every released rule over an
-- organisation's staged records (writing a hash-chained alert per firing rule), and
-- `automation_dispatch_pending`, which drains the event outbox through `rule_engine_process` and
-- `escalation_evaluate` without a trigger.
--
-- The lineage hash is the load-bearing value: `monitor_alert_chain` builds the alert hash from it,
-- so the SQL evaluation must reproduce the TypeScript engine's `hashParts` byte for byte. The
-- constants in section 2 were produced by src/lib/writing/monitors.ts (`evaluateMonitor`) over the
-- fixtures below and are pinned here; src/lib/writing/monitorRunnerParity.test.ts asserts the same
-- constants through the TypeScript engine, so a drift between the two implementations fails.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. The coercion helpers mirror the TypeScript engine's toNumber / cmp.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(public.monitor_to_number('150'::jsonb), 150::numeric,
    'C1: a numeric string coerces to its number');
  perform provio_test.assert_eq(public.monitor_to_number('150.50'::jsonb), 150.5::numeric,
    'C1: a fixed-scale decimal string coerces');
  perform provio_test.assert_eq(public.monitor_to_number('true'::jsonb), 1::numeric,
    'C1: a boolean true coerces to 1');
  perform provio_test.assert_eq(public.monitor_to_number('false'::jsonb), 0::numeric,
    'C1: a boolean false coerces to 0');
  perform provio_test.assert_eq(public.monitor_to_number('"nonsense"'::jsonb), 0::numeric,
    'C1: a non-numeric string coerces to 0, as Number() would');
  perform provio_test.assert_eq(public.monitor_to_number('""'::jsonb), 0::numeric,
    'C1: an empty string coerces to 0');
  perform provio_test.assert_eq(public.monitor_to_number('null'::jsonb), 0::numeric,
    'C1: null coerces to 0');
  perform provio_test.assert_eq(public.monitor_to_number('"8"'::jsonb), 8::numeric,
    'C1: a numeric string parses');

  perform provio_test.assert_true(public.monitor_cmp(150, 100, 'gt'), 'C1: 150 gt 100');
  perform provio_test.assert_true(not public.monitor_cmp(100, 100, 'gt'), 'C1: 100 not gt 100');
  perform provio_test.assert_true(public.monitor_cmp(100, 100, 'gte'), 'C1: 100 gte 100');
  perform provio_test.assert_true(public.monitor_cmp(90, 100, 'lt'), 'C1: 90 lt 100');
  perform provio_test.assert_true(public.monitor_cmp(100, 100, 'lte'), 'C1: 100 lte 100');
  perform provio_test.assert_true(public.monitor_cmp(100, 100, 'eq'), 'C1: 100 eq 100');
  perform provio_test.assert_true(not public.monitor_cmp(100, 100, 'bogus'),
    'C1: an unknown comparison never fires');

  perform provio_test.assert_eq(public.monitor_number_text(8.0), '8', 'C1: 8.0 renders as 8');
  perform provio_test.assert_eq(public.monitor_number_text(8.5), '8.5', 'C1: 8.5 renders as 8.5');
end $$;

-- ===========================================================================
-- 2. The lineage hash matches the TypeScript engine byte for byte.
--    The expected values were produced by src/lib/writing/monitors.ts over the same inputs.
-- ===========================================================================
do $$
declare
  v_refs jsonb := jsonb_build_array(
    jsonb_build_object('type', 'signal', 'id', 'ledger:s3', 'contentHash', repeat('c', 64)));
begin
  perform provio_test.assert_eq(
    public.monitor_lineage_hash('mon.t.amount', 1, 'threshold', '2026-10-28T00:00:00.000Z', null, v_refs),
    'd044ab777adea29b57d7d5db8d317c922dc9c7d8f07cdf4aeaaf1c0d071b57d5',
    'C1: the threshold lineage hash matches the engine');
  perform provio_test.assert_eq(
    public.monitor_lineage_hash('mon.rec', 1, 'reconciliation', '2026-10-28T00:00:00.000Z', null,
      jsonb_build_array(
        jsonb_build_object('type', 'signal', 'id', 'bank:s1', 'contentHash', repeat('a', 64)),
        jsonb_build_object('type', 'signal', 'id', 'bank:s2', 'contentHash', repeat('b', 64)),
        jsonb_build_object('type', 'signal', 'id', 'ledger:s3', 'contentHash', repeat('c', 64)))),
    '25f6e1814ad811930e1bd2a008c4c5cbdf987fe10f6951e79f7cb92117fa75f9',
    'C1: the reconciliation lineage hash matches the engine');
  perform provio_test.assert_eq(
    public.monitor_lineage_hash('mon.rate', 1, 'rate', '2026-10-28T00:00:00.000Z', '2026-10-27T23:58:00.000Z',
      jsonb_build_array(
        jsonb_build_object('type', 'signal', 'id', 'bank:s1', 'contentHash', repeat('a', 64)),
        jsonb_build_object('type', 'signal', 'id', 'bank:s2', 'contentHash', repeat('b', 64)),
        jsonb_build_object('type', 'signal', 'id', 'ledger:s3', 'contentHash', repeat('c', 64)))),
    '5eb561d79be5d2a55a474293bc1a3cb24db0acea9e697e7a9c164ea62d2780e1',
    'C1: the rate lineage hash matches the engine, window start included');
end $$;

-- ===========================================================================
-- 3. monitor_evaluate_org: every kind fires on the shared fixtures and writes the pinned alert.
--    The fixtures are the same three staged records the TypeScript parity test uses.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'bank-statement',
  'Test bank', '{}'::jsonb, null);
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
  null, 'bank', 's1', repeat('a', 64), '2026-10-27T23:58:00.000Z'::timestamptz,
  '{"amount":150,"step_a":1}', '["reconciled"]');
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
  null, 'bank', 's2', repeat('b', 64), '2026-10-27T23:59:30.000Z'::timestamptz,
  '{"amount":90,"step_b":1}', '[]');
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
  null, 'ledger', 's3', repeat('c', 64), '2026-10-27T23:59:45.000Z'::timestamptz,
  '{"amount":250}', '["reconciled"]');
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alerts int;
begin
  insert into monitor_rules (org_id, rule_id, version, kind, description, spec, status)
  values
    (v_org, 'mon.t.amount', 1, 'threshold', 'amount over 100',
     '{"field":"amount","comparison":"gt","threshold":"100"}'::jsonb, 'released'),
    (v_org, 'mon.rate', 1, 'rate', 'rate at least 2 in 120s',
     '{"windowSeconds":120,"comparison":"gte","threshold":"2"}'::jsonb, 'released'),
    (v_org, 'mon.seq', 1, 'sequence', 'step a then b',
     '{"sequence":["step_a","step_b"]}'::jsonb, 'released'),
    (v_org, 'mon.set', 1, 'set_membership', 'approved and reconciled present',
     '{"requiredTags":["approved","reconciled"]}'::jsonb, 'released'),
    (v_org, 'mon.miss', 1, 'missing_event', 'an event every 10s',
     '{"expectedEverySeconds":10}'::jsonb, 'released'),
    (v_org, 'mon.rec', 1, 'reconciliation', 'bank equals ledger',
     '{"field":"amount","reconcile":{"left":"bank","right":"ledger"}}'::jsonb, 'released');

  v_alerts := public.monitor_evaluate_org(v_org, '2026-10-28T00:00:00.000Z');
  perform provio_test.assert_eq(v_alerts, 6, 'C1: all six released rules fired');

  -- The threshold alert carries the pinned lineage hash and the engine's reason string.
  perform provio_test.assert_eq(
    (select lineage_hash from monitor_alerts where org_id = v_org and rule_id = 'mon.t.amount'),
    'd044ab777adea29b57d7d5db8d317c922dc9c7d8f07cdf4aeaaf1c0d071b57d5',
    'C1: the written threshold alert carries the engine lineage hash');
  perform provio_test.assert_eq(
    (select reason from monitor_alerts where org_id = v_org and rule_id = 'mon.t.amount'),
    'the highest amount is 250, which is gt the threshold 100',
    'C1: the threshold reason matches the engine');
  perform provio_test.assert_eq(
    (select reason from monitor_alerts where org_id = v_org and rule_id = 'mon.rec'),
    'bank totals 240 and ledger totals 250, which differ',
    'C1: the reconciliation reason matches the engine');
  perform provio_test.assert_eq(
    (select reason from monitor_alerts where org_id = v_org and rule_id = 'mon.miss'),
    'no event occurred for 15 seconds, more than the expected 10',
    'C1: the missing-event reason matches the engine');
  perform provio_test.assert_eq(
    (select reason from monitor_alerts where org_id = v_org and rule_id = 'mon.set'),
    'the required tags approved were not present',
    'C1: the set-membership reason names the missing tag');
  perform provio_test.assert_eq(
    (select count(*) from monitor_alerts where org_id = v_org and rule_id not in
       ('mon.t.amount','mon.rate','mon.seq','mon.set','mon.miss','mon.rec')),
    0::bigint, 'C1: only the six released rules produced alerts');

  -- The chain is intact: each alert's hash follows from its predecessor.
  perform provio_test.assert_true(public.verify_monitor_chain(v_org),
    'C1: the alert chain verifies end to end');
end $$;

-- ===========================================================================
-- 4. The alert insertion emitted the `watcher.signal` catalogue event, once per alert.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  perform provio_test.assert_eq(
    (select count(*) from automation_events
      where org_id = v_org and event_key = 'watcher.signal'), 6::bigint,
    'C1: each alert emitted one watcher.signal event');
  perform provio_test.assert_eq(
    (select count(*) from automation_events_catalogue where event_key = 'watcher.signal'),
    1::bigint, 'C1: the watcher.signal catalogue row exists once');
end $$;

-- ===========================================================================
-- 5. The dispatcher drains the outbox: it processes pending events exactly once and is idempotent.
--    It does NOT process on insert (test 66 relies on the direct call staying valid), so before the
--    dispatcher runs the events are still pending.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_pending bigint;
  v_watcher_pending bigint;
  v_acted int;
  v_pending_after bigint;
begin
  -- The outbox holds the six watcher.signal events from section 4 plus whatever else the fixtures
  -- emitted. The load-bearing fact is that they are STILL pending: nothing processed them on insert.
  select count(*) into v_pending from automation_events e
   where e.org_id = v_org
     and not exists (select 1 from automation_event_processed p where p.event_id = e.id);
  select count(*) into v_watcher_pending from automation_events e
   where e.org_id = v_org and e.event_key = 'watcher.signal'
     and not exists (select 1 from automation_event_processed p where p.event_id = e.id);
  perform provio_test.assert_eq(v_watcher_pending, 6::bigint,
    'C1: the six watcher.signal events are still pending before the dispatcher runs (no trigger)');
  perform provio_test.assert_true(v_pending >= 6,
    'C1: the six watcher.signal events are part of the pending outbox');

  v_acted := public.automation_dispatch_pending(v_org, 100);
  perform provio_test.assert_eq(v_acted, v_pending::int,
    'C1: the dispatcher acted on every pending event');

  select count(*) into v_pending_after from automation_events e
   where e.org_id = v_org
     and not exists (select 1 from automation_event_processed p where p.event_id = e.id);
  perform provio_test.assert_eq(v_pending_after, 0::bigint, 'C1: no event is left pending');

  perform provio_test.assert_eq(public.automation_dispatch_pending(v_org, 100), 0,
    'C1: a second dispatch acts on nothing (idempotent)');
end $$;

-- ===========================================================================
-- 6. Idempotent over the SIGNAL SET: a later sweep over unchanged records writes nothing new, even
--    though the evaluation time (and so the lineage hash) differs. This is the real re-sweep case:
--    the five-minute job must not re-alert for a condition it already reported.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_before bigint;
  v_after bigint;
  v_alerts int;
begin
  select count(*) into v_before from monitor_alerts where org_id = v_org;
  -- A later evaluation instant, as the next scheduled sweep would use.
  v_alerts := public.monitor_evaluate_org(v_org, '2026-10-28T00:05:00.000Z');
  select count(*) into v_after from monitor_alerts where org_id = v_org;
  perform provio_test.assert_eq(v_alerts, 0, 'C1: a later sweep over unchanged records writes no new alert');
  perform provio_test.assert_eq(v_before, v_after, 'C1: the alert count is unchanged on a later sweep');
end $$;

-- ===========================================================================
-- 7. A NEW record changes the reference set and does fire a fresh alert.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
  null, 'bank', 's4', repeat('e', 64), '2026-10-27T23:59:55.000Z'::timestamptz,
  '{"amount":999}'::jsonb, '["reconciled"]');
select provio_test.as_owner();
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alerts int;
begin
  v_alerts := public.monitor_evaluate_org(v_org, '2026-10-28T00:10:00.000Z');
  perform provio_test.assert_true(v_alerts >= 1,
    'C1: a new record changes the reference set and fires a fresh alert');
end $$;

-- ===========================================================================
-- 8. The sweep runs every organisation and isolates them.
-- ===========================================================================
do $$
declare
  v_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_b uuid := 'b0000000-0000-0000-0000-000000000001';
  v_inst_b uuid;
  v_a_before bigint;
  v_a_after bigint;
  v_total int;
begin
  select count(*) into v_a_before from monitor_alerts where org_id = v_a;

  -- Org B gets its own instance, one staged record, and one released rule.
  insert into connector_instances (org_id, connector_id, label, config)
  values (v_b, 'bank-statement', 'Org B bank', '{}'::jsonb) returning id into v_inst_b;
  insert into staged_records (org_id, instance_id, source, source_id, content_hash, fetched_at, values, tags)
  values (v_b, v_inst_b, 'bank', 'b1', repeat('d', 64), '2026-10-27T23:58:00.000Z'::timestamptz,
          '{"amount":500}'::jsonb, '[]'::jsonb);
  insert into monitor_rules (org_id, rule_id, version, kind, description, spec, status)
  values (v_b, 'mon.b.only', 1, 'threshold', 'org B only',
     '{"field":"amount","comparison":"gt","threshold":"0"}'::jsonb, 'released');

  v_total := public.monitor_runner_sweep(100);
  select count(*) into v_a_after from monitor_alerts where org_id = v_a;

  perform provio_test.assert_eq(v_total, 1, 'C1: the sweep wrote exactly org B''s new alert');
  perform provio_test.assert_eq(
    (select count(*) from monitor_alerts where org_id = v_b), 1::bigint,
    'C1: org B has its one alert');
  perform provio_test.assert_eq(v_a_after, v_a_before,
    'C1: org A''s alerts are unchanged by org B''s run (isolation)');
end $$;

-- ===========================================================================
-- 9. Grants: the runner, dispatcher and helpers are service-only; nothing is anon-reachable.
-- ===========================================================================
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'monitor_runner_sweep(int)', 'automation_dispatch_pending(uuid, int)',
    'monitor_evaluate_org(uuid, text)', 'monitor_lineage_hash(text, int, text, text, text, jsonb)',
    'monitor_to_number(jsonb)', 'monitor_cmp(numeric, numeric, text)', 'monitor_number_text(numeric)']
  loop
    perform provio_test.assert_true(
      not has_function_privilege('anon', 'public.' || v_fn, 'execute'),
      format('C1: anon may not execute %s', v_fn));
    perform provio_test.assert_true(
      not has_function_privilege('authenticated', 'public.' || v_fn, 'execute'),
      format('C1: a signed-in tenant may not execute %s', v_fn));
    perform provio_test.assert_true(
      has_function_privilege('service_role', 'public.' || v_fn, 'execute'),
      format('C1: service_role may execute %s', v_fn));
  end loop;
  perform provio_test.assert_true(
    has_function_privilege('authenticated', 'public.verify_monitor_chain(uuid)', 'execute'),
    'C1: a signed-in user may verify an alert chain');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.verify_monitor_chain(uuid)', 'execute'),
    'C1: anon may not verify an alert chain');
end $$;

select provio_test.as_owner();

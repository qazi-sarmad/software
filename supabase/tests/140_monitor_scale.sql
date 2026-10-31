-- Test 140 (S5 / F49, F50, C1): the monitor run holds over a large batch (SCALE-PROGRAMME §5 flow 16).
--
-- One released threshold rule over a large staged batch must produce exactly ONE alert, and a second
-- sweep over the unchanged records must produce none. The batch size is the GUC
-- `provio_test.scale_factor` (default 1), so the CI harness stays fast while a dedicated scale run
-- reaches the target; the STRUCTURE is the same at any factor.
\i supabase/tests/00_lib.sql
select provio_test.seed();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'ledger-feed',
  'Scale ledger', '{}'::jsonb, null);
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_inst uuid := (select id from connector_instances where org_id = v_org limit 1);
  v_batch int := 50 * coalesce(nullif(current_setting('provio_test.scale_factor', true), ''), '1')::int;
  v_i int;
  v_alerts int;
begin
  insert into monitor_rules (org_id, rule_id, version, kind, description, spec, status)
  values (v_org, 'scale.threshold', 1, 'threshold', 'amount over 10',
    '{"field":"amount","comparison":"gt","threshold":"10"}'::jsonb, 'released');

  -- A large batch whose amounts run 1..N, so the maximum (N) is over the threshold and the rule fires
  -- once. Every id and hash is a pure function of the index: no now(), no random().
  for v_i in 1..v_batch loop
    perform public.staged_record_ingest(v_org, v_inst, null, 'ledger',
      'scale-' || v_i, encode(sha256(v_i::text::bytea), 'hex'),
      ('2026-10-28T00:00:00.000Z'::timestamptz + make_interval(secs => v_i)),
      jsonb_build_object('amount', v_i), '[]'::jsonb);
  end loop;

  v_alerts := public.monitor_evaluate_org(v_org, '2026-10-28T00:10:00.000Z');
  perform provio_test.assert_eq(v_alerts, 1, format('C1: one rule over %s records fires exactly once', v_batch));
  perform provio_test.assert_eq(
    (select count(*) from monitor_alerts where org_id = v_org and rule_id = 'scale.threshold'),
    1::bigint, 'C1: exactly one alert is written over the batch');
  perform provio_test.assert_eq(
    (select reason from monitor_alerts where org_id = v_org and rule_id = 'scale.threshold'),
    format('the highest amount is %s, which is gt the threshold 10', v_batch),
    'C1: the reason names the batch maximum, not a partial view');
  perform provio_test.assert_true(public.verify_monitor_chain(v_org),
    'C1: the alert chain verifies over the batch');

  -- A later sweep over the unchanged batch writes nothing new (the five-minute job must not re-alert).
  perform provio_test.assert_eq(
    public.monitor_evaluate_org(v_org, '2026-10-28T00:15:00.000Z'), 0,
    'C1: a later sweep over the unchanged batch writes no new alert');
  perform provio_test.assert_eq(
    (select count(*) from monitor_alerts where org_id = v_org), 1::bigint,
    'C1: the alert count is unchanged on the later sweep');
end $$;

select provio_test.as_owner();

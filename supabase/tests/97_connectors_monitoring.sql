-- 97: connectors, staging and deterministic monitoring (WRITE-1, 0090). W11.1, W11.2, W11.4, W11.5.
--   * RLS on every new table; no direct write from a tenant; isolation between organisations.
--   * Ingestion is idempotent by content hash; a run records counts and never a secret.
--   * A monitor rule ships as a draft; a release is a platform-admin action.
--   * An alert is hash-chained and emits the watcher.signal catalogue event.
--   * Triage: a dismissal needs a reason, a snooze needs an expiry; cross-org refusals.
-- M5: fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. RLS is on for every table 0090 creates.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n int;
begin
  foreach t in array array[
    'connector_instances', 'connector_runs', 'staged_records', 'connector_egress_allowlist',
    'monitor_rules', 'monitor_rule_versions', 'monitor_alerts', 'alert_triage'
  ] loop
    select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity;
    perform provio_test.assert_eq(n, 1, format('RLS is enabled on %s', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. No direct write from a tenant to any of the tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_n int;
begin
  foreach t in array array[
    'connector_instances', 'connector_runs', 'staged_records', 'connector_egress_allowlist',
    'monitor_rules', 'monitor_rule_versions', 'monitor_alerts', 'alert_triage'
  ] loop
    select count(*) into v_n from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = t
        and g.grantee in ('anon', 'authenticated', 'public')
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    perform provio_test.assert_eq(v_n, 0, format('%s takes no direct write from a tenant', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. An instance is saved with a credential REFERENCE, never a value; a run records counts.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'http-rest',
  'Payments API', '{"base_url":"https://mock.local","page_size":100}', 'secret-ref-1');
do $$ begin
  perform provio_test.assert_eq(
    (select credential_ref from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'secret-ref-1', 'the instance stores a credential reference, not a value');
end $$;

select public.connector_run_start('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001'));
select public.connector_run_finish('a0000000-0000-0000-0000-000000000001',
  (select id from connector_runs where org_id = 'a0000000-0000-0000-0000-000000000001'),
  'succeeded', 2, 1, 1, null, 'fetched 2, staged 1, skipped 1');
do $$ begin
  perform provio_test.assert_eq(
    (select rows_staged from connector_runs where org_id = 'a0000000-0000-0000-0000-000000000001'),
    1, 'the run records the staged row count');
  perform provio_test.assert_eq(
    (select status from connector_runs where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'succeeded', 'the run records its outcome');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Ingestion is idempotent by content hash: the same record stages once.
-- ---------------------------------------------------------------------------
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001'),
  (select id from connector_runs where org_id = 'a0000000-0000-0000-0000-000000000001'),
  'http-rest', 'r1', repeat('e', 64), now(), '{"amount":10}', '[]');
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001'),
  (select id from connector_runs where org_id = 'a0000000-0000-0000-0000-000000000001'),
  'http-rest', 'r1', repeat('e', 64), now(), '{"amount":10}', '[]');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from staged_records where org_id = 'a0000000-0000-0000-0000-000000000001')::int, 1,
    'a duplicate content hash does not stage twice');
end $$;

-- ---------------------------------------------------------------------------
-- 5. The egress allow-list: a host is reachable only when listed. The allow-list row is written by
--    the platform (owner), never by a tenant, because no tenant write policy exists on the table.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into connector_egress_allowlist (org_id, host) values
  ('a0000000-0000-0000-0000-000000000001', 'mock.local');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform provio_test.assert_true(
    public.connector_egress_allowed('a0000000-0000-0000-0000-000000000001', 'mock.local'),
    'a listed host is allowed');
  perform provio_test.assert_true(
    not public.connector_egress_allowed('a0000000-0000-0000-0000-000000000001', 'evil.example'),
    'an unlisted host is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A monitor rule ships as a draft; a release is a platform-admin action.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.monitor_rule_save('a0000000-0000-0000-0000-000000000001', 'm.threshold', 'threshold',
  'severity above 8', '{"field":"severity","threshold":"8","comparison":"gt"}', repeat('f', 64));
do $$ begin
  perform provio_test.assert_eq(
    (select status from monitor_rules where rule_id = 'm.threshold'), 'draft',
    'a new monitor rule is a draft');
end $$;
do $$ begin
  perform provio_test.assert_raises(
    format('select public.monitor_rule_release(%L)', (select id from monitor_rules where rule_id = 'm.threshold')),
    'platform administrator', 'a tenant user cannot release a monitor rule');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.monitor_rule_release((select id from monitor_rules where rule_id = 'm.threshold'));
do $$ begin
  perform provio_test.assert_eq(
    (select status from monitor_rules where rule_id = 'm.threshold'), 'released',
    'a platform administrator releases the monitor rule');
end $$;

-- ---------------------------------------------------------------------------
-- 7. An alert is hash-chained and emits watcher.signal. A second alert chains onto the first.
-- ---------------------------------------------------------------------------
select public.alert_record('a0000000-0000-0000-0000-000000000001', 'm.threshold', 1, 'threshold',
  'the highest severity is 9, which is gt the threshold 8',
  '[{"type":"signal","id":"syslog-cef:s1","contentHash":"aa"}]'::jsonb, now(), null, repeat('1', 64));
select public.alert_record('a0000000-0000-0000-0000-000000000001', 'm.threshold', 1, 'threshold',
  'the highest severity is 10, which is gt the threshold 8',
  '[{"type":"signal","id":"syslog-cef:s2","contentHash":"bb"}]'::jsonb, now(), null, repeat('2', 64));
do $$
declare v_first text;
begin
  select hash into v_first from monitor_alerts where org_id = 'a0000000-0000-0000-0000-000000000001'
    order by created_at, id limit 1;
  perform provio_test.assert_true(v_first is not null and length(v_first) = 64, 'the first alert has a hash');
  perform provio_test.assert_eq(
    (select prev_hash from monitor_alerts where org_id = 'a0000000-0000-0000-0000-000000000001'
       order by created_at desc, id desc limit 1),
    v_first, 'the second alert chains onto the first');
  -- The watcher.signal event was emitted for each alert.
  perform provio_test.assert_eq(
    (select count(*) from automation_events where org_id = 'a0000000-0000-0000-0000-000000000001'
       and event_key = 'watcher.signal')::int, 2,
    'each alert emitted the watcher.signal catalogue event');
end $$;

-- The alert is append-only.
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_raises(
    $q$update monitor_alerts set reason = 'tampered'$q$, 'append-only',
    'monitor_alerts refuses an update');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

-- ---------------------------------------------------------------------------
-- 8. Triage: a dismissal needs a reason, a snooze needs an expiry; the disposition is stored.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    format('select public.alert_triage_record(%L, %L, ''dismissed'', null, null)',
      'a0000000-0000-0000-0000-000000000001',
      (select id from monitor_alerts where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at limit 1)),
    'requires a reason', 'a dismissal without a reason is refused');
  perform provio_test.assert_raises(
    format('select public.alert_triage_record(%L, %L, ''snoozed'', null, null)',
      'a0000000-0000-0000-0000-000000000001',
      (select id from monitor_alerts where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at limit 1)),
    'requires an expiry', 'a snooze without an expiry is refused');
end $$;
select public.alert_triage_record('a0000000-0000-0000-0000-000000000001',
  (select id from monitor_alerts where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at limit 1),
  'dismissed', 'a duplicate of an existing alert', null);
do $$ begin
  perform provio_test.assert_eq(
    (select disposition from public.alert_list('a0000000-0000-0000-0000-000000000001') order by evaluated_at limit 1),
    'dismissed', 'the dismissal is stored and read back');
end $$;

-- ---------------------------------------------------------------------------
-- 9. Cross-organisation: Org B reads none of Org A's instances, staged records or alerts, and cannot
--    save an instance or start a run in Org A.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from public.alert_list('a0000000-0000-0000-0000-000000000001'))::int, 0,
    'org B cannot read org A alerts');
  perform provio_test.assert_raises(
    $q$select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'http-rest', 'x', '{}', null)$q$,
    'not the caller', 'org B cannot save a connector instance in org A');
  perform provio_test.assert_raises(
    format('select public.connector_run_start(%L, %L)', 'a0000000-0000-0000-0000-000000000001',
      (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001')),
    'not the caller', 'org B cannot start a run for an org A instance');
end $$;

-- Org A still reads its own alerts.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from public.alert_list('a0000000-0000-0000-0000-000000000001'))::int, 2,
    'org A still reads its own alerts');
end $$;

select provio_test.as_owner();

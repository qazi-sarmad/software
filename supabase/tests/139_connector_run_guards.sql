-- Test 139 (S5 / F57, F58, C1/C3): the connector run lifecycle is ordered.
--
-- 0169 makes the three refusals explicit. This test proves each one raises with its exact reason AND
-- writes nothing: a refusal leaves no staged record and does not change a run's outcome.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. A record cannot be staged without a live run: an unknown run id is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'http-rest',
  'Payments API', '{"base_url":"https://mock.local"}', 'secret-ref-1');

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_inst uuid := (select id from connector_instances where org_id = v_org and connector_id = 'http-rest');
  v_before int;
begin
  select count(*) into v_before from staged_records where org_id = v_org;
  perform provio_test.assert_raises(
    format($f$select public.staged_record_ingest(%L::uuid, %L::uuid, gen_random_uuid(), 'http-rest',
      'orphan', repeat('a', 64), now(), '{}'::jsonb, '[]'::jsonb)$f$, v_org, v_inst),
    'no such run', 'an ingest against an unknown run is refused');
  perform provio_test.assert_eq(
    (select count(*) from staged_records where org_id = v_org), v_before,
    'the refused ingest wrote nothing');
end $$;

-- ===========================================================================
-- 2. Ingest is bound to the run's own instance: a run of another instance is refused.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_inst uuid := (select id from connector_instances where org_id = v_org and connector_id = 'http-rest');
  v_other uuid;
  v_run uuid;
  v_before int;
begin
  -- A second instance in the same org, with its own run.
  v_other := public.connector_instance_save(v_org, null, 'ledger-feed', 'Ledger feed', '{}'::jsonb, null);
  v_run := public.connector_run_start(v_org, v_other);
  select count(*) into v_before from staged_records where org_id = v_org;
  perform provio_test.assert_raises(
    format($f$select public.staged_record_ingest(%L::uuid, %L::uuid, %L::uuid, 'http-rest',
      'mismatch', repeat('d', 64), now(), '{}'::jsonb, '[]'::jsonb)$f$, v_org, v_inst, v_run),
    'no such run for this connector instance', 'an ingest into another instance''s run is refused');
  perform provio_test.assert_eq(
    (select count(*) from staged_records where org_id = v_org), v_before,
    'the refused mismatch ingest wrote nothing');
  -- The same run id, with its own instance, is accepted.
  perform provio_test.assert_true(
    public.staged_record_ingest(v_org, v_other, v_run, 'ledger-feed', 'own', repeat('e', 64),
      now(), '{"amount":2}'::jsonb, '[]'::jsonb),
    'the same run id is accepted for its own instance');
  perform public.connector_run_finish(v_org, v_run, 'succeeded', 1, 1, 0, null, 'one row');
  perform provio_test.assert_eq(
    (select status from connector_runs where id = v_run), 'succeeded',
    'the run records its outcome');
end $$;

-- ===========================================================================
-- 3. A run cannot be finished twice; the first outcome is left untouched.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_inst uuid := (select id from connector_instances where org_id = v_org and connector_id = 'http-rest');
  v_run uuid;
begin
  v_run := public.connector_run_start(v_org, v_inst);
  perform public.connector_run_finish(v_org, v_run, 'succeeded', 3, 2, 1, null, 'first finish');
  perform provio_test.assert_raises(
    format($f$select public.connector_run_finish(%L::uuid, %L::uuid, 'failed', 9, 9, 9, 'boom', 'second')$f$, v_org, v_run),
    'already finished', 'a second finish is refused');
  perform provio_test.assert_eq(
    (select status from connector_runs where id = v_run), 'succeeded',
    'the refused second finish left the first outcome untouched');
  perform provio_test.assert_eq(
    (select rows_fetched from connector_runs where id = v_run), 3,
    'the refused second finish left the counts untouched');
end $$;

-- ===========================================================================
-- 4. One live run per instance: a second start is refused while one is running.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_inst uuid := (select id from connector_instances where org_id = v_org and connector_id = 'http-rest');
  v_run uuid;
  v_before int;
begin
  select count(*) into v_before from connector_runs where org_id = v_org and status = 'running';
  v_run := public.connector_run_start(v_org, v_inst);
  perform provio_test.assert_raises(
    format($f$select public.connector_run_start(%L::uuid, %L::uuid)$f$, v_org, v_inst),
    'already in progress', 'a second run on a busy instance is refused');
  perform provio_test.assert_eq(
    (select count(*) from connector_runs where org_id = v_org and status = 'running'),
    v_before + 1, 'the refused second start inserted no run');
  -- Once the run finishes, a new one is accepted.
  perform public.connector_run_finish(v_org, v_run, 'succeeded', 0, 0, 0, null, '');
  v_run := public.connector_run_start(v_org, v_inst);
  perform provio_test.assert_true(v_run is not null, 'a new run starts once the previous one finished');
  perform public.connector_run_finish(v_org, v_run, 'succeeded', 0, 0, 0, null, '');
end $$;

-- ===========================================================================
-- 5. Scale (SCALE-PROGRAMME §5 flow 17): the run shape holds over a large batch. The batch size is
--    read from the GUC `provio_test.scale_factor` (default 1), so the CI harness stays fast while a
--    dedicated scale run reaches the target. The STRUCTURE is the same at any factor: one run, every
--    record staged once, the counts exact.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_inst uuid := (select id from connector_instances where org_id = v_org and connector_id = 'http-rest');
  v_run uuid;
  v_batch int := 40 * coalesce(nullif(current_setting('provio_test.scale_factor', true), ''), '1')::int;
  v_i int;
  v_staged int;
begin
  v_run := public.connector_run_start(v_org, v_inst);
  for v_i in 1..v_batch loop
    perform public.staged_record_ingest(v_org, v_inst, v_run, 'http-rest',
      'scale-' || v_i, encode(sha256(v_i::text::bytea), 'hex'), now(),
      jsonb_build_object('amount', v_i), '[]'::jsonb);
  end loop;
  select count(*) into v_staged from staged_records
    where org_id = v_org and instance_id = v_inst and source = 'http-rest' and source_id like 'scale-%';
  perform public.connector_run_finish(v_org, v_run, 'succeeded', v_batch, v_batch, 0, null, 'scale run');
  perform provio_test.assert_eq(v_staged, v_batch, format('every one of %s records staged once', v_batch));
  perform provio_test.assert_eq(
    (select rows_staged from connector_runs where id = v_run), v_batch,
    'the run records the exact staged count');
  -- Idempotence at scale: re-staging the same batch adds nothing.
  for v_i in 1..v_batch loop
    perform public.staged_record_ingest(v_org, v_inst, v_run, 'http-rest',
      'scale-' || v_i, encode(sha256(v_i::text::bytea), 'hex'), now(),
      jsonb_build_object('amount', v_i), '[]'::jsonb);
  end loop;
  perform provio_test.assert_eq(
    (select count(*) from staged_records where org_id = v_org and source_id like 'scale-%'),
    v_batch, 'a replayed batch stages nothing new');
end $$;

select provio_test.as_owner();

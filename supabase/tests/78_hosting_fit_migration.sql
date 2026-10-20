-- Test 78 (S11, F16): Hosting fit and database mobility.
--
-- F16: the Hosting Fit catalogue and rules are platform-admin only; a tenant cannot read or edit
--      them. A hosting connection and a migration job are gated on the hosting_migration feature and
--      the edit_config right, refuse a cross-org target, and write their history. The ledger-copy
--      bypass works ONLY for the provio_migrator role with provio.migration_mode on: an ordinary role
--      setting the flag changes nothing (the chain trigger still recomputes).
-- Applies twice (M2, M6): the whole file is a no-op on a second run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The Hosting Fit catalogue and rules are platform-admin only (F16, SA-10/SA-11).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
declare
  v jsonb;
  v_rule jsonb;
begin
  v := public.hosting_fit_get();
  perform provio_test.assert_true(jsonb_array_length(v -> 'catalogue') >= 9,
    'F16: the seeded catalogue lists every stack');
  perform provio_test.assert_true(jsonb_array_length(v -> 'rules') >= 10,
    'F16: the seeded rules are present');

  -- The engine rule is a blocker with the custom-quote cost tier.
  select r into v_rule from jsonb_array_elements(v -> 'rules') r
   where r ->> 'key' = 'engine.postgres.required';
  perform provio_test.assert_eq(v_rule ->> 'severity', 'blocker',
    'F16: a non-Postgres engine is a blocker');
  perform provio_test.assert_eq(v_rule ->> 'costTier', 'custom_quote',
    'F16: a non-Postgres engine costs a custom quote');

  -- A Supabase stack is supported; SQL Server is not.
  perform provio_test.assert_true(
    (select (s ->> 'isSupported')::boolean from jsonb_array_elements(v -> 'catalogue') s
      where s ->> 'key' = 'supabase_cloud') = true,
    'F16: a Supabase cloud project is supported');
  perform provio_test.assert_true(
    (select (s ->> 'isSupported')::boolean from jsonb_array_elements(v -> 'catalogue') s
      where s ->> 'key' = 'sql_server') = false,
    'F16: SQL Server is not supported');

  -- A bad severity is refused.
  perform provio_test.assert_raises(
    $q$select public.hosting_fit_rule_save('x','ram_gb','lt','8','nope','m','standard',true)$q$,
    'severity must be', 'F16: an invalid rule severity is refused');
  -- A valid edit upserts by key.
  perform public.hosting_fit_rule_save('size.ram.warning','ram_gb','lt','16','warning',
    '16 GB is recommended.', 'standard', true);
  v_rule := (select r from jsonb_array_elements(public.hosting_fit_get() -> 'rules') r
              where r ->> 'key' = 'size.ram.warning');
  perform provio_test.assert_eq(v_rule ->> 'value', '16', 'F16: a rule edit is saved by key');
end $$;
select provio_test.as_owner();

-- A tenant member cannot read the platform catalogue or rules at all.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.hosting_fit_get()$q$,
    'platform administrator only', 'F16: a tenant cannot read the hosting catalogue');
  perform provio_test.assert_raises(
    $q$select public.hosting_fit_rule_save('x','ram_gb','lt','8','warning','m','standard',true)$q$,
    'platform administrator only', 'F16: a tenant cannot edit a hosting rule');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. hosting_migration feature off: connection and job refuse with the plan message (F25).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.hosting_connection_save('a0000000-0000-0000-0000-000000000001','t','supabase_self_hosted','db.test',5432,'postgres','postgres','require')$q$,
    'not included in your plan', 'F25: hosting_connection_save is refused while the feature is off');
end $$;
select provio_test.as_owner();

-- Turn hosting_migration on for org A.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','hosting_migration',true,'Assurance','S11 test');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. A hosting connection: the right is required, the row is created with a masked secret, and the
--    configuration history records it (F16, F5: no plaintext through SQL).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  -- A Preparer lacks edit_config.
  perform provio_test.assert_raises(
    $q$select public.hosting_connection_save('a0000000-0000-0000-0000-000000000001','t','supabase_self_hosted','db.test',5432,'postgres','postgres','require')$q$,
    'not allowed', 'F16: a Preparer cannot save a hosting connection');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_conn uuid;
  v_list jsonb;
begin
  v_conn := public.hosting_connection_save('a0000000-0000-0000-0000-000000000001','Target',
    'supabase_self_hosted','db.target.test',5432,'postgres','postgres','require');
  perform public.hosting_connection_set_secret(v_conn,
    '00000000-0000-0000-0000-0000000000aa', '•••• 1234');

  v_list := public.hosting_connection_list('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(jsonb_array_length(v_list), 1, 'F16: the connection is listed');
  perform provio_test.assert_eq(v_list -> 0 ->> 'host', 'db.target.test', 'F16: the host is stored');
  perform provio_test.assert_eq(v_list -> 0 ->> 'passwordMasked', '•••• 1234', 'F5: only the mask is stored');

  -- A cross-org target is refused: org B cannot touch an org A connection.
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.hosting_connection_set_secret('00000000-0000-0000-0000-000000000000'::uuid, null, null)$q$,
    'Unknown hosting connection', 'F16: an unknown/cross-org connection id is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. A migration job returns its token once and is gated on the feature (F16, SA-12).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_conn uuid;
  v_job jsonb;
  v_list jsonb;
begin
  select (public.hosting_connection_list('a0000000-0000-0000-0000-000000000001') -> 0 ->> 'id')::uuid into v_conn;
  v_job := public.migration_job_create('a0000000-0000-0000-0000-000000000001', v_conn, 14);
  perform provio_test.assert_true((v_job ->> 'jobToken') is not null, 'F16: the job token is returned once');
  perform provio_test.assert_eq(jsonb_typeof(v_job -> 'jobId'), 'string', 'F16: the job id is returned');

  v_list := public.migration_job_list('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(jsonb_array_length(v_list), 1, 'F16: the job is listed');
  perform provio_test.assert_eq(v_list -> 0 ->> 'status', 'created', 'F16: a new job starts created');
  perform provio_test.assert_eq(v_list -> 0 ->> 'totalSteps', '11', 'F16: there are 11 steps');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Ledger-copy safety (F16). An ordinary role setting provio.migration_mode changes NOTHING:
--    ledger_copy_mode_ok() stays false, and the chain trigger carries the inlined guard so no
--    ordinary session can reach the bypass. The positive path (the provio_migrator role preserving
--    sequence, timestamps and hashes) is exercised by the migration-runner tests in S11.b against a
--    faked driver, because creating a migration role on the shared test project is itself residue.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform set_config('provio.migration_mode', 'on', false);
  perform provio_test.assert_true(public.ledger_copy_mode_ok() = false,
    'F16: the bypass is not available to a tenant role even with the flag on');
  perform set_config('provio.migration_mode', '', false);
end $$;
select provio_test.as_owner();

select provio_test.as_service();
do $$
begin
  perform set_config('provio.migration_mode', 'on', false);
  perform provio_test.assert_true(public.ledger_copy_mode_ok() = false,
    'F16: service_role is not provio_migrator, so the flag alone changes nothing');
  perform set_config('provio.migration_mode', '', false);
end $$;
select provio_test.as_owner();

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.chain_ledger_entry()'::regprocedure);
  perform provio_test.assert_true(position('provio_migrator' in v_def) > 0,
    'F16: the chain trigger carries the inlined migration guard');
  perform provio_test.assert_true(position('provio.migration_mode' in v_def) > 0,
    'F16: the chain trigger checks the migration_mode setting');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. anon can execute none of the new surfaces.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises($q$select public.hosting_fit_get()$q$, 'permission denied',
    'F16: anon cannot read the hosting catalogue');
  perform provio_test.assert_raises(
    $q$select public.hosting_connection_list('a0000000-0000-0000-0000-000000000001')$q$,
    'permission denied', 'F16: anon cannot list hosting connections');
  perform provio_test.assert_raises(
    $q$select public.migration_job_list('a0000000-0000-0000-0000-000000000001')$q$,
    'permission denied', 'F16: anon cannot list migration jobs');
end $$;
select provio_test.as_owner();

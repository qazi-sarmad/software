-- Test 38 (4G): Phase 4 acceptance — the cross-cutting guarantees the phase must hold, in one place.
-- Cross-org reads/writes refused, unauthenticated calls refused, no-right caller refused, L3, four-eyes
-- on sign-off, hash chains contiguous, planning locked after sign-off, sampling floor enforced
-- (spec §10, §11, §12; L2, L3).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Publish the Org A SIRA cycle (needed by the testing lock).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.publish_sira_cycle('a1000000-0000-0000-0000-0000000000a1');
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 1. Cross-org: an Org B caller reads zero Org A rows in every new Phase 4 table, and cannot call a
--    Phase 4 RPC that targets an Org A object.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['planning_sections','planning_suggestion_decisions',
                           'planning_reconciliation_acks','org_sampling_table','analysis_results'] loop
    execute format('select count(*) from %I where org_id = %L', t, 'a0000000-0000-0000-0000-000000000001') into n;
    perform provio_test.assert_eq(n, 0::bigint, format('4G: an Org B caller reads zero Org A rows in %s', t));
  end loop;
  perform provio_test.assert_raises(
    $q$select public.populate_planning_suggestions('50000000-0000-0000-0000-0000000000a1')$q$,
    'not found in this organisation', '4G: an Org B caller cannot pre-fill an Org A engagement');
  perform provio_test.assert_raises(
    $q$select public.lock_population('70000000-0000-0000-0000-0000000000c1')$q$,
    'not found in this organisation', '4G: an Org B caller cannot lock an Org A population');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Unauthenticated: anon cannot call any Phase 4 security-definer RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.populate_planning_suggestions('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '4G: anon cannot pre-fill planning');
  perform provio_test.assert_raises(
    $q$select public.compute_sample('60000000-0000-0000-0000-0000000000a1','system')$q$,
    null, '4G: anon cannot compute a sample');
  perform provio_test.assert_raises(
    $q$select public.record_analysis_result('50000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000c1','duplicates','{}'::jsonb,array[1])$q$,
    null, '4G: anon cannot raise a finding');
  perform provio_test.assert_eq((select count(*) from planning_sections), 0::bigint,
    '4G: anon reads zero planning sections');
  perform provio_test.assert_eq((select count(*) from analysis_results), 0::bigint,
    '4G: anon reads zero analysis results');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. No-right caller: the Observer holds neither perform_work nor review_and_approve, so every Phase 4
--    RPC that does work is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.save_planning_section('50000000-0000-0000-0000-0000000000a1','scope','{}'::jsonb)$q$,
    'perform_work', '4G: a no-right caller cannot save a planning section');
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a1')$q$,
    'review_and_approve', '4G: a no-right caller cannot sign planning');
  perform provio_test.assert_raises(
    $q$select public.sign_off_workpaper('60000000-0000-0000-0000-0000000000a1')$q$,
    'review_and_approve', '4G: a no-right caller cannot sign a workpaper');
  perform provio_test.assert_raises(
    $q$select public.record_analysis_result('50000000-0000-0000-0000-0000000000a1','70000000-0000-0000-0000-0000000000c1','duplicates','{}'::jsonb,array[1])$q$,
    'perform_work', '4G: a no-right caller cannot raise a finding');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. L3: a sample row with no verified population is refused by the database.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  insert into populations (id, org_id, engagement_id, sha256, row_count, status)
  values ('70000000-0000-0000-0000-0000000000e1','a0000000-0000-0000-0000-000000000001',
          '50000000-0000-0000-0000-0000000000a1', repeat('9',64), 2, 'uploading');
  perform provio_test.assert_raises(
    $q$insert into samples (org_id, population_id, population_sha256) values ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000e1',repeat('9',64))$q$,
    'population_gate', '4G: L3 — a sample on an unverified population is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Sampling floor is enforced at the database, not the client.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$update samples set locked_at = now(), locked_by = auth.uid(), size_floor = 5, sample_rows = '[{"row_ref":1}]'::jsonb where id = '80000000-0000-0000-0000-0000000000a1'$q$,
    'samples_floor_chk', '4G: a locked sample below its floor violates the CHECK constraint');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. Planning sign-off: four-eyes, lock, and a contiguous hash chain.
-- ---------------------------------------------------------------------------
-- cia prepares every section and acknowledges the reconciliation discrepancy, then tries to sign.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
create temp table t_risk_b as select id from risks_library
  where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_risk uuid;
begin
  select id into v_risk from t_risk_b;
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'scope',
    jsonb_build_object('summary', 'Scope'));
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'riskcontrol',
    jsonb_build_object('risks', jsonb_build_array(jsonb_build_object('risk_id', v_risk::text, 'selected', true))));
  perform public.acknowledge_planning_discrepancy('50000000-0000-0000-0000-0000000000a1',
    'Reconciled after adding the new control to the RCM.');
  -- The same user prepared every section, so four-eyes refuses the sign-off.
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a1')$q$,
    'four_eyes', '4G: the preparer of every planning section cannot sign');
end $$;
select provio_test.as_owner();

-- A different reviewer with the right signs; the sections lock and a ledger entry is written.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.sign_planning('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(public.planning_signed_off('50000000-0000-0000-0000-0000000000a1'), true,
    '4G: planning reports as signed off');
  -- The ledger stays contiguous: verify_ledger returns null when the chain is intact.
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint,
    '4G: the org ledger chain is contiguous after Phase 4 writes');
end $$;
select provio_test.as_owner();

-- A signed-off section is read-only.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.save_planning_section('50000000-0000-0000-0000-0000000000a1','scope','{"summary":"changed"}'::jsonb)$q$,
    'planning_locked', '4G: a signed-off planning section is read-only');
end $$;
select provio_test.as_owner();


-- Test 63 (D21): planning reconciliation detail. The gate (33) answers yes/no; this test pins the
-- detail that lets the Planning screen say which risks disagree and offer a next action.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Publish the Org A cycle for universe A-U1 (entity A-E1), as test 33 does.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.publish_sira_cycle('a1000000-0000-0000-0000-0000000000a1');
create temp table t_risk_a as select id, name from risks_library
  where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 1. No riskcontrol section yet: nothing is planned and nothing is unmatched, so it reconciles.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  d jsonb;
begin
  d := public.planning_reconciliation_detail('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((d ->> 'reconciled')::boolean, true,
    'D21: an empty planning RCM reconciles');
  perform provio_test.assert_eq(jsonb_array_length(d -> 'unmatched_planning'), 0,
    'D21: no unmatched planning risks when none are planned');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. A planned risk that the SIRA does not score is reported, with its name, and blocks reconciliation.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_risk uuid;
begin
  select id into v_risk from t_risk_a;
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'riskcontrol',
    jsonb_build_object('risks', jsonb_build_array(
      jsonb_build_object('risk_id', v_risk::text, 'selected', true),
      jsonb_build_object('risk_id', '00000000-0000-0000-0000-0000000000ff', 'selected', false))));
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  d jsonb;
  missing jsonb;
begin
  d := public.planning_reconciliation_detail('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((d ->> 'reconciled')::boolean, false,
    'D21: a planning risk absent from the SIRA is reported as unreconciled');
  perform provio_test.assert_eq(jsonb_array_length(d -> 'unmatched_planning'), 1,
    'D21: exactly the one unmatched planning risk is listed');
  missing := d -> 'unmatched_planning' -> 0;
  perform provio_test.assert_eq((missing ->> 'risk_id'), '00000000-0000-0000-0000-0000000000ff',
    'D21: the unmatched entry names the offending risk id');
  perform provio_test.assert_true((missing ? 'name'),
    'D21: the unmatched entry carries a display name, so the screen can name the risk');
  -- The detail agrees with the gate.
  perform provio_test.assert_eq(
    public.check_planning_reconciliation('50000000-0000-0000-0000-0000000000a1'), false,
    'D21: the detail and the gate agree when reconciliation fails');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. Fix the RCM so every planned risk is in the SIRA: the detail is clean and the gate passes.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_risk uuid;
begin
  select id into v_risk from t_risk_a;
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'riskcontrol',
    jsonb_build_object('risks', jsonb_build_array(jsonb_build_object('risk_id', v_risk::text, 'selected', true))));
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  d jsonb;
begin
  d := public.planning_reconciliation_detail('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((d ->> 'reconciled')::boolean, true,
    'D21: reconciliation detail is clean once every planned risk is in the SIRA');
  perform provio_test.assert_eq(jsonb_array_length(d -> 'unmatched_planning'), 0,
    'D21: no unmatched planning risks once fixed');
  perform provio_test.assert_eq(
    public.check_planning_reconciliation('50000000-0000-0000-0000-0000000000a1'), true,
    'D21: the detail and the gate agree when reconciliation passes');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. Tenant isolation and the right to read the detail.
-- ---------------------------------------------------------------------------
-- An org B caller cannot read org A's engagement.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.planning_reconciliation_detail('50000000-0000-0000-0000-0000000000a1')$q$,
    'engagement not found', 'D21: another organisation cannot read the reconciliation detail');
end $$;
select provio_test.as_owner();

-- A read-only principal in the same organisation may still read the detail (it is a read, not a write).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_eq(
    (public.planning_reconciliation_detail('50000000-0000-0000-0000-0000000000a1') ->> 'reconciled')::boolean, true,
    'D21: a read-only principal can read the reconciliation detail');
end $$;
select provio_test.as_owner();

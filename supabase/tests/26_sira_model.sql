-- Test 26 (3C): SIRA model, library selection, deterministic sira_compute and the parity fixtures.
-- The fixtures are the exact set in src/lib/siraFixtures.json; public.sira_compute must return
-- the recorded expected value for each (L1: the app engine and the database agree).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: the QSCorp default model is seeded for an existing org.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  m jsonb;
begin
  m := public.sira_model_snapshot('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(jsonb_array_length(m -> 'factors'), 6, 'the default model has six factors');
  perform provio_test.assert_eq(jsonb_array_length(m -> 'scales'), 5, 'the default scale has five points');
  perform provio_test.assert_eq(jsonb_array_length(m -> 'bands'), 4, 'the default model has four bands');
  perform provio_test.assert_eq(m ->> 'aggregation', 'weighted_sum', 'the default aggregation is weighted_sum');
end $$;
select provio_test.as_owner();

-- b: parity fixtures. Each row calls public.sira_compute with the same inputs as the app engine.
do $$
declare
  fx jsonb := $fx$[{"factorValues":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":0.0},{"factorValues":{"inherent_risk":5,"complexity":5,"regulatory_exposure":5,"prior_findings":5,"time_since_audit":5,"materiality":5},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":100.0},{"factorValues":{"inherent_risk":3,"complexity":3,"regulatory_exposure":3,"prior_findings":3,"time_since_audit":3,"materiality":3},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":50.0},{"factorValues":{"inherent_risk":1,"complexity":2,"regulatory_exposure":3,"prior_findings":4,"time_since_audit":5,"materiality":3},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":50.0},{"factorValues":{"inherent_risk":5,"complexity":1,"regulatory_exposure":5,"prior_findings":1,"time_since_audit":5,"materiality":1},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":50.0},{"factorValues":{"inherent_risk":4,"complexity":2,"regulatory_exposure":5,"prior_findings":3,"time_since_audit":1,"materiality":4},"weights":{"inherent_risk":2,"complexity":2,"regulatory_exposure":2,"prior_findings":2,"time_since_audit":2,"materiality":2},"maxPoint":5,"method":"weighted_sum","expected":54.17},{"factorValues":{"inherent_risk":4,"complexity":2,"regulatory_exposure":5,"prior_findings":3,"time_since_audit":1,"materiality":4},"weights":{"inherent_risk":1,"complexity":2,"regulatory_exposure":3,"prior_findings":4,"time_since_audit":5,"materiality":6},"maxPoint":5,"method":"weighted_sum","expected":51.19},{"factorValues":{"inherent_risk":1,"complexity":2,"regulatory_exposure":3,"prior_findings":4,"time_since_audit":5,"materiality":3},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"maximum","expected":100.0},{"factorValues":{"inherent_risk":2,"complexity":2,"regulatory_exposure":2,"prior_findings":2,"time_since_audit":2,"materiality":2},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"maximum","expected":25.0},{"factorValues":{"inherent_risk":5,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"maximum","expected":100.0},{"factorValues":{"inherent_risk":1,"complexity":2,"regulatory_exposure":3,"prior_findings":4,"time_since_audit":5,"materiality":3},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_average","expected":60.0},{"factorValues":{"inherent_risk":3,"complexity":3,"regulatory_exposure":3,"prior_findings":3,"time_since_audit":3,"materiality":3},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_average","expected":60.0},{"factorValues":{"inherent_risk":5,"complexity":5,"regulatory_exposure":5,"prior_findings":5,"time_since_audit":5,"materiality":5},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_average","expected":100.0},{"factorValues":{"inherent_risk":1,"complexity":2,"regulatory_exposure":3,"prior_findings":4,"time_since_audit":5,"materiality":3},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_average_floor","expected":60.0},{"factorValues":{"inherent_risk":5,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_average_floor","expected":50.0},{"factorValues":{"inherent_risk":2,"complexity":2,"regulatory_exposure":2,"prior_findings":2,"time_since_audit":2,"materiality":2},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_average_floor","expected":40.0},{"factorValues":{"inherent_risk":5,"complexity":4,"regulatory_exposure":3,"prior_findings":2,"time_since_audit":1,"materiality":5},"weights":{"inherent_risk":3,"complexity":3,"regulatory_exposure":3,"prior_findings":3,"time_since_audit":3,"materiality":3},"maxPoint":5,"method":"weighted_average_floor","expected":66.67},{"factorValues":{"inherent_risk":4,"complexity":4,"regulatory_exposure":4,"prior_findings":4,"time_since_audit":4,"materiality":4},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":75.0},{"factorValues":{"inherent_risk":2,"complexity":4,"regulatory_exposure":2,"prior_findings":4,"time_since_audit":2,"materiality":4},"weights":{"inherent_risk":2,"complexity":2,"regulatory_exposure":2,"prior_findings":2,"time_since_audit":2,"materiality":2},"maxPoint":5,"method":"weighted_average","expected":60.0},{"factorValues":{"inherent_risk":1,"complexity":3,"regulatory_exposure":5,"prior_findings":2,"time_since_audit":4,"materiality":3},"weights":{"inherent_risk":5,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"weighted_sum","expected":30.0},{"factorValues":{"inherent_risk":1,"complexity":3,"regulatory_exposure":5,"prior_findings":2,"time_since_audit":4,"materiality":3},"weights":{"inherent_risk":0.5,"complexity":2,"regulatory_exposure":1.5,"prior_findings":1,"time_since_audit":0.5,"materiality":2},"maxPoint":5,"method":"weighted_average_floor","expected":64.0},{"factorValues":{"inherent_risk":5,"complexity":5,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":5,"materiality":5},"weights":{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1},"maxPoint":5,"method":"maximum","expected":100.0}]$fx$::jsonb;
  rec jsonb;
  got numeric;
  exp numeric;
  i int := 0;
begin
  for rec in select * from jsonb_array_elements(fx) loop
    i := i + 1;
    exp := (rec ->> 'expected')::numeric;
    got := public.sira_compute(rec -> 'factorValues', rec -> 'weights', (rec ->> 'maxPoint')::int, rec ->> 'method');
    perform provio_test.assert_eq(got, exp, format('parity fixture %s (%s)', i, rec ->> 'method'));
  end loop;
  perform provio_test.assert_true(i >= 20, format('at least 20 parity fixtures ran (ran %s)', i));
end $$;

-- c: sira_compute rejects an out-of-range value and an unknown method.
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sira_compute('{"inherent_risk":9}'::jsonb, '{}'::jsonb, 5, 'weighted_sum')$q$,
    'outside 1..5', 'a factor value above the scale is refused');
  perform provio_test.assert_raises(
    $q$select public.sira_compute('{"inherent_risk":3}'::jsonb, '{}'::jsonb, 5, 'free_form')$q$,
    'unknown aggregation', 'an unknown aggregation method is refused');
end $$;

-- d: bands map a score to a name, highest matching band winning.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(public.sira_band_for('a0000000-0000-0000-0000-000000000001', 10), 'Low', '10 is Low');
  perform provio_test.assert_eq(public.sira_band_for('a0000000-0000-0000-0000-000000000001', 25), 'Medium', '25 is Medium (highest match)');
  perform provio_test.assert_eq(public.sira_band_for('a0000000-0000-0000-0000-000000000001', 60), 'High', '60 is High');
  perform provio_test.assert_eq(public.sira_band_for('a0000000-0000-0000-0000-000000000001', 90), 'Critical', '90 is Critical');
end $$;
select provio_test.as_owner();

-- e: editing the model requires edit_config, bumps the version and appends history.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_set_sira_aggregation('maximum')$q$,
    'lacks the edit_config right', 'a preparer without edit_config cannot edit the model');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v0 int;
  v1 int;
begin
  select version into v0 from sira_models where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform public.admin_set_sira_aggregation('maximum');
  select version into v1 from sira_models where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(v1, v0 + 1, 'editing the model bumps the version');
  perform provio_test.assert_true(
    (select count(*) from sira_model_versions where org_id = 'a0000000-0000-0000-0000-000000000001') >= 1,
    'a model change appends an immutable version snapshot');
  perform provio_test.assert_eq(
    (select snapshot ->> 'aggregation' from sira_model_versions
      where org_id = 'a0000000-0000-0000-0000-000000000001' order by version desc limit 1),
    'maximum', 'the appended snapshot records the new aggregation');
  perform public.admin_upsert_sira_factor('fraud_risk', 'Fraud risk', 2, 7);
  perform provio_test.assert_eq((select count(*) from sira_factors where org_id = 'a0000000-0000-0000-0000-000000000001'), 7,
    'a factor can be added to the model');
  perform public.admin_set_sira_band('Extreme', 90, 100, 5);
  perform provio_test.assert_eq(public.sira_band_for('a0000000-0000-0000-0000-000000000001', 95), 'Extreme',
    'a band can be added and wins at the top of the range');
end $$;
select provio_test.as_owner();

-- f: cross-org isolation of the model editors.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  perform public.admin_set_sira_aggregation('weighted_average');
  perform provio_test.assert_eq((select aggregation from sira_models where org_id = 'b0000000-0000-0000-0000-000000000001'), 'weighted_average',
    'an Org B cia edits the Org B model');
  select count(*) into n from sira_factors where org_id = 'b0000000-0000-0000-0000-000000000001' and key = 'fraud_risk';
  perform provio_test.assert_eq(n, 0, 'the Org B model never sees the Org A factor');
  -- RLS: an Org B caller sees no Org A model row at all.
  perform provio_test.assert_eq((select count(*) from sira_models where org_id = 'a0000000-0000-0000-0000-000000000001'), 0,
    'an Org B caller cannot read the Org A model');
end $$;
select provio_test.as_owner();

-- As the owner, confirm Org A is unchanged by the Org B edit.
do $$
begin
  perform provio_test.assert_eq((select aggregation from sira_models where org_id = 'a0000000-0000-0000-0000-000000000001'), 'maximum',
    'the Org A model is unchanged by the Org B edit');
  perform provio_test.assert_eq((select aggregation from sira_models where org_id = 'b0000000-0000-0000-0000-000000000001'), 'weighted_average',
    'the Org B model holds its own aggregation');
end $$;
select provio_test.as_owner();

select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_set_sira_aggregation('maximum')$q$,
    null, 'an anonymous caller cannot edit the model');
  perform provio_test.assert_raises(
    $q$select public.sira_compute('{"inherent_risk":3}'::jsonb, '{}'::jsonb, 5, 'weighted_sum')$q$,
    null, 'an anonymous caller cannot call sira_compute');
end $$;
select provio_test.as_owner();

-- g: risk library selection within a universe, per entity (§8.1).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.select_sira_risk('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', (select id from risks_library where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1))$q$),
    'lacks the manage_engagements right', 'a preparer without manage_engagements cannot select a risk');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_risk uuid;
begin
  select id into v_risk from risks_library where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  perform public.select_sira_risk('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', v_risk);
  perform provio_test.assert_eq((select count(*) from sira_risk_selection), 1, 'a risk can be selected for an entity');
  perform provio_test.assert_raises(
    format($q$select public.select_sira_risk('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', %L)$q$, v_risk),
    null, 'selecting the same risk for the same entity twice is refused');
  perform provio_test.assert_raises(
    format($q$select public.select_sira_risk('30000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000a1', %L)$q$, v_risk),
    'universe not found', 'a risk cannot be selected against another organisation''s universe');
end $$;
select provio_test.as_owner();

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

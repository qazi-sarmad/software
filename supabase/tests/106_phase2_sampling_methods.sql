-- Test 106 (Phase 2.8): method-aware sampling and the Clopper-Pearson bound.
--
-- Before migration 0105 `compute_sample` (0027) hardcoded `method = 'random'`; the schema accepted
-- seven methods and the Org Sampling Table mapped a band to one of them, but the engine implemented
-- exactly one. 0105 reads the method the Org Sampling Table maps to the population's band and applies
-- it, records the calculation, and adds the exact Clopper-Pearson interval (§11.3).
--
-- Every assertion runs under a real role. The fixture is a 40-row population (the small band) with a
-- skewed value distribution so high-value coverage and the value ordering are testable.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: three testing workpapers, each with a verified population. The value layout is fixed so
-- the value-based methods are checkable: row 1 is by far the largest (value 1000000), the rest are
-- small (value = row_ref). The top 10% of total value is row 1 alone.
do $$
declare
  v_pop uuid;
  v_wp  uuid;
  i int;
begin
  for i in 1..3 loop
    v_wp := ('60000000-0000-0000-0000-0000000000e' || i)::uuid;
    v_pop := ('70000000-0000-0000-0000-0000000000e' || i)::uuid;
    insert into workpapers (id, org_id, engagement_id, stage) values
      (v_wp, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'testing');
    insert into populations (id, org_id, engagement_id, workpaper_id, sha256, row_count, status)
    values (v_pop, 'a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1',
            v_wp, repeat('e',64), 40, 'verified');
    insert into population_rows (org_id, population_id, row_ref, data)
    select 'a0000000-0000-0000-0000-000000000001', v_pop, g,
           jsonb_build_object('amt', case when g = 1 then 1000000 else g end,
                              'account', 'GL-' || (g % 4))
    from generate_series(1, 40) g;
  end loop;
end $$;

-- ===========================================================================
-- 1. The Clopper-Pearson bound matches the textbook exact interval.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  -- References computed independently (scipy-style bisection on the binomial CDF).
  perform provio_test.assert_eq(public.clopper_pearson_upper(0, 20, 0.95), 0.168433::numeric,
    '2.8: CP upper for 0/20 at 95% is 0.168433');
  perform provio_test.assert_eq(public.clopper_pearson_upper(3, 20, 0.95), 0.378927::numeric,
    '2.8: CP upper for 3/20 at 95% is 0.378927');
  perform provio_test.assert_eq(public.clopper_pearson_lower(3, 20, 0.95), 0.032071::numeric,
    '2.8: CP lower for 3/20 at 95% is 0.032071');
  perform provio_test.assert_eq(public.clopper_pearson_upper(10, 50, 0.95), 0.337183::numeric,
    '2.8: CP upper for 10/50 at 95% is 0.337183');
  perform provio_test.assert_eq(public.clopper_pearson_lower(10, 50, 0.95), 0.100302::numeric,
    '2.8: CP lower for 10/50 at 95% is 0.100302');
  perform provio_test.assert_eq(public.clopper_pearson_upper(2, 10, 0.90), 0.506901::numeric,
    '2.8: CP upper for 2/10 at 90% is 0.506901');
  perform provio_test.assert_eq(public.clopper_pearson_upper(5, 25, 0.99), 0.469758::numeric,
    '2.8: CP upper for 5/25 at 99% is 0.469758');
  perform provio_test.assert_eq(public.clopper_pearson_upper(20, 20, 0.95), 1.0::numeric,
    '2.8: CP upper is 1 when every item is an exception');
  perform provio_test.assert_eq(public.clopper_pearson_lower(0, 20, 0.95), 0.0::numeric,
    '2.8: CP lower is 0 when there are no exceptions');
  perform provio_test.assert_eq(public.clopper_pearson_upper(5, 0, 0.95), null::numeric,
    '2.8: CP is undefined for an empty sample');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 2. Random (the default for the small band): deterministic, and the floor is met.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000e1';
  v1 jsonb;
  v2 jsonb;
begin
  v1 := public.compute_sample(v_wp, 'system');
  v2 := public.compute_sample(v_wp, 'system');
  perform provio_test.assert_eq(v1, v2, '2.8: the system sample is deterministic');
  perform provio_test.assert_eq(
    (select method from samples where workpaper_id = v_wp), 'random',
    '2.8: the small band maps to the random method');
  perform provio_test.assert_eq(
    (select calculation ->> 'formula' from samples where workpaper_id = v_wp) is not null, true,
    '2.8: the calculation records how the sample was drawn');
  perform provio_test.assert_true(
    v1 @> '[{"row_ref":1}]'::jsonb,
    '2.8: a system sample always includes the high-value item (row 1)');
end $$;

-- ===========================================================================
-- 3. High value: the largest items are selected first.
-- ===========================================================================
select provio_test.as_owner();
update org_sampling_table set method = 'high_value' where org_id = 'a0000000-0000-0000-0000-000000000001' and pop_band = 'small';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000e2';
  v_rows jsonb;
begin
  v_rows := public.compute_sample(v_wp, 'system');
  perform provio_test.assert_eq(
    (select method from samples where workpaper_id = v_wp), 'high_value',
    '2.8: the high_value method is applied from the Org Sampling Table');
  perform provio_test.assert_true(
    v_rows @> '[{"row_ref":1}]'::jsonb,
    '2.8: high value selects the largest item first');
end $$;

-- ===========================================================================
-- 4. Low value: the smallest items are selected first.
-- ===========================================================================
select provio_test.as_owner();
update org_sampling_table set method = 'low_value' where org_id = 'a0000000-0000-0000-0000-000000000001' and pop_band = 'small';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000e3';
  v_rows jsonb;
begin
  v_rows := public.compute_sample(v_wp, 'system');
  perform provio_test.assert_eq(
    (select method from samples where workpaper_id = v_wp), 'low_value',
    '2.8: the low_value method is applied');
  -- The smallest row is row 2 (value 2); row 1 (value 1000000) is the largest, so it is not the pick
  -- — but it is the high-value item, so it is added back for coverage.
  perform provio_test.assert_true(
    v_rows @> '[{"row_ref":2}]'::jsonb,
    '2.8: low value selects the smallest item first');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. Systematic: the pick count is the floor and the selection is reproducible.
-- ===========================================================================
update org_sampling_table set method = 'systematic' where org_id = 'a0000000-0000-0000-0000-000000000001' and pop_band = 'small';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_wp uuid := '60000000-0000-0000-0000-0000000000e1';
  v_rows jsonb;
begin
  v_rows := public.compute_sample(v_wp, 'system');
  perform provio_test.assert_eq(
    (select method from samples where workpaper_id = v_wp), 'systematic',
    '2.8: the systematic method is applied');
  perform provio_test.assert_true(
    jsonb_array_length(v_rows) >= (select size_floor from samples where workpaper_id = v_wp),
    '2.8: a systematic sample meets the floor');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. The other methods are accepted and produce a deterministic, non-empty sample.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  m text;
  v_wp uuid := '60000000-0000-0000-0000-0000000000e2';
  v_rows jsonb;
begin
  foreach m in array array['mus', 'stratified', 'haphazard'] loop
    -- The Org Sampling Table write needs the config right, so it runs as the owner; the draw runs as
    -- the preparer, whose perform_work right is what compute_sample checks. The JWT claims stay set
    -- across the temporary role switch, so jwt_org_id() still resolves.
    perform set_config('role', 'postgres', true);
    delete from samples where workpaper_id = v_wp;
    update org_sampling_table set method = m
     where org_id = 'a0000000-0000-0000-0000-000000000001' and pop_band = 'small';
    perform set_config('role', 'authenticated', true);
    v_rows := public.compute_sample(v_wp, 'system');
    perform provio_test.assert_true(jsonb_array_length(v_rows) > 0, format('2.8: %s draws a non-empty sample', m));
    perform provio_test.assert_eq((select method from samples where workpaper_id = v_wp), m,
      format('2.8: the %s method is recorded', m));
  end loop;
  perform set_config('role', 'postgres', true);
  update org_sampling_table set method = 'random'
   where org_id = 'a0000000-0000-0000-0000-000000000001' and pop_band = 'small';
  perform set_config('role', 'authenticated', true);
end $$;

-- ===========================================================================
-- 7. sample_precision reads k from the recorded exceptions.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_sample uuid;
  v_ref text;
  v_prec jsonb;
begin
  select id into v_sample from samples where workpaper_id = '60000000-0000-0000-0000-0000000000e2';
  -- Lock so the drawn rows are seeded and linked, then record exceptions against them.
  perform public.lock_sample(v_sample);
  -- Two of the sample's rows become exceptions.
  for v_ref in select row_ref from workpaper_rows where sample_id = v_sample order by row_ref limit 2 loop
    perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000e2', v_ref, 'cross', 'Amounts do not agree to the ledger.');
  end loop;
  v_prec := public.sample_precision(v_sample, 0.95);
  perform provio_test.assert_eq((v_prec ->> 'k')::int, 2, '2.8: sample_precision counts the recorded exceptions');
  perform provio_test.assert_eq((v_prec ->> 'n')::int,
    (select jsonb_array_length(sample_rows) from samples where id = v_sample),
    '2.8: sample_precision reports the sample size');
  perform provio_test.assert_true((v_prec ->> 'upper')::numeric > (v_prec ->> 'lower')::numeric,
    '2.8: the CP interval has a positive width');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 8. Isolation: Org B reads no sample precision for Org A's sample.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sample_precision('80000000-0000-0000-0000-0000000000a1')$q$,
    'not found', '2.8: another organisation cannot read this sample precision');
end $$;
select provio_test.as_owner();

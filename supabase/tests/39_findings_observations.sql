-- Test 39 (5A): Findings, observations and issues — the readability gate, the four mandatory role
-- tags, org-configured optional tags, severity colour tokens and cross-org refusal (spec §14).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The readability check needs Context, Condition, Effect and Risk (all four, non-empty).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_obs uuid;
begin
  v_obs := public.create_observation(
    '50000000-0000-0000-0000-0000000000a1', null, 'Incomplete',
    '{"context":"Payroll area","condition":"Two approvals missing"}'::jsonb);
  perform provio_test.assert_true(v_obs is not null, '5A: an observation can be created as a draft');
  perform provio_test.assert_eq(public.check_readability(v_obs), false,
    '5A: readability fails when effect and risk are missing');
  perform provio_test.assert_eq(public.missing_readability_sections(v_obs), array['effect','risk'],
    '5A: the missing tags are reported in order');
  perform provio_test.assert_raises(
    format($q$select public.promote_to_finding('%s')$q$, v_obs),
    'readability_failed', '5A: promotion is refused while mandatory sections are missing');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A complete observation promotes to a finding, and the observation flips to 'finding'.
-- ---------------------------------------------------------------------------
do $$
declare v_obs uuid; v_finding uuid; v_level uuid;
begin
  v_obs := public.create_observation(
    '50000000-0000-0000-0000-0000000000a1', null, 'Complete',
    '{"context":"Payroll","condition":"Approvals missing","effect":"Unauthorised payments","risk":"Fraud"}'::jsonb);
  perform provio_test.assert_eq(public.check_readability(v_obs), true,
    '5A: readability passes when all four mandatory tags are filled');
  select id into v_level from severity_levels where org_id = 'a0000000-0000-0000-0000-000000000001' and name = 'High';
  v_finding := public.promote_to_finding(v_obs, v_level);
  perform provio_test.assert_true(v_finding is not null, '5A: a complete observation promotes to a finding');
  perform provio_test.assert_eq(
    (select status from observations where id = v_obs), 'finding',
    '5A: the observation status becomes finding');
  perform provio_test.assert_eq(
    (select count(*) from findings where id = v_finding and observation_id = v_obs), 1::bigint,
    '5A: the finding links back to its observation');
end $$;

-- ---------------------------------------------------------------------------
-- 3. An optional tag required by the org's methodology blocks promotion when it is empty (§14.3).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into config_versions (org_id, key, value, version) values
  ('a0000000-0000-0000-0000-000000000001', 'methodology.required_sections', '["criteria","cause"]', 1);
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_obs uuid;
begin
  v_obs := public.create_observation(
    '50000000-0000-0000-0000-0000000000a1', null, 'Optional missing',
    '{"context":"Payroll","condition":"Approvals missing","effect":"Loss","risk":"Fraud"}'::jsonb);
  perform provio_test.assert_eq(public.check_readability(v_obs), false,
    '5A: an org-required optional tag (criteria, cause) is enforced');
  perform provio_test.assert_eq(public.missing_readability_sections(v_obs), array['criteria','cause'],
    '5A: the missing optional tags are reported');
end $$;
select provio_test.as_owner();
-- config_versions is append-only (M5/L5): supersede with a newer version rather than delete.
insert into config_versions (org_id, key, value, version) values
  ('a0000000-0000-0000-0000-000000000001', 'methodology.required_sections', '[]', 2);

-- ---------------------------------------------------------------------------
-- 4. A severity level's colour must be a design token, not a hex value (§14.4).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into severity_levels (org_id, name, color_token, rank) values ('a0000000-0000-0000-0000-000000000001','Critical','#ff0000',4)$q$,
    'severity_levels_token_chk', '5A: a severity colour must be a design token, not a hex value');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Cross-org refusal: an Org B caller cannot read Org A severity levels or promote an Org A
--    observation.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from severity_levels where org_id = 'a0000000-0000-0000-0000-000000000001'), 0::bigint,
    '5A: an Org B caller reads zero Org A severity levels');
  perform provio_test.assert_raises(
    $q$select public.check_readability((select id from observations where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1))$q$,
    'not found in this organisation', '5A: an Org B caller cannot check an Org A observation');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A caller without perform_work cannot create an observation.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_observation('50000000-0000-0000-0000-0000000000a1', null, 'x', '{}'::jsonb)$q$,
    'perform_work', '5A: a caller without perform_work cannot create an observation');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Anon reads nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_eq((select count(*) from severity_levels), 0::bigint,
    '5A: anon reads zero severity levels');
  perform provio_test.assert_eq((select count(*) from observations), 0::bigint,
    '5A: anon reads zero observations');
end $$;
select provio_test.as_owner();

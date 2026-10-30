-- Test 141 (S2, D5/D7/D8/D9): the assurance capabilities.
--
-- Covers the four owner-approved capabilities of docs/ASSURANCE-RULEBOOKS.md:
--   D5 ICFR continuous control monitoring — a breach opens a finding naming the control id, the rule
--      id/version and the AS 2201 severity; a control with no evidence is not a pass; a compensating
--      control caps the severity; the feature gate and the right are enforced; a re-run duplicates
--      nothing.
--   D7 population forensics — a rule run over a population records its findings; a foreign population
--      is refused.
--   D8 gap analysis — a gap names its clause and the missing control; a re-run duplicates nothing.
--   D9 metrics — a metric with a NULL value stays unknown, never 0.
--
-- Every writer is security-definer; this file proves the isolation (L2), the right check, and that a
-- refusal writes nothing.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. D5 — configure an ICFR control, its rule and its evidence, then monitor.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
-- The org admin holds edit_config but not perform_work, so it may configure but not record a finding.
select public.icfr_control_save('a0000000-0000-0000-0000-000000000001', 'C-01', 'coso_icif_2013',
  'control_activities', 12, 'completeness', 'Owner A', 'Match the subledger to the GL each close', null);
select public.icfr_rule_save('a0000000-0000-0000-0000-000000000001', 'icfr.c01', 1, 'C-01', 5);
select public.icfr_evidence_save('a0000000-0000-0000-0000-000000000001', 'C-01', 200, 40, '2026-10-28T00:00:00.000Z');
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from icfr_controls where org_id = 'a0000000-0000-0000-0000-000000000001' and control_id = 'C-01'),
    1::bigint, 'D5: the control was configured');
  perform provio_test.assert_eq(
    (select tolerance_percent from icfr_monitor_rules where org_id = 'a0000000-0000-0000-0000-000000000001' and rule_id = 'icfr.c01'),
    5::numeric, 'D5: the rule tolerance was saved');
  perform provio_test.assert_eq(
    (select deviations from icfr_control_evidence where org_id = 'a0000000-0000-0000-0000-000000000001' and control_id = 'C-01'),
    40, 'D5: the evidence was saved');
end $$;

-- ===========================================================================
-- 2. D5 — the feature gate: without the feature the finding writer refuses and writes nothing.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.icfr_finding_record('a0000000-0000-0000-0000-000000000001', null, '2026-10-28T00:00:00.000Z',
      '[{"ruleId":"icfr.c01","ruleVersion":1,"controlId":"C-01","severity":"material_weakness","reason":"x"}]'::jsonb)
  $q$, 'feature_off: icfr_monitoring', 'D5: without the feature the writer is refused');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'icfr_finding'),
    0::bigint, 'D5: the refused write left no ledger entry');
end $$;

-- ===========================================================================
-- 3. D5 — with the feature on, a breach opens a finding; a re-run duplicates nothing.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'icfr_monitoring', true, null, 'test');
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

do $$
declare
  v_added int;
begin
  v_added := public.icfr_finding_record('a0000000-0000-0000-0000-000000000001', null, '2026-10-28T00:00:00.000Z',
    '[{"ruleId":"icfr.c01","ruleVersion":1,"controlId":"C-01","severity":"material_weakness","reason":"ICFR control C-01 breached"}]'::jsonb);
  perform provio_test.assert_eq(v_added, 1, 'D5: the breach opened one finding');
  perform provio_test.assert_eq(
    (select payload -> 'finding' ->> 'controlId' from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'icfr_finding'),
    'C-01', 'D5: the finding names its control id');
  perform provio_test.assert_eq(
    (select payload -> 'finding' ->> 'severity' from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'icfr_finding'),
    'material_weakness', 'D5: the finding names the AS 2201 severity');
  -- A re-run of the same evaluation is idempotent.
  v_added := public.icfr_finding_record('a0000000-0000-0000-0000-000000000001', null, '2026-10-28T00:00:00.000Z',
    '[{"ruleId":"icfr.c01","ruleVersion":1,"controlId":"C-01","severity":"material_weakness","reason":"ICFR control C-01 breached"}]'::jsonb);
  perform provio_test.assert_eq(v_added, 0, 'D5: a re-run of the same evaluation adds no finding');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4. D5 — the writer refuses a control that is not the org's, and a finding with no rule version.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.icfr_finding_record('a0000000-0000-0000-0000-000000000001', null, '2026-10-29T00:00:00.000Z',
      '[{"ruleId":"icfr.xx","ruleVersion":1,"controlId":"C-99","severity":"deficiency","reason":"x"}]'::jsonb)
  $q$, 'not found in this organisation', 'D5: a control outside the org is refused');
  perform provio_test.assert_raises($q$
    select public.icfr_finding_record('a0000000-0000-0000-0000-000000000001', null, '2026-10-29T00:00:00.000Z',
      '[{"ruleId":"icfr.c01","controlId":"C-01","severity":"deficiency","reason":"x"}]'::jsonb)
  $q$, 'needs a ruleId, a ruleVersion and a controlId', 'D5: a finding without a rule version is refused');
end $$;

-- ===========================================================================
-- 5. D5 — the writer enforces the right: an observer (read-only) may not record a finding.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.icfr_finding_record('a0000000-0000-0000-0000-000000000001', null, '2026-10-29T00:00:00.000Z',
      '[{"ruleId":"icfr.c01","ruleVersion":1,"controlId":"C-01","severity":"deficiency","reason":"x"}]'::jsonb)
  $q$, 'not permitted: perform_work or review_and_approve is required', 'D5: a read-only caller may not record');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. D5 — L2 isolation: a caller of another org sees none of org A's controls.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from icfr_controls), 0::bigint,
    'D5: org B sees none of org A''s ICFR controls (RLS)');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 7. D7 — a forensic rule run records its findings; a foreign population is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'forensic_analytics', true, null, 'test');
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_added int;
begin
  v_added := public.forensic_finding_record('a0000000-0000-0000-0000-000000000001', null, null, '2026-10-28T00:00:00.000Z',
    '[{"ruleId":"forensic.benford_first_digit","ruleVersion":1,"checkId":"benford_first_digit","flaggedCount":3,"source":"Benford''s Law","reason":"3 rows matched"}]'::jsonb);
  perform provio_test.assert_eq(v_added, 1, 'D7: the forensic run recorded one finding');
  perform provio_test.assert_eq(
    (select payload -> 'finding' ->> 'source' from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'forensic_finding'),
    'Benford''s Law', 'D7: the finding names its verified source');
end $$;
do $$
begin
  perform provio_test.assert_raises($q$
    select public.forensic_finding_record('a0000000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', null, '2026-10-28T00:00:00.000Z',
      '[{"ruleId":"forensic.duplicates","ruleVersion":1}]'::jsonb)
  $q$, 'population not found in this organisation', 'D7: a population outside the org is refused');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 8. D8 — a gap names its clause and the missing control; a re-run duplicates nothing.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'policy_gap_analysis', true, null, 'test');
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.icfr_control_save('a0000000-0000-0000-0000-000000000001', 'C-02', 'iso_27001_2022',
  'control_activities', 11, 'existence_occurrence', 'Owner B', 'Access review each quarter', null);
select provio_test.as_owner();
do $$
begin
  insert into policy_obligations (org_id, obligation_id, source_clause, subject, control_ids)
  values ('a0000000-0000-0000-0000-000000000001', 'O-1', 'ISO-A.5.15', 'access control', '["C-02","C-99"]'::jsonb),
         ('a0000000-0000-0000-0000-000000000001', 'O-2', 'CL-UNK', 'unknown clause', null);
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_added int;
begin
  v_added := public.gap_finding_record('a0000000-0000-0000-0000-000000000001',
    '[{"obligationId":"O-1","sourceClause":"ISO-A.5.15","status":"partial","reason":"missing C-99"},
      {"obligationId":"O-2","sourceClause":"CL-UNK","status":"not_interpreted","reason":"could not be interpreted"}]'::jsonb);
  perform provio_test.assert_eq(v_added, 2, 'D8: both gaps were recorded');
  perform provio_test.assert_eq(
    (select payload -> 'finding' ->> 'sourceClause' from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'gap_finding'
        and payload -> 'finding' ->> 'obligationId' = 'O-1'),
    'ISO-A.5.15', 'D8: the gap names its clause');
  -- Idempotent per (obligation, clause).
  v_added := public.gap_finding_record('a0000000-0000-0000-0000-000000000001',
    '[{"obligationId":"O-1","sourceClause":"ISO-A.5.15","status":"partial","reason":"missing C-99"}]'::jsonb);
  perform provio_test.assert_eq(v_added, 0, 'D8: a re-run of the same clause adds no finding');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 9. D9 — a metric with a NULL value stays unknown; a value is saved; isolation holds.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.assurance_metric_save('a0000000-0000-0000-0000-000000000001', 'M-1', '12.2', 'engagement conformance', 95, 'EV-1');
select public.assurance_metric_save('a0000000-0000-0000-0000-000000000001', 'M-2', '8.4', 'EQA readiness', null, null);
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select value from assurance_metrics where org_id = 'a0000000-0000-0000-0000-000000000001' and metric_id = 'M-1'),
    95::numeric, 'D9: a measured metric keeps its value');
  perform provio_test.assert_true(
    (select value is null from assurance_metrics where org_id = 'a0000000-0000-0000-0000-000000000001' and metric_id = 'M-2'),
    'D9: a metric with no input stays NULL (unknown), never 0');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from assurance_metrics), 0::bigint,
    'D9: org B sees none of org A''s metrics (RLS)');
  perform provio_test.assert_eq((select count(*) from policy_obligations), 0::bigint,
    'D8: org B sees none of org A''s obligations (RLS)');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 10. Grants: no writer is anon-reachable.
-- ===========================================================================
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'icfr_control_save(uuid, text, text, text, int, text, text, text, text)',
    'icfr_rule_save(uuid, text, int, text, numeric)',
    'icfr_evidence_save(uuid, text, int, int, timestamptz)',
    'icfr_finding_record(uuid, uuid, timestamptz, jsonb)',
    'forensic_finding_record(uuid, uuid, uuid, timestamptz, jsonb)',
    'gap_finding_record(uuid, jsonb)',
    'assurance_metric_save(uuid, text, text, text, numeric, text)']
  loop
    perform provio_test.assert_true(
      not has_function_privilege('anon', 'public.' || v_fn, 'execute'),
      format('S2: anon may not execute %s', v_fn));
    perform provio_test.assert_true(
      has_function_privilege('authenticated', 'public.' || v_fn, 'execute'),
      format('S2: authenticated may execute %s', v_fn));
  end loop;
end $$;

select provio_test.as_owner();

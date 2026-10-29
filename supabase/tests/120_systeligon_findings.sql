-- 120: Systeligon findings (S13, 0118). A rule run's findings are recorded against an engagement as
--      idempotent, hash-chained ledger entries, and the report reads them back with the rule
--      provenance intact (F39). Sibling of 119 (rule packs).
--   * A record needs the feature, a right and a real engagement; the evaluation instant is required.
--   * Re-recording the same run adds nothing; a new instant is a new run.
--   * Isolation: a user in another org cannot record against the first org's engagement.
-- M5: fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. As a performer in org A, with the feature on, record two findings.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_eng uuid := '50000000-0000-0000-0000-0000000000a1';
  v_added int;
  v_findings jsonb := jsonb_build_array(
    jsonb_build_object('ruleId','numeric.duplicates','ruleVersion',1,'severity','medium'),
    jsonb_build_object('ruleId','numeric.round_numbers','ruleVersion',2,'severity','low'));
begin
  v_added := public.systeligon_finding_record(null, v_eng, '2026-10-29T00:00:00Z'::timestamptz, v_findings);
  perform provio_test.assert_eq(v_added, 2, 'finding: two findings are recorded');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where action = 'rule_finding'), 2,
    'finding: each finding is a ledger entry');
  perform provio_test.assert_eq(
    (select payload ->> 'engagement_id' from ledger_entries where action = 'rule_finding'
      and payload -> 'finding' ->> 'ruleId' = 'numeric.duplicates'), v_eng::text,
    'finding: the entry names the engagement');

  -- Idempotent per run: the same run records nothing new.
  v_added := public.systeligon_finding_record(null, v_eng, '2026-10-29T00:00:00Z'::timestamptz, v_findings);
  perform provio_test.assert_eq(v_added, 0, 'finding: re-recording the same run adds nothing');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where action = 'rule_finding'), 2,
    'finding: the ledger still holds two');

  -- A new instant is a new run.
  v_added := public.systeligon_finding_record(null, v_eng, '2026-10-30T00:00:00Z'::timestamptz, v_findings);
  perform provio_test.assert_eq(v_added, 2, 'finding: a new instant is a new run');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The instant is required (a finding is never recorded against a clock).
-- ---------------------------------------------------------------------------
select provio_test.assert_raises(
  $$select public.systeligon_finding_record(null, '50000000-0000-0000-0000-0000000000a1', null, '[]'::jsonb)$$,
  'evaluation instant is required', 'finding: a null instant is refused');

-- ---------------------------------------------------------------------------
-- 3. Every finding needs a rule id and a version.
-- ---------------------------------------------------------------------------
select provio_test.assert_raises(
  $$select public.systeligon_finding_record(null, '50000000-0000-0000-0000-0000000000a1',
      '2026-10-31T00:00:00Z'::timestamptz, jsonb_build_array(jsonb_build_object('severity','low')))$$,
  'ruleId and a ruleVersion', 'finding: missing rule provenance is refused');

-- ---------------------------------------------------------------------------
-- 4. Isolation: a user in another org cannot record against org A's engagement.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_raises(
  $$select public.systeligon_finding_record(null, '50000000-0000-0000-0000-0000000000a1',
      '2026-10-29T00:00:00Z'::timestamptz,
      jsonb_build_array(jsonb_build_object('ruleId','numeric.duplicates','ruleVersion',1)))$$,
  'engagement not found', 'finding: a foreign engagement is refused');

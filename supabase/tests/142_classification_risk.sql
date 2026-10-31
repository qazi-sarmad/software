-- Test 142 (S3): D10 classification + the configurable standards library + the derived risk library
-- and the D14 auto-compute (normalisation to 100, auto-derived factors, the manual override).
-- Sources: docs/PAKISTAN-ASSURANCE-REGIMES.md, docs/RISK-ASSESSMENT-MODEL.md, docs/AUDIT-DOMAINS-MODEL.md.

-- ===========================================================================
-- 1. D10 — classify a tenant (C6, a bank/DFI): ICFR at the highest rigour, the LFR artifact, and
--    the citation-bearing obligations are materialised.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_version int;
begin
  v_version := public.classification_set('a0000000-0000-0000-0000-000000000001', 'C6', false, true);
  perform provio_test.assert_eq(v_version, 1, 'D10: the first classification is version 1');
  perform provio_test.assert_true(
    (select icfr_mandatory and icfr_rigour = 'highest' from org_classification
      where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D10: a banking company / DFI gets the highest ICFR rigour');
  perform provio_test.assert_true(
    (select artifacts::text like '%Long Form Report (LFR)%' from org_classification
      where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D10: the LFR artifact is required for C6');
  perform provio_test.assert_true(
    (select regulator_numbering like 'SBP BSD Circular No. 7%' from org_classification
      where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D10: the regulator numbering cites the SBP circular');
  -- The obligations, each naming its clause.
  perform provio_test.assert_eq(
    (select count(*) from classification_obligations where org_id = 'a0000000-0000-0000-0000-000000000001'),
    2::bigint, 'D10: C6 materialised its two obligations');
  perform provio_test.assert_true(
    (select bool_and(source_clause <> '') from classification_obligations
      where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D10: every obligation names its source clause');
  -- C6 with IT scope offers all three disciplines; never hard-code exactly three.
  perform provio_test.assert_true(
    (select offered_disciplines ? 'shariah' and offered_disciplines ? 'it' and offered_disciplines ? 'management'
      from org_classification where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D10: C6 with IT scope offers management, IT and Shari''ah');
end $$;

-- ===========================================================================
-- 2. D10 bad path — a classification the matrix does not name is refused.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.classification_set('a0000000-0000-0000-0000-000000000001', 'C9', false, false)
  $q$, 'not one the matrix names', 'D10: an unknown classification is refused');
end $$;

-- ===========================================================================
-- 3. D10 — the right is enforced: an observer may not classify.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.classification_set('a0000000-0000-0000-0000-000000000001', 'C1', false, false)
  $q$, 'edit_config', 'D10: a caller without edit_config may not classify');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4. The standards library — configurable per org or for all orgs at once.
-- ===========================================================================
-- A platform default exists for every org to read.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from standards_library where org_id is null and key = 'cobit.2019') = 1,
    'standards: the platform COBIT 2019 default is visible to org B');
end $$;
select provio_test.as_owner();

-- scope=org: one org's own override, invisible to the other.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_version int;
begin
  v_version := public.standards_update_scope('org', 'a0000000-0000-0000-0000-000000000001', 'cobit.2019', 'it',
    'COBIT 2019 (org A configured)', 'COBIT 2019', 'docs/ASSURANCE-RULEBOOKS.md §1');
  perform provio_test.assert_eq(v_version, 1, 'standards: the org override starts at version 1');
  perform provio_test.assert_eq(
    (select count(*) from standards_library where org_id = 'a0000000-0000-0000-0000-000000000001' and key = 'cobit.2019'),
    1::bigint, 'standards: org A now carries its own COBIT row');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from standards_library where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'standards: org B sees none of org A''s overrides (L2)');
end $$;
select provio_test.as_owner();

-- scope=all_orgs: platform admin updates every org at once, one version each, in one transaction.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_count int;
  v_orgs int;
begin
  select count(*) into v_orgs from orgs;
  v_count := public.standards_update_scope('all_orgs', null, 'nist.sp.800-53.r5', 'it',
    'NIST SP 800-53 Rev. 5 (all orgs)', 'NIST SP 800-53 Rev. 5', 'docs/ASSURANCE-RULEBOOKS.md §1');
  perform provio_test.assert_eq(v_count, v_orgs, 'standards: all_orgs wrote one override per org');
  perform provio_test.assert_eq(
    (select count(distinct org_id) from standards_library where key = 'nist.sp.800-53.r5' and org_id is not null),
    v_orgs::bigint, 'standards: every org now has its own NIST row');
end $$;

-- bad path: a non-platform caller may not update all orgs.
select provio_test.as_owner();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.standards_update_scope('all_orgs', null, 'cobit.2019', 'it', 'x', '', '')
  $q$, 'platform administrator only', 'standards: scope=all_orgs is platform-admin only');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. D10 — risks are derived from the frameworks into the risk library, for the offered disciplines.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_added int;
  v_again int;
begin
  v_added := public.risk_library_derive('a0000000-0000-0000-0000-000000000001', null);
  perform provio_test.assert_true(v_added > 0, 'D10: the frameworks derive risks into the library');
  -- A management risk and a Shari'ah risk both land (C6 offers both).
  perform provio_test.assert_true(
    (select count(*) > 0 from risks_library
      where org_id = 'a0000000-0000-0000-0000-000000000001' and derived_from = 'coso.icif.2013'),
    'D10: a COSO ICIF risk is derived (management)');
  perform provio_test.assert_true(
    (select count(*) > 0 from risks_library
      where org_id = 'a0000000-0000-0000-0000-000000000001' and derived_from = 'aaoifi.ss'),
    'D10: an AAOIFI risk is derived (Shari''ah)');
  -- Idempotent: a re-run adds nothing.
  v_again := public.risk_library_derive('a0000000-0000-0000-0000-000000000001', null);
  perform provio_test.assert_eq(v_again, 0, 'D10: a re-derivation adds no duplicate risk');
end $$;
select provio_test.as_owner();

-- bad path: an org with no classification cannot derive.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.risk_library_derive('b0000000-0000-0000-0000-000000000001', null)
  $q$, 'no classification yet', 'D10: a derivation needs a classification first');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. D14 — the auto-compute normalises the factor weights to exactly 100.
-- ===========================================================================
do $$
declare
  v_norm jsonb;
  v_total numeric;
begin
  v_norm := public.sira_normalize_weights('{"a":1,"b":1,"c":1,"d":2,"e":5}'::jsonb);
  select sum((value #>> '{}')::numeric) into v_total from jsonb_each(v_norm);
  perform provio_test.assert_eq(v_total, 100::numeric, 'D14: the normalised weights sum to exactly 100');
  perform provio_test.assert_true(
    (select bool_and((value #>> '{}')::numeric = floor((value #>> '{}')::numeric)) from jsonb_each(v_norm)),
    'D14: every normalised weight is an integer');
end $$;

-- ===========================================================================
-- 7. D14 — write the derived factors; the score is computed over the normalised weights; an unknown
--    factor is omitted, never 0.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_risk uuid;
  v_score numeric;
begin
  select id into v_risk from risks_library
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;

  -- Two known factors and one unknown (null). The unknown must not appear as 0.
  v_score := public.risk_factor_write(
    'a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1',
    v_risk,
    '[{"factorKey":"inherent_risk","proposedValue":4},{"factorKey":"complexity","proposedValue":2},{"factorKey":"materiality","proposedValue":null}]'::jsonb,
    '[]'::jsonb);
  perform provio_test.assert_true(v_score > 0, 'D14: the score is computed from the derived factors');
  perform provio_test.assert_true(
    (select not factor_values ? 'materiality' from sira_scores
      where org_id = 'a0000000-0000-0000-0000-000000000001' and risk_id = v_risk),
    'D14: an unknown factor is omitted from the score, never 0');
end $$;

-- ===========================================================================
-- 8. D14 — the manual override: the reason is mandatory, the auto value is kept, the revert is recorded.
-- ===========================================================================
do $$
declare
  v_risk uuid;
begin
  select id into v_risk from risks_library
   where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;

  -- bad path: an empty reason is refused.
  perform provio_test.assert_raises($q$
    select public.risk_override_set('a0000000-0000-0000-0000-000000000001',
      'a1000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
      (select id from risks_library where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
      'inherent_risk', 5, '   ')
  $q$, 'reason is refused', 'D14: an override with an empty reason is refused');

  -- happy path: the override is recorded and the auto value is kept.
  perform public.risk_override_set('a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', v_risk,
    'inherent_risk', 5, 'board judgement');
  perform provio_test.assert_eq(
    (select (overrides -> 0 ->> 'overrideValue')::numeric from sira_scores
      where org_id = 'a0000000-0000-0000-0000-000000000001' and risk_id = v_risk),
    5::numeric, 'D14: the override value is recorded');
  perform provio_test.assert_eq(
    (select (overrides -> 0 ->> 'autoValueAtOverride')::numeric from sira_scores
      where org_id = 'a0000000-0000-0000-0000-000000000001' and risk_id = v_risk),
    4::numeric, 'D14: the automatic value at override is kept, never destroyed');

  -- revert: the record is kept and the revert is named.
  perform public.risk_override_revert('a0000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', v_risk, 'inherent_risk');
  perform provio_test.assert_true(
    (select overrides -> 0 ->> 'overrideReason' like '%reverted by%' from sira_scores
      where org_id = 'a0000000-0000-0000-0000-000000000001' and risk_id = v_risk),
    'D14: the revert is recorded on the override');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 9. L2 isolation — org B sees none of org A's classification or derived risks.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from org_classification where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'D10: org B sees none of org A''s classification (RLS)');
  perform provio_test.assert_eq((select count(*) from classification_obligations where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'D10: org B sees none of org A''s obligations (RLS)');
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
    'classification_set(uuid, text, boolean, boolean)',
    'standards_upsert(uuid, text, text, text, text, text, text, jsonb)',
    'standards_update_scope(text, uuid, text, text, text, text, text)',
    'risk_library_derive(uuid, text)',
    'risk_factor_write(uuid, uuid, uuid, uuid, jsonb, jsonb)',
    'risk_override_set(uuid, uuid, uuid, uuid, text, numeric, text)',
    'risk_override_revert(uuid, uuid, uuid, uuid, text)']
  loop
    perform provio_test.assert_true(
      not has_function_privilege('anon', 'public.' || v_fn, 'execute'),
      format('S3: anon may not execute %s', v_fn));
    perform provio_test.assert_true(
      has_function_privilege('authenticated', 'public.' || v_fn, 'execute'),
      format('S3: authenticated may execute %s', v_fn));
  end loop;
end $$;


-- ===========================================================================
-- 11. D15 — the ERM theme map, the KRIs and the trigger-based plan-change proposal.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
begin
  perform public.erm_theme_set('a0000000-0000-0000-0000-000000000001', 'cybersecurity and data privacy',
                               '40000000-0000-0000-0000-0000000000a1', true);
  perform provio_test.assert_true(
    (select is_top_risk from erm_theme_map
      where org_id = 'a0000000-0000-0000-0000-000000000001' and theme = 'cybersecurity and data privacy'),
    'D15: the theme is mapped and marked a top risk');
  perform public.kri_value_set('a0000000-0000-0000-0000-000000000001', 'KRI-1', 'cybersecurity and data privacy', null, null);
  perform provio_test.assert_true(
    (select value is null and tolerance is null from erm_kri
      where org_id = 'a0000000-0000-0000-0000-000000000001' and kri_id = 'KRI-1'),
    'D15: an unmeasured KRI stores no value and no tolerance');
  perform public.kri_value_set('a0000000-0000-0000-0000-000000000001', 'KRI-1', 'cybersecurity and data privacy', 9, 5);
  perform provio_test.assert_true(
    (select value > tolerance from erm_kri
      where org_id = 'a0000000-0000-0000-0000-000000000001' and kri_id = 'KRI-1'),
    'D15: a value above the tolerance is a breach');
  v_id := public.plan_change_propose('a0000000-0000-0000-0000-000000000001', 'incident',
                                     '40000000-0000-0000-0000-0000000000a1', 'defer', 'assess the incident first');
  perform provio_test.assert_true(v_id is not null, 'D15: a plan-change proposal is recorded');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'plan_change_proposed'),
    'D15: the proposal is on the ledger');
end $$;

-- Bad path: a proposal without a rationale is refused.
do $$
begin
  perform provio_test.assert_raises($q$
    select public.plan_change_propose('a0000000-0000-0000-0000-000000000001', 'incident',
                                      '40000000-0000-0000-0000-0000000000a1', 'defer', '')
  $q$, 'requires a rationale', 'D15: a plan-change proposal requires a rationale');
end $$;

-- Bad path: an unknown trigger kind is refused.
do $$
begin
  perform provio_test.assert_raises($q$
    select public.plan_change_propose('a0000000-0000-0000-0000-000000000001', 'rumour',
                                      '40000000-0000-0000-0000-0000000000a1', 'defer', 'x')
  $q$, 'unknown trigger kind', 'D15: an unknown trigger kind is refused');
end $$;

-- Bad path: an entity from another organisation is refused (L2).
do $$
begin
  perform provio_test.assert_raises($q$
    select public.erm_theme_set('a0000000-0000-0000-0000-000000000001', 'talent and workforce',
                                '40000000-0000-0000-0000-0000000000b1', true)
  $q$, 'entity not found in this organisation', 'D15: an entity from another org is refused');
end $$;

-- Cross-tenant read: org B sees none of org A's D15 rows.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from erm_theme_map where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'D15: org B sees no ERM theme row of org A (RLS)');
  perform provio_test.assert_eq(
    (select count(*) from plan_change_proposals where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'D15: org B sees no plan-change proposal of org A (RLS)');
end $$;

select provio_test.as_owner();

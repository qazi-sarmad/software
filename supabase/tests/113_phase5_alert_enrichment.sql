-- Test 113 (Phase 5, C2): alert enrichment.
--
-- Before migration 0112 a monitor alert carried only its rule, kind, reason, references and hashes.
-- `docs/SYSTELIGON.md` §11.1 calls the missing linkage the highest-value gap in the phase: an alert
-- must name the entity, the department, the engagement, the universe, the SIRA residual risk and the
-- affected controls, or nobody can act on it. 0112 resolves that join in `alert_enrichment` and
-- stores the result on the alert through `alert_record`.
--
-- The fixtures are the seed (00_lib.sql) plus a population-linked staged record, so the chain
-- staged_records.population_id -> populations.engagement_id -> engagements.entity_id -> entities and
-- sira_scores is exercised for real, not asserted around.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. The resolver follows the real chain and returns the linkage.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_enr jsonb;
begin
  -- The entity's recorded label for the department. The seed leaves `kind` empty, so it falls back
  -- to the entity name; set it so the department assertion is about `kind`, not the fallback.
  update entities set kind = 'Treasury' where id = '40000000-0000-0000-0000-0000000000a1';
  -- The inherent-risk factor on the seed score row, before the cycle is frozen by publication.
  update sira_scores set factor_values = '{"inherent_risk": 4}'
   where org_id = v_org and cycle_id = 'a1000000-0000-0000-0000-0000000000a1';
  -- Publish the seed cycle so the SIRA join has a published cycle to read.
  update sira_cycles set status = 'published', published_at = now()
   where id = 'a1000000-0000-0000-0000-0000000000a1';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.connector_instance_save('a0000000-0000-0000-0000-000000000001', null, 'ledger-feed',
  'Test ledger', '{}'::jsonb, null);
select public.staged_record_ingest('a0000000-0000-0000-0000-000000000001',
  (select id from connector_instances where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
  null, 'ledger', 'e1', repeat('e', 64), '2026-10-27T10:00:00.000Z'::timestamptz,
  '{"amount":500}', '[]');
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_enr jsonb;
begin
  -- Promotion is a separate feature (it sets staged_records.population_id); the column exists for
  -- it and the resolver reads it. Set it here so the join under test is the real one.
  update staged_records set population_id = '70000000-0000-0000-0000-0000000000a1'
   where org_id = v_org and source = 'ledger' and source_id = 'e1';

  v_enr := public.alert_enrichment(v_org,
    jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:e1',
                                         'contentHash', repeat('e', 64))));

  perform provio_test.assert_eq(v_enr->>'entity_id', '40000000-0000-0000-0000-0000000000a1',
    'C2: the entity resolves through population -> engagement -> entity');
  perform provio_test.assert_eq(v_enr->>'engagement_id', '50000000-0000-0000-0000-0000000000a1',
    'C2: the engagement resolves');
  perform provio_test.assert_eq(v_enr->>'universe_id', '30000000-0000-0000-0000-0000000000a1',
    'C2: the universe resolves');
  perform provio_test.assert_eq(v_enr->>'department', 'Treasury',
    'C2: the department is the entity kind when it is set');
  perform provio_test.assert_eq((v_enr->>'residual_risk')::numeric, 50::numeric,
    'C2: the residual risk is the entity SIRA score');
  perform provio_test.assert_eq(v_enr->>'residual_band', 'High',
    'C2: the band comes from the org configured bands (score 50 -> High)');
  perform provio_test.assert_eq((v_enr->>'inherent_risk')::numeric, 4::numeric,
    'C2: the inherent risk is the SIRA inherent_risk factor on the chosen score row');
  perform provio_test.assert_eq(v_enr->>'inherent_risk_label', 'High',
    'C2: the inherent risk label comes from the org sira_scales (4 -> High)');
  perform provio_test.assert_eq(v_enr->>'sira_risk_name', 'A risk',
    'C2: the SIRA risk name resolves from the library');
  -- The engagement's workpaper is the only server-side control record.
  perform provio_test.assert_eq(v_enr->'control_ids',
    '["60000000-0000-0000-0000-0000000000a1"]'::jsonb,
    'C2: the affected controls are the engagement workpapers');
end $$;

-- ===========================================================================
-- 2. The resolver never throws and never invents: an unknown reference is an empty linkage.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_enr jsonb;
begin
  v_enr := public.alert_enrichment(v_org,
    jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ghost:nope',
                                         'contentHash', repeat('f', 64))));
  perform provio_test.assert_true(v_enr->>'entity_id' is null,
    'C2: an unknown reference resolves no entity');
  perform provio_test.assert_eq(v_enr->'control_ids', '[]'::jsonb,
    'C2: an unknown reference resolves no controls');
  -- No references at all: still a valid (empty) answer, not an error.
  perform provio_test.assert_eq(public.alert_enrichment(v_org, '[]'::jsonb)->'control_ids',
    '[]'::jsonb, 'C2: no references resolves an empty linkage');
end $$;

-- ===========================================================================
-- 3. The department falls back to the entity name when kind is empty.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
begin
  update entities set kind = '' where id = '40000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_eq(
    public.alert_enrichment(v_org,
      jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:e1')))->>'department',
    'A-E1', 'C2: the department falls back to the entity name when kind is blank');
  update entities set kind = 'Treasury' where id = '40000000-0000-0000-0000-0000000000a1';
end $$;

-- ===========================================================================
-- 4. SIRA resolution: only a PUBLISHED cycle is read, and the highest score wins.
--    A published cycle is frozen (`sira_score_guard`), so a higher score is added while the cycle is
--    still a draft and only counts once the cycle is published — which is exactly the rule under
--    test: a draft cycle contributes nothing.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_enr jsonb;
begin
  insert into sira_cycles (id, org_id, universe_id, year) values
    ('a1000000-0000-0000-0000-0000000000a2', v_org, '30000000-0000-0000-0000-0000000000a1', 2027);
  insert into sira_scores (org_id, cycle_id, entity_id, risk_id, score, factor_values)
  select v_org, 'a1000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', id, 99,
         '{"inherent_risk": 2}'::jsonb
    from risks_library where org_id = v_org limit 1;

  -- The draft cycle's 99 is ignored; the published cycle's 50 stands.
  v_enr := public.alert_enrichment(v_org,
    jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:e1')));
  perform provio_test.assert_eq((v_enr->>'residual_risk')::numeric, 50::numeric,
    'C2: a draft cycle contributes no SIRA risk');

  -- Publish it: now the highest published score wins.
  update sira_cycles set status = 'published', published_at = now()
   where id = 'a1000000-0000-0000-0000-0000000000a2';
  v_enr := public.alert_enrichment(v_org,
    jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:e1')));
  perform provio_test.assert_eq((v_enr->>'residual_risk')::numeric, 99::numeric,
    'C2: the highest published SIRA score wins');
  perform provio_test.assert_eq(v_enr->>'residual_band', 'Critical',
    'C2: score 99 bands as Critical');
  perform provio_test.assert_eq((v_enr->>'inherent_risk')::numeric, 2::numeric,
    'C2: the inherent risk follows the chosen score row (2 on the newer published cycle)');
  perform provio_test.assert_eq(v_enr->>'inherent_risk_label', 'Low',
    'C2: the inherent risk label follows the org scale (2 -> Low)');
end $$;

-- ===========================================================================
-- 5. alert_record stores the enrichment; alert_list returns it; the watcher.signal payload carries
--    it. This is the wiring that makes the screen able to show it.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
select public.alert_record(
  'a0000000-0000-0000-0000-000000000001', 'mon.c2', 1, 'threshold',
  'the highest amount is 500, which is gt the threshold 100',
  jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:e1', 'contentHash', repeat('e', 64))),
  '2026-10-28T00:00:00.000Z'::timestamptz, null, 'c2lineage');
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert_id uuid;
begin
  select id into v_alert_id from monitor_alerts where org_id = v_org and rule_id = 'mon.c2';
  perform provio_test.assert_true(v_alert_id is not null, 'C2: the alert was written');

  perform provio_test.assert_eq(
    (select entity_id from monitor_alerts where id = v_alert_id),
    '40000000-0000-0000-0000-0000000000a1'::uuid, 'C2: the stored alert carries the entity');
  perform provio_test.assert_eq(
    (select department from monitor_alerts where id = v_alert_id), 'Treasury',
    'C2: the stored alert carries the department');
  perform provio_test.assert_eq(
    (select residual_band from monitor_alerts where id = v_alert_id), 'Critical',
    'C2: the stored alert carries the residual band');
  perform provio_test.assert_eq(
    (select inherent_risk from monitor_alerts where id = v_alert_id), 2::numeric,
    'C2: the stored alert carries the inherent risk');
  perform provio_test.assert_eq(
    (select inherent_risk_label from monitor_alerts where id = v_alert_id), 'Low',
    'C2: the stored alert carries the inherent risk label');
  perform provio_test.assert_eq(
    (select control_ids from monitor_alerts where id = v_alert_id),
    array['60000000-0000-0000-0000-0000000000a1'::uuid],
    'C2: the stored alert carries the affected controls');
end $$;

-- alert_list is scoped to the caller's org (`jwt_org_id()`), so it is read under a real identity,
-- exactly as test 97 does.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert_id uuid;
begin
  select id into v_alert_id from monitor_alerts where org_id = v_org and rule_id = 'mon.c2';

  perform provio_test.assert_eq(
    (select department from public.alert_list(v_org) where alert_id = v_alert_id), 'Treasury',
    'C2: alert_list returns the department');
  perform provio_test.assert_eq(
    (select residual_band from public.alert_list(v_org) where alert_id = v_alert_id), 'Critical',
    'C2: alert_list returns the residual band');
  perform provio_test.assert_eq(
    (select inherent_risk_label from public.alert_list(v_org) where alert_id = v_alert_id), 'Low',
    'C2: alert_list returns the inherent risk label');
end $$;
select provio_test.as_owner();

do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert_id uuid;
begin
  select id into v_alert_id from monitor_alerts where org_id = v_org and rule_id = 'mon.c2';

  -- The catalogue event carries the linkage, so a notification (C3) can name it.
  perform provio_test.assert_eq(
    (select payload->>'department' from automation_events
      where org_id = v_org and event_key = 'watcher.signal'
        and payload->>'alert_id' = v_alert_id::text),
    'Treasury', 'C2: the watcher.signal payload carries the department');
  perform provio_test.assert_eq(
    (select (payload->>'control_count')::int from automation_events
      where org_id = v_org and event_key = 'watcher.signal'
        and payload->>'alert_id' = v_alert_id::text),
    1, 'C2: the watcher.signal payload carries the control count');
end $$;

-- ===========================================================================
-- 6. The alert chain still verifies with the enrichment columns present.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    public.verify_monitor_chain('a0000000-0000-0000-0000-000000000001'),
    'C2: the alert chain verifies with enrichment');
end $$;

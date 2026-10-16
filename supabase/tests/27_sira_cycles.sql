-- Test 27 (3D): SIRA cycles, publish freeze + hash-chained ledger, emergent-risk queue (spec §8.3).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: a cycle is one per universe per year; creating it requires manage_engagements.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_sira_cycle('30000000-0000-0000-0000-0000000000a1', 2026)$q$,
    'lacks the manage_engagements right', 'a preparer cannot create a cycle');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  c1 uuid;
  c2 uuid;
begin
  c1 := public.create_sira_cycle('30000000-0000-0000-0000-0000000000a1', 2026);
  perform provio_test.assert_true(c1 is not null, 'a cia can create a cycle');
  c2 := public.create_sira_cycle('30000000-0000-0000-0000-0000000000a1', 2026);
  perform provio_test.assert_eq(c2, c1, 'creating the same universe/year twice returns the same cycle');
  perform provio_test.assert_eq((select count(*) from sira_cycles where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2026), 1,
    'there is exactly one cycle per universe and year');
end $$;
select provio_test.as_owner();

-- b: scores are computed by sira_compute and stored; a score can be recorded for an entity risk.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  c uuid;
  v_risk uuid;
  s numeric;
  v_factors jsonb := '{"inherent_risk":5,"complexity":5,"regulatory_exposure":5,"prior_findings":5,"time_since_audit":5,"materiality":5}'::jsonb;
begin
  select id into c from sira_cycles where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2026;
  select id into v_risk from risks_library where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  s := public.record_sira_score(c, '40000000-0000-0000-0000-0000000000a1', v_risk, v_factors);
  perform provio_test.assert_eq(s, 100.00, 'all factors at the top of the scale score 100');
  perform provio_test.assert_eq((select score from sira_scores where cycle_id = c and entity_id = '40000000-0000-0000-0000-0000000000a1' and risk_id = v_risk),
    100.00, 'the score is stored in sira_scores');
  perform provio_test.assert_eq((select method from sira_scores where cycle_id = c and entity_id = '40000000-0000-0000-0000-0000000000a1' and risk_id = v_risk),
    'weighted_sum', 'the method used is recorded with the score');
  -- Re-recording updates the single row rather than adding another.
  perform public.record_sira_score(c, '40000000-0000-0000-0000-0000000000a1', v_risk,
    '{"inherent_risk":3,"complexity":3,"regulatory_exposure":3,"prior_findings":3,"time_since_audit":3,"materiality":3}'::jsonb);
  perform provio_test.assert_eq((select count(*) from sira_scores where cycle_id = c and entity_id = '40000000-0000-0000-0000-0000000000a1' and risk_id = v_risk), 1,
    're-recording a score keeps one row per cycle/entity/risk');
  perform provio_test.assert_eq((select score from sira_scores where cycle_id = c and entity_id = '40000000-0000-0000-0000-0000000000a1' and risk_id = v_risk),
    50.00, 'the updated score is 50');
end $$;
select provio_test.as_owner();

-- c: publishing freezes the cycle, writes the hash-chained ledger entry and an activity row.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  c uuid;
begin
  select id into c from sira_cycles where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2026;
  perform provio_test.assert_raises(format($q$select public.publish_sira_cycle(%L)$q$, c),
    'lacks the approve_plan right', 'a preparer without approve_plan cannot publish a cycle');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  c uuid;
  h text;
  v_risk uuid;
begin
  select id into c from sira_cycles where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2026;
  select id into v_risk from risks_library where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
  h := public.publish_sira_cycle(c);
  perform provio_test.assert_true(h is not null and length(h) = 64, 'publishing returns a 64-char hash');
  perform provio_test.assert_eq((select status from sira_cycles where id = c), 'published', 'the cycle is published');
  perform provio_test.assert_true((select published_at is not null from sira_cycles where id = c), 'the publish time is recorded');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'sira_cycle_published'),
    'the publish is written to the hash-chained ledger');
  perform provio_test.assert_true(
    exists (select 1 from activity_log where object_id = c and action = 'sira_cycle_published'),
    'the publish is written to the activity log');
  -- Frozen: no score change, no re-publish.
  perform provio_test.assert_raises(
    format($q$select public.record_sira_score(%L, '40000000-0000-0000-0000-0000000000a1', %L, '{"inherent_risk":1,"complexity":1,"regulatory_exposure":1,"prior_findings":1,"time_since_audit":1,"materiality":1}'::jsonb)$q$, c, v_risk),
    'frozen', 'a published cycle cannot accept a new score');
  perform provio_test.assert_raises(format($q$select public.publish_sira_cycle(%L)$q$, c),
    'already published', 'a published cycle cannot be published twice');
end $$;

-- d: cycle_summary reports the inherent risk environment per entity and universe (§8.3).
do $$
declare
  c uuid;
  s jsonb;
begin
  select id into c from sira_cycles where universe_id = '30000000-0000-0000-0000-0000000000a1' and year = 2026;
  s := public.cycle_summary(c);
  perform provio_test.assert_eq(s ->> 'year', '2026', 'the summary reports the year');
  perform provio_test.assert_eq(s ->> 'status', 'published', 'the summary reports the published status');
  perform provio_test.assert_eq(s ->> 'mean_score', '50.00', 'the summary reports the mean score');
  perform provio_test.assert_eq(s ->> 'band', 'High', 'the summary maps the mean to a band');
  perform provio_test.assert_eq(jsonb_array_length(s -> 'entities'), 1, 'the summary lists one entity');
end $$;
select provio_test.as_owner();

-- e: the emergent-risk queue. A concluded engagement queues a risk; a decision needs a reason.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  r uuid;
begin
  r := public.submit_emergent_risk('30000000-0000-0000-0000-0000000000a1', 'New fraud scheme', '40000000-0000-0000-0000-0000000000a1', '50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(r is not null, 'a performer can queue an emergent risk');
  perform provio_test.assert_eq((select status from sira_emergent_risks where id = r), 'pending', 'a queued risk starts pending');
  perform provio_test.assert_raises(
    format($q$select public.submit_emergent_risk('30000000-0000-0000-0000-0000000000a1', '   ')$q$),
    'needs a title', 'an emergent risk needs a title');
  -- A performer may not decide.
  perform provio_test.assert_raises(
    format($q$select public.decide_emergent_risk(%L, 'accepted', 'looks legitimate to me')$q$, r),
    'lacks the review_and_approve right', 'a performer cannot decide an emergent risk');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
begin
  select id into r from sira_emergent_risks where title = 'New fraud scheme';
  perform provio_test.assert_raises(
    format($q$select public.decide_emergent_risk(%L, 'accepted', 'too short')$q$, r),
    'at least 10 characters', 'a decision reason shorter than 10 characters is refused');
  perform provio_test.assert_raises(
    format($q$select public.decide_emergent_risk(%L, 'maybe', 'a long enough reason here')$q$, r),
    'accepted or rejected', 'a decision must be accepted or rejected');
  perform public.decide_emergent_risk(r, 'accepted', 'Relevant to next year''s plan');
  perform provio_test.assert_eq((select status from sira_emergent_risks where id = r), 'accepted', 'the risk is accepted');
  perform provio_test.assert_true((select decided_at is not null and decided_by is not null from sira_emergent_risks where id = r),
    'the decision records who and when');
  perform provio_test.assert_raises(
    format($q$select public.decide_emergent_risk(%L, 'rejected', 'changed my mind completely')$q$, r),
    'already been decided', 'a decided risk cannot be decided again');
end $$;
select provio_test.as_owner();

-- f: cross-org refusal and platform blindness.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  perform provio_test.assert_raises(
    $q$select public.create_sira_cycle('30000000-0000-0000-0000-0000000000a1', 2027)$q$,
    'universe not found', 'Org B cannot create a cycle on an Org A universe');
  select count(*) into n from sira_emergent_risks;
  perform provio_test.assert_eq(n, 0, 'Org B sees no Org A emergent risks (RLS)');
  select count(*) into n from sira_cycles where universe_id = '30000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_eq(n, 0, 'Org B sees no Org A cycle (RLS)');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  n int;
begin
  select count(*) into n from sira_emergent_risks;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero tenant rows');
  select count(*) into n from sira_cycles;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero cycle rows');
end $$;
select provio_test.as_owner();

-- g: anonymous refusal.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises($q$select public.create_sira_cycle('30000000-0000-0000-0000-0000000000a1', 2028)$q$,
    null, 'an anonymous caller cannot create a cycle');
  perform provio_test.assert_raises($q$select public.submit_emergent_risk('30000000-0000-0000-0000-0000000000a1', 'x')$q$,
    null, 'an anonymous caller cannot queue an emergent risk');
  perform provio_test.assert_raises($q$select public.cycle_summary('00000000-0000-0000-0000-000000000000')$q$,
    null, 'an anonymous caller cannot read a cycle summary');
end $$;
select provio_test.as_owner();

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

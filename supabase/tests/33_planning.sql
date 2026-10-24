-- Test 33 (4B): Planning DB — SIRA pre-fill, reconciliation gate, four-eyes sign-off and the
-- testing lock (spec §10.1, §10.4).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. With no published SIRA cycle the pre-fill is an empty array, not an error.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    public.populate_planning_suggestions('50000000-0000-0000-0000-0000000000a1'), '[]'::jsonb,
    '4B: pre-fill is an empty array when no SIRA cycle is published');
end $$;
select provio_test.as_owner();

-- Publish the Org A cycle for universe A-U1 (entity A-E1).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.publish_sira_cycle('a1000000-0000-0000-0000-0000000000a1');
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. SIRA pre-fill returns a correctly structured suggestion array.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  s jsonb;
  first_item jsonb;
begin
  s := public.populate_planning_suggestions('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(jsonb_typeof(s) = 'array', '4B: pre-fill returns a JSON array');
  perform provio_test.assert_eq(jsonb_array_length(s), 1, '4B: one suggestion per SIRA score for the entity');
  first_item := s -> 0;
  perform provio_test.assert_true((first_item ? 'suggestion_id'), '4B: a suggestion carries suggestion_id');
  perform provio_test.assert_true((first_item ? 'risk_id'), '4B: a suggestion carries risk_id');
  perform provio_test.assert_true((first_item ? 'inherent_rating'), '4B: a suggestion carries inherent_rating');
  perform provio_test.assert_true((first_item ? 'suggested_controls'), '4B: a suggestion carries suggested_controls');
  perform provio_test.assert_true((first_item ? 'prior_finding_count'), '4B: a suggestion carries prior_finding_count');
  perform provio_test.assert_true((first_item ? 'risk_band'), '4B: a suggestion carries risk_band');
  perform provio_test.assert_eq((first_item ->> 'suggestion_id'), 'risk:' || (first_item ->> 'risk_id'),
    '4B: the suggestion id is derived from the risk id');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. Reconciliation gate: a risk in Planning that is not in the published SIRA blocks sign-off.
-- ---------------------------------------------------------------------------
-- Fetch the SIRA risk id as cia (risks_library is cia/org_admin only) into a temp table.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
create temp table t_risk_a as select id from risks_library
  where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_risk uuid;
  v_other uuid;
begin
  select id into v_risk from t_risk_a;
  -- A risk id that is not in the SIRA for this entity.
  v_other := '00000000-0000-0000-0000-0000000000ff';
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'riskcontrol',
    jsonb_build_object('risks', jsonb_build_array(
      jsonb_build_object('risk_id', v_risk::text, 'selected', true),
      jsonb_build_object('risk_id', v_other::text, 'selected', false))));
  perform public.save_planning_section('50000000-0000-0000-0000-0000000000a1', 'scope',
    jsonb_build_object('summary', 'Scope text'));
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    public.check_planning_reconciliation('50000000-0000-0000-0000-0000000000a1'), false,
    '4B: reconciliation is false when a planning risk is not in the current SIRA');
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a1')$q$,
    'planning_reconciliation', '4B: sign-off is blocked by the reconciliation gate');
end $$;
select provio_test.as_owner();

-- A recorded acknowledgement with a reason unblocks sign-off.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.acknowledge_planning_discrepancy('50000000-0000-0000-0000-0000000000a1','short')$q$,
    'at least 10 characters', '4B: a discrepancy acknowledgement needs a real reason');
  perform public.acknowledge_planning_discrepancy('50000000-0000-0000-0000-0000000000a1',
    'The extra risk is a new vendor control added after the SIRA cycle was published.');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. Four-eyes: the preparer of every section cannot be the signer.
-- ---------------------------------------------------------------------------
-- Remove the acknowledgement so the reconciliation gate is tested in isolation for four-eyes.
select provio_test.as_owner();
delete from planning_reconciliation_acks where engagement_id = '50000000-0000-0000-0000-0000000000a1';

-- a2 prepared every section, so a2 cannot sign even with review_and_approve.
select provio_test.as_owner();
update org_members set role_id = '20000000-0000-0000-0000-0000000000a6'
 where user_id = '10000000-0000-0000-0000-0000000000a2';  -- Reviewer: review_and_approve + perform_work
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a1')$q$,
    'four_eyes', '4B: the preparer of every section cannot sign');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. A different reviewer with the right signs once reconciliation is clean.
-- ---------------------------------------------------------------------------
-- Fix the RCM so every planning risk is in the SIRA, then a1 (cia) signs.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
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
begin
  perform provio_test.assert_eq(
    public.check_planning_reconciliation('50000000-0000-0000-0000-0000000000a1'), true,
    '4B: reconciliation is true once every planning risk is in the SIRA');
  perform public.sign_planning('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(
    public.planning_signed_off('50000000-0000-0000-0000-0000000000a1'), true,
    '4B: planning is signed off');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'planning_signed_off'),
    '4B: sign-off wrote a hash-chained ledger entry');
  perform provio_test.assert_true(
    exists (select 1 from planning_sections where engagement_id = '50000000-0000-0000-0000-0000000000a1'
            and signed_off_at is not null and signed_off_by is not null),
    '4B: the signed sections carry the signer and the time');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Testing is locked until Planning sign-off; a section is read-only after sign-off.
-- ---------------------------------------------------------------------------
-- Engagement A-Eng2 has no signed planning, so a testing workpaper there is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into workpapers (org_id, engagement_id, stage) values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a2','testing')$q$,
    'testing_locked', '4B: testing is locked before planning sign-off');
  -- A planning workpaper is allowed.
  insert into workpapers (org_id, engagement_id, stage) values
    ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a2','planning');
  perform provio_test.assert_true(true, '4B: a planning workpaper is allowed without sign-off');
  -- Once A-Eng1's planning is signed off, a testing workpaper is allowed.
  insert into workpapers (org_id, engagement_id, stage) values
    ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','testing');
  perform provio_test.assert_true(true, '4B: testing is unlocked after planning sign-off');
end $$;
select provio_test.as_owner();

-- A signed section cannot be changed (§10.4 lock).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.save_planning_section('50000000-0000-0000-0000-0000000000a1','scope','{"summary":"changed"}'::jsonb)$q$,
    'planning_locked', '4B: a signed-off planning section is read-only');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 7. Isolation: an Org B caller cannot read Org A planning rows or pre-fill.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from planning_sections), 0::bigint,
    '4B: an Org B caller reads zero planning sections from Org A');
  perform provio_test.assert_eq((select count(*) from planning_suggestion_decisions), 0::bigint,
    '4B: an Org B caller reads zero suggestion decisions from Org A');
  perform provio_test.assert_raises(
    $q$select public.populate_planning_suggestions('50000000-0000-0000-0000-0000000000a1')$q$,
    'not found in this organisation', '4B: pre-fill for another org''s engagement is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 8. A no-right caller (preparer) cannot sign planning.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a2')$q$,
    'review_and_approve', '4B: a caller without review_and_approve cannot sign planning');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 9. Anon and a no-org caller see nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises('select count(*) from planning_sections', 'permission denied',
    '4B: anon cannot read planning sections');
end $$;
select provio_test.as_owner();

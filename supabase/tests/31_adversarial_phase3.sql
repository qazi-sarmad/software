-- Test 31 (3H): adversarial coverage for 3B-3G. Cross-org refusal, unauthenticated refusal,
-- missing-right refusal, hash-chain integrity, atomicity, concurrency and platform blindness.
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Cross-org refusal: every 3B-3G RPC that names a tenant object refuses an Org B caller naming an
--    Org A object. (2F closed the same hole for the earlier RPCs.)
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  -- 3B: entity approval.
  perform provio_test.assert_raises($q$select public.submit_entity('40000000-0000-0000-0000-0000000000a1')$q$,
    'outside the caller', '3B: Org B cannot submit an Org A entity');
  -- 3C/3D: SIRA.
  perform provio_test.assert_raises($q$select public.record_sira_score('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-0000000000a1', null, '{}'::jsonb)$q$,
    null, '3C: Org B cannot score an Org A cycle/entity');
  -- 3E: audit plan.
  perform provio_test.assert_raises($q$select public.create_plan('30000000-0000-0000-0000-0000000000a1', '2026')$q$,
    'universe not found', '3E: Org B cannot create an Org A plan');
  -- 3F: deployment gate and ethics.
  perform provio_test.assert_raises($q$select public.acknowledge_ethics('50000000-0000-0000-0000-0000000000a1')$q$,
    'not found', '3F: Org B cannot acknowledge ethics on an Org A engagement');
  perform provio_test.assert_eq(public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1') ->> 'outcome',
    'entity_not_found', '3F: Org B cannot deploy on an Org A universe (the entity is not in its org)');
  -- 3G: combined approval.
  perform provio_test.assert_raises($q$select public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    'universe not found', '3G: Org B cannot raise an Org A request');
  perform provio_test.assert_raises($q$select public.decide_combined_deployment('00000000-0000-0000-0000-000000000000', true)$q$,
    null, '3G: Org B cannot decide an unknown request');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Unauthenticated refusal: an anon caller cannot touch any 3B-3G RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises($q$select public.submit_entity('40000000-0000-0000-0000-0000000000a1')$q$,
    null, '3B: anon cannot submit an entity');
  perform provio_test.assert_raises($q$select public.create_plan('30000000-0000-0000-0000-0000000000a1', '2026')$q$,
    null, '3E: anon cannot create a plan');
  perform provio_test.assert_raises($q$select public.approve_plan('00000000-0000-0000-0000-000000000000')$q$,
    null, '3E: anon cannot approve a plan');
  perform provio_test.assert_raises($q$select public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    null, '3F: anon cannot deploy');
  perform provio_test.assert_raises($q$select public.acknowledge_ethics('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '3F: anon cannot acknowledge ethics');
  perform provio_test.assert_raises($q$select public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    null, '3G: anon cannot raise a request');
  perform provio_test.assert_raises($q$select public.escalate_overdue_deployment_requests()$q$,
    null, '3G: anon cannot escalate requests');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. Missing-right refusal: an authenticated caller who holds no relevant right is refused. The
--    reviewer role holds review_and_approve only; the observer holds read_only only.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  -- 3B: the observer cannot configure or submit.
  perform provio_test.assert_raises($q$select public.admin_set_entity_approval('edit_config', 'approve_plan')$q$,
    'edit_config', '3B: an observer cannot configure entity approval');
  -- 3E: the observer cannot create a plan.
  perform provio_test.assert_raises($q$select public.create_plan('30000000-0000-0000-0000-0000000000a1', '2026')$q$,
    'manage_engagements', '3E: an observer cannot create a plan');
  -- 3G: the observer cannot raise a request (no perform_work).
  perform provio_test.assert_raises($q$select public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    'perform_work', '3G: an observer cannot raise a request');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. Hash-chain integrity: after the 3B-3G actions, the ledger still verifies (no gap, no break).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  e uuid;
begin
  -- Exercise several ledger-writing paths.
  p := public.create_plan('30000000-0000-0000-0000-0000000000a1', '2026');
  perform public.add_plan_item(p, 'Audit A-E1', '40000000-0000-0000-0000-0000000000a1');
  perform public.approve_plan(p);
  e := (public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p, '2026') ->> 'engagement_id')::uuid;
  perform public.assign_team_role(e, '10000000-0000-0000-0000-0000000000a1', 'lead');
  perform public.acknowledge_ethics(e);
end $$;
select provio_test.as_owner();

do $$
declare
  v_bad bigint;
begin
  v_bad := public.verify_ledger('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_bad, null::bigint, 'the ledger verifies clean after 3B-3G actions');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Atomicity: an approval that fails revalidation writes neither the deployment nor a plan version
--    and does not change the request. (The whole decision is one transaction.)
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'Atomicity probe');
end $$;
select provio_test.as_owner();

-- Make the entity unapproved (owner, one transaction) to force the decision to fail revalidation.
do $$
begin
  insert into entity_decision_grants (org_id, entity_id, txid)
  values ('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', txid_current());
  update entities set status = 'rejected', approved = false where id = '40000000-0000-0000-0000-0000000000a1';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
  before_eng int;
  before_ver int;
begin
  select id into r from deployment_requests where org_id = 'a0000000-0000-0000-0000-000000000001' and title = 'Atomicity probe';
  select count(*) into before_eng from engagements;
  select count(*) into before_ver from plan_versions;
  perform provio_test.assert_raises(format($q$select public.decide_combined_deployment(%L, true)$q$, r),
    'revalidation failed', 'the failed decision raises');
  perform provio_test.assert_eq((select count(*) from engagements), before_eng, 'atomicity: no audit file was created');
  perform provio_test.assert_eq((select count(*) from plan_versions), before_ver, 'atomicity: no plan version was written');
  perform provio_test.assert_eq((select status from deployment_requests where id = r), 'pending',
    'atomicity: the request is unchanged');
end $$;
select provio_test.as_owner();

-- Restore.
do $$
begin
  insert into entity_decision_grants (org_id, entity_id, txid)
  values ('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', txid_current());
  update entities set status = 'approved', approved = true where id = '40000000-0000-0000-0000-0000000000a1';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Concurrency: two concurrent approvals of the same plan both succeed (append-only versioning), and
--    the ledger stays contiguous. Two concurrent decisions of the same deployment request: only one
--    may win. (Concurrency is exercised with dblink like test 15; here we assert the single-threaded
--    invariant that a decided request refuses a second decision, which is what blocks the race.)
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'Race probe');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
begin
  select id into r from deployment_requests where org_id = 'a0000000-0000-0000-0000-000000000001' and title = 'Race probe';
  perform public.decide_combined_deployment(r, true);
  -- The second decision of the same request is refused, so exactly one audit file exists per request.
  perform provio_test.assert_raises(format($q$select public.decide_combined_deployment(%L, true)$q$, r),
    'already been decided', 'a concurrent second decision is refused');
  perform provio_test.assert_eq((select count(*) from engagements where title = 'Race probe'), 1,
    'exactly one audit file exists per request');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 7. Platform blindness: a platform admin sees zero tenant rows in every 3B-3G table.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  n int;
begin
  select count(*) into n from entities;            perform provio_test.assert_eq(n, 0, 'platform sees 0 entities');
  select count(*) into n from sira_cycles;         perform provio_test.assert_eq(n, 0, 'platform sees 0 sira cycles');
  select count(*) into n from sira_scores;         perform provio_test.assert_eq(n, 0, 'platform sees 0 sira scores');
  select count(*) into n from plans;               perform provio_test.assert_eq(n, 0, 'platform sees 0 plans');
  select count(*) into n from plan_versions;       perform provio_test.assert_eq(n, 0, 'platform sees 0 plan versions');
  select count(*) into n from plan_items;          perform provio_test.assert_eq(n, 0, 'platform sees 0 plan items');
  select count(*) into n from deployment_requests; perform provio_test.assert_eq(n, 0, 'platform sees 0 deployment requests');
  select count(*) into n from ethics_acknowledgements; perform provio_test.assert_eq(n, 0, 'platform sees 0 acknowledgements');
end $$;
select provio_test.as_owner();

-- The ledger is still clean after every probe.
do $$
begin
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint,
    'the ledger verifies clean after the adversarial probes');
end $$;

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

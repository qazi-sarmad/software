-- Test 144 (integrator, final phase): the engagement file owner, deployment from the plan, early
-- deployment with a reason and an approval by the configured role, and the deterministic suggestions.
--
-- Owner instruction 2026-10-30: "the file owner (for all engagements) concept, deployable from plan
-- when due, if deployed earlier take reasons and get them approved by appropriately configured role,
-- suggest the subsequent change in audit calendar, board pack and all."
--
-- Happy path: an owner is named; an on-time deployment from a plan item deploys at once and generates
-- suggestions; an early deployment is held for approval, and the configured approver approves it.
-- Bad paths: an early deployment with no reason is refused; a non-approver cannot decide; a second
-- decision on a decided deployment is refused; a cross-tenant plan item is refused.

\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A plan item to deploy, in the approved plan a2 of universe u_a1, for entity e_a1.
insert into plans (id, org_id, universe_id, period, status, approved_at)
values ('a2000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-0000000000a1', '2026', 'approved', now());
insert into plan_items (id, org_id, plan_id, entity_id, title, planned_start, planned_end, status)
values ('a3000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
        'a2000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-0000000000a1',
        'A-E1 FY2026 audit', '2026-06-01', '2026-08-31', 'approved');

-- ===========================================================================
-- 1. The file owner. The CIA names the Preparer as the file owner of an engagement.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_version int;
begin
  v_id := public.engagement_file_owner_set('50000000-0000-0000-0000-0000000000a1',
                                           '10000000-0000-0000-0000-0000000000a2',
                                           'a3000000-0000-0000-0000-0000000000c1', 'named at plan time');
  perform provio_test.assert_true(v_id is not null, 'O1: a file owner is named');
  perform provio_test.assert_eq(
    (select user_id from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    '10000000-0000-0000-0000-0000000000a2'::uuid, 'O1: the owner is the named person');
  perform provio_test.assert_eq(
    (select version from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    1, 'O1: the first assignment is version 1');
  -- A re-assignment is a new version, not a second row.
  perform public.engagement_file_owner_set('50000000-0000-0000-0000-0000000000a1',
                                           '10000000-0000-0000-0000-0000000000a4', null, 'handover');
  select version into v_version from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_eq(v_version, 2, 'O1: a re-assignment bumps the version');
  perform provio_test.assert_eq(
    (select count(*) from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    1::bigint, 'O1: one owner row per engagement');
end $$;

-- ===========================================================================
-- 2. On-time deployment from the plan: the engagement is created at once, and the deterministic
--    suggestions for the audit calendar, the board pack and the plan are generated.
-- ===========================================================================
do $$
declare
  v_out jsonb;
  v_dep uuid;
  v_suggestions int;
begin
  -- p_on is on/after the planned start (2026-06-01), so this is on time.
  v_out := public.engagement_deploy_from_plan('a3000000-0000-0000-0000-0000000000c1', '2026-06-01', '');
  perform provio_test.assert_eq(v_out ->> 'outcome', 'deployed', 'O2: an on-time deployment deploys at once');
  perform provio_test.assert_eq((v_out ->> 'is_early')::boolean, false, 'O2: it is not early');
  perform provio_test.assert_true((v_out ->> 'engagement_id') is not null, 'O2: an engagement was created');
  v_dep := (v_out ->> 'deployment_id')::uuid;
  perform provio_test.assert_eq(
    (select count(*) from deployment_suggestions where deployment_id = v_dep),
    2::bigint, 'O2: the calendar and board-pack suggestions are generated');
  perform provio_test.assert_true(
    exists (select 1 from deployment_suggestions where deployment_id = v_dep and target = 'audit_calendar'),
    'O2: the audit-calendar suggestion names the window');
  perform provio_test.assert_true(
    exists (select 1 from deployment_suggestions where deployment_id = v_dep and target = 'board_pack'),
    'O2: the board-pack suggestion is present');
end $$;

-- ===========================================================================
-- 3. EARLY deployment with no reason is refused, and nothing is deployed or recorded.
-- ===========================================================================
do $$
declare
  v_out jsonb;
  v_before int;
begin
  select count(*) into v_before from engagement_deployments;
  v_out := public.engagement_deploy_from_plan('a3000000-0000-0000-0000-0000000000c1', '2026-03-01', 'too short');
  perform provio_test.assert_eq(v_out ->> 'outcome', 'reason_required', 'O3: an early deployment with a short reason is refused');
  perform provio_test.assert_eq(
    (select count(*) from engagement_deployments), v_before::bigint,
    'O3: a refused early deployment writes no row');
end $$;

-- ===========================================================================
-- 4. EARLY deployment with a reason is held for approval — no engagement yet.
-- ===========================================================================
do $$
declare
  v_out jsonb;
  v_dep uuid;
  v_engagement_before int;
begin
  select count(*) into v_engagement_before from engagements where org_id = 'a0000000-0000-0000-0000-000000000001';
  v_out := public.engagement_deploy_from_plan('a3000000-0000-0000-0000-0000000000c1', '2026-03-01',
                                              'the entity requested an earlier start this year');
  perform provio_test.assert_eq(v_out ->> 'outcome', 'early_approval_required', 'O4: an early deployment is held for approval');
  v_dep := (v_out ->> 'deployment_id')::uuid;
  perform provio_test.assert_eq(
    (select status from engagement_deployments where id = v_dep), 'pending_approval',
    'O4: the deployment is pending approval');
  perform provio_test.assert_true(
    (select engagement_id is null from engagement_deployments where id = v_dep),
    'O4: no engagement is created while it is pending');
  perform provio_test.assert_eq(
    (select count(*) from engagements where org_id = 'a0000000-0000-0000-0000-000000000001'),
    v_engagement_before::bigint, 'O4: the pending deployment created no engagement');
end $$;

-- ===========================================================================
-- 5. BAD PATH — a caller without the configured approve right cannot decide.
--    The org's approve_right defaults to approve_plan; a preparer does not hold it.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_dep uuid;
begin
  select id into v_dep from engagement_deployments
   where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'pending_approval' limit 1;
  perform provio_test.assert_raises(format($q$select public.engagement_deployment_decide('%s'::uuid, true, 'ok')$q$, v_dep),
    'approve_plan', 'O5: a caller without the configured right cannot approve');
end $$;

-- ===========================================================================
-- 6. The configured approver approves the early deployment: the engagement is created and the
--    suggestions now include the plan and the bring-forward calendar change.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_dep uuid;
  v_out jsonb;
begin
  select id into v_dep from engagement_deployments
   where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'pending_approval' limit 1;
  v_out := public.engagement_deployment_decide(v_dep, true, 'the entity needs the earlier start');
  perform provio_test.assert_eq(v_out ->> 'outcome', 'approved', 'O6: the configured approver approves');
  perform provio_test.assert_true((v_out ->> 'engagement_id') is not null, 'O6: approving creates the engagement');
  perform provio_test.assert_eq(
    (select status from engagement_deployments where id = v_dep), 'approved', 'O6: the deployment is approved');
  -- The early path adds the bring-forward calendar suggestion and the plan suggestion.
  perform provio_test.assert_true(
    exists (select 1 from deployment_suggestions where deployment_id = v_dep and target = 'plan'),
    'O6: the plan suggestion is generated for an early deployment');
  perform provio_test.assert_true(
    (select count(*) from deployment_suggestions where deployment_id = v_dep and target = 'audit_calendar') >= 2,
    'O6: the early deployment adds a bring-forward calendar suggestion');
end $$;

-- ===========================================================================
-- 7. BAD PATH — a second decision on a decided deployment is refused by name.
-- ===========================================================================
do $$
declare
  v_dep uuid;
begin
  select id into v_dep from engagement_deployments
   where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'approved' limit 1;
  perform provio_test.assert_raises(format($q$select public.engagement_deployment_decide('%s'::uuid, false, 'again')$q$, v_dep),
    'not_pending', 'O7: a decided deployment cannot be decided again');
end $$;

-- ===========================================================================
-- 8. BAD PATH — a plan item from another organisation is refused. Org B's CIA tries to deploy org A's
--    plan item.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.engagement_deploy_from_plan('a3000000-0000-0000-0000-0000000000c1'::uuid, '2026-06-01', '')
  $q$, 'not in this organisation', 'O8: a cross-tenant plan item is refused');
end $$;

-- ===========================================================================
-- 9. ISOLATION — org B sees none of org A's owners, deployments or suggestions, and its own
--    deployment is its own.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from engagement_file_owners_list()), 0::bigint,
    'O9: org B sees none of org A''s file owners');
  perform provio_test.assert_eq((select count(*) from engagement_deployments_list()), 0::bigint,
    'O9: org B sees none of org A''s deployments');
end $$;

-- ===========================================================================
-- 10. BAD PATH — the right is enforced. A preparer (no manage_engagements) cannot name a file owner.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.engagement_file_owner_set('50000000-0000-0000-0000-0000000000a1',
                                            '10000000-0000-0000-0000-0000000000a1', null, 'should not')
  $q$, 'manage_engagements', 'O10: a preparer cannot name a file owner');
end $$;

-- ===========================================================================
-- 11. BAD PATH — a file owner who is not a member is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.engagement_file_owner_set('50000000-0000-0000-0000-0000000000a1',
                                            '10000000-0000-0000-0000-0000000000f0', null, 'not a member')
  $q$, 'member of this organisation', 'O11: a non-member cannot be a file owner');
end $$;

select provio_test.as_owner();

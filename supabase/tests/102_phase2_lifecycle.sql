-- Test 102 (Phase 2.1-2.4): the engagement lifecycle and its governance settings are real.
--
-- 2.1 set_engagement_stage writes engagements.stage with an append-only transition log.
-- 2.2 signoff_role_* gates sign_planning / sign_conclusion.
-- 2.3 testing_mode (one_stage / two_stage) gates the transition to Conclusion.
-- 2.4 workflow_settings.approval_chain gates approve_plan.
--
-- Every assertion runs under a real role; the fixture has no org_lifecycle_settings row, so the
-- defaults (two_stage, reviewer) apply until a test saves its own.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The fixture users must exist in auth.users for engagement_team_members.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a3', 'a3@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a4', 'a4@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a6', 'a6@provio-test.invalid')
on conflict (id) do nothing;

-- a6 is an org member holding the Reviewer role, for the approval-chain step.
insert into org_members (org_id, user_id, role_id, hierarchy_level) values
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a6', '20000000-0000-0000-0000-0000000000a6', 2)
on conflict (org_id, user_id) do update set role_id = excluded.role_id;

-- ===========================================================================
-- 1. set_engagement_stage (2.1): rights, forward-only, optimistic concurrency, the log.
-- ===========================================================================
-- A caller without manage_engagements is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'testing', 'planning')$q$,
    'manage_engagements', '2.1: a caller without manage_engagements cannot move the stage');
end $$;
select provio_test.as_owner();

-- planning -> testing is refused while planning is not signed off (the 0025/0095 lock holds).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'testing', 'planning')$q$,
    'testing_locked', '2.1: testing is locked until planning is signed off');
end $$;
select provio_test.as_owner();

-- Sign planning off as the owner (fixtures bypass the rights path), then the transition succeeds.
insert into planning_sections (org_id, engagement_id, section_type, content, signed_off_at, signed_off_by) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1', 'scope', '{"summary":"x"}'::jsonb, now(), '10000000-0000-0000-0000-0000000000a1');

-- Optimistic concurrency: an expected stage that does not match is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'testing', 'conclusion')$q$,
    'stage_conflict', '2.1: a stale expected stage is refused');
  perform public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'testing', 'planning');
  perform provio_test.assert_eq(
    (select stage from engagements where id = '50000000-0000-0000-0000-0000000000a1'), 'testing',
    '2.1: planning -> testing is written to the row');
end $$;
select provio_test.as_owner();

-- The transition is logged (append-only) and a ledger entry exists.
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from engagement_stage_transitions
             where engagement_id = '50000000-0000-0000-0000-0000000000a1'
               and from_stage = 'planning' and to_stage = 'testing'),
    '2.1: the transition is recorded in the log');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
              and action = 'stage_changed'),
    '2.1: the transition wrote a hash-chained ledger entry');
end $$;

-- Backward moves are refused; so is a no-op.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'planning', 'testing')$q$,
    'illegal_transition', '2.1: a backward move is refused');
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'testing', 'testing')$q$,
    'no_change', '2.1: a no-op is refused');
end $$;
select provio_test.as_owner();

-- The log is append-only.
do $$
begin
  perform provio_test.assert_raises(
    $q$update engagement_stage_transitions set to_stage = 'conclusion'$q$,
    'append-only', '2.1: the transition log cannot be rewritten');
end $$;

-- ===========================================================================
-- 2. testing_mode (2.3): two_stage needs a DEA and an OET workpaper, both signed off.
-- ===========================================================================
-- Two-stage (the default): the operating workpaper is signed off, but no DEA workpaper exists yet,
-- so Conclusion is refused.
update workpapers set status = 'signed_off', test_phase = 'oet'
 where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'conclusion', 'testing')$q$,
    'two_stage_testing', '2.3: two-stage testing needs a DEA workpaper before Conclusion');
end $$;
select provio_test.as_owner();

-- Add the signed-off DEA workpaper; the transition now succeeds.
insert into workpapers (id, org_id, engagement_id, stage, status, test_phase) values
  ('60000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000a1', 'testing', 'signed_off', 'dea');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.set_engagement_stage('50000000-0000-0000-0000-0000000000a1', 'conclusion', 'testing');
  perform provio_test.assert_eq(
    (select stage from engagements where id = '50000000-0000-0000-0000-0000000000a1'), 'conclusion',
    '2.3: two-stage Conclusion is allowed once both workpapers are signed off');
end $$;
select provio_test.as_owner();

-- One-stage: a fresh engagement with only an OET workpaper can reach Conclusion.
insert into engagements (id, org_id, universe_id, entity_id, title) values
  ('50000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'A-Eng1-onestage');
insert into planning_sections (org_id, engagement_id, section_type, content, signed_off_at, signed_off_by) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000c1', 'scope', '{"summary":"c"}'::jsonb, now(), '10000000-0000-0000-0000-0000000000a1');
insert into workpapers (id, org_id, engagement_id, stage, status, test_phase) values
  ('60000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000c1', 'testing', 'signed_off', 'oet');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'reviewer', 'reviewer', false, 0); end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.set_engagement_stage('50000000-0000-0000-0000-0000000000c1', 'testing', 'planning');
  perform public.set_engagement_stage('50000000-0000-0000-0000-0000000000c1', 'conclusion', 'testing');
  perform provio_test.assert_eq(
    (select stage from engagements where id = '50000000-0000-0000-0000-0000000000c1'), 'conclusion',
    '2.3: one-stage reaches Conclusion with only an OET workpaper');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 3. signoff_role_* (2.2): the configured team role gates sign-off.
-- ===========================================================================
-- Default 'reviewer': a caller without review_and_approve is refused by the right check first.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000c1')$q$,
    'review_and_approve', '2.2: the right check still runs before the role check');
end $$;
select provio_test.as_owner();

-- Configure planning sign-off to require the 'lead' team role (manage_team). The CIA holds
-- review_and_approve but not manage_team, so it is now refused with signoff_role.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin perform public.admin_save_lifecycle_settings('one_stage', 'lead', 'reviewer', 'reviewer', false, 0); end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000c1')$q$,
    'signoff_role', '2.2: the CIA (no manage_team) cannot sign when planning requires the lead role');
end $$;
select provio_test.as_owner();

-- Back to 'reviewer'. An engagement-team membership narrows it: assign a4 as the reviewer of g_a2
-- and a *different* reviewer (the CIA) is refused, while a4 is allowed.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.assign_team_role('50000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a4', 'reviewer');
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'reviewer', 'reviewer', false, 0); end $$;
select provio_test.as_owner();

insert into planning_sections (org_id, engagement_id, section_type, content) values
  ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a2', 'scope', '{"summary":"z"}'::jsonb);

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_planning('50000000-0000-0000-0000-0000000000a2')$q$,
    'signoff_role', '2.2: a reviewer who is not the assigned engagement reviewer cannot sign');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.sign_planning('50000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_true(public.planning_signed_off('50000000-0000-0000-0000-0000000000a2'),
    '2.2: the assigned reviewer signs planning');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4. approval_chain (2.4): approve_plan consults workflow_settings.approval_chain.
-- ===========================================================================
-- Empty chain (the default): approve_plan behaves as before.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_plan uuid;
begin
  v_plan := public.create_plan('30000000-0000-0000-0000-0000000000a1', '2030');
  perform public.approve_plan(v_plan);
  perform provio_test.assert_eq((select status from plans where id = v_plan), 'approved',
    '2.4: with an empty chain the plan approves as before');
end $$;
select provio_test.as_owner();

-- Configure a one-step chain requiring the 'reviewer' role, and a fresh plan.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin perform public.admin_save_workflow_settings('[{"role":"reviewer"}]'::jsonb, 48, 'cia', 72); end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_plan uuid;
begin
  v_plan := public.create_plan('30000000-0000-0000-0000-0000000000a2', '2031');
  perform provio_test.assert_raises(
    format($q$select public.approve_plan('%s')$q$, v_plan),
    'approval_chain', '2.4: a plan is refused until every chain step is recorded');
end $$;
select provio_test.as_owner();

-- The reviewer's plan read is scope-bound, so carry the id in a temp table (session-visible).
drop table if exists p2_plan_2031;
create temp table p2_plan_2031 as
  select id from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2031';
grant select on p2_plan_2031 to authenticated;

-- The CIA holds approve_plan but its role slug is 'cia', not the step's 'reviewer', so recording the
-- step is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_plan uuid := (select id from p2_plan_2031);
begin
  perform provio_test.assert_raises(
    format($q$select public.approval_step_decide('plan','%s')$q$, v_plan),
    'requires role', '2.4: a caller whose role is not the step role cannot record the step');
end $$;
select provio_test.as_owner();

-- A reviewer records the step; the chain is then ready and the CIA can approve.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
declare v_plan uuid := (select id from p2_plan_2031);
begin
  perform public.approval_step_decide('plan', v_plan);
  perform provio_test.assert_true(public.approval_chain_ready('a0000000-0000-0000-0000-000000000001', 'plan', v_plan),
    '2.4: the chain is ready once every step is recorded');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_plan uuid := (select id from p2_plan_2031);
begin
  perform public.approve_plan(v_plan);
  perform provio_test.assert_eq((select status from plans where id = v_plan), 'approved',
    '2.4: the plan approves once the chain is satisfied');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. Isolation and the anon surface.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from engagement_stage_transitions), 0::bigint,
    '2.1: an Org B caller reads zero Org A transitions');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.set_engagement_stage(uuid, text, text)', 'execute'),
    'F11: anon cannot execute set_engagement_stage');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.approval_step_decide(text, uuid)', 'execute'),
    'F11: anon cannot execute approval_step_decide');
end $$;

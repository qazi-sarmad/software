-- Test 29 (3F): deployment gate steps 1-6 and ethics acknowledgements (spec §7, §10.1).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The fixture users must exist in auth.users: engagement_team_members and ethics_acknowledgements
-- reference it.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a6', 'a6@provio-test.invalid')
on conflict (id) do nothing;

-- a: step 1 — an entity must be selected.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r jsonb;
begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', null);
  perform provio_test.assert_eq(r ->> 'outcome', 'entity_required', 'step 1: no entity -> entity_required');
end $$;

-- b: step 2 — an unapproved entity is blocked.
do $$
declare
  r jsonb;
begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a3', null, null);
  perform provio_test.assert_eq(r ->> 'outcome', 'entity_not_approved', 'step 2: a draft entity is blocked');
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a2', null, null);
  perform provio_test.assert_eq(r ->> 'outcome', 'entity_not_approved', 'step 2: an entity outside the universe is blocked');
end $$;

-- c: step 3 — the entity must be in an approved plan. Prepare one with a plan item.
do $$
declare
  p uuid;
  r jsonb;
begin
  -- No approved plan yet, so the gate asks for a plan change.
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', null, null);
  perform provio_test.assert_eq(r ->> 'outcome', 'plan_change_required', 'step 3: no approved plan -> plan_change_required');

  p := public.create_plan('30000000-0000-0000-0000-0000000000a1', '2026');
  perform public.add_plan_item(p, 'Audit A-E1', '40000000-0000-0000-0000-0000000000a1');
  -- Still not approved.
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p, '2026');
  perform provio_test.assert_eq(r ->> 'outcome', 'plan_change_required', 'step 3: a draft plan does not satisfy the gate');
  perform public.approve_plan(p);
end $$;

-- d: step 4 — the plan period must match the deployment period.
do $$
declare
  p uuid;
  r jsonb;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2026' and status = 'approved';
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p, '2027');
  perform provio_test.assert_eq(r ->> 'outcome', 'period_mismatch', 'step 4: a mismatched period is routed to plan change');
end $$;
select provio_test.as_owner();

-- e: step 5 — an unauthorised deployer gets an approval request, not a file.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  p uuid;
  r jsonb;
  n int;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2026' and status = 'approved';
  select count(*) into n from engagements where universe_id = '30000000-0000-0000-0000-0000000000a1';
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p, '2026');
  perform provio_test.assert_eq(r ->> 'outcome', 'approval_required', 'step 5: an unauthorised deployer needs approval');
  perform provio_test.assert_eq((select count(*) from engagements where universe_id = '30000000-0000-0000-0000-0000000000a1'), n,
    'step 5: no audit file exists while awaiting approval');
end $$;
select provio_test.as_owner();

-- f: every gate passed — the engagement is created, logged and hash-chained.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  r jsonb;
  e uuid;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2026' and status = 'approved';
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p, '2026', 'Deployed audit');
  perform provio_test.assert_eq(r ->> 'outcome', 'deployed', 'an authorised deployer with a matching plan deploys');
  e := (r ->> 'engagement_id')::uuid;
  perform provio_test.assert_eq((select stage from engagements where id = e), 'planning', 'the new engagement starts in Planning');
  perform provio_test.assert_eq((select plan_id from engagements where id = e), p, 'the engagement is linked to the approved plan');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'engagement_deployed'),
    'the deployment is written to the hash-chained ledger');
end $$;

-- g: step 6 — Testing is locked until every team member acknowledges ethics (hard block).
do $$
declare
  e uuid;
  r jsonb;
begin
  select id into e from engagements where title = 'Deployed audit';
  -- Add two team members.
  perform public.assign_team_role(e, '10000000-0000-0000-0000-0000000000a1', 'lead');
  perform public.assign_team_role(e, '10000000-0000-0000-0000-0000000000a2', 'preparer');
  r := public.ethics_status(e);
  perform provio_test.assert_eq(r ->> 'complete', 'false', 'the team is not complete before acknowledgements');
  -- Moving to Testing is blocked.
  perform provio_test.assert_raises(format($q$update engagements set stage = 'testing' where id = %L$q$, e),
    'acknowledge ethics', 'Testing is locked until every member acknowledges');
end $$;
select provio_test.as_owner();

-- h: acknowledge_ethics is self only; once every member acknowledges, Testing unlocks.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  e uuid;
begin
  select id into e from engagements where title = 'Deployed audit';
  perform public.acknowledge_ethics(e);
  perform provio_test.assert_eq(public.ethics_status(e) ->> 'complete', 'false', 'one of two still leaves the team incomplete');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  e uuid;
begin
  select id into e from engagements where title = 'Deployed audit';
  perform public.acknowledge_ethics(e);
  perform provio_test.assert_eq(public.ethics_status(e) ->> 'complete', 'true', 'both members acknowledged -> complete');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  e uuid;
begin
  select id into e from engagements where title = 'Deployed audit';
  perform public.acknowledge_ethics(e);  -- idempotent
  perform provio_test.assert_eq((select count(*) from ethics_acknowledgements where engagement_id = e and user_id = '10000000-0000-0000-0000-0000000000a1'),
    1, 'a repeated acknowledgement does not duplicate');
  update engagements set stage = 'testing' where id = e;
  perform provio_test.assert_eq((select stage from engagements where id = e), 'testing', 'Testing unlocks once the team is complete');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'ethics_acknowledged'),
    'each acknowledgement is recorded in the ledger');
end $$;
select provio_test.as_owner();

-- i: cross-org refusal and platform blindness.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.acknowledge_ethics('50000000-0000-0000-0000-0000000000a1')$q$,
    'not found', 'Org B cannot acknowledge ethics on an Org A engagement');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  n int;
begin
  select count(*) into n from ethics_acknowledgements;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero acknowledgements');
  select count(*) into n from engagement_gate_settings;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero gate settings');
end $$;
select provio_test.as_owner();

-- j: the gate rights are configurable per organisation.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises($q$select public.admin_set_engagement_gate('nope', 'approve_plan')$q$,
    'unknown right', 'an unknown right is refused');
  perform public.admin_set_engagement_gate('review_and_approve', 'approve_plan');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
declare
  p uuid;
  r jsonb;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2026' and status = 'approved';
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', p, '2026');
  perform provio_test.assert_eq(r ->> 'outcome', 'deployed', 'a reviewer holding the configured deploy right can deploy');
end $$;
select provio_test.as_owner();

-- k: anonymous refusal.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises($q$select public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    null, 'an anonymous caller cannot deploy');
  perform provio_test.assert_raises($q$select public.acknowledge_ethics('50000000-0000-0000-0000-0000000000a1')$q$,
    null, 'an anonymous caller cannot acknowledge ethics');
end $$;
select provio_test.as_owner();

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

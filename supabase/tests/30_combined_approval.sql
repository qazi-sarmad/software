-- Test 30 (3G): combined approval — one request, one atomic decision (spec §7.1).
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid')
on conflict (id) do nothing;

-- a: a performer raises one request that carries a plan change and a deployment.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  r uuid;
  st jsonb;
begin
  r := public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
         '40000000-0000-0000-0000-0000000000a1', '2026', 'Deploy before plan');
  perform provio_test.assert_true(r is not null, 'a performer can raise a combined request');
  st := public.deployment_request_status(r);
  perform provio_test.assert_eq(st ->> 'status', 'pending', 'the request starts pending');
  perform provio_test.assert_true((st ->> 'sla_due_at') is not null, 'the request carries an SLA due time');
end $$;
select provio_test.as_owner();

-- b: the requester cannot decide their own request (four-eyes), and a plain performer cannot decide.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  r uuid;
begin
  select id into r from deployment_requests where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'pending';
  perform provio_test.assert_raises(format($q$select public.decide_combined_deployment(%L, true)$q$, r),
    'lacks the approve_plan right', 'a performer without approve_plan cannot decide');
end $$;
select provio_test.as_owner();

-- c: rejection leaves both the plan and the deployment untouched, and returns the reason.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
  before_plans int;
  before_eng int;
  res jsonb;
begin
  select id into r from deployment_requests where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'pending';
  select count(*) into before_plans from plans;
  select count(*) into before_eng from engagements where universe_id = '30000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_raises(format($q$select public.decide_combined_deployment(%L, false, 'short')$q$, r),
    'at least 10 characters', 'rejecting needs a reason');
  res := public.decide_combined_deployment(r, false, 'The entity is not ready for this period');
  perform provio_test.assert_eq(res ->> 'outcome', 'rejected', 'the request is rejected');
  perform provio_test.assert_eq(public.deployment_request_status(r) ->> 'reason', 'The entity is not ready for this period',
    'the rejection reason is returned to the requester');
  perform provio_test.assert_eq((select count(*) from plans), before_plans, 'rejection leaves the plan untouched');
  perform provio_test.assert_eq((select count(*) from engagements where universe_id = '30000000-0000-0000-0000-0000000000a1'), before_eng,
    'rejection leaves the deployment untouched (no audit file)');
  perform provio_test.assert_raises(format($q$select public.decide_combined_deployment(%L, true)$q$, r),
    'already been decided', 'a decided request cannot be decided again');
end $$;
select provio_test.as_owner();

-- d: approval applies both atomically — a new plan version linked to the request, and the deployment.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'Approved deploy');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
  res jsonb;
  e uuid;
begin
  select id into r from deployment_requests
   where org_id = 'a0000000-0000-0000-0000-000000000001' and title = 'Approved deploy' and status = 'pending';
  res := public.decide_combined_deployment(r, true);
  perform provio_test.assert_eq(res ->> 'outcome', 'approved', 'the request is approved');
  e := (res ->> 'engagement_id')::uuid;
  perform provio_test.assert_true(e is not null, 'the deployment created an audit file');
  perform provio_test.assert_eq((select stage from engagements where id = e), 'planning', 'the audit file starts in Planning');
  perform provio_test.assert_true((res ->> 'plan_id') is not null, 'the approval created a plan link');
  -- The plan version is linked to the request.
  perform provio_test.assert_true(
    exists (select 1 from plan_versions vv where vv.plan_id = (res ->> 'plan_id')::uuid
            and vv.reason like '%' || r::text || '%'),
    'the new plan version is linked to the request');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'combined_approval'),
    'the combined approval is written to the hash-chained ledger');
  perform provio_test.assert_eq(public.deployment_request_status(r) ->> 'status', 'approved', 'the request reads as approved');
end $$;
select provio_test.as_owner();

-- e: revalidation — an entity that is no longer approved blocks the approval at decision time.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'Stale request');
end $$;
select provio_test.as_owner();

-- The entity is rejected before the decision. entity_decision_grants is not writable by an
-- application role (that is the whole point of the guard) and the guard keys on txid_current(), so
-- the grant insert and the update must share one transaction — hence one DO block, run as owner.
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
begin
  select id into r from deployment_requests
   where org_id = 'a0000000-0000-0000-0000-000000000001' and title = 'Stale request' and status = 'pending';
  perform provio_test.assert_raises(format($q$select public.decide_combined_deployment(%L, true)$q$, r),
    'revalidation failed', 'the decision revalidates the entity against its current state');
end $$;
select provio_test.as_owner();

-- Restore the entity (again via the guard, in one transaction, as owner).
do $$
begin
  insert into entity_decision_grants (org_id, entity_id, txid)
  values ('a0000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', txid_current());
  update entities set status = 'approved', approved = true where id = '40000000-0000-0000-0000-0000000000a1';
end $$;

-- f: the SLA and escalation right are configurable; escalation marks overdue requests.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises($q$select public.admin_set_engagement_gate('manage_engagements', 'approve_plan', 0)$q$,
    'at least one hour', 'the SLA must be at least one hour');
  perform public.admin_set_engagement_gate('manage_engagements', 'approve_plan', 24, 'manage_users');
  perform provio_test.assert_eq((select sla_hours from engagement_gate_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    24, 'the SLA is configurable');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'Overdue');
end $$;
select provio_test.as_owner();

-- Force the request past its SLA (the owner may write the scheduling column directly).
update deployment_requests set sla_due_at = now() - interval '1 hour'
 where org_id = 'a0000000-0000-0000-0000-000000000001' and title = 'Overdue';

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r uuid;
  n int;
begin
  select id into r from deployment_requests
   where org_id = 'a0000000-0000-0000-0000-000000000001' and title = 'Overdue' and status = 'pending';
  n := public.escalate_overdue_deployment_requests();
  perform provio_test.assert_true(n >= 1, 'the escalation finds the overdue request');
  perform provio_test.assert_eq((select status from deployment_requests where id = r), 'escalated', 'the overdue request is escalated');
  perform provio_test.assert_eq((select escalated_to_right from deployment_requests where id = r), 'manage_users',
    'escalation is addressed to the configured right');
  -- An escalated request can still be decided.
  perform public.decide_combined_deployment(r, true);
  perform provio_test.assert_eq((select status from deployment_requests where id = r), 'approved', 'an escalated request can still be approved');
end $$;
select provio_test.as_owner();

-- g: cross-org refusal and platform blindness.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  perform provio_test.assert_raises(
    $q$select public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    'universe not found', 'Org B cannot raise a request on an Org A universe');
  select count(*) into n from deployment_requests;
  perform provio_test.assert_eq(n, 0, 'Org B sees no Org A deployment requests (RLS)');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  n int;
begin
  select count(*) into n from deployment_requests;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero deployment requests');
end $$;
select provio_test.as_owner();

-- h: anonymous refusal.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises($q$select public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1')$q$,
    null, 'an anonymous caller cannot raise a request');
  perform provio_test.assert_raises($q$select public.decide_combined_deployment('00000000-0000-0000-0000-000000000000', true)$q$,
    null, 'an anonymous caller cannot decide a request');
end $$;
select provio_test.as_owner();

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

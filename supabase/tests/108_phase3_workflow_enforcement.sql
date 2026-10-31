-- Test 108 (Phase 3.1–3.3): the workflow settings now have an effect.
--
-- Before 0107, workflow_settings.sla_hours, escalation_hours and escalation_role were saved and
-- displayed but read by no function; org_lifecycle_settings.signoff_role_testing was likewise inert.
-- This test sets each value and asserts the product behaves differently, so each field is proven
-- enforced rather than merely stored (docs/CONFIG-EFFECT-MATRIX.md).
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a4', 'a4@provio-test.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. sla_hours drives the deployment request's due time. With the workflow SLA at 5 hours the due
--    time lands within the 5-hour window; the gate default (48) would put it far outside it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_workflow_settings('[]'::jsonb, 5, 'cia', 10);
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_req uuid; v_due timestamptz;
begin
  v_req := public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'SLA from workflow settings');
  select sla_due_at into v_due from deployment_requests where id = v_req;
  perform provio_test.assert_true(v_due between now() + interval '4 hours' and now() + interval '6 hours',
    '3.1: the due time uses the workflow SLA (5h), not the gate default (48h)');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. escalation_hours drives when a pending request escalates (3.2). The schema requires
--    escalation_hours >= sla_hours, so the configured window is a grace period measured from
--    creation: a request past its SLA but inside the window is NOT escalated (the pre-0107 rule,
--    "past sla_due_at", would have escalated it); past the window it escalates.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_workflow_settings('[]'::jsonb, 24, 'cia', 48);
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_req uuid;
begin
  v_req := public.request_combined_deployment('30000000-0000-0000-0000-0000000000a1',
    '40000000-0000-0000-0000-0000000000a1', '2026', 'Escalate by age');
  perform set_config('provio_test.esc_req', v_req::text, false);
end $$;
select provio_test.as_owner();

-- Backdate the request to 30h old: past its 24h SLA, but before the 48h escalation window.
update deployment_requests
   set created_at = now() - interval '30 hours',
       sla_due_at = now() - interval '6 hours'
 where id = current_setting('provio_test.esc_req')::uuid;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_req uuid := current_setting('provio_test.esc_req')::uuid; v_n int;
begin
  v_n := public.escalate_overdue_deployment_requests();
  perform provio_test.assert_eq(v_n, 0,
    '3.2: a request past its SLA but inside the escalation window is not escalated');
  perform provio_test.assert_eq((select status from deployment_requests where id = v_req), 'pending',
    '3.2: the request is still pending (the escalation window is a real grace period)');
end $$;
select provio_test.as_owner();

-- Past the escalation window (50h old) it escalates.
update deployment_requests
   set created_at = now() - interval '50 hours',
       sla_due_at = now() - interval '26 hours'
 where id = current_setting('provio_test.esc_req')::uuid;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_req uuid := current_setting('provio_test.esc_req')::uuid; v_n int;
begin
  v_n := public.escalate_overdue_deployment_requests();
  perform provio_test.assert_true(v_n >= 1, '3.2: a request past the escalation window escalates');
  perform provio_test.assert_eq((select status from deployment_requests where id = v_req), 'escalated',
    '3.2: the request is escalated once past the window');
end $$;

-- ---------------------------------------------------------------------------
-- 3. escalation_role is the role told when an escalation fires (3.3).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from notifications
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and event_key = 'deployment.escalated' and role_target = 'cia'),
    '3.3: the escalation notifies the configured escalation role');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. signoff_role_testing narrows who may sign a workpaper (3.4). With the role at 'lead' a manager
--    without manage_team is refused; with the default 'reviewer' the same manager signs.
-- ---------------------------------------------------------------------------
insert into workpapers (id, org_id, engagement_id, stage, status) values
  ('60000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000a1','testing','open');
insert into workpaper_rows (org_id, workpaper_id, row_ref, result) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000f1','R1','tick');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'lead', 'reviewer', false, 0);
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.sign_off_workpaper('60000000-0000-0000-0000-0000000000f1')$q$,
    'signoff_role', '3.4: the configured testing role refuses a manager who does not hold it');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin
  perform public.admin_save_lifecycle_settings('one_stage', 'reviewer', 'reviewer', 'reviewer', false, 0);
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.sign_off_workpaper('60000000-0000-0000-0000-0000000000f1');
  perform provio_test.assert_eq(
    (select status from workpapers where id = '60000000-0000-0000-0000-0000000000f1'), 'signed_off',
    '3.4: with the reviewer role the manager signs');
end $$;
select provio_test.as_owner();

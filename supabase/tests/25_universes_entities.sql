-- Test 25 (3B): universe and entity approval workflow (spec §6).
-- Proves: rights-only initiation and approval (organisation-configured), four-eyes, required
-- reason on rejection, cross-org refusal, unauthenticated refusal, entity history, and that a
-- configured right change alters who may act.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: the configuration defaults to edit_config to initiate and approve_plan to approve.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  cfg record;
begin
  select * into cfg from public.entity_approval_config('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(cfg.initiate_right, 'edit_config', 'default initiate right is edit_config');
  perform provio_test.assert_eq(cfg.approve_right, 'approve_plan', 'default approve right is approve_plan');
end $$;
select provio_test.as_owner();

-- b: a caller without the initiate right cannot submit. The preparer holds neither edit_config nor
-- approve_plan, so both submit and decide are refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.submit_entity('40000000-0000-0000-0000-0000000000a3')$q$,
    'lacks the', 'a preparer without edit_config cannot submit an entity');
end $$;
select provio_test.as_owner();

-- c: the cia holds edit_config, so it can submit the draft entity; the status becomes pending.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.submit_entity('40000000-0000-0000-0000-0000000000a3');
  perform provio_test.assert_eq(
    (select status from entities where id = '40000000-0000-0000-0000-0000000000a3'),
    'pending', 'the cia submits the draft entity and it becomes pending');
end $$;
select provio_test.as_owner();

-- d: four-eyes — the submitter cannot approve its own submission.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.decide_entity('40000000-0000-0000-0000-0000000000a3', true, null)$q$,
    'four-eyes', 'the submitter cannot approve its own submission');
end $$;
select provio_test.as_owner();

-- e: an organisation admin cannot decide — it lacks approve_plan.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.decide_entity('40000000-0000-0000-0000-0000000000a3', true, null)$q$,
    'lacks the', 'an org admin without approve_plan cannot decide an entity');
end $$;
select provio_test.as_owner();

-- f: configure the approval right to manage_engagements (the audit_manager's right), then the
-- audit_manager can approve. This proves the decision is rights-driven, not role-name driven.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.admin_set_entity_approval('edit_config', 'manage_engagements', '["name"]');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.decide_entity('40000000-0000-0000-0000-0000000000a3', true, null);
  perform provio_test.assert_eq(
    (select status from entities where id = '40000000-0000-0000-0000-0000000000a3'),
    'approved', 'the audit_manager approves after the approve right is reconfigured to its right');
  perform provio_test.assert_true(
    (select approved from entities where id = '40000000-0000-0000-0000-0000000000a3'),
    'the legacy approved flag follows the decision');
end $$;
select provio_test.as_owner();

-- g: rejection requires a reason of at least 10 characters, and records it.
-- Reset the entity to draft through the guarded path is not needed: reseed, then submit again.
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.admin_set_entity_approval('edit_config', 'manage_engagements', '["name"]');
  perform public.submit_entity('40000000-0000-0000-0000-0000000000a3');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.decide_entity('40000000-0000-0000-0000-0000000000a3', false, 'too short')$q$,
    'at least 10 characters', 'a rejection needs a reason of at least 10 characters');
  perform public.decide_entity('40000000-0000-0000-0000-0000000000a3', false, 'the scope is too broad');
  perform provio_test.assert_eq(
    (select status from entities where id = '40000000-0000-0000-0000-0000000000a3'),
    'rejected', 'the entity is rejected');
  perform provio_test.assert_eq(
    (select rejection_reason from entities where id = '40000000-0000-0000-0000-0000000000a3'),
    'the scope is too broad', 'the rejection reason is recorded');
end $$;
select provio_test.as_owner();

-- h: cross-org refusal. A caller in Org A cannot submit an Org B entity.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.submit_entity('40000000-0000-0000-0000-0000000000b1')$q$,
    'outside the caller', 'a caller cannot submit an entity in another organisation');
end $$;
select provio_test.as_owner();

-- i: unauthenticated refusal. The anon role cannot call submit_entity.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.submit_entity('40000000-0000-0000-0000-0000000000a3')$q$,
    null, 'an anonymous caller cannot submit an entity');
end $$;
select provio_test.as_owner();

-- j: the entity history records the submit and the decision, and is hash-chained in the ledger.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  select count(*) into n from public.entity_history('40000000-0000-0000-0000-0000000000a3');
  perform provio_test.assert_true(n >= 2, format('the entity history records the submit and the decision (found %s)', n));
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries
            where org_id = 'a0000000-0000-0000-0000-000000000001'
              and action = 'entity_rejected'),
    'the entity decision is written to the hash-chained ledger');
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint,
    'the ledger chain is intact after the entity decisions');
end $$;
select provio_test.as_owner();

-- k: the status is forge-proof. Even a cia, who may edit entity structure, cannot set status
-- directly; it must go through submit_entity()/decide_entity().
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$update entities set status = 'approved', approved = true where id = '40000000-0000-0000-0000-0000000000a3'$q$,
    'must go through', 'a direct status change is refused by the guard trigger');
end $$;
select provio_test.as_owner();

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

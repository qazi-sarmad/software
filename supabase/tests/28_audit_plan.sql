-- Test 28 (3E): Audit plan, version history, ad-hoc justification and approval (spec §9).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: the create right is configurable; a caller without it cannot create a plan.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_plan('30000000-0000-0000-0000-0000000000a1', '2027')$q$,
    'lacks the manage_engagements right', 'a preparer cannot create a plan');
  perform provio_test.assert_raises(
    $q$select public.admin_set_plan_approval('manage_engagements', 'approve_plan')$q$,
    'lacks the edit_config right', 'a preparer cannot configure plan approval');
end $$;
select provio_test.as_owner();

-- b: a plan starts as a draft with version 1 in its history.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  v int;
begin
  p := public.create_plan('30000000-0000-0000-0000-0000000000a1', '2027');
  perform provio_test.assert_true(p is not null, 'a cia can create a plan');
  perform provio_test.assert_eq((select status from plans where id = p), 'draft', 'a new plan is a draft');
  perform provio_test.assert_eq((select current_version from plans where id = p), 1, 'a new plan is at version 1');
  perform provio_test.assert_eq((select count(*) from plan_versions where plan_id = p), 1, 'the creation snapshot is stored');
  perform provio_test.assert_eq((select reason from plan_versions where plan_id = p and version = 1), 'created', 'the creation snapshot is labelled');
end $$;
select provio_test.as_owner();

-- c: adding an ordinary item versions the plan; an ad-hoc item needs a justification and is pending.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  it uuid;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2027';
  it := public.add_plan_item(p, 'Annual controls test', '40000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((select status from plan_items where id = it), 'proposed', 'an ordinary item is proposed');
  perform provio_test.assert_eq((select current_version from plans where id = p), 2, 'adding an item versions the plan');
  perform provio_test.assert_raises(
    format($q$select public.add_plan_item(%L, 'Surprise audit', '40000000-0000-0000-0000-0000000000a1', null, null, null, true, 'too short')$q$, p),
    'at least 10 characters', 'an ad-hoc item without a real justification is refused');
  it := public.add_plan_item(p, 'Surprise audit', '40000000-0000-0000-0000-0000000000a1', null, null, null, true,
    'Triggered by a whistleblower report');
  perform provio_test.assert_eq((select status from plan_items where id = it), 'pending_adhoc', 'an ad-hoc item waits as pending');
  perform provio_test.assert_true((select is_adhoc from plan_items where id = it), 'the item is marked ad-hoc');
end $$;
select provio_test.as_owner();

-- d: a plan with a pending ad-hoc item cannot be approved; the ad-hoc item is decided first.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  it uuid;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2027';
  perform provio_test.assert_raises(format($q$select public.approve_plan(%L)$q$, p),
    'pending ad-hoc', 'a plan with a pending ad-hoc item cannot be approved');
  select id into it from plan_items where plan_id = p and is_adhoc;
  perform public.decide_adhoc_item(it, true);
  perform provio_test.assert_eq((select status from plan_items where id = it), 'approved', 'the ad-hoc item is approved');
  perform provio_test.assert_true((select decided_at is not null and decided_by is not null from plan_items where id = it),
    'the ad-hoc decision records who and when');
  perform provio_test.assert_raises(format($q$select public.decide_adhoc_item(%L, false, 'changed my mind for sure')$q$, it),
    'pending ad-hoc', 'a decided ad-hoc item cannot be decided again');
end $$;
select provio_test.as_owner();

-- e: approval requires the approve right, sets the status and writes a hash-chained ledger entry.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
declare
  p uuid;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2027';
  perform provio_test.assert_raises(format($q$select public.approve_plan(%L)$q$, p),
    'lacks the approve_plan right', 'a reviewer without approve_plan cannot approve a plan');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  v int;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2027';
  v := public.approve_plan(p);
  perform provio_test.assert_eq((select status from plans where id = p), 'approved', 'the plan is approved');
  perform provio_test.assert_true((select approved_at is not null and approved_by is not null from plans where id = p),
    'the approval records who and when');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'plan_approved'),
    'the approval is written to the hash-chained ledger');
  perform provio_test.assert_raises(format($q$select public.approve_plan(%L)$q$, p),
    'already approved', 'an approved plan cannot be approved twice');
  perform provio_test.assert_raises(
    format($q$select public.add_plan_item(%L, 'Late addition')$q$, p),
    'cannot be changed', 'an approved plan refuses new items');
end $$;
select provio_test.as_owner();

-- f: plan_history returns the versions in order.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p uuid;
  n int;
begin
  select id into p from plans where org_id = 'a0000000-0000-0000-0000-000000000001' and period = '2027';
  select count(*) into n from public.plan_history(p);
  perform provio_test.assert_true(n >= 3, 'the plan history has at least three versions');
  perform provio_test.assert_eq((select max(version) from public.plan_history(p) where reason = 'approved'), n,
    'the approved version is the latest');
end $$;
select provio_test.as_owner();

-- g: the approval rights are configurable per organisation (§9).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  n int;
begin
  perform public.admin_set_plan_approval('review_and_approve', 'approve_plan');
  perform provio_test.assert_eq(public.plan_approval_config('a0000000-0000-0000-0000-000000000001') ->> 'create_right',
    'review_and_approve', 'the create right is configurable');
  perform provio_test.assert_raises(
    $q$select public.admin_set_plan_approval('not_a_right', 'approve_plan')$q$,
    'unknown right', 'an unknown right is refused');
  -- With the create right now review_and_approve, an org_admin (no review_and_approve) cannot create.
  perform provio_test.assert_raises(
    $q$select public.create_plan('30000000-0000-0000-0000-0000000000a2', '2028')$q$,
    'lacks the review_and_approve right', 'creation now needs the configured right');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a6', 'a0000000-0000-0000-0000-000000000001', 'reviewer');
do $$
begin
  perform provio_test.assert_true(public.create_plan('30000000-0000-0000-0000-0000000000a2', '2028') is not null,
    'a reviewer who holds the configured create right can create a plan');
end $$;
select provio_test.as_owner();

-- h: cross-org refusal and platform blindness.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  perform provio_test.assert_raises(
    $q$select public.create_plan('30000000-0000-0000-0000-0000000000a1', '2029')$q$,
    'universe not found', 'Org B cannot create a plan on an Org A universe');
  select count(*) into n from plan_items;
  perform provio_test.assert_eq(n, 0, 'Org B sees no Org A plan items (RLS)');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  n int;
begin
  select count(*) into n from plan_items;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero plan items');
  select count(*) into n from plan_approval_settings;
  perform provio_test.assert_eq(n, 0, 'a platform admin sees zero approval settings');
end $$;
select provio_test.as_owner();

-- i: anonymous refusal.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises($q$select public.create_plan('30000000-0000-0000-0000-0000000000a1', '2030')$q$,
    null, 'an anonymous caller cannot create a plan');
  perform provio_test.assert_raises($q$select public.approve_plan('a2000000-0000-0000-0000-0000000000a1')$q$,
    null, 'an anonymous caller cannot approve a plan');
end $$;
select provio_test.as_owner();

-- Restore the seed so later tests see the seed state (M5: no residue).
select provio_test.seed();

-- Test 149 (S4): D12 — readiness signals, complaints and the self-diagnostic.
--
-- docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md D12 is the specification. A signal is a deterministic
-- verdict with a reason; a check that cannot be evaluated is AMBER, never green; a non-green signal
-- carries its fix; a complaint is coded, org-scoped and emailed; a diagnostic runs one signal in
-- isolation, records its result and changes no state.
--
-- Happy path: the catalogue is seeded; every signal carries a verdict, a reason, a remediation and a
-- fix target; a complaint is created with a code and a bundle and its event is written; the lifecycle
-- records assign/comment/resolve.
-- Bad paths: an unevaluated check is amber, never green; an unknown signal is refused; a blank reason
-- is refused; a blank title is refused; org B never reads org A's complaint (L2); a resolve needs a
-- reason; a caller without edit_config cannot raise an org complaint.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The platform administrator is a real account (the complaint email resolves addresses from auth.users).
select provio_test.as_owner();
insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000f0', 'platform@qscorp.test')
on conflict (id) do nothing;

-- ===========================================================================
-- 1. The catalogue is seeded and every row names its fix.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from readiness_signals) >= 11,
    'D12: the readiness-signal catalogue is seeded');
  perform provio_test.assert_eq(
    (select count(*) from readiness_signals where btrim(remediation) = '' or btrim(fix_target) = ''),
    0::bigint, 'D12: every signal names a remediation and a fix target');
  perform provio_test.assert_eq(
    (select count(*) from readiness_signals where layer not in ('platform', 'environment', 'organisation')),
    0::bigint, 'D12: every signal is on one of the three layers');
end $$;

-- ===========================================================================
-- 2. The platform view returns every signal with a verdict and a reason.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v jsonb;
  v_signals jsonb;
begin
  v := public.platform_readiness_signals('a0000000-0000-0000-0000-000000000001');
  v_signals := v -> 'signals';
  perform provio_test.assert_eq((v ->> 'scope'), 'platform', 'D12: the platform view is scoped platform');
  perform provio_test.assert_eq(
    jsonb_array_length(v_signals), (select count(*)::int from readiness_signals),
    'D12: every catalogue signal is evaluated');
  perform provio_test.assert_true(
    (select bool_and((s ->> 'verdict') in ('green', 'amber', 'red') and (s ->> 'reason') <> '')
       from jsonb_array_elements(v_signals) s),
    'D12: every signal carries a verdict and a reason');
  perform provio_test.assert_true(
    (select bool_and((s ->> 'remediation') <> '' and (s ->> 'fix_target') <> '')
       from jsonb_array_elements(v_signals) s),
    'D12: every signal carries its fix');
  -- The summary counts agree with the signals.
  perform provio_test.assert_eq(
    ((v -> 'summary' ->> 'green')::int + (v -> 'summary' ->> 'amber')::int + (v -> 'summary' ->> 'red')::int),
    jsonb_array_length(v_signals), 'D12: the summary counts every signal exactly once');
end $$;

-- ===========================================================================
-- 3. The honest rule: a check that cannot be evaluated is AMBER, never green. The environment
--    signals (edge functions, migrations, build env) have no readable source, so they are amber.
-- ===========================================================================
do $$
declare
  v jsonb;
begin
  v := public.platform_readiness_signals('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(
    (select s ->> 'verdict' from jsonb_array_elements(v -> 'signals') s where s ->> 'signal_id' = 'edge_functions'),
    'amber', 'D12: an un-deployable-check signal is amber, never green');
  perform provio_test.assert_eq(
    (select s ->> 'verdict' from jsonb_array_elements(v -> 'signals') s where s ->> 'signal_id' = 'build_env'),
    'amber', 'D12: the build-env signal is amber (verify at the host), never green');
  perform provio_test.assert_eq(
    (select s ->> 'verdict' from jsonb_array_elements(v -> 'signals') s where s ->> 'signal_id' = 'migrations_applied'),
    'amber', 'D12: the migrations signal is amber when not readable, never green');
  perform provio_test.assert_true(
    (select (s ->> 'reason') ilike '%not evaluated%'
       from jsonb_array_elements(v -> 'signals') s where s ->> 'signal_id' = 'edge_functions'),
    'D12: an amber signal names "not evaluated"');
end $$;

-- ===========================================================================
-- 4. The deterministic verdict helper: green/red from a boolean, amber when not evaluated, and a
--    null is never green.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(public.readiness_verdict(true, 'ok') ->> 'verdict', 'green',
    'D12: true is green');
  perform provio_test.assert_eq(public.readiness_verdict(false, 'no') ->> 'verdict', 'red',
    'D12: false is red');
  perform provio_test.assert_eq(public.readiness_verdict(null, 'unknown') ->> 'verdict', 'amber',
    'D12: a null verdict is amber, never green');
  perform provio_test.assert_eq(public.readiness_verdict(false, 'x', true) ->> 'verdict', 'amber',
    'D12: an explicitly not-evaluated check is amber even when the boolean is false');
end $$;

-- ===========================================================================
-- 5. The organisation view returns only organisation-layer signals (L2: no environment signal leaks).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v jsonb;
begin
  v := public.org_readiness_signals();
  perform provio_test.assert_eq((v ->> 'scope'), 'organisation', 'D12: the org view is scoped organisation');
  perform provio_test.assert_true(
    (select bool_and((s ->> 'layer') = 'organisation') from jsonb_array_elements(v -> 'signals') s),
    'D12: the org view carries organisation signals only');
  perform provio_test.assert_true(
    (select count(*) > 0 from jsonb_array_elements(v -> 'signals') s),
    'D12: the org view is non-empty');
end $$;

-- ===========================================================================
-- 6. The self-diagnostic: one signal in isolation, recorded, and it changes no inspected state.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v jsonb;
  v_before int;
  v_after int;
begin
  select count(*) into v_before from ledger_entries where action = 'readiness_diagnostic';
  v := public.run_readiness_diagnostic('a0000000-0000-0000-0000-000000000001', 'roles_seeded');
  perform provio_test.assert_eq((v ->> 'signal_id'), 'roles_seeded', 'D12: the diagnostic names the one signal');
  perform provio_test.assert_true((v ->> 'verdict') in ('green', 'amber', 'red'),
    'D12: the diagnostic returns a verdict');
  perform provio_test.assert_true((v ->> 'remediation') <> '', 'D12: the diagnostic returns a remediation');
  perform provio_test.assert_eq((v ->> 'recorded'), 'true', 'D12: the diagnostic reports it was recorded');
  -- The role count is asserted as the owner: RLS shows a platform session no tenant row, which would
  -- make a "mutated nothing" assertion vacuous.
  perform provio_test.as_owner();
  perform provio_test.assert_eq(
    (select count(*) from roles where org_id = 'a0000000-0000-0000-0000-000000000001'),
    7::bigint, 'D12: the diagnostic mutated no inspected state');
  select count(*) into v_after from ledger_entries where action = 'readiness_diagnostic';
  perform provio_test.assert_eq(v_after, v_before + 1, 'D12: the diagnostic appends one ledger entry');
  perform provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
end $$;

-- Bad path: an unknown signal is refused.
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.run_readiness_diagnostic('a0000000-0000-0000-0000-000000000001', 'not_a_signal')$q$,
    'unknown signal', 'D12: an unknown signal is refused');
end $$;

-- ===========================================================================
-- 7. A complaint: a code, a bundle with the evidence, an event, and an email queued to the platform.
-- ===========================================================================
do $$
declare
  v jsonb;
  v_id uuid;
begin
  v := public.complaint_create('a0000000-0000-0000-0000-000000000001',
    'Storage buckets are not ready', array['storage_buckets'], 'critical', 'auto-generated');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'D12: the complaint is created');
  perform provio_test.assert_true((v ->> 'code') like 'PRV-%', 'D12: the complaint carries a code');
  v_id := (v ->> 'complaint_id')::uuid;

  perform provio_test.assert_eq(
    (select count(*) from complaints where id = v_id), 1::bigint, 'D12: the complaint row exists');
  perform provio_test.assert_true(
    (select bundle ? 'signals' and bundle ? 'summary' from complaints where id = v_id),
    'D12: the bundle carries the auto-generated evidence');
  perform provio_test.assert_eq(
    (select count(*) from complaint_events where complaint_id = v_id and kind = 'created'),
    1::bigint, 'D12: the creation event is written');
  perform provio_test.assert_eq(
    (select count(*) from complaint_events where complaint_id = v_id and kind = 'emailed'),
    1::bigint, 'D12: the email event is written when the platform admin is addressable');
  perform provio_test.assert_eq(
    (select count(*) from email_queue where metadata ->> 'code' = (v ->> 'code')),
    1::bigint, 'D12: exactly one complaint email is queued');
end $$;

-- Bad path: a blank title is refused.
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.complaint_create('a0000000-0000-0000-0000-000000000001', '  ', array['storage_buckets'], 'warning', '')$q$,
    'title is required', 'D12: a blank complaint title is refused');
end $$;

-- ===========================================================================
-- 8. The code is unique per organisation and the counter is atomic.
-- ===========================================================================
do $$
declare
  v1 jsonb;
  v2 jsonb;
begin
  v1 := public.complaint_create('a0000000-0000-0000-0000-000000000001', 'Second issue', array[]::text[], 'warning', '');
  v2 := public.complaint_create('a0000000-0000-0000-0000-000000000001', 'Third issue', array[]::text[], 'warning', '');
  perform provio_test.assert_true((v1 ->> 'code') <> (v2 ->> 'code'),
    'D12: two complaints in one org get different codes');
  perform provio_test.assert_eq(
    (select count(distinct code) from complaints where org_id = 'a0000000-0000-0000-0000-000000000001'),
    (select count(*) from complaints where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'D12: every complaint code is distinct within the org');
end $$;

-- ===========================================================================
-- 9. The lifecycle: assign needs a reason; comment appends; resolve needs a reason and is terminal.
-- ===========================================================================
do $$
declare
  v_id uuid;
  v_code text;
begin
  select id, code into v_id, v_code from complaints
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by created_at limit 1;

  perform provio_test.assert_raises(
    format($q$select public.complaint_assign(%L, %L, '  ')$q$, v_id, '10000000-0000-0000-0000-0000000000f0'),
    'reason is required', 'D12: assigning without a reason is refused');

  perform public.complaint_assign(v_id, '10000000-0000-0000-0000-0000000000f0', 'platform owns this');
  perform provio_test.assert_eq(
    (select status from complaints where id = v_id), 'assigned', 'D12: the complaint is assigned');
  perform provio_test.assert_eq(
    (select count(*) from complaint_events where complaint_id = v_id and kind = 'assigned'),
    1::bigint, 'D12: the assignment event is written');

  perform public.complaint_comment(v_id, 'Investigating the bucket policy.');
  perform provio_test.assert_eq(
    (select count(*) from complaint_events where complaint_id = v_id and kind = 'commented'),
    1::bigint, 'D12: the comment event is written');

  perform provio_test.assert_raises(
    format($q$select public.complaint_resolve(%L, '')$q$, v_id),
    'reason is required', 'D12: resolving without a reason is refused');

  perform public.complaint_resolve(v_id, 'buckets created and verified');
  perform provio_test.assert_eq(
    (select status from complaints where id = v_id), 'resolved', 'D12: the complaint is resolved');
  perform provio_test.assert_raises(
    format($q$select public.complaint_resolve(%L, 'again')$q$, v_id),
    'already resolved', 'D12: a resolved complaint cannot be resolved twice');
end $$;

-- ===========================================================================
-- 10. The read path. The platform sees all; a tenant sees only its own (L2).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v jsonb;
begin
  v := public.complaint_list(null);
  perform provio_test.assert_true(jsonb_array_length(v) >= 3, 'D12: the platform register lists the complaints');
end $$;

-- Org B must not read Org A's complaints through the org read path.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v jsonb;
begin
  v := public.org_complaint_list();
  perform provio_test.assert_eq(jsonb_array_length(v), 0,
    'D12: org B reads none of org A''s complaints');
end $$;

-- A tenant with edit_config raises a complaint about its own org; the org is the session's, never a parameter.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v jsonb;
begin
  v := public.org_complaint_create('Something is wrong here', array['roles_seeded'], 'warning', 'tenant raised');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'D12: a tenant can raise a complaint');
  perform provio_test.assert_eq(
    (select org_id from complaints where id = (v ->> 'complaint_id')::uuid),
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'D12: the tenant complaint is pinned to the session org, never a parameter');
end $$;

-- A caller without edit_config (an Observer) cannot raise an org complaint.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.org_complaint_create('x', array[]::text[], 'warning', '')$q$,
    'edit_config', 'D12: an Observer without edit_config cannot raise a complaint');
end $$;

-- Bad path: a tenant cannot run an environment diagnostic (it is not an organisation signal).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.org_run_readiness_diagnostic('storage_buckets')$q$,
    'unknown organisation signal', 'D12: a tenant cannot diagnose an environment signal');
end $$;

-- Bad path: a tenant cannot read the platform view.
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.platform_readiness_signals('a0000000-0000-0000-0000-000000000001')$q$,
    'platform administrator', 'D12: a tenant session cannot read the platform readiness view');
end $$;

select provio_test.as_owner();

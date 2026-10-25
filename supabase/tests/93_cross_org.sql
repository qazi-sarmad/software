-- Cross-organisation regression tests (audit round 2, 2026-10-23). Each refusal is paired with the
-- legitimate read, so a fix that blocks everything fails here.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures (owner): an Org A escalation event, an Org A work-queue proposal, a platform recipient,
-- and the board pack feature on for Org A.
insert into escalation_events (org_id, rule_key, source_event_key, severity, recommendation, reason, target_roles, payload)
  values ('a0000000-0000-0000-0000-000000000001', 'r1', 'e1', 'info', 'rec', 'because', array['cia'], '{}');
insert into work_queue_proposals (org_id, kind, title, body, status, target_roles)
  values ('a0000000-0000-0000-0000-000000000001', 'review_note', 'Org A proposal', 'body', 'proposed', array['cia']);
insert into platform_notification_recipients (address) values ('ops@platform.example');
insert into tenant_entitlements (org_id, feature_key, enabled, effective_from)
  values ('a0000000-0000-0000-0000-000000000001', 'board_pack', true, now() - interval '1 day');

-- 1. Escalation events: Org B sees none of Org A's; Org A sees its own.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.escalation_event_list('a0000000-0000-0000-0000-000000000001'))::int, 0,
    'org B cannot read org A escalation events');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.escalation_event_list('a0000000-0000-0000-0000-000000000001'))::int, 1,
    'org A CIA still reads its own escalation events');
end $$;

-- 2. Work-queue proposals: the same split.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.work_queue_proposal_list('a0000000-0000-0000-0000-000000000001'))::int, 0,
    'org B cannot read org A work-queue proposals');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.work_queue_proposal_list('a0000000-0000-0000-0000-000000000001'))::int, 1,
    'org A CIA still reads its own work-queue proposals');
end $$;

-- 3. The platform recipient list: refused to a tenant user, served to a platform administrator.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.platform_list_recipients())::int, 0,
    'a tenant CIA cannot read platform notification recipients');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform provio_test.assert_eq((select count(*) from public.platform_list_recipients())::int, 1,
    'a platform administrator still reads platform notification recipients');
end $$;

-- 4. Org-argument helpers and platform-wide sweeps are not callable by a tenant user.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises('select public.admin_snapshot_sira_model(''a0000000-0000-0000-0000-000000000001'')',
    'permission denied', 'org B cannot snapshot org A''s SIRA model');
  perform provio_test.assert_raises('select public.consultation_sweep()', 'permission denied',
    'a tenant user cannot run the platform-wide consultation sweep');
  perform provio_test.assert_raises('select public.email_expire_stale(7)', 'permission denied',
    'a tenant user cannot expire every org''s email queue');
  perform provio_test.assert_raises('select public.hosting_fit_seed()', 'permission denied',
    'a tenant user cannot rewrite the hosting catalogue');
  perform provio_test.assert_raises('select public.hosting_connection_test_result(''80000000-0000-0000-0000-0000000000a1'', ''ok'', null)',
    'permission denied', 'a tenant user cannot write hosting test results');
end $$;

-- 5. has_feature answers for the caller's own org only.
do $$ begin
  perform provio_test.assert_eq(public.has_feature('a0000000-0000-0000-0000-000000000001', 'board_pack'), false,
    'org B cannot learn org A''s feature flags');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(public.has_feature('a0000000-0000-0000-0000-000000000001', 'board_pack'), true,
    'org A still sees its own feature flags');
end $$;

-- 6. Public verification still runs for anonymous callers, and the feature check it needs is internal.
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_true(has_function_privilege('anon', 'public.verify_certificate(uuid)', 'execute'),
    'anonymous public verification stays executable');
  perform provio_test.assert_true(not has_function_privilege('anon', 'public.has_feature(uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.feature_enabled_internal(uuid,text)', 'execute'),
    'the internal feature check is not callable by end users');
end $$;
select provio_test.as_anon();
do $$ begin
  perform provio_test.assert_eq(
    (select status from public.verify_certificate('90000000-0000-0000-0000-0000000000ff')), 'not_found',
    'anonymous verification of an unknown certificate returns not_found');
end $$;
select provio_test.as_owner();

-- 7. Row policies: a tenant cannot attach a child row to another tenant's parent.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_raises(
    $q$insert into samples (org_id, population_id, population_sha256, method, size_floor)
       values ('b0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-0000000000a1', repeat('b', 64), 'random', 1)$q$,
    null, 'org B cannot attach a sample to org A''s population (refused by the population gate or RLS)');
  perform provio_test.assert_raises(
    $q$insert into plan_versions (org_id, plan_id, version, snapshot)
       values ('b0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-0000000000a1', 9, '{}')$q$,
    'row-level security', 'org B cannot insert a plan version under org A''s plan');
end $$;

-- 8. snapshot_plan_version: refused for another org's plan; served for the owner.
do $$ begin
  perform provio_test.assert_raises(
    $q$select public.snapshot_plan_version('a2000000-0000-0000-0000-0000000000a1', 'probe')$q$,
    'not found in this organisation', 'org B cannot snapshot org A''s plan');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(public.snapshot_plan_version('a2000000-0000-0000-0000-0000000000a1', 'own'), 2,
    'org A still snapshots its own plan');
end $$;
select provio_test.as_owner();

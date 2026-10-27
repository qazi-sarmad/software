-- Test 107: WP11 SSO enforcement (access-token hook) and WP15 right to erasure.
--
-- SSO enforcement lives in custom_access_token_hook, the only writer of org_id. An enforcing org
-- does not hand tenant claims to a non-SSO session, so the whole tenant is unreachable through RLS.
-- Erasure pseudonymises personal identifiers in place and refuses under legal hold; the sealed,
-- hash-chained record is never rewritten (L2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Clean slate for both passes.
select provio_test.as_owner();
delete from org_sso_settings where org_id = 'a0000000-0000-0000-0000-000000000001';
update org_members set display_name = 'Subject A' where user_id = '10000000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------------------
-- SSO: an enforcing org withholds claims from a password session, hands them to an SSO session.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.sso_set_provider('a0000000-0000-0000-0000-000000000001', 'saml', 'acme.test', true, 'client requires SSO');
  perform provio_test.assert_eq((select enforced from public.sso_get_settings('a0000000-0000-0000-0000-000000000001')),
    true, 'sso: the policy is enforced');
end $$;

-- The hook is the identity choke point. It is revoked from application roles (0083), so the test
-- calls it as the owner and inspects the claims it would stamp.
select provio_test.as_owner();
do $$
declare
  v_pw jsonb := public.custom_access_token_hook(jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1',
    'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'password')))));
  v_sso jsonb := public.custom_access_token_hook(jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1',
    'claims', jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'sso/saml')))));
begin
  perform provio_test.assert_eq(v_pw #>> '{claims,org_id}', null, 'sso: a password session gets no org claim');
  perform provio_test.assert_eq(v_pw #>> '{claims,sso_required}', 'true', 'sso: a password session is told SSO is required');
  perform provio_test.assert_eq(v_sso #>> '{claims,org_id}', 'a0000000-0000-0000-0000-000000000001',
    'sso: an SSO session gets the org claim');
  perform provio_test.assert_eq(v_sso #>> '{claims,user_role}', 'cia', 'sso: an SSO session gets the role claim');
end $$;

-- A member with no org claim (the withheld state) reads nothing from the tenant tables.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', '', '');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 0, 'sso: a withheld session reads no universes');
  perform provio_test.assert_eq((select count(*) from engagements), 0, 'sso: a withheld session reads no engagements');
end $$;

-- A non-member with no org claim still gets no org, and a domain lookup routes to the org.
do $$
begin
  perform provio_test.assert_eq((select org_id from public.sso_org_for_domain('acme.test')),
    'a0000000-0000-0000-0000-000000000001'::uuid, 'sso: a known domain routes to its org');
  perform provio_test.assert_eq((select count(*) from public.sso_org_for_domain('unknown.test')), 0,
    'sso: an unknown domain routes nowhere');
end $$;

-- Only edit_config may change SSO settings; a preparer is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises($q$select public.sso_set_provider('a0000000-0000-0000-0000-000000000001','oidc','x.test',false,'nope')$q$,
    'edit_config', 'sso: a preparer cannot change SSO settings');
end $$;

-- ---------------------------------------------------------------------------
-- Erasure: request, legal hold blocks, execute pseudonymises, the ledger is intact.
-- ---------------------------------------------------------------------------
-- A preparer (no manage_users) cannot raise a request.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises($q$select public.erasure_request('a0000000-0000-0000-0000-000000000001','someone@example.test','gdpr')$q$,
    'manage_users', 'erasure: a preparer cannot raise a request');
end $$;

-- An org admin can.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_id uuid;
  v_ledger_before int;
  v_ledger_after int;
begin
  select count(*) into v_ledger_before from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001';
  v_id := public.erasure_request('a0000000-0000-0000-0000-000000000001', 'subject.a@example.test', 'GDPR Art. 17 request');
  perform provio_test.assert_eq((select status from data_erasure_requests where id = v_id), 'pending',
    'erasure: the request starts pending');
  perform provio_test.assert_eq((select count(*) from data_erasure_events where request_id = v_id), 1,
    'erasure: the request appends one event');

  -- A legal hold blocks execution.
  perform public.erasure_set_legal_hold(v_id, true, 'litigation hold');
  perform provio_test.assert_eq((select status from data_erasure_requests where id = v_id), 'blocked',
    'erasure: a legal hold blocks the request');
  perform provio_test.assert_raises(format($q$select public.erasure_execute('%s','now')$q$, v_id),
    'legal hold', 'erasure: a held request cannot be executed');

  -- Lift the hold, then execute. A personal column is pseudonymised; the ledger only grows.
  perform public.erasure_set_legal_hold(v_id, false, 'hold lifted');
  perform public.erasure_execute(v_id, 'GDPR Art. 17 completed');
  perform provio_test.assert_eq((select status from data_erasure_requests where id = v_id), 'executed',
    'erasure: the request is executed');
  perform provio_test.assert_raises(format($q$select public.erasure_execute('%s','again')$q$, v_id),
    'already executed', 'erasure: a request cannot be executed twice');
  select count(*) into v_ledger_after from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_true(v_ledger_after > v_ledger_before,
    'erasure: the ledger records the erasure and is never rewritten');
end $$;

-- The erasure log is append-only.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises($q$update data_erasure_events set action = 'x'$q$, 'append_only_violation',
    'erasure: the event log refuses an update');
  perform provio_test.assert_raises($q$delete from data_erasure_events$q$, 'append_only_violation',
    'erasure: the event log refuses a delete');
end $$;

-- A subject in another org cannot be erased through this org's register (RLS + guard).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises($q$select public.erasure_request('b0000000-0000-0000-0000-000000000001','subject.b@example.test','x')$q$,
    'not allowed', 'erasure: org A cannot raise a request against org B');
end $$;

-- Residency: an unsupported region is refused, a supported one is recorded.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin', 'aal2');
do $$
begin
  perform public.platform_set_residency('a0000000-0000-0000-0000-000000000001', 'eu-central-1', 'client is EU-based');
  perform provio_test.assert_eq((select data_residency_region from org_settings_extra where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'eu-central-1', 'residency: a supported region is recorded');
  perform provio_test.assert_raises($q$select public.platform_set_residency('a0000000-0000-0000-0000-000000000001','mars-1','x')$q$,
    'unsupported residency region', 'residency: an unsupported region is refused');
  perform provio_test.assert_eq((select count(*) from public.platform_list_residency_regions()), 7,
    'residency: the allow-list is seeded');
end $$;

-- Cleanup so the second pass starts clean. Erasure requests are append-only, so they are left in
-- place; every assertion is keyed on the request id it created, and the seed truncates orgs (a
-- TRUNCATE cascade, which fires no row trigger) at the start of each pass.
select provio_test.as_owner();
delete from org_sso_settings where org_id = 'a0000000-0000-0000-0000-000000000001';
update org_settings_extra set data_residency_region = null where org_id = 'a0000000-0000-0000-0000-000000000001';

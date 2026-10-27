-- Test 108: owner-only platform console (0103) and the tenant second factor.
--
-- Two controls, both enforced in a single choke point:
--   * `require_platform_admin()` requires the OWNER row, so a platform admin who is not the owner
--     is refused with the same message a tenant user gets;
--   * `custom_access_token_hook` withholds org claims from a session that has not satisfied the
--     organisation's MFA requirement.
--
-- Every negative case below is the point of the test: the console must refuse, and the tenant must
-- be unreachable, not merely hidden in the browser.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Clean slate for both passes.
select provio_test.as_owner();
delete from org_security_settings where org_id = 'a0000000-0000-0000-0000-000000000001';
delete from org_security_versions where org_id = 'a0000000-0000-0000-0000-000000000001';

-- A second platform admin who is NOT the owner. Inserted as the owner; never given an owners row.
select provio_test.as_owner();
insert into platform_admins (user_id) values ('10000000-0000-0000-0000-0000000000f1')
  on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. The owner holds the console; a non-owner platform admin does not.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin', 'aal2');
do $$
begin
  perform provio_test.assert_eq((select is_platform_admin from public.platform_whoami()), true,
    'owner: the session holds the platform role');
  perform provio_test.assert_eq((select is_platform_owner from public.platform_whoami()), true,
    'owner: the session holds the owner row');
  perform provio_test.assert_eq((select owner_exists from public.platform_whoami()), true,
    'owner: ownership is claimed');
  -- The owner reaches the control plane.
  perform public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'suspended');
  perform provio_test.assert_eq(
    (select status from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'suspended', 'owner: the owner changes a tenant');
  perform public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'active');
end $$;

-- The non-owner platform admin is refused by EVERY platform RPC, with the tenant-facing message.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f1', '', 'platform_admin', 'aal2');
do $$
begin
  perform provio_test.assert_eq((select is_platform_admin from public.platform_whoami()), true,
    'non-owner: the session still holds the platform role');
  perform provio_test.assert_eq((select is_platform_owner from public.platform_whoami()), false,
    'non-owner: the session holds no owner row');

  -- The refusal message is identical to a tenant refusal, so the console is indistinguishable.
  perform provio_test.assert_raises($q$select public.platform_list_tenants()$q$,
    'not allowed: platform administrator only', 'non-owner: cannot list tenants');
  perform provio_test.assert_raises($q$select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001','suspended')$q$,
    'not allowed: platform administrator only', 'non-owner: cannot change a tenant');
  perform provio_test.assert_raises($q$select public.platform_set_security_setting('session_max_age_minutes','30'::jsonb,'x')$q$,
    'not allowed: platform administrator only', 'non-owner: cannot change a security setting');
  perform provio_test.assert_raises($q$select public.platform_list_trail(10)$q$,
    'not allowed: platform administrator only', 'non-owner: cannot read the platform trail');
  perform provio_test.assert_raises($q$select public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{}'::jsonb,30)$q$,
    'not allowed: platform administrator only', 'non-owner: cannot grant support access');
end $$;

-- A tenant user is refused exactly as before (the owner check does not widen anything).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia', 'aal2');
do $$
begin
  perform provio_test.assert_eq((select is_platform_owner from public.platform_whoami()), false,
    'tenant: a tenant member is never the owner');
  perform provio_test.assert_raises($q$select public.platform_list_tenants()$q$,
    'not allowed: platform administrator only', 'tenant: cannot list tenants');
end $$;

-- The owner reads its own owner row; a tenant user reads none.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq((select count(*) from platform_owners), 1, 'owner row: exactly one owner exists');
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia', 'aal2');
do $$
begin
  perform provio_test.assert_eq((select count(*) from platform_owners), 0,
    'owner row: a tenant member reads no owner row');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The bootstrap closes permanently once ownership is claimed.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f1', '', 'platform_admin', 'aal2');
do $$
begin
  perform provio_test.assert_raises($q$select public.platform_owner_claim('let me in')$q$,
    'platform ownership is already claimed', 'bootstrap: a second claim is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tenant second factor. The hook withholds claims from an aal1 session when the org requires it.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia', 'aal2');
do $$
begin
  perform provio_test.assert_eq((select require_mfa from public.org_security_status()), false,
    'mfa: the organisation does not require a factor by default');
  perform public.admin_set_require_mfa(true, 'client policy: second factor for every member');
  perform provio_test.assert_eq((select require_mfa from public.org_security_status()), true,
    'mfa: the requirement is set');
  -- The change is ledgered and hash-chained.
  perform provio_test.assert_true(
    (select count(*) from org_security_versions where org_id = 'a0000000-0000-0000-0000-000000000001') = 1,
    'mfa: the change is versioned');
end $$;

-- A reason is required.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia', 'aal2');
do $$
begin
  perform provio_test.assert_raises($q$select public.admin_set_require_mfa(false, '')$q$,
    'reason is required', 'mfa: a change without a reason is refused');
end $$;

-- A member without edit_config cannot change the requirement.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer', 'aal2');
do $$
begin
  perform provio_test.assert_raises($q$select public.admin_set_require_mfa(false, 'turn it off')$q$,
    'edit_config', 'mfa: a preparer cannot change the requirement');
end $$;

-- The hook is the choke point. It is revoked from application roles (0083), so the test calls it as
-- the owner and inspects the claims it would stamp for an aal1 and an aal2 session.
select provio_test.as_owner();
do $$
declare
  v_aal1 jsonb := public.custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-0000000000a1',
    'claims', jsonb_build_object('aal', 'aal1', 'amr', jsonb_build_array(jsonb_build_object('method', 'password')))));
  v_aal2 jsonb := public.custom_access_token_hook(jsonb_build_object(
    'user_id', '10000000-0000-0000-0000-0000000000a1',
    'claims', jsonb_build_object('aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password')))));
begin
  perform provio_test.assert_eq(v_aal1 #>> '{claims,org_id}', null,
    'mfa: an aal1 session gets no org claim');
  perform provio_test.assert_eq(v_aal1 #>> '{claims,mfa_required}', 'true',
    'mfa: an aal1 session is told a factor is required');
  perform provio_test.assert_eq(v_aal1 #>> '{claims,user_role}', null,
    'mfa: an aal1 session gets no role claim');
  perform provio_test.assert_eq(v_aal2 #>> '{claims,org_id}', 'a0000000-0000-0000-0000-000000000001',
    'mfa: an aal2 session gets the org claim');
  perform provio_test.assert_eq(v_aal2 #>> '{claims,user_role}', 'cia',
    'mfa: an aal2 session gets the role claim');
  perform provio_test.assert_eq(v_aal2 #>> '{claims,mfa_required}', null,
    'mfa: an aal2 session is not told a factor is required');
end $$;

-- A member with the withheld state (no org claim) reads nothing from the tenant tables.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', '', '', 'aal1');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 0,
    'mfa: a withheld session reads no universes');
  perform provio_test.assert_eq((select count(*) from engagements), 0,
    'mfa: a withheld session reads no engagements');
  perform provio_test.assert_eq((select count(*) from entities), 0,
    'mfa: a withheld session reads no entities');
end $$;

-- A member of an org that does NOT require MFA is unaffected, even at aal1.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia', 'aal1');
do $$
begin
  perform provio_test.assert_eq((select require_mfa from public.org_security_status()), false,
    'mfa: org B does not require a factor');
  perform provio_test.assert_eq((select count(*) from universes where org_id = 'b0000000-0000-0000-0000-000000000001'), 1,
    'mfa: an aal1 member of a non-requiring org still reads its own org');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Leave the shared state clean for the next file and the second pass.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
delete from org_security_settings where org_id = 'a0000000-0000-0000-0000-000000000001';
delete from org_security_versions where org_id = 'a0000000-0000-0000-0000-000000000001';
delete from platform_admins where user_id = '10000000-0000-0000-0000-0000000000f1';

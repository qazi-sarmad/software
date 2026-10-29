-- Test 116 (G3): tenant suspension is enforced, not merely stored.
-- `tenant_settings.status` was settable and shown but read by no decision; the config-effect matrix
-- claimed it blocked writes with no such guard in the schema. It is now read by
-- `custom_access_token_hook` through `tenant_is_active`, so a suspended tenant's member is issued no
-- org claim and RLS shows them nothing. Owner decision 1: enforce, do not remove.
--
-- Both the hook and `tenant_is_active` are revoked from `authenticated` (0083), so they are exercised
-- as the owner, exactly as tests 16 and 92 do.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The named reader reflects the stored status. `tenant_is_active` is internal (revoked from
--    authenticated), so it is called as the owner; the status is set by the platform admin.
-- ---------------------------------------------------------------------------
do $$
declare v_active boolean;
begin
  v_active := public.tenant_is_active('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_true(v_active, 'an org with no tenant_settings row is active by default');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'suspended');
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(not public.tenant_is_active('a0000000-0000-0000-0000-000000000001'),
    'a suspended tenant is not active');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'active');
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(public.tenant_is_active('a0000000-0000-0000-0000-000000000001'),
    'lifting the suspension makes the tenant active again');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The effect: while suspended, the access-token hook stamps no org claim, so the member's
--    identity is, to RLS, a user with no membership.
-- ---------------------------------------------------------------------------
do $$
declare
  ev jsonb;
  out jsonb;
begin
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1',
                           'claims', jsonb_build_object('sub', '10000000-0000-0000-0000-0000000000a1'));

  -- Active: the member is stamped (the pre-existing 0010 behaviour, unchanged).
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_eq(out #>> '{claims,org_id}', 'a0000000-0000-0000-0000-000000000001',
    'an active tenant member is stamped with org_id');
  perform provio_test.assert_eq(out #>> '{claims,user_role}', 'cia', 'and with the role slug');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'suspended');
select provio_test.as_owner();
do $$
declare
  ev jsonb;
  out jsonb;
begin
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1',
                           'claims', jsonb_build_object('sub', '10000000-0000-0000-0000-0000000000a1'));
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_true((out #>> '{claims,org_id}') is null,
    'a suspended tenant member is issued no org claim');
  perform provio_test.assert_true((out #>> '{claims,user_role}') is null,
    'a suspended tenant member is issued no role claim');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The consequence: with no org claim, the member reads nothing (spec §4.5, no fallback org).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', '', '', 'aal1');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 0,
    'a suspended tenant member reads no universes');
  perform provio_test.assert_eq((select count(*) from entities), 0,
    'a suspended tenant member reads no entities');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Platform staff are never suspended out: they carry no org membership, so the platform can
--    always lift a suspension.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare
  ev jsonb;
  out jsonb;
begin
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000f0',
                           'claims', jsonb_build_object('sub', '10000000-0000-0000-0000-0000000000f0'));
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_eq(out #>> '{claims,user_role}', 'platform_admin',
    'platform staff keep the platform_admin role regardless of any tenant status');
  perform provio_test.assert_true((out #>> '{claims,org_id}') is null,
    'platform staff still carry no org');
end $$;

-- Restore so a later test file sees an active tenant.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'active');
select provio_test.as_owner();

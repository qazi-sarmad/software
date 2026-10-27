-- Test 106: WP9 platform-admin MFA gate, and WP16 crypto agility (key rotation).
--
-- The MFA gate lives in require_platform_admin(), the single choke point every platform RPC calls.
-- It is armed by a platform_security_settings row and enforced against the JWT `aal` claim. This
-- file proves the gate refuses an aal1 session, admits an aal2 session, never admits a tenant
-- session, and leaves the switch OFF so no later test or second pass is affected.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Clean slate for both passes: disarm the switch and drop any key this test made. The switch is a
-- config row seed() does not touch, so a failed first pass must not leave it armed.
select provio_test.as_owner();
delete from signing_keys where key_id like 'sec-test-%';
update platform_security_settings set require_platform_mfa = false where id;

-- An AAL1 platform session can arm the switch (the gate is OFF, so it passes), and is then refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin', 'aal1');
do $$
begin
  perform provio_test.assert_eq((select require_platform_mfa from public.platform_security_status()), false,
    'mfa: off by default');
  perform provio_test.assert_eq((select aal from public.platform_security_status()), 'aal1',
    'mfa: the session reports aal1');
  perform provio_test.assert_eq((select mfa_satisfied from public.platform_security_status()), true,
    'mfa: with the switch off, any aal satisfies the gate');

  perform public.platform_set_security_setting('require_platform_mfa', 'true'::jsonb,
    'owner decision: arm the second factor for platform staff');
  perform provio_test.assert_eq((select require_platform_mfa from public.platform_security_status()), true,
    'mfa: the switch is armed');
  perform provio_test.assert_eq((select mfa_satisfied from public.platform_security_status()), false,
    'mfa: an aal1 session no longer satisfies the gate');

  -- The same AAL1 session is now refused by every platform RPC.
  perform provio_test.assert_raises($q$select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001','suspended')$q$,
    'mfa required', 'mfa: an aal1 session cannot change a tenant');
  perform provio_test.assert_raises($q$select public.platform_set_security_setting('session_max_age_minutes','30'::jsonb,'shorten')$q$,
    'mfa required', 'mfa: an aal1 session cannot change a security setting');
  perform provio_test.assert_raises($q$select public.platform_get_dr_settings()$q$,
    'mfa required', 'mfa: an aal1 session cannot read the DR posture');
end $$;

-- An AAL2 platform session passes.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin', 'aal2');
do $$
begin
  perform provio_test.assert_eq((select mfa_satisfied from public.platform_security_status()), true,
    'mfa: an aal2 session satisfies the gate');
  perform public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'suspended');
  perform provio_test.assert_eq((select status from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'suspended', 'mfa: an aal2 session changes a tenant');
  perform public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'active');
  -- A reason is still required once the factor is satisfied.
  perform provio_test.assert_raises($q$select public.platform_set_security_setting('session_max_age_minutes','30'::jsonb,'')$q$,
    'reason is required', 'mfa: a security change still requires a reason');
end $$;

-- A tenant session is refused regardless of its AAL, and reads no platform security row.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia', 'aal2');
do $$
begin
  perform provio_test.assert_raises($q$select public.platform_set_security_setting('require_platform_mfa','false'::jsonb,'nope')$q$,
    'platform administrator only', 'mfa: a tenant session cannot change a platform setting');
  perform provio_test.assert_eq((select count(*) from platform_security_settings), 0,
    'mfa: a tenant session reads no platform security row');
end $$;

-- The security ledger is append-only.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises($q$update platform_security_versions set reason = 'x'$q$, 'append_only_violation',
    'mfa: the security ledger refuses an update');
  perform provio_test.assert_raises($q$delete from platform_security_versions$q$, 'append_only_violation',
    'mfa: the security ledger refuses a delete');
end $$;

-- WP16: crypto agility. The algorithm is a registry row, so a new algorithm is a data change.
select provio_test.as_owner();
insert into signing_keys (org_id, scope, key_id, algorithm, public_key, key_version, rotate_after)
values (null, 'platform', 'sec-test-p1', 'Ed25519', repeat('a', 64), 1, timestamptz '2020-01-01T00:00:00Z');

do $$
begin
  perform provio_test.assert_eq(public.default_signing_algorithm(), 'Ed25519', 'crypto: Ed25519 is the default active algorithm');
  perform provio_test.assert_true(public.algorithm_can_sign('Ed25519'), 'crypto: an active algorithm may sign');
  perform provio_test.assert_true(not public.algorithm_can_sign('ES256'), 'crypto: a deprecated algorithm may not sign');
  perform provio_test.assert_true(not public.algorithm_can_sign('ML-DSA-65'), 'crypto: a planned algorithm may not sign');
end $$;

-- Rotation is refused for an aal1 session while the switch is armed.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin', 'aal1');
do $$
begin
  perform provio_test.assert_raises($q$select public.platform_rotate_signing_key('sec-test-p1','sec-test-p2', repeat('b',64),'Ed25519','annual', now())$q$,
    'mfa required', 'crypto: rotation is refused for an aal1 session');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin', 'aal2');
do $$
declare
  v record;
begin
  select * into v from public.platform_rotate_signing_key('sec-test-p1', 'sec-test-p2', repeat('b', 64),
    'Ed25519', 'annual rotation', timestamptz '2026-01-01T00:00:00Z');
  perform provio_test.assert_eq(v.new_key_version, 2, 'crypto: the new key is version 2');
  perform provio_test.assert_raises($q$select public.platform_rotate_signing_key('sec-test-p2','sec-test-p3', repeat('c',64),'ML-DSA-65','x', now())$q$,
    'may not sign', 'crypto: a planned algorithm cannot sign a new key');
  perform provio_test.assert_raises($q$select public.platform_rotate_signing_key('sec-test-p2','sec-test-p4', repeat('c',64),'Ed25519','', now())$q$,
    'reason is required', 'crypto: rotation requires a reason');
  -- Constant rotation: a key past its rotate_after is due; none is due before it.
  perform provio_test.assert_eq(
    (select count(*) from public.platform_signing_keys_due(timestamptz '2030-01-01T00:00:00Z') where key_id = 'sec-test-p2'),
    1, 'crypto: a key past rotate_after is due for rotation');
  perform provio_test.assert_eq(
    (select count(*) from public.platform_signing_keys_due(timestamptz '2020-01-01T00:00:00Z') where key_id = 'sec-test-p2'),
    0, 'crypto: a key is not due before its rotate_after');
end $$;

-- The rows themselves: a platform-scope key is not visible to a tenant session, so the row
-- assertions run as the owner. The old key is retired, never deleted; the new key records the link.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq((select count(*) from signing_keys where key_id = 'sec-test-p1' and retired_at is not null),
    1, 'crypto: the old key is retired, never deleted');
  perform provio_test.assert_eq((select key_version from signing_keys where key_id = 'sec-test-p2'),
    2, 'crypto: the new key carries version 2');
  perform provio_test.assert_eq((select rotated_from_key_id from signing_keys where key_id = 'sec-test-p2'),
    'sec-test-p1', 'crypto: the new key records its predecessor');
end $$;

-- Cleanup: leave no armed switch and no live test key, so the next pass and later tests are unaffected.
select provio_test.as_owner();
update platform_security_settings set require_platform_mfa = false where id;
delete from signing_keys where key_id like 'sec-test-%';

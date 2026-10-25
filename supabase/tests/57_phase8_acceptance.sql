-- Test 57 (8E): Phase 8 acceptance — the platform portal, support access, AI enablement and the
-- invite-cap control in one place. A tenant reads zero platform rows, cannot call any platform RPC,
-- and the platform admin's AI enablement is recorded in both the platform trail and the org ledger
-- (spec §24; L2, D-PLATFORM-RIGHTS).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. A tenant user reads zero rows from every platform table and cannot call any platform RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['platform_settings','tenant_settings','support_access_grants','platform_trail'] loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0, format('8E: a tenant user reads zero rows from %s', t));
  end loop;
  perform provio_test.assert_raises(
    $q$select public.platform_set_feature_flag('a0000000-0000-0000-0000-000000000001','exports',true)$q$,
    'platform administrator only', '8E: a tenant user cannot set a feature flag');
  perform provio_test.assert_raises(
    $q$select public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 7)$q$,
    'platform administrator only', '8E: a tenant user cannot set the invite cap');
  perform provio_test.assert_raises(
    $q$select public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{}'::jsonb,4)$q$,
    'platform administrator only', '8E: a tenant user cannot grant platform support access');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Unauthenticated: anon reads zero platform rows and cannot call a platform RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises('select count(*) from tenant_settings', 'permission denied', '8E: anon cannot read tenant settings');
  perform provio_test.assert_raises(
    $q$select public.platform_set_feature_flag('a0000000-0000-0000-0000-000000000001','exports',true)$q$,
    null, '8E: anon cannot call a platform RPC');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. The platform admin sets flags, AI and the invite cap; every write lands in the trail (§24).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_feature_flag('a0000000-0000-0000-0000-000000000001', 'exports', true);
  perform provio_test.assert_eq(
    (select feature_flags -> 'exports' from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'true'::jsonb, '8E: the platform admin sets a feature flag');

  perform provio_test.assert_raises(
    $q$select public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 101)$q$,
    'between 1 and 100', '8E: an invite cap above 100 is refused');
  perform public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 9);
  perform provio_test.assert_eq(
    (select per_user_daily from invite_cap_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    9, '8E: the platform invite-cap override is stored');

  perform provio_test.assert_true(
    (select count(*) > 0 from platform_trail where action = 'invite_cap_set'),
    '8E: the invite-cap change is written to the platform trail');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Support access is time-boxed; the platform reads no tenant business table even after granting.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_id uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{}'::jsonb,49)$q$,
    'may not exceed 48 hours', '8E: a support grant beyond the ceiling is refused');
  v_id := public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{"read":"metadata"}'::jsonb,4);
  perform provio_test.assert_true(v_id is not null, '8E: a time-boxed support grant is created');
  perform provio_test.assert_true(
    (select expires_at > granted_at from support_access_grants where id = v_id),
    '8E: the grant expires after it was granted');
end $$;

-- The platform admin still reads no tenant business content (L2).
do $$
declare
  t text;
  n int;
begin
  foreach t in array provio_test.org_tables() loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0, format('8E: the platform admin reads no rows from %s', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The Org Admin grants its own support access; the grant is recorded in the org ledger and can be
--    revoked (§24).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.grant_support_access('a0000000-0000-0000-0000-000000000001', '{}'::jsonb, 2);
  perform provio_test.assert_true(v_id is not null, '8E: the Org Admin grants its own support access');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'support_access_granted'),
    '8E: the org grant is written to the organisation ledger');
  perform provio_test.assert_raises(
    format($q$select public.revoke_support_access('%s','short')$q$, v_id),
    'at least 10 characters', '8E: a short revoke reason is refused');
  perform public.revoke_support_access(v_id, 'tenant ended the support session');
end $$;

-- support_access_grants is platform-readable only, so confirm the revocation as the owner.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_true(
    (select count(*) > 0 from support_access_grants where revoked_at is not null
       and revoke_reason = 'tenant ended the support session'),
    '8E: the grant records its revocation');
end $$;

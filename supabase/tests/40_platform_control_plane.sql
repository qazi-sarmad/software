-- Test 40 (C1): the platform control plane. Tenant roles read zero platform rows and cannot call
-- platform RPCs; the platform admin reads and writes platform metadata but no tenant business table;
-- tenant status, invite-cap bounds and grant expiry are enforced (spec §24, L2, D-PLATFORM-RIGHTS).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. A tenant user reads zero rows from every platform table.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['platform_settings','tenant_settings','support_access_grants'] loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0, format('an org user reads zero rows from %s', t));
  end loop;
  perform provio_test.assert_eq((select count(*) from platform_trail), 0,
    'an org user reads zero platform trail rows');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A tenant user cannot call a platform RPC.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001','suspended')$q$,
    'platform administrator only', 'an org user cannot suspend a tenant');
  perform provio_test.assert_raises(
    $q$select public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{}'::jsonb,4)$q$,
    'platform administrator only', 'an org user cannot grant platform support access');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The platform admin writes platform metadata; every write lands in the trail.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_tenant_status('a0000000-0000-0000-0000-000000000001', 'suspended');
  perform provio_test.assert_eq(
    (select status from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'suspended', 'the platform admin suspends a tenant');

  perform public.platform_set_feature_flag('a0000000-0000-0000-0000-000000000001', 'exports', true);
  perform provio_test.assert_eq(
    (select feature_flags -> 'exports' from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'true'::jsonb, 'the platform admin sets a feature flag');

  perform public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', true, 'http://ai.local');
  perform provio_test.assert_eq(
    (select ai_enabled from tenant_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    true, 'the platform admin enables advisory features');

  perform provio_test.assert_true(
    (select count(*) > 0 from platform_trail where action = 'tenant_status_changed'),
    'the suspension is written to the platform trail');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A tenant cannot enable advisory features for itself.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.platform_enable_ai('a0000000-0000-0000-0000-000000000001', true, 'http://x')$q$,
    'platform administrator only', 'an org admin cannot enable advisory features');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Invite-cap bounds and grant expiry are enforced.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_id uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 0)$q$,
    'between 1 and 100', 'an invite cap below 1 is refused');
  perform provio_test.assert_raises(
    $q$select public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 101)$q$,
    'between 1 and 100', 'an invite cap above 100 is refused');
  perform public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 7);
  perform provio_test.assert_eq(
    (select per_user_daily from invite_cap_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    7, 'a platform invite-cap override is stored');

  perform provio_test.assert_raises(
    $q$select public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{}'::jsonb,49)$q$,
    'may not exceed 48 hours', 'a support grant beyond the ceiling is refused');
  v_id := public.platform_grant_support_access('a0000000-0000-0000-0000-000000000001','{"read":"metadata"}'::jsonb,4);
  perform provio_test.assert_true(v_id is not null, 'a time-boxed support grant is created');
  perform provio_test.assert_raises(
    format($q$select public.platform_revoke_support_access('%s','short')$q$, v_id),
    'at least 10 characters', 'a short revoke reason is refused');
  perform public.platform_revoke_support_access(v_id, 'tenant requested revocation');
  perform provio_test.assert_true(
    (select revoked_at is not null from support_access_grants where id = v_id),
    'the grant records its revocation');
end $$;

-- ---------------------------------------------------------------------------
-- 6. The org admin can grant its own support access; the platform can only revoke it via the platform RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.grant_support_access('a0000000-0000-0000-0000-000000000001', '{}'::jsonb, 2);
  perform provio_test.assert_true(v_id is not null, 'the Org Admin grants its own time-boxed support access');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
       and action = 'support_access_granted'),
    'the org grant is written to the organisation ledger');
end $$;

-- ---------------------------------------------------------------------------
-- 7. The platform admin still reads no tenant business table (L2) even after granting access.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  t text;
  n int;
begin
  foreach t in array provio_test.org_tables() loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0, format('platform_admin reads no rows from %s', t));
  end loop;
end $$;

select provio_test.as_owner();

-- Test 42 (C3/C4): the platform read APIs used by the Super Admin portal. A tenant role is refused
-- by every read RPC; the platform admin reads tenant metadata (not business content) and cannot read
-- an org business table (spec §24, L2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. A tenant user is refused by every platform read RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$select * from public.platform_list_tenants()$q$,
    'platform administrator only', 'a tenant cannot list tenants');
  perform provio_test.assert_raises($q$select * from public.platform_get_invite_caps()$q$,
    'platform administrator only', 'a tenant cannot read invite caps');
  perform provio_test.assert_raises($q$select * from public.platform_list_support_grants()$q$,
    'platform administrator only', 'a tenant cannot list support grants');
  perform provio_test.assert_raises($q$select * from public.platform_list_trail(10)$q$,
    'platform administrator only', 'a tenant cannot read the platform trail');
end $$;

-- The identity probe is safe for a tenant: it reports that the caller is not a platform admin.
do $$
begin
  perform provio_test.assert_eq(
    (select is_platform_admin from public.platform_whoami()), false,
    'platform_whoami reports a tenant is not a platform admin');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The platform admin reads the portal data.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq((select is_platform_admin from public.platform_whoami()), true,
    'platform_whoami reports the platform admin');
  perform provio_test.assert_true((select count(*) >= 1 from public.platform_list_tenants()),
    'the platform admin lists at least one tenant');
end $$;

-- The platform admin sets an invite cap and then reads it back through the read API.
do $$
begin
  perform public.platform_set_invite_cap('a0000000-0000-0000-0000-000000000001', 7);
end $$;
do $$
begin
  perform provio_test.assert_eq(
    (select per_user_daily from public.platform_get_invite_caps()
      where org_id = 'a0000000-0000-0000-0000-000000000001'),
    7, 'the platform admin reads back the invite cap it set');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Even as a platform admin, tenant business tables stay unreadable (data-blind, spec §24).
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from entities;
  perform provio_test.assert_eq(n, 0, 'the platform admin reads zero entity rows');
  select count(*) into n from observations;
  perform provio_test.assert_eq(n, 0, 'the platform admin reads zero observation rows');
end $$;

select provio_test.as_owner();

-- Test 76 (R-1b, F8, F25): ai_gateway_authorise is the gate the ai-gateway Edge Function makes
-- before it reads any endpoint or credential with the service role. It must answer true only for a
-- member of the named org who holds use_ai_assist while ai_assist is entitled for that org, and it
-- must be unreachable by anon. Applying twice is a no-op (M2, M6).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- 1. A member of org B naming org A is refused (cross-org).
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    public.ai_gateway_authorise('a0000000-0000-0000-0000-000000000001') is not true,
    'a member of org B naming org A is refused');
end $$;

-- 2. A member of org A whose role lacks use_ai_assist is refused. The Org Admin role holds none of
--    the four assurance rights (F3), so it is the natural negative.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_true(
    public.ai_gateway_authorise('a0000000-0000-0000-0000-000000000001') is not true,
    'a member without use_ai_assist is refused');
end $$;

-- 3. With the right but the feature off, the call is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    public.ai_gateway_authorise('a0000000-0000-0000-0000-000000000001') is not true,
    'the call is refused while ai_assist is not entitled');
end $$;

-- 4. Turn ai_assist on for org A: the same caller is now allowed.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001','ai_assist',true,null,'R-1 test');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    public.ai_gateway_authorise('a0000000-0000-0000-0000-000000000001') is true,
    'a member with the right and the entitlement is allowed');
end $$;

-- 5. The platform principal is not a member of the org, so it is refused even with the feature on.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_true(
    public.ai_gateway_authorise('a0000000-0000-0000-0000-000000000001') is not true,
    'a platform admin is not a member and is refused');
end $$;

-- 6. anon cannot execute it at all.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.ai_gateway_authorise('a0000000-0000-0000-0000-000000000001')$q$,
    'permission denied', 'anon cannot execute ai_gateway_authorise');
end $$;

select provio_test.as_owner();

-- Test 81 (C1.1, F5, F11): oauth_state_consume is the single-use store behind the Microsoft Graph
-- consent flow. It must be service-role only, must refuse a blank nonce, and must answer false for a
-- nonce it has already seen so a captured state cannot be replayed. The table behind it must be
-- unreachable by any tenant or platform role. Applying twice is a no-op (M2, M6).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- 1. The function is not executable by anon or authenticated: the Edge Function is the only caller.
do $$
declare
  fn oid;
  anon_ok boolean := false;
  auth_ok boolean := false;
begin
  select p.oid into fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'oauth_state_consume'
   limit 1;
  perform provio_test.assert_true(fn is not null, 'oauth_state_consume exists');
  anon_ok := has_function_privilege('anon', fn, 'execute');
  auth_ok := has_function_privilege('authenticated', fn, 'execute');
  perform provio_test.assert_true(not anon_ok, 'anon cannot execute oauth_state_consume');
  perform provio_test.assert_true(not auth_ok, 'authenticated cannot execute oauth_state_consume');
  perform provio_test.assert_true(
    has_function_privilege('service_role', fn, 'execute'),
    'service_role can execute oauth_state_consume');
end $$;

-- 2. A blank nonce is refused, so a caller cannot consume an empty key.
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.oauth_state_consume('', '10000000-0000-0000-0000-0000000000a1', null, now() + interval '10 minutes')$q$,
    'nonce is required',
    'a blank nonce is refused');
end $$;

-- 3. The first use of a nonce is true; the second is false (single use).
do $$
declare
  first_use boolean;
  second_use boolean;
begin
  select public.oauth_state_consume(
    'test-nonce-c11', '10000000-0000-0000-0000-0000000000a1',
    'a0000000-0000-0000-0000-000000000001', now() + interval '10 minutes') into first_use;
  perform provio_test.assert_true(first_use is true, 'a fresh nonce is accepted');
  select public.oauth_state_consume(
    'test-nonce-c11', '10000000-0000-0000-0000-0000000000a1',
    'a0000000-0000-0000-0000-000000000001', now() + interval '10 minutes') into second_use;
  perform provio_test.assert_true(second_use is false, 'a replayed nonce is refused');
end $$;

-- 4. The table has RLS enabled and NO policy, so no session role can read or write it directly.
do $$
declare
  rls boolean;
  policies int;
begin
  select c.relrowsecurity into rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'oauth_state_nonces';
  perform provio_test.assert_true(rls is true, 'oauth_state_nonces has RLS enabled');
  select count(*) into policies from pg_policies
   where schemaname = 'public' and tablename = 'oauth_state_nonces';
  perform provio_test.assert_eq(policies, 0, 'oauth_state_nonces has no direct policy');
end $$;

-- 5. Leave no residue (M5): the test rows are removed.
do $$
begin
  delete from oauth_state_nonces where nonce = 'test-nonce-c11';
  perform provio_test.assert_true(true, 'cleanup done');
end $$;

-- Test 16: the access-token hook stamps org_id and user_role from the database only (spec §4.5, §25.2).
-- A user with no membership gets no org claim; a forged org claim in the incoming token is stripped.
\i supabase/tests/00_lib.sql
select provio_test.seed();

do $$
declare
  ev jsonb;
  out jsonb;
begin
  -- A provisioned member.
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1', 'claims', jsonb_build_object('sub','10000000-0000-0000-0000-0000000000a1'));
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_eq(out #>> '{claims,org_id}', 'a0000000-0000-0000-0000-000000000001',
    'hook stamps org_id from org_members');
  perform provio_test.assert_eq(out #>> '{claims,user_role}', 'cia', 'hook stamps the role slug');

  -- A forged org_id in the incoming claims is replaced with the database value.
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1',
                           'claims', jsonb_build_object('sub','10000000-0000-0000-0000-0000000000a1','org_id','b0000000-0000-0000-0000-000000000001'));
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_eq(out #>> '{claims,org_id}', 'a0000000-0000-0000-0000-000000000001',
    'a forged org_id claim is stripped and replaced');

  -- A user with no membership gets no org claim and no role.
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000ff', 'claims', jsonb_build_object('sub','10000000-0000-0000-0000-0000000000ff'));
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_true((out #>> '{claims,org_id}') is null, 'no membership means no org claim');
  perform provio_test.assert_true((out #>> '{claims,user_role}') is null, 'no membership means no role claim');

  -- Platform staff get the platform role and no org.
  ev := jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000f0', 'claims', jsonb_build_object('sub','10000000-0000-0000-0000-0000000000f0'));
  out := public.custom_access_token_hook(ev);
  perform provio_test.assert_eq(out #>> '{claims,user_role}', 'platform_admin', 'platform staff get the platform_admin role');
  perform provio_test.assert_true((out #>> '{claims,org_id}') is null, 'platform staff carry no org');
end $$;

-- A user with no membership, once given such a token, reads nothing.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000ff"}', false);
select provio_test.as_user('10000000-0000-0000-0000-0000000000ff', '', '', 'aal1');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes), 0, 'a user with no org claim reads no universes');
  perform provio_test.assert_eq((select count(*) from orgs), 0, 'a user with no org claim reads no orgs');
end $$;
select provio_test.as_owner();

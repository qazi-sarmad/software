-- Test 18: the access-token hook returns an org_id claim that equals the provisioned user's org
-- (spec §4.5, §25.2). One login per tenant: the claim the JWT carries is the org the user belongs to.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Every provisioned user: the hook stamps their org, and it equals the org in org_members.
do $$
declare
  m record;
  out jsonb;
begin
  for m in
    select om.user_id, om.org_id
    from org_members om
    order by om.user_id
  loop
    out := public.custom_access_token_hook(
      jsonb_build_object('user_id', m.user_id::text,
                         'claims', jsonb_build_object('sub', m.user_id::text)));
    perform provio_test.assert_eq(out #>> '{claims,org_id}', m.org_id::text,
      'hook stamps the org of user ' || m.user_id::text);
    perform provio_test.assert_true((out #>> '{claims,org_id}') is not null,
      'org_id is present in the returned claims for ' || m.user_id::text);
  end loop;
end $$;

-- The claim cannot come from the incoming token: a forged org is replaced by the database value.
do $$
declare
  out jsonb;
begin
  out := public.custom_access_token_hook(
    jsonb_build_object('user_id', '10000000-0000-0000-0000-0000000000a1',
                       'claims', jsonb_build_object('sub', '10000000-0000-0000-0000-0000000000a1',
                                                    'org_id', 'b0000000-0000-0000-0000-000000000001')));
  perform provio_test.assert_eq(out #>> '{claims,org_id}', 'a0000000-0000-0000-0000-000000000001',
    'a forged org_id claim is replaced by the user''s own org');
end $$;

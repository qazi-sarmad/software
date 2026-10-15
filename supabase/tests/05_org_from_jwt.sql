-- Test 5: a client-supplied org_id in a request body does not change the org used by RLS.
-- No policy reads an org from a header or body; only the JWT claim is used (spec §25.2, decision D).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The caller is cia_A. They claim org B in a "body" (a GUC a naive implementation might read)
-- and also try to pass org B as an explicit filter. RLS must still use the JWT org.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select set_config('request.headers', '{"x-org-id":"b0000000-0000-0000-0000-000000000001"}', false);

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from universes where org_id = 'b0000000-0000-0000-0000-000000000001'),
    0, 'a body/header org_id cannot make org B rows visible');
  perform provio_test.assert_eq((select count(*) from universes), 2, 'the JWT org still governs the read');
  -- The JWT claim itself decides the org.
  perform provio_test.assert_eq(public.jwt_org_id(), 'a0000000-0000-0000-0000-000000000001'::uuid,
    'jwt_org_id() returns the claim, not the body');
end $$;

-- Now genuinely switch the JWT claim to org B and confirm the org changes with it.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a1","org_id":"b0000000-0000-0000-0000-000000000001","user_role":"cia"}', false);
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes where org_id = 'b0000000-0000-0000-0000-000000000001'), 1,
    'changing the JWT claim changes the org, proving the claim is the source');
end $$;

select provio_test.as_owner();

-- Test 2: a user scoped to universe U1 cannot see U2 entities or engagements (spec §4.3, §25.2).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');

do $$
begin
  -- Sees only its universe.
  perform provio_test.assert_eq((select count(*) from universes), 1, 'scoped user sees exactly 1 universe');
  perform provio_test.assert_eq((select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 0, 'scoped user cannot see U2');
  -- Sees only the entities of its universe.
  perform provio_test.assert_eq((select count(*) from entities), 1, 'scoped user sees exactly 1 entity');
  perform provio_test.assert_eq((select count(*) from entities where universe_id = '30000000-0000-0000-0000-0000000000a2'), 0, 'scoped user cannot see U2 entities');
  -- Sees only the engagements of its universe (or where it is a team member).
  perform provio_test.assert_eq((select count(*) from engagements where universe_id = '30000000-0000-0000-0000-0000000000a2'), 0, 'scoped user cannot see U2 engagements');
  perform provio_test.assert_eq((select count(*) from engagements), 1, 'scoped user sees its own engagement');
end $$;

-- A member of an engagement can see that engagement even without a matching scope row.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq((select count(*) from engagements where id = '50000000-0000-0000-0000-0000000000b1'), 1, 'engagement member sees its engagement via membership');
  perform provio_test.assert_eq((select count(*) from engagements where org_id = 'a0000000-0000-0000-0000-000000000001'), 0, 'member sees no org A engagement');
end $$;

select provio_test.as_owner();

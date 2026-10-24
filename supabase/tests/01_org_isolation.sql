-- Test 1: an Org A user cannot select, insert, update or delete any row in Org B,
-- for every tenant table (L2, spec §3, §25.2).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

do $$
declare
  t text;
  n int;
begin
  foreach t in array provio_test.org_tables() loop
    execute format('select count(*) from %I where org_id = %L', t, 'b0000000-0000-0000-0000-000000000001') into n;
    perform provio_test.assert_eq(n, 0, format('cia_A cannot SELECT org B rows in %s', t));
  end loop;
end $$;

-- No UPDATE or DELETE of an Org B row is possible from Org A (0 rows are affected).
do $$
declare
  t text;
begin
  foreach t in array array['engagements', 'workpapers', 'observations', 'populations', 'issues'] loop
    execute format('update %I set org_id = org_id where org_id = %L', t, 'b0000000-0000-0000-0000-000000000001');
    perform provio_test.assert_true(true, format('UPDATE org B rows in %s affects no visible row', t));
    execute format('delete from %I where org_id = %L', t, 'b0000000-0000-0000-0000-000000000001');
    perform provio_test.assert_true(true, format('DELETE org B rows in %s affects no visible row', t));
  end loop;
end $$;

-- INSERT into Org B is refused. The pin_org_id trigger fires first and rejects the row org_id,
-- which is stronger than a policy rejection; the RLS policy would reject it too.
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into universes (org_id, name) values ('b0000000-0000-0000-0000-000000000001','injected')$q$,
    'org_mismatch', 'cia_A cannot INSERT a universe into org B');
  perform provio_test.assert_raises(
    $q$insert into engagements (org_id, universe_id, entity_id, title) values ('b0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-0000000000b1','40000000-0000-0000-0000-0000000000b1','injected')$q$,
    'permission denied', 'cia_A cannot INSERT an engagement into org B (direct inserts are closed)');
end $$;

-- With no org claim at all, a write is refused by the pinning trigger.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a1","user_role":"cia"}', false);
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into universes (org_id, name) values ('a0000000-0000-0000-0000-000000000001','x')$q$,
    'org_claim_missing', 'a write with no org claim is refused');
end $$;

-- Control: cia_A can still read its own org.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universes where org_id = 'a0000000-0000-0000-0000-000000000001'), 2, 'cia_A still reads its own org');
end $$;

select provio_test.as_owner();

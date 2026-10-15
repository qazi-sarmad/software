-- Test 4: the anon key with no session sees zero rows in every table (spec §4.5, §25.1).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_anon();

do $$
declare
  t text;
  n int;
begin
  execute 'select count(*) from orgs' into n;
  perform provio_test.assert_eq(n, 0, 'anon sees no orgs');
  foreach t in array provio_test.org_tables() loop
    execute format('select count(*) from %I', t) into n;
    perform provio_test.assert_eq(n, 0, format('anon sees zero rows in %s', t));
  end loop;
  execute 'select count(*) from platform_trail' into n;
  perform provio_test.assert_eq(n, 0, 'anon sees no platform trail');
end $$;

select provio_test.as_owner();

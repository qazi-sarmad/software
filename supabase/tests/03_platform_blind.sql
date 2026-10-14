-- Test 3: the platform role reads no tenant business table (L2, spec §24, §25.2, decision E).
\i supabase/tests/00_lib.sql
select provio_test.seed();
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

do $$
begin
  -- The platform trail and org metadata are the only things it reads.
  perform provio_test.assert_eq((select count(*) from orgs), 2, 'platform_admin reads org metadata rows');
  perform provio_test.assert_eq((select count(*) from platform_trail), 1, 'platform_admin reads the platform trail');
  perform provio_test.assert_eq((select count(*) from tenant_metadata), 2, 'platform_admin reads the tenant metadata view');
  -- It cannot write tenant business tables either.
  perform provio_test.assert_raises(
    $q$insert into universes (org_id, name) values ('a0000000-0000-0000-0000-000000000001','x')$q$,
    null, 'platform_admin cannot INSERT a universe');
end $$;

select provio_test.as_owner();

-- Cross-tenant isolation at scale. For a sample of orgs, become a CIA of that org and assert that
-- EVERY tenant table returns zero rows belonging to any other org. This is the L2 proof: the JWT
-- org claim is the only read path, and no table leaks across it.
\set ON_ERROR_STOP on
\i supabase/tests/00_lib.sql

drop table if exists iso_org;
create temporary table iso_org as select i, md5('org' || i)::uuid as org_id from generate_series(1,1000) i;

do $$
declare
  t text;
  o record;
  leaked bigint;
  checked int := 0;
  failures int := 0;
begin
  for o in select * from iso_org loop
    -- CIA of org o: view_all_scopes, the broadest read a tenant user can have.
    perform provio_test.as_user(md5('user' || o.i || '-1')::text, o.org_id::text, 'cia');
    foreach t in array provio_test.org_tables() loop
      execute format('select count(*) from %I where org_id is distinct from %L::uuid', t, o.org_id::text) into leaked;
      checked := checked + 1;
      if leaked > 0 then
        failures := failures + 1;
        raise warning 'LEAK: org % sees % rows of % in table %', o.i, leaked, t, o.org_id;
      end if;
    end loop;
  end loop;
  raise notice 'ISOLATION: checked % table-reads across 1000 orgs; failures=%', checked, failures;
  if failures > 0 then raise exception 'CROSS-TENANT LEAK: % failures', failures; end if;
end $$;

-- Test 4: the anon key with no session sees zero rows in every table (spec §4.5, §25.1).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_anon();

do $$
declare
  t text;
  n int;
begin
  -- Audit 2026-10-23: anon holds no table privilege at all, so it is refused before RLS applies.
  perform provio_test.assert_raises('select count(*) from orgs', 'permission denied', 'anon cannot read orgs');
  foreach t in array provio_test.org_tables() loop
    perform provio_test.assert_raises(format('select count(*) from %I', t), 'permission denied',
      format('anon cannot read %s', t));
  end loop;
  perform provio_test.assert_raises('select count(*) from platform_trail', 'permission denied',
    'anon cannot read the platform trail');
end $$;

select provio_test.as_owner();

-- Test 13: RLS is enabled on every table in the public schema, and no policy uses USING (true) (spec §25.2).
\i supabase/tests/00_lib.sql

do $$
declare
  r record;
  bad boolean := false;
  total int := 0;
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    total := total + 1;
    if not r.relrowsecurity then
      bad := true;
      raise notice 'RLS DISABLED on %', r.relname;
    end if;
  end loop;
  perform provio_test.assert_true(not bad, format('RLS is enabled on all %s tables in public', total));
  perform provio_test.assert_true(total >= 31, format('the public schema holds at least 31 tables (found %s)', total));
end $$;

-- No policy is a blanket allow: no policy expression is literally `true` (spec §25.1).
do $$
declare
  r record;
  bad text[] := '{}';
begin
  for r in
    select p.polname, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as chk
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  loop
    if btrim(coalesce(r.qual, '')) = 'true' or btrim(coalesce(r.chk, '')) = 'true' then
      bad := array_append(bad, format('%s.%s', r.relname, r.polname));
    end if;
  end loop;
  perform provio_test.assert_eq(array_length(bad, 1), null::int,
    format('no public policy is USING (true) (offenders: %s)', coalesce(array_to_string(bad, ', '), 'none')));
end $$;

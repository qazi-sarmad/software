-- Test 118 (scale): every tenant table whose RLS policy filters on org_id carries an org_id index.
--
-- The defect this pins: 31 tenant tables had only their primary-key index, yet every tenant RLS
-- policy filters `org_id = jwt_org_id()`. A single-org read therefore sequential-scanned the whole
-- table, which is invisible at fixture size and only appears at real tenant volume (measured:
-- 1139 ms for one org's population_rows at 1000 orgs). This test makes the gap impossible to
-- reintroduce: any new tenant table with an org_id policy and no org_id index fails the build.
--
-- It is a structural assertion over the catalogue, not a timing test, so it is deterministic and
-- cheap. Timing is proven separately by supabase/scale/05_index_volume.sql.
\i supabase/tests/00_lib.sql
select provio_test.seed();

do $$
declare
  r record;
  offenders text := '';
  n int := 0;
begin
  for r in
    with pol as (
      select tablename,
             count(*) filter (
               where coalesce(qual, '') || coalesce(with_check, '') ~ 'org_id'
             ) as org_policies
      from pg_policies where schemaname = 'public' group by tablename
    ),
    missing as (
      select c.relname as tbl
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0
      where ns.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_index i
          join pg_attribute ia on ia.attrelid = i.indrelid and ia.attnum = i.indkey[0]
          where i.indrelid = c.oid and ia.attname = 'org_id'
        )
    )
    select m.tbl from missing m join pol p on p.tablename = m.tbl where p.org_policies > 0
    order by m.tbl
  loop
    n := n + 1;
    offenders := offenders || case when offenders = '' then '' else ', ' end || r.tbl;
  end loop;
  if n > 0 then
    raise exception 'org_id index gap: % table(s) have an org_id RLS policy but no org_id index: %',
      n, offenders;
  end if;
  raise notice 'ok: every org_id-policied tenant table carries an org_id index';
end $$;

-- The specific hot tables the scale run measured must each have an org_id index by name, so a
-- future rename or drop is caught even if some other index happens to cover org_id.
do $$
declare t text; missing text := '';
begin
  foreach t in array array[
    'population_rows','sample_rows','test_rows','findings','observations','issues','cap_items',
    'sign_offs','plans','plan_versions','universes','notifications','report_graphs'
  ] loop
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = t and indexname = t || '_org_idx'
    ) then
      missing := missing || case when missing = '' then '' else ', ' end || t;
    end if;
  end loop;
  if missing <> '' then
    raise exception 'missing named org index on: %', missing;
  end if;
  raise notice 'ok: all 13 measured hot tables carry <table>_org_idx';
end $$;

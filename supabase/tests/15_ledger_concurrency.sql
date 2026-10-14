-- Test 15: the ledger chain is race-free. Many connections append at the same instant;
-- seq values must be unique and contiguous and the chain must verify (L5, spec §26).
-- Uses dblink so the inserts really run in parallel sessions. Advisory transaction locking in
-- chain_ledger_entry() serialises them; without it, two rows would share a seq or fork the chain.
\i supabase/tests/00_lib.sql
select provio_test.seed();

\getenv db_url TEST_SUPABASE_DB_URL
\if :{?db_url}
\else
  \set db_url postgresql:///provio_local
\endif

-- psql variables are not substituted inside a dollar-quoted body, so pass the URL through a GUC.
-- Strip whitespace first: a secret set with a trailing newline would otherwise be read as a database
-- name with a newline in it (libpq then reports database "postgres\n" does not exist).
select set_config('provio_test.db_url', regexp_replace(:'db_url', '[[:space:]]', '', 'g'), false);

do $$
declare
  -- Supabase's session-mode pooler caps concurrent clients (pool_size, 15 by default). The psql
  -- session itself holds one, so stay well under the cap. The invariant under test (seq values are
  -- unique and contiguous under concurrent appends) does not depend on the exact fan-out.
  v_n int := 10;
  v_created boolean;
begin
  begin
    create extension if not exists dblink;
    v_created := true;
  exception when others then
    v_created := false;
  end;

  if not v_created then
    raise exception 'test 15 cannot run: the dblink extension is unavailable in this database';
  end if;

  perform set_config('provio_test.n', v_n::text, false);
end $$;

do $$
declare
  n int := current_setting('provio_test.n')::int;
  conn text := current_setting('provio_test.db_url');
  i int;
  cname text;
begin
  for i in 1..n loop
    cname := 'provio_conc_' || i;
    perform dblink_connect(cname, conn);
  end loop;
  for i in 1..n loop
    cname := 'provio_conc_' || i;
    perform dblink_send_query(cname, format(
      $f$insert into ledger_entries (org_id, prev_hash, hash, payload_hash, action, payload)
         values ('a0000000-0000-0000-0000-000000000001','','','','concurrent','{"i":%s}')$f$, i));
  end loop;
  for i in 1..n loop
    cname := 'provio_conc_' || i;
    perform * from dblink_get_result(cname) as t(x text);
    perform dblink_disconnect(cname);
  end loop;
end $$;

do $$
declare
  n int := current_setting('provio_test.n')::int;
  v_count int;
  v_distinct int;
  v_min bigint;
  v_max bigint;
begin
  select count(*), count(distinct seq), min(seq), max(seq)
    into v_count, v_distinct, v_min, v_max
  from ledger_entries
  where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'concurrent';

  perform provio_test.assert_eq(v_count, n, 'all concurrent inserts landed');
  perform provio_test.assert_eq(v_distinct, n, 'every concurrent insert has a unique seq');
  perform provio_test.assert_eq(v_max - v_min, (n - 1)::bigint, 'concurrent seq values are contiguous');
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint,
    'the chain verifies after concurrent appends');
end $$;

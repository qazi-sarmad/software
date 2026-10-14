-- Test 15: the ledger chain is race-free. Fifty appends run in parallel sessions; seq values must
-- be unique and contiguous, every prev_hash must link to the row before it, and the chain must verify
-- (L5, spec §26). Uses dblink so the inserts really run in parallel sessions. Advisory transaction
-- locking in chain_ledger_entry() serialises them; without it, two rows would share a seq or fork the
-- chain.
--
-- Supabase's session-mode pooler caps concurrent clients (pool_size, 15 by default), so 50 separate
-- connections cannot be open at once. The 50 appends are instead batched: v_conns connections are
-- opened, each sends one multi-row INSERT of (50 / v_conns) rows without waiting, and all of them race
-- on the chain. The assertions cover all 50 appends.
\i supabase/tests/00_lib.sql
select provio_test.seed();

\getenv db_url TEST_SUPABASE_DB_URL
\if :{?db_url}
\else
  \set db_url postgresql:///provio_local
\endif

-- psql variables are not substituted inside a dollar-quoted body, so pass the URL through a GUC.
-- Strip whitespace first: TEST_SUPABASE_DB_URL still carries a trailing newline (the secret has not
-- been re-set yet), and libpq reads it as a database name ending in a newline (database "postgres\n").
-- Remove this once the secret is set without the newline.
select set_config('provio_test.db_url', regexp_replace(:'db_url', '[[:space:]]', '', 'g'), false);

do $$
declare
  -- The spec requires 50 concurrent appends (§26). v_conns keeps the number of simultaneously open
  -- dblink sessions under the pooler's cap; the 50 appends are batched across those connections.
  v_total int := 50;
  v_conns int := 10;
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

  perform set_config('provio_test.total', v_total::text, false);
  perform set_config('provio_test.conns', v_conns::text, false);
end $$;

do $$
declare
  total int := current_setting('provio_test.total')::int;
  conns int := current_setting('provio_test.conns')::int;
  conn text := current_setting('provio_test.db_url');
  base int := total / conns;
  rem int := total % conns;
  rows_j int;
  cname text;
  j int;
begin
  -- A pooled backend session may be reused (Supavisor session mode) and dblink connection names
  -- survive DISCARD ALL, so clear any stale names before connecting.
  for j in 1..conns loop
    cname := 'provio_conc_' || j;
    begin
      perform dblink_disconnect(cname);
    exception when others then null;
    end;
  end loop;
  for j in 1..conns loop
    cname := 'provio_conc_' || j;
    perform dblink_connect(cname, conn);
  end loop;

  -- Each connection sends one multi-row INSERT without waiting, so all `conns` statements race.
  for j in 1..conns loop
    rows_j := base + (case when j <= rem then 1 else 0 end);
    if rows_j > 0 then
      cname := 'provio_conc_' || j;
      perform dblink_send_query(cname, format(
        $f$insert into ledger_entries (org_id, prev_hash, hash, payload_hash, action, payload)
           select 'a0000000-0000-0000-0000-000000000001','','','','concurrent',
                  jsonb_build_object('conn', %s, 'k', g)
           from generate_series(1, %s) g$f$, j, rows_j));
    end if;
  end loop;

  for j in 1..conns loop
    cname := 'provio_conc_' || j;
    perform * from dblink_get_result(cname) as t(x text);
    perform dblink_disconnect(cname);
  end loop;
end $$;

do $$
declare
  n int := current_setting('provio_test.total')::int;
  v_count int;
  v_distinct int;
  v_min bigint;
  v_max bigint;
  v_broken int;
begin
  select count(*), count(distinct seq), min(seq), max(seq)
    into v_count, v_distinct, v_min, v_max
  from ledger_entries
  where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'concurrent';

  perform provio_test.assert_eq(v_count, n, 'all 50 concurrent inserts landed');
  perform provio_test.assert_eq(v_distinct, n, 'every concurrent insert has a unique seq');
  perform provio_test.assert_eq(v_max - v_min, (n - 1)::bigint, 'concurrent seq values are contiguous');

  -- Every prev_hash must equal the hash of the row with the immediately preceding seq.
  select count(*) into v_broken
  from ledger_entries e
  where e.org_id = 'a0000000-0000-0000-0000-000000000001' and e.action = 'concurrent'
    and e.prev_hash is distinct from coalesce(
      (select p.hash from ledger_entries p
        where p.org_id = e.org_id and p.seq = e.seq - 1), repeat('0', 64));

  perform provio_test.assert_eq(v_broken, 0, 'every prev_hash links to the row before it');
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint,
    'the chain verifies after 50 concurrent appends');
end $$;

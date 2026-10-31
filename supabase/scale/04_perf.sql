-- Performance at scale: measure the latency of the reads a tenant user actually makes.
\set ON_ERROR_STOP on
\i supabase/tests/00_lib.sql
\timing on
do $$
declare o record; t0 timestamptz; ms numeric; total numeric := 0; n int := 0;
  p50 numeric; arr numeric[] := '{}';
begin
  for o in select i, md5('org'||i)::uuid as org_id from generate_series(1,1000) i loop
    perform provio_test.as_user(md5('user' || o.i || '-1'), o.org_id::text, 'cia');
    t0 := clock_timestamp();
    perform count(*) from universes;
    perform count(*) from entities;
    perform count(*) from engagements;
    perform count(*) from org_members;
    perform count(*) from roles;
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    arr := arr || ms; total := total + ms; n := n + 1;
  end loop;
  select percentile_cont(0.5) within group (order by x) into p50 from unnest(arr) x;
  raise notice 'PERF: % orgs, per-org 5-read bundle: avg % ms, p50 % ms', n, round(total/n,2), round(p50,2);
end $$;
\timing off

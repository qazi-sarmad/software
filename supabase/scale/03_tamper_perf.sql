-- Tamper detection and performance at scale.
\set ON_ERROR_STOP on
\i supabase/tests/00_lib.sql

-- T1: break one ledger row in org 7 (as owner, bypassing the append-only trigger with a
-- session_replication_role override is NOT available; instead corrupt the payload so the hash
-- no longer matches, which the chain check catches). We disable the trigger for the probe only.
do $$
declare broken bigint;
begin
  reset role;
  alter table ledger_entries disable trigger ledger_entries_append_only;
  update ledger_entries set payload = '{"k": 999}' where org_id = md5('org7')::uuid and seq = 3;
  alter table ledger_entries enable trigger ledger_entries_append_only;
  perform provio_test.as_user(md5('user7-1'), md5('org7')::text, 'cia');
  broken := public.verify_ledger(md5('org7')::uuid);
  if broken is null then raise exception 'T1 FAIL: tamper not detected'; end if;
  raise notice 'T1 ok: tampered ledger detected at seq %', broken;
end $$;

-- T2: a clean neighbour org is unaffected by org 7's tamper (isolation of the alarm).
do $$
declare broken bigint;
begin
  perform provio_test.as_user(md5('user8-1'), md5('org8')::text, 'cia');
  broken := public.verify_ledger(md5('org8')::uuid);
  if broken is not null then raise exception 'T2 FAIL: clean org 8 reported broken at %', broken; end if;
  raise notice 'T2 ok: clean org 8 still verifies after org 7 tamper';
end $$;

-- Repair org 7 so later probes are clean.
do $$ begin
  reset role;
  alter table ledger_entries disable trigger ledger_entries_append_only;
  update ledger_entries set payload = '{"k": 3}' where org_id = md5('org7')::uuid and seq = 3;
  alter table ledger_entries enable trigger ledger_entries_append_only;
end $$;

-- T3: re-verify all 1000 chains after repair.
do $$
declare o record; broken bigint; failures int := 0;
begin
  for o in select i, md5('org'||i)::uuid as org_id from generate_series(1,1000) i loop
    perform provio_test.as_user(md5('user' || o.i || '-1'), o.org_id::text, 'cia');
    broken := public.verify_ledger(o.org_id);
    if broken is not null then failures := failures + 1; end if;
  end loop;
  if failures > 0 then raise exception 'T3 FAIL: % chains still broken after repair', failures; end if;
  raise notice 'T3 ok: all 1000 chains verify after repair';
end $$;

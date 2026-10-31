-- Adversarial probes at scale. Each asserts the SECURE outcome.
\set ON_ERROR_STOP on
\i supabase/tests/00_lib.sql

do $$ begin
  raise notice '== A1: anonymous sees nothing ==';
end $$;

-- A1: anon has no org claim. For each tenant table the secure outcome is EITHER 0 rows OR a
-- permission error (anon holds no table grant) - never a row.
do $$
declare t text; n bigint; total bigint := 0; denied int := 0; readable int := 0;
begin
  perform provio_test.as_anon();
  foreach t in array provio_test.org_tables() loop
    begin
      execute format('select count(*) from %I', t) into n;
      readable := readable + 1;
      total := total + n;
    exception when insufficient_privilege then
      denied := denied + 1;
    end;
  end loop;
  if total <> 0 then raise exception 'ANON LEAK: anon read % rows across tenant tables', total; end if;
  raise notice 'A1 ok: anon read 0 rows (% tables denied outright, % readable but empty)',
    denied, readable;
end $$;

-- A2: a user of org 1 cannot READ org 2's universe by id.
do $$
declare n bigint;
begin
  perform provio_test.as_user(md5('user1-1'), md5('org1')::text, 'cia');
  select count(*) into n from universes where id = md5('univ2-1')::uuid;
  if n <> 0 then raise exception 'A2 LEAK: org1 CIA read org2 universe'; end if;
  raise notice 'A2 ok: cross-org read by id returns 0 rows';
end $$;

-- A3: a user of org 1 cannot UPDATE org 2's universe.
do $$
declare n bigint;
begin
  perform provio_test.as_user(md5('user1-1'), md5('org1')::text, 'cia');
  update universes set name = 'pwned' where id = md5('univ2-1')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A3 LEAK: org1 CIA updated % rows of org2', n; end if;
  raise notice 'A3 ok: cross-org update affects 0 rows';
end $$;

-- A4: a user of org 1 cannot DELETE org 2's universe.
do $$
declare n bigint;
begin
  perform provio_test.as_user(md5('user1-1'), md5('org1')::text, 'cia');
  delete from universes where id = md5('univ2-1')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A4 LEAK: org1 CIA deleted % rows of org2', n; end if;
  raise notice 'A4 ok: cross-org delete affects 0 rows';
end $$;

-- A5: a Preparer (perform_work only) cannot read another user's org membership.
do $$
declare n bigint;
begin
  perform provio_test.as_user(md5('user1-5'), md5('org1')::text, 'preparer');
  -- own membership visible
  select count(*) into n from org_members where user_id = md5('user1-5')::uuid;
  if n <> 1 then raise exception 'A5: preparer cannot see own membership (n=%)', n; end if;
  -- other user's membership not visible
  select count(*) into n from org_members where user_id = md5('user1-9')::uuid;
  if n <> 0 then raise exception 'A5 LEAK: preparer saw another user membership'; end if;
  raise notice 'A5 ok: preparer sees only own membership';
end $$;

-- A6: ledger_entries is read-gated to cia/org_admin; a preparer sees none.
do $$
declare n bigint;
begin
  perform provio_test.as_user(md5('user1-5'), md5('org1')::text, 'preparer');
  select count(*) into n from ledger_entries;
  if n <> 0 then raise exception 'A6 LEAK: preparer read % ledger rows', n; end if;
  raise notice 'A6 ok: preparer cannot read the ledger';
end $$;

-- A7: ledger_entries is append-only. Probe as the OWNER (the strongest attacker: RLS and grants
-- are bypassed) - the append-only trigger must still refuse UPDATE and DELETE.
do $$ begin
  reset role;
  perform set_config('request.jwt.claims', '{}', false);
  perform provio_test.assert_raises(
    format('update ledger_entries set action = ''tamper'' where org_id = %L', md5('org1')),
    'append-only', 'A7a ledger row cannot be updated (owner)');
  perform provio_test.assert_raises(
    format('delete from ledger_entries where org_id = %L', md5('org1')),
    'append-only', 'A7b ledger row cannot be deleted (owner)');
end $$;

-- A8: the ledger chain verifies for every one of the 1000 orgs, each read as that org's own CIA
-- (provio_org_guard requires the caller's claim to match - the guard itself is part of the proof).
do $$
declare o record; broken bigint; checked int := 0; failures int := 0;
begin
  for o in select i, md5('org'||i)::uuid as org_id from generate_series(1,1000) i loop
    perform provio_test.as_user(md5('user' || o.i || '-1'), o.org_id::text, 'cia');
    broken := public.verify_ledger(o.org_id);
    checked := checked + 1;
    if broken is not null then
      failures := failures + 1;
      raise warning 'LEDGER BROKEN: org % at seq %', o.i, broken;
    end if;
  end loop;
  if failures > 0 then raise exception 'LEDGER: % of % org chains broken', failures, checked; end if;
  raise notice 'A8 ok: all % org ledger chains verify intact', checked;
end $$;

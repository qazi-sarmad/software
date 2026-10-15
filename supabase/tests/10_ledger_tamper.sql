-- Test 10: tampering with a ledger row makes verification fail at the tampered seq (D4, spec §26).
-- The tamper is performed by the owner with the append-only trigger disabled, which simulates
-- an out-of-band write. The verifier must still detect it.
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into ledger_entries (org_id, prev_hash, hash, payload_hash, action, payload) values
  ('a0000000-0000-0000-0000-000000000001', '', '', '', 'e2', '{"n":2}'),
  ('a0000000-0000-0000-0000-000000000001', '', '', '', 'e3', '{"n":3}');
select provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint, 'intact chain verifies');

-- Tamper with seq 2's payload.
alter table ledger_entries disable trigger ledger_entries_append_only;
update ledger_entries set payload = '{"n":"TAMPERED"}' where org_id = 'a0000000-0000-0000-0000-000000000001' and seq = 2;
alter table ledger_entries enable trigger ledger_entries_append_only;

do $$
begin
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), 2::bigint,
    'tampered payload is detected at seq 2');
end $$;

-- Repair the payload: the chain verifies again.
alter table ledger_entries disable trigger ledger_entries_append_only;
update ledger_entries set payload = '{"n":2}' where org_id = 'a0000000-0000-0000-0000-000000000001' and seq = 2;
alter table ledger_entries enable trigger ledger_entries_append_only;
select provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint, 'repaired chain verifies');

-- Tamper with the prev_hash link of seq 3: the break is reported at seq 3.
alter table ledger_entries disable trigger ledger_entries_append_only;
update ledger_entries set prev_hash = repeat('f', 64) where org_id = 'a0000000-0000-0000-0000-000000000001' and seq = 3;
alter table ledger_entries enable trigger ledger_entries_append_only;
select provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), 3::bigint,
  'a broken prev_hash link is detected at seq 3');

-- Test 9: the ledger hash chain is correct and genesis-linked (D4, spec §26).
-- Expected hashes are computed with extensions.digest directly, not with the function under test.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Canonical form: sorted keys, no whitespace, nested objects sorted too.
do $$
begin
  perform provio_test.assert_eq(
    public.canonical_payload('{"b":1,"a":"x","n":null,"arr":[3,1,2],"o":{"z":true,"y":false}}'::jsonb),
    '{"a":"x","arr":[3,1,2],"b":1,"n":null,"o":{"y":false,"z":true}}',
    'canonical payload sorts keys and removes whitespace');
  perform provio_test.assert_eq(
    public.canonical_payload('{"a":"x","b":1}'::jsonb),
    public.canonical_payload('{"b":1,"a":"x"}'::jsonb),
    'canonical payload is key-order independent');
end $$;

-- The seed wrote one ledger row per org. Verify genesis and the exact hash.
do $$
declare
  r ledger_entries;
  canonical text;
  payload_hash text;
  expected_hash text;
begin
  select * into r from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' order by seq asc limit 1;
  perform provio_test.assert_eq(r.seq, 1::bigint, 'first entry has seq 1');
  perform provio_test.assert_eq(r.prev_hash, repeat('0', 64), 'first entry links to the genesis hash of 64 zeros');

  canonical := '{"org":"A"}';
  payload_hash := encode(extensions.digest(canonical, 'sha256'), 'hex');
  expected_hash := encode(extensions.digest(r.prev_hash || payload_hash || canonical, 'sha256'), 'hex');
  perform provio_test.assert_eq(r.payload_hash, payload_hash, 'payload_hash = sha256(canonical)');
  perform provio_test.assert_eq(r.hash, expected_hash, 'hash = sha256(prev_hash || payload_hash || canonical)');
end $$;

-- Append a second entry and confirm it links to the first.
do $$
declare
  first_hash text;
  second ledger_entries;
begin
  select hash into first_hash from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001' order by seq desc limit 1;
  select * into second from public.append_ledger_entry('a0000000-0000-0000-0000-000000000001', 'second', '{"x":"y"}', null);
  perform provio_test.assert_eq(second.seq, 2::bigint, 'appended entry has seq 2');
  perform provio_test.assert_eq(second.prev_hash, first_hash, 'appended entry links to the previous hash');
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint, 'chain verifies as intact');
end $$;

-- The chain is per-org: org B is untouched by org A appends.
do $$
begin
  perform provio_test.assert_eq((select count(*) from ledger_entries where org_id = 'b0000000-0000-0000-0000-000000000001'), 1,
    'org B chain is independent of org A');
end $$;

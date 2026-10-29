-- Test 107 (S20): evidence storage. The row records where the bytes live; a verify re-derives the
-- hash from the stored bytes; the path must stay under the caller's org; the size cap is enforced; a
-- mismatch raises an integrity alert; and a row with no stored bytes is reported, not silently OK.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: register an evidence row, with the ledger entry appended after the row.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  ev uuid;
  h text := repeat('a', 64);
begin
  ev := public.register_evidence_file(
    '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1',
    'bank-confirmation.pdf',
    'a0000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-0000000000a1/bank-confirmation.pdf',
    h, 'application/pdf', 2048, 'testing');
  perform provio_test.assert_true(ev is not null, 'S20: an evidence row is registered');
  perform provio_test.assert_eq(
    (select storage_path is not null from evidence_files where id = ev), true,
    'S20: the row records where the bytes live');
  perform provio_test.assert_eq(
    (select byte_size from evidence_files where id = ev), 2048::bigint,
    'S20: the row records the byte size');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where action = 'evidence_registered'),
    'S20: the registration is ledgered');
end $$;
select provio_test.as_owner();

-- b: a path outside the caller's org prefix is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.register_evidence_file(
      '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'x.pdf',
      %L, %L, 'application/pdf', 10, 'testing')$q$, 'b0000000-0000-0000-0000-000000000001/x.pdf', repeat('b', 64)),
    'must begin with the organisation id', 'S20: a path outside the org prefix is refused');
end $$;
select provio_test.as_owner();

-- c: the size cap and the hash shape are enforced.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  p text := 'a0000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-0000000000a1/big.bin';
begin
  perform provio_test.assert_raises(
    format($q$select public.register_evidence_file(
      '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'big.bin',
      %L, %L, 'application/octet-stream', 30000000, 'testing')$q$, p, repeat('c', 64)),
    'between 1 byte and', 'S20: a file over the cap is refused');
  perform provio_test.assert_raises(
    format($q$select public.register_evidence_file(
      '50000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000a1', 'x.pdf',
      %L, 'nothex', 'application/pdf', 10, 'testing')$q$, p),
    'SHA-256 of the stored bytes', 'S20: a malformed hash is refused');
end $$;
select provio_test.as_owner();

-- d: verify re-derives and matches; a mismatch raises an alert and records the status.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  ev uuid;
  st text;
  h text := repeat('a', 64);
begin
  select id into ev from evidence_files where filename = 'bank-confirmation.pdf';
  st := public.verify_evidence_file(ev, h);
  perform provio_test.assert_eq(st, 'verified', 'S20: matching bytes verify');
  perform provio_test.assert_eq(
    (select verify_status from evidence_files where id = ev), 'verified',
    'S20: the verification status is recorded');

  st := public.verify_evidence_file(ev, repeat('d', 64));
  perform provio_test.assert_eq(st, 'mismatch', 'S20: mismatching bytes report a mismatch');
  perform provio_test.assert_true(
    exists (select 1 from integrity_alerts where kind = 'evidence_hash_mismatch'),
    'S20: a mismatch raises an integrity alert');
end $$;
select provio_test.as_owner();

-- e: a row with no stored bytes is reported as such, never silently OK. Rows are normally created by
-- register_evidence_file; this one is inserted directly to model legacy session-only evidence.
select provio_test.as_owner();
do $$
declare
  ev uuid;
begin
  insert into evidence_files (org_id, engagement_id, workpaper_id, filename, stage, content_sha256)
  values ('a0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-0000000000a1',
          '60000000-0000-0000-0000-0000000000a1', 'session-only.pdf', 'testing', repeat('e', 64))
  returning id into ev;
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  ev uuid;
  st text;
begin
  select id into ev from evidence_files where filename = 'session-only.pdf';
  st := public.verify_evidence_file(ev, repeat('e', 64));
  perform provio_test.assert_eq(st, 'no_stored_bytes',
    'S20: evidence with no stored bytes is reported, not silently verified');
end $$;
select provio_test.as_owner();

-- f: evidence_files_for returns the rows with their storage facts.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n int;
begin
  select count(*) into n from public.evidence_files_for('60000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(n, 2, 'S20: the workpaper''s evidence rows are listed');
end $$;
select provio_test.as_owner();

-- g: cross-org and anonymous refusal.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  n bigint;
begin
  select count(*) into n from evidence_files;
  perform provio_test.assert_eq(n, 0::bigint, 'S20: Org B sees no Org A evidence (RLS)');
  perform provio_test.assert_raises(
    $q$select public.register_evidence_file(
      '50000000-0000-0000-0000-0000000000a1', null, 'x.pdf',
      'b0000000-0000-0000-0000-000000000001/x.pdf', repeat('f', 64), 'application/pdf', 10, 'testing')$q$,
    'not found in this organisation', 'S20: Org B cannot register against an Org A engagement');
end $$;
select provio_test.as_owner();

select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.register_evidence_file(
      '50000000-0000-0000-0000-0000000000a1', null, 'x.pdf', 'p', repeat('f', 64), 'application/pdf', 10, 'testing')$q$,
    null, 'an anonymous caller cannot register evidence');
end $$;
select provio_test.as_owner();

-- Restore the seed (M5: no residue).
select provio_test.seed();

-- Test 6: sample rows against an unverified population fail (L3, spec §11.1).
-- Also proves the database refuses a sample that references a rejected population.
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

-- A pending population.
insert into populations (id, org_id, engagement_id, sha256, status)
values ('70000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', repeat('c',64), 'pending');

do $$
begin
  perform provio_test.assert_raises(
    $q$insert into samples (org_id, population_id, population_sha256) values ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000a9',repeat('c',64))$q$,
    'population_gate', 'sample on a pending population is rejected');

  -- Moving it to verified unlocks the sample.
  update populations set status = 'verified' where id = '70000000-0000-0000-0000-0000000000a9';
  insert into samples (id, org_id, population_id, population_sha256)
  values ('80000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-0000000000a9', repeat('c',64));
  perform provio_test.assert_eq((select count(*) from samples where id = '80000000-0000-0000-0000-0000000000a9'), 1,
    'sample on a verified population is accepted');

  -- A sample row on a sample whose population is not verified is rejected too.
  update populations set status = 'rejected' where id = '70000000-0000-0000-0000-0000000000a9';
  perform provio_test.assert_raises(
    $q$insert into sample_rows (org_id, sample_id, row_ref) values ('a0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-0000000000a9',2)$q$,
    'population_gate', 'sample row on a sample backed by a rejected population is rejected');
end $$;

select provio_test.as_owner();

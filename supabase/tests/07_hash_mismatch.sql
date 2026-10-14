-- Test 7: a sample whose population_sha256 does not match the verified population fails (L3, spec §11.1).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

do $$
begin
  -- The fixture population pop_a1 is verified with sha256 = repeat('a',64).
  perform provio_test.assert_raises(
    $q$insert into samples (org_id, population_id, population_sha256) values ('a0000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-0000000000a1','deadbeef')$q$,
    'population_gate', 'sample with a mismatched population_sha256 is rejected');

  -- A later change of the population hash invalidates an existing sample on update.
  perform provio_test.assert_raises(
    $q$update samples set population_sha256 = 'deadbeef' where id = '80000000-0000-0000-0000-0000000000a1'$q$,
    'population_gate', 'updating a sample to a mismatched hash is rejected');

  -- The correct hash still works.
  insert into samples (id, org_id, population_id, population_sha256)
  values ('80000000-0000-0000-0000-0000000000a8', 'a0000000-0000-0000-0000-000000000001',
          '70000000-0000-0000-0000-0000000000a1', repeat('a',64));
  perform provio_test.assert_eq((select count(*) from samples where id = '80000000-0000-0000-0000-0000000000a8'), 1,
    'sample with the matching population_sha256 is accepted');
end $$;

select provio_test.as_owner();

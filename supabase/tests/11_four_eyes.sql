-- Test 11: four-eyes — the same user cannot be preparer and reviewer (D3, spec §4.4).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

do $$
begin
  perform provio_test.assert_raises(
    $q$insert into sign_offs (org_id, workpaper_id, stage, preparer_id, reviewer_id) values ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','testing','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1')$q$,
    'sign_offs_four_eyes', 'a sign-off with the same preparer and reviewer is refused by the CHECK constraint');

  -- Different users are accepted.
  insert into sign_offs (org_id, workpaper_id, stage, preparer_id, reviewer_id) values
    ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','conclusion','10000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_eq(
    (select count(*) from sign_offs where workpaper_id = '60000000-0000-0000-0000-0000000000a1' and stage = 'conclusion'), 1,
    'a four-eyes sign-off with distinct users is accepted');

  -- The constraint is enforced at the database, not the client.
  perform provio_test.assert_true(
    exists (select 1 from pg_constraint where conname = 'sign_offs_four_eyes' and contype = 'c'),
    'sign_offs_four_eyes is a CHECK constraint in the database');
end $$;

select provio_test.as_owner();

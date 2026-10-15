-- Test 12: a sealed engagement is read-only; the only way to change it is reopen_engagement() (D2, spec §4.4, §10.4).
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

do $$
begin
  -- Seal A-Eng1.
  update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a1';

  -- Every mutation under the sealed engagement is refused.
  perform provio_test.assert_raises(
    $q$update workpapers set prepared = true where id = '60000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'workpaper under a sealed engagement is read-only');
  perform provio_test.assert_raises(
    $q$update observations set title = 'x' where engagement_id = '50000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'observation under a sealed engagement is read-only');
  perform provio_test.assert_raises(
    $q$update populations set control_total_cents = 1 where engagement_id = '50000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'population under a sealed engagement is read-only');
  perform provio_test.assert_raises(
    $q$update population_rows set data = '{"x":1}' where population_id = '70000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'population row under a sealed engagement is read-only');
  perform provio_test.assert_raises(
    $q$update samples set method = 'x' where population_id = '70000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'sample under a sealed engagement is read-only');
  perform provio_test.assert_raises(
    $q$update sample_rows set conclusion = 'cross' where sample_id = '80000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'sample row under a sealed engagement is read-only');
  perform provio_test.assert_raises(
    $q$update test_rows set result = 'x' where workpaper_id = '60000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'test row under a sealed engagement is read-only');

  -- sign_offs has no UPDATE policy at all: it is append-only, so the update affects 0 rows.
  update sign_offs set stage = 'conclusion' where workpaper_id = '60000000-0000-0000-0000-0000000000a1';
  perform provio_test.assert_eq(
    (select stage from sign_offs where workpaper_id = '60000000-0000-0000-0000-0000000000a1'),
    'testing', 'a sign-off cannot be updated (append-only, no UPDATE policy)');

  -- A different, unsealed engagement in the same org is unaffected.
  update workpapers set prepared = true where id = '60000000-0000-0000-0000-0000000000a2';
  perform provio_test.assert_eq(
    (select prepared from workpapers where id = '60000000-0000-0000-0000-0000000000a2'), true,
    'a workpaper under an unsealed engagement is writable');
end $$;

select provio_test.as_owner();

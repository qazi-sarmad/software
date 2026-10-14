-- Test 14: reopening a sealed engagement (D2, spec §4.4, §10.4).
-- Requires the can_reopen right and a justification of at least 10 characters; it writes
-- an activity_log row and a ledger row.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A caller without can_reopen is refused, even with a valid justification.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
select provio_test.as_owner();
update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');

do $$
begin
  perform provio_test.assert_raises(
    $q$select public.reopen_engagement('50000000-0000-0000-0000-0000000000a1','a sufficient justification')$q$,
    'can_reopen', 'a caller without can_reopen cannot reopen');
end $$;
select provio_test.as_owner();
select provio_test.assert_eq((select sealed from engagements where id = '50000000-0000-0000-0000-0000000000a1'), true,
  'the engagement is still sealed after a refused reopen');

-- A caller with can_reopen but a too-short justification is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.reopen_engagement('50000000-0000-0000-0000-0000000000a1','short')$q$,
    'at least 10 characters', 'a justification under 10 characters is refused');
end $$;
select provio_test.as_owner();
select provio_test.assert_eq((select sealed from engagements where id = '50000000-0000-0000-0000-0000000000a1'), true,
  'the engagement is still sealed after a short justification');

-- The authorised reopen succeeds and unseals.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select public.reopen_engagement('50000000-0000-0000-0000-0000000000a1', 'management requested a correction');
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq((select sealed from engagements where id = '50000000-0000-0000-0000-0000000000a1'), false,
    'the engagement is unsealed after reopen');
  perform provio_test.assert_true(
    exists (select 1 from activity_log where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'engagement_reopen' and object_id = '50000000-0000-0000-0000-0000000000a1'),
    'reopen wrote an activity_log row');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and action = 'engagement_reopen'),
    'reopen wrote a ledger row');
end $$;

-- After the reopen transaction, the sealed guard applies again.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.as_owner();
update engagements set sealed = true where id = '50000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$update workpapers set prepared = true where id = '60000000-0000-0000-0000-0000000000a1'$q$,
    'sealed_engagement', 'the sealed guard is active again after the reopen transaction ends');
end $$;
select provio_test.as_owner();

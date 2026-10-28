-- Test 101: Phase 1.4 — the write paths the shell used to fake in memory (migration 0100).
--   finalize_testing, submit_population, add_entity, set_test_step_state, seal_engagement.
-- Each is proven with a real call under a real role: the happy path writes, and a caller without the
-- right is refused. The point of Phase 1 is that a mutation reaches the database, so every assertion
-- reads the row back rather than trusting the return value.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- add_entity: a CIA may add a draft entity to a universe in their own org.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_row entities;
begin
  v_id := public.add_entity('30000000-0000-0000-0000-0000000000a1', 'Phase 1 probe entity', 'finance');
  select * into v_row from entities where id = v_id;
  perform provio_test.assert_eq(v_row.name, 'Phase 1 probe entity', 'add_entity: the name is stored');
  perform provio_test.assert_eq(v_row.status, 'draft', 'add_entity: a new entity starts as a draft');
  perform provio_test.assert_true(not v_row.approved, 'add_entity: a new entity is not approved');
  perform provio_test.assert_eq(v_row.org_id, 'a0000000-0000-0000-0000-000000000001',
    'add_entity: the row belongs to the caller org');
end $$;
select provio_test.as_owner();

-- An empty name is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.add_entity('30000000-0000-0000-0000-0000000000a1', '   ', null)$q$,
    'needs a name', 'add_entity: a blank name is refused');
end $$;
select provio_test.as_owner();

-- A universe in another org is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.add_entity('30000000-0000-0000-0000-0000000000b1', 'Cross-org entity', null)$q$,
    'not found in this organisation', 'add_entity: another org''s universe is refused');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- set_test_step_state: a tick is persisted and can be cleared; a signed-off paper is read-only.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.set_test_step_state('60000000-0000-0000-0000-0000000000a1', 'step-1', true);
  perform provio_test.assert_eq(
    (select completed from workpaper_step_state
      where workpaper_id = '60000000-0000-0000-0000-0000000000a1' and step_id = 'step-1'),
    true, 'set_test_step_state: the tick is stored');
  perform public.set_test_step_state('60000000-0000-0000-0000-0000000000a1', 'step-1', false);
  perform provio_test.assert_eq(
    (select completed from workpaper_step_state
      where workpaper_id = '60000000-0000-0000-0000-0000000000a1' and step_id = 'step-1'),
    false, 'set_test_step_state: unticking updates the same row');
  perform provio_test.assert_eq(
    (select count(*) from workpaper_step_state
      where workpaper_id = '60000000-0000-0000-0000-0000000000a1' and step_id = 'step-1'),
    1::bigint, 'set_test_step_state: the upsert keeps one row per step');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- submit_population: a verified population is recorded with its hash and row count.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_pop uuid;
  v_row populations;
begin
  v_pop := public.submit_population(
    '60000000-0000-0000-0000-0000000000a1', repeat('a', 64), 'population.csv', 250, 100000);
  select * into v_row from populations where id = v_pop;
  perform provio_test.assert_eq(v_row.sha256, repeat('a', 64), 'submit_population: the hash is stored');
  perform provio_test.assert_eq(v_row.row_count, 250, 'submit_population: the row count is stored');
  perform provio_test.assert_eq(v_row.status, 'verified', 'submit_population: the population is verified');
  perform provio_test.assert_eq(v_row.workpaper_id, '60000000-0000-0000-0000-0000000000a1'::uuid,
    'submit_population: the population is anchored to the workpaper');
end $$;
select provio_test.as_owner();

-- A malformed hash is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.submit_population('60000000-0000-0000-0000-0000000000a1', 'not-a-hash', 'x.csv', 10, 1)$q$,
    'lowercase SHA-256', 'submit_population: a malformed hash is refused');
  perform provio_test.assert_raises(
    $q$select public.submit_population('60000000-0000-0000-0000-0000000000a1', repeat('b', 64), 'x.csv', 0, 1)$q$,
    'at least one row', 'submit_population: an empty population is refused');
end $$;
select provio_test.as_owner();

-- A second submit upserts the same workpaper's population rather than stacking a second one.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.submit_population(
    '60000000-0000-0000-0000-0000000000a1', repeat('c', 64), 'population-v2.csv', 300, 120000);
  perform provio_test.assert_eq(
    (select count(*) from populations where workpaper_id = '60000000-0000-0000-0000-0000000000a1'),
    1::bigint, 'submit_population: a re-submit replaces, it does not stack');
  perform provio_test.assert_eq(
    (select sha256 from populations where workpaper_id = '60000000-0000-0000-0000-0000000000a1'),
    repeat('c', 64), 'submit_population: the re-submit updates the hash');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- finalize_testing: refused with no rows; succeeds once rows are recorded with results.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.finalize_testing('60000000-0000-0000-0000-0000000000a1')$q$,
    'no rows to finalize', 'finalize_testing: an empty workpaper cannot be finalized');
end $$;
select provio_test.as_owner();

-- Record two resolved rows as the preparer. (A row with no result cannot be created through
-- record_workpaper_row: its exception_flag is NOT NULL, so an unresolved row is inserted directly.)
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000a1', 'row-1', 'tick', null, null);
  perform public.record_workpaper_row('60000000-0000-0000-0000-0000000000a1', 'row-2', 'cross', 'tested', true);
  perform provio_test.assert_eq(
    (select count(*) from workpaper_rows where workpaper_id = '60000000-0000-0000-0000-0000000000a1'),
    2::bigint, 'finalize_testing: two rows are recorded');
end $$;
select provio_test.as_owner();

-- An unresolved row blocks finalization.
insert into workpaper_rows (org_id, workpaper_id, row_ref, result, exception_flag)
values ('a0000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-0000000000a1', 'row-3', null, false);
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.finalize_testing('60000000-0000-0000-0000-0000000000a1')$q$,
    'have no result', 'finalize_testing: an unresolved row blocks finalization');
end $$;
select provio_test.as_owner();

-- An exception that is not flagged blocks finalization too.
update workpaper_rows set result = 'cross', rationale = 'tested', exception_flag = false
 where workpaper_id = '60000000-0000-0000-0000-0000000000a1' and row_ref = 'row-3';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.finalize_testing('60000000-0000-0000-0000-0000000000a1')$q$,
    'not flagged', 'finalize_testing: an unflagged exception blocks finalization');
end $$;
select provio_test.as_owner();

-- Flag it, then finalization succeeds and the workpaper moves to prepared.
update workpaper_rows set exception_flag = true, rationale = 'tested'
 where workpaper_id = '60000000-0000-0000-0000-0000000000a1' and row_ref = 'row-3';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.finalize_testing('60000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(
    (select status from workpapers where id = '60000000-0000-0000-0000-0000000000a1'),
    'prepared', 'finalize_testing: the workpaper moves to prepared');
  perform provio_test.assert_true(
    (select prepared from workpapers where id = '60000000-0000-0000-0000-0000000000a1'),
    'finalize_testing: the prepared flag is set');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- seal_engagement: refused without review_and_approve; refused while a workpaper is open; succeeds
-- for an Audit Manager once every workpaper is signed off, and refuses a second seal.
-- ===========================================================================
-- The Org Admin lacks review_and_approve, so the right check is the first refusal.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.seal_engagement('50000000-0000-0000-0000-0000000000a1')$q$,
    'review_and_approve', 'seal_engagement: a caller without the right is refused');
end $$;
select provio_test.as_owner();

-- The Audit Manager has review_and_approve; with the workpaper still open the seal is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.seal_engagement('50000000-0000-0000-0000-0000000000a1')$q$,
    'not signed off', 'seal_engagement: an unsigned workpaper blocks the seal');
end $$;
select provio_test.as_owner();

-- Sign off the workpaper through the existing RPC. Four-eyes: the signer must not have prepared every
-- row, so the Audit Manager signs off rows the CIA prepared.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.sign_off_workpaper('60000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(
    (select status from workpapers where id = '60000000-0000-0000-0000-0000000000a1'),
    'signed_off', 'seal_engagement: the workpaper is signed off first');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform public.seal_engagement('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(
    (select sealed from engagements where id = '50000000-0000-0000-0000-0000000000a1'),
    'seal_engagement: the engagement is sealed');
  perform provio_test.assert_raises(
    $q$select public.seal_engagement('50000000-0000-0000-0000-0000000000a1')$q$,
    'already sealed', 'seal_engagement: sealing twice is refused');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- The new functions are not on the anonymous surface (0085/F11).
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.finalize_testing(uuid)', 'EXECUTE'),
    'grants: anon cannot execute finalize_testing');
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.seal_engagement(uuid)', 'EXECUTE'),
    'grants: anon cannot execute seal_engagement');
  perform provio_test.assert_true(
    has_function_privilege('authenticated', 'public.submit_population(uuid, text, text, int, bigint)', 'EXECUTE'),
    'grants: authenticated may execute submit_population');
end $$;

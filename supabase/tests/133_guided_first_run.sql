-- Test 133 (U6): the guided first run.
--
-- Two functions: `create_universe` (the first-run action, which had no write path anywhere) and
-- `get_org_data_state` (the one fact the guided empty state needs — is this organisation still
-- empty?). This proves: a member WITH edit_config can create a universe and it is org-scoped and
-- ledgered; a member WITHOUT edit_config is refused; an anonymous caller is refused at the grant;
-- and the data-state function returns COUNTS and a boolean, org-scoped, readable by any signed-in
-- member (including a scoped one who sees no rows), never a row of tenant content (Law L2).
--
-- The harness runs this file twice against the same database; the universe the test creates is
-- removed first (and the seed is restored at the end, M5).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Remove any residue from a previous run before counting.
delete from universes where name = 'U6-Guided-Universe';

-- ===========================================================================
-- 1. A caller with edit_config (the org_admin a3) creates a universe. It is org-scoped, appears in
--    the data state, and appends a ledger entry.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_id uuid;
  v_org uuid;
  v_before bigint;
  v_after bigint;
begin
  select count(*) into v_before from public.ledger_entries where action = 'config_changed';

  v_id := public.create_universe('U6-Guided-Universe', 'treasury');

  select org_id into v_org from universes where id = v_id;
  perform provio_test.assert_eq(v_org, 'a0000000-0000-0000-0000-000000000001'::uuid,
    'create_universe: the new universe belongs to the caller''s org');

  select count(*) into v_after from public.ledger_entries where action = 'config_changed';
  perform provio_test.assert_true(v_after = v_before + 1,
    'create_universe: appends exactly one config_changed ledger entry');

  perform provio_test.assert_true(
    exists (select 1 from universes where id = v_id and name = 'U6-Guided-Universe' and domain = 'treasury'),
    'create_universe: the row is written with its name and domain');
end $$;

-- ===========================================================================
-- 2. A caller WITHOUT edit_config (the auditee a7) is refused. Nothing is written.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000001', 'auditee');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_universe('Should-Not-Exist')$q$,
    'edit_config', 'create_universe: a caller without edit_config is refused');
  perform provio_test.assert_eq(
    (select count(*) from universes where name = 'Should-Not-Exist'), 0,
    'create_universe: a refused call writes no row');
end $$;

-- ===========================================================================
-- 3. An empty name is refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_universe('   ')$q$,
    'needs a name', 'create_universe: an empty name is refused');
end $$;

-- ===========================================================================
-- 4. get_org_data_state: counts and a boolean, org-scoped. Org A is populated (not empty); the
--    function is readable by a scoped member who sees no rows (the auditee).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000001', 'auditee');
do $$
declare
  v_uni int;
  v_ent int;
  v_eng int;
  v_empty boolean;
begin
  select universes, entities, engagements, is_empty
    into v_uni, v_ent, v_eng, v_empty from public.get_org_data_state();
  perform provio_test.assert_true(v_uni >= 2, 'data state: org A reports its universes');
  perform provio_test.assert_true(v_ent >= 3, 'data state: org A reports its entities');
  perform provio_test.assert_true(v_eng >= 2, 'data state: org A reports its engagements');
  perform provio_test.assert_eq(v_empty, false, 'data state: a populated org is not empty');
end $$;

-- ===========================================================================
-- 5. Org scoping: the same caller in org B sees org B's counts, never org A's.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(
    (select universes from public.get_org_data_state()), 1,
    'data state: org B reports only its own universe');
end $$;

-- ===========================================================================
-- 6. A genuinely empty org reads as empty. Build a fresh empty org (as the owner, so RLS does not
--    block the fixture) and check the boolean flips.
-- ===========================================================================
select provio_test.as_owner();
do $$
begin
  insert into orgs (id, name, is_demo) values ('c0000000-0000-0000-0000-000000000001', 'Org C empty', false)
    on conflict (id) do nothing;
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select universes from public.get_org_data_state()), 0,
    'data state: a new org reports zero universes');
  perform provio_test.assert_eq(
    (select is_empty from public.get_org_data_state()), true,
    'data state: a new org reads as empty (the guided first run)');
end $$;

-- ===========================================================================
-- 7. Anonymous is refused at the grant, for both functions.
-- ===========================================================================
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_universe('Anon')$q$,
    null, 'create_universe: an anonymous caller cannot call the function');
  perform provio_test.assert_raises(
    $q$select * from public.get_org_data_state()$q$,
    null, 'data state: an anonymous caller cannot call the function');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 8. A null org (a session with no org claim) reads as empty, never as an error.
-- ===========================================================================
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000a1"}', false);
  perform provio_test.assert_eq(
    (select is_empty from public.get_org_data_state()), true,
    'data state: a null org reads as empty, never an error');
end $$;

-- Restore the seed (M5: no residue).
select provio_test.seed();
delete from orgs where id = 'c0000000-0000-0000-0000-000000000001';
delete from universes where name = 'U6-Guided-Universe';

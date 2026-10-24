-- Test 65 (S1): the configuration-history read path (OA-17, F4, L5). A tenant member with
-- edit_config reads its own organisation's history and sees which rows a QSCorp consultant made; a
-- member without the right reads nothing; a platform admin reads nothing without an active session
-- and reads through the consultation path while one is active.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Fixture history rows (as owner): one role change, one entitlement change, one org setting.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into role_config_log (org_id, entity, entity_id, action, payload, actor, row_hash)
  values ('a0000000-0000-0000-0000-000000000001', 'role', '20000000-0000-0000-0000-0000000000a1',
          'update', jsonb_build_object('summary', 'CIA rights changed'),
          '10000000-0000-0000-0000-0000000000a3', repeat('1', 64));

  insert into tenant_entitlement_versions (org_id, entity, entity_id, action, payload, actor, row_hash)
  values ('a0000000-0000-0000-0000-000000000001', 'entitlement', 'board_pack',
          'update', jsonb_build_object('summary', 'board_pack turned on'),
          '10000000-0000-0000-0000-0000000000f0', repeat('2', 64));

  insert into config_versions (org_id, key, value, version, actor_id)
  values ('a0000000-0000-0000-0000-000000000001', 'sampling.default', '{"rate": 10}'::jsonb, 1,
          '10000000-0000-0000-0000-0000000000a3');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An Org Admin (edit_config) reads its own history, newest first, and sees the consultant flag.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_rows int;
  v_platform_rows int;
begin
  select count(*) into v_rows from public.config_history_list(100);
  perform provio_test.assert_true(v_rows >= 3, 'the Org Admin reads its organisation history');

  select count(*) into v_platform_rows from public.config_history_list(100) where actor_is_platform;
  perform provio_test.assert_eq(v_platform_rows, 1,
    'exactly the platform consultant row is flagged as platform');

  perform provio_test.assert_eq(
    (select summary from public.config_history_list(100) where entity = 'entitlement'),
    'board_pack turned on', 'the summary is carried through from the history payload');

  -- The limit is honoured and bounded.
  perform provio_test.assert_eq((select count(*) from public.config_history_list(1)), 1,
    'the limit is honoured');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A member without edit_config reads nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq((select count(*) from public.config_history_list(100)), 0,
    'a member without edit_config reads no configuration history');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A platform admin reads nothing without an active session; with an active tier 1 session it
--    reads the org it is consulting for.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  v_session uuid;
begin
  perform provio_test.assert_eq((select count(*) from public.config_history_list(100)), 0,
    'a platform admin reads no history without an active session');

  v_session := public.consultation_request('a0000000-0000-0000-0000-000000000001', 'config', 2);
  perform provio_test.assert_eq((select count(*) from public.config_history_list(100)), 0,
    'a requested (not yet active) session does not open the history');

  perform provio_test.assert_eq((select status from consultation_sessions where id = v_session),
    'requested', 'the session starts as requested');
end $$;

-- The tenant side acknowledges, which activates the session.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_session uuid;
begin
  select id into v_session from consultation_sessions
   where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'requested'
   order by requested_at desc limit 1;
  perform public.consultation_acknowledge(v_session);
  perform provio_test.assert_eq((select status from consultation_sessions where id = v_session),
    'active', 'the tenant acknowledges and the session is active');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) from public.config_history_list(100)) >= 3,
    'the consultant reads the history while its session is active');

  -- End the session; the read path closes again.
  perform public.consultation_end(
    (select id from consultation_sessions where org_id = 'a0000000-0000-0000-0000-000000000001'
       and status = 'active'), 'done');
  perform provio_test.assert_eq((select count(*) from public.config_history_list(100)), 0,
    'the history closes again once the session ends');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Another tenant's history is never visible: org B's member reads its own rows only, and never
--    the org A fixture rows.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.config_history_list(500)
      where summary in ('board_pack turned on', 'CIA rights changed')), 0,
    'a member of another organisation never reads the org A history');
  perform provio_test.assert_true(
    (select count(*) from public.config_history_list(500)) > 0,
    'the org B member does read its own organisation history');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Anon cannot execute the function at all.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.config_history_list(10)$q$,
    'permission denied', 'anon cannot read configuration history');
end $$;

select provio_test.as_owner();

-- Residue cleanup (M5): the fixtures above are inside the transaction the harness wraps this file
-- in; nothing else is written by this test.

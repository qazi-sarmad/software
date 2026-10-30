-- Test 118: Phase 6.2 — multi-org isolation under real concurrency.
--
-- Phase 6.1 proved the built app renders real database rows; this proves the tenant boundary holds
-- while many organisations read and write AT THE SAME TIME. The RLS policies resolve identity from
-- the JWT claims, and the claims are per-session state; a bug that leaked claims between pooled
-- backends, or a policy that relied on some shared mutable state, would only show up when the reads
-- overlap. Serial tests (01_org_isolation, 103_scale_isolation) cannot see that class of defect.
--
-- Method: dblink, the same tool test 15 uses. N organisations are created through the platform path,
-- then N x SESSIONS connections each assume their own org's identity and, concurrently:
--   * read their own universes (must see exactly 1),
--   * read every other org's universes (must see 0 — RLS),
--   * attempt to write another org's universe (must affect 0 rows — RLS).
-- All the send_query calls are issued before any get_result, so the statements really race.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- dblink conninfo. psql variables are not substituted inside a dollar-quoted body, so pass the URL
-- through a GUC (the same mechanism test 15 uses).
\getenv db_url TEST_SUPABASE_DB_URL
\if :{?db_url}
\else
  \set db_url postgresql:///provio_local
\endif
select set_config('provio_test.db_url', :'db_url', false);

-- One read/write probe, self-contained per call so it is safe to run on many connections at once.
-- It assumes an identity, reads its own and foreign rows, attempts a write to another org, then
-- restores the session. Returns (own, foreign, foreign_writes).
create or replace function provio_test.isolation_probe(p_sub text, p_org text, p_target text)
returns table (own int, foreign_rows int, foreign_writes int)
language plpgsql as $$
declare
  v_own int;
  v_foreign int;
  v_writes int;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_sub, 'org_id', p_org, 'user_role', 'cia', 'aal', 'aal1')::text, false);

  select count(*)::int into v_own from universes where org_id = p_org::uuid;
  select count(*)::int into v_foreign from universes where org_id <> p_org::uuid;
  update universes set name = name where org_id = p_target::uuid;
  get diagnostics v_writes = row_count;

  return query select v_own, v_foreign, v_writes;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

-- ---------------------------------------------------------------------------
-- Fixture: four organisations, each with its seven roles (platform path), one universe, entity,
-- engagement and a cia member. Fixed ids so the run is idempotent.
-- ---------------------------------------------------------------------------
do $$
declare
  i int;
  v_org uuid;
begin
  for i in 1..4 loop
    v_org := format('c0000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    insert into orgs (id, name) values (v_org, 'Concurrency Org ' || i) on conflict (id) do nothing;
  end loop;
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare
  i int;
  v_org uuid;
begin
  for i in 1..4 loop
    v_org := format('c0000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    perform public.platform_seed_org_roles(v_org);
  end loop;
end $$;

select provio_test.as_owner();
do $$
declare
  i int;
  v_org uuid;
  v_user uuid;
  v_univ uuid;
  v_ent uuid;
  v_role uuid;
begin
  for i in 1..4 loop
    v_org  := format('c0000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    v_user := format('c1000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    v_univ := format('c2000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    v_ent  := format('c3000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;

    insert into universes (id, org_id, name) values (v_univ, v_org, 'U' || i)
      on conflict (id) do nothing;
    insert into entities (id, org_id, universe_id, name, approved, status)
      values (v_ent, v_org, v_univ, 'E' || i, true, 'approved') on conflict (id) do nothing;
    insert into engagements (id, org_id, universe_id, entity_id, title)
      values (format('c4000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid, v_org, v_univ, v_ent, 'Eng' || i)
      on conflict (id) do nothing;

    select id into v_role from roles where org_id = v_org and slug = 'cia';
    insert into org_members (org_id, user_id, role_id) values (v_org, v_user, v_role)
      on conflict (org_id, user_id) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The concurrent phase. 4 orgs x 4 sessions = 16 in-flight statements.
-- ---------------------------------------------------------------------------
-- Non-vacuity: the foreign rows the sessions must NOT see really exist. Without RLS a session would
-- read 4 universes and update foreign rows; the assertions above would then fail. As owner, all four
-- fixture universes are visible.
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from universes where id in (
      'c2000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000002',
      'c2000000-0000-4000-8000-000000000003',
      'c2000000-0000-4000-8000-000000000004'))::int, 4,
    'concurrent: the four foreign universes exist (the isolation probe is non-vacuous)');
end $$;

do $$
declare
  v_orgs int := 4;
  v_sessions int := 4;
  v_conns int;
  v_cname text;
  j int;
  i int;
  v_org text;
  v_user text;
  v_target text;
  r_own int;
  r_foreign int;
  r_writes int;
begin
  begin
    create extension if not exists dblink;
  exception when others then
    raise exception 'test 118 cannot run: the dblink extension is unavailable in this database';
  end;

  v_conns := v_orgs * v_sessions;

  -- A pooled backend may be reused and dblink names survive DISCARD ALL; clear stale names first.
  for j in 1..v_conns loop
    begin
      perform dblink_disconnect('provio_conc6_' || j);
    exception when others then null;
    end;
  end loop;
  for j in 1..v_conns loop
    perform dblink_connect('provio_conc6_' || j, current_setting('provio_test.db_url'));
  end loop;

  -- Send every probe WITHOUT waiting, so all v_conns statements are in flight together.
  for j in 1..v_conns loop
    i := ((j - 1) / v_sessions) + 1;
    v_org := format('c0000000-0000-4000-8000-%s', lpad(i::text, 12, '0'));
    v_user := format('c1000000-0000-4000-8000-%s', lpad(i::text, 12, '0'));
    -- Each session tries to write the NEXT org's universe, so every org is written by a foreign
    -- session concurrently.
    v_target := format('c0000000-0000-4000-8000-%s', lpad((((i) % v_orgs) + 1)::text, 12, '0'));
    perform dblink_send_query('provio_conc6_' || j, format(
      $f$select own, foreign_rows, foreign_writes from provio_test.isolation_probe(%L, %L, %L)$f$,
      v_user, v_org, v_target));
  end loop;

  -- Collect and assert. Every session must see exactly its own row, no foreign rows, no foreign write.
  for j in 1..v_conns loop
    v_cname := 'provio_conc6_' || j;
    i := ((j - 1) / v_sessions) + 1;
    select t.own, t.foreign_rows, t.foreign_writes into r_own, r_foreign, r_writes
      from dblink_get_result(v_cname) as t(own int, foreign_rows int, foreign_writes int);
    perform provio_test.assert_eq(r_own, 1, format('concurrent: session %s sees exactly its own org''s universe', j));
    perform provio_test.assert_eq(r_foreign, 0, format('concurrent: session %s sees zero foreign universes', j));
    perform provio_test.assert_eq(r_writes, 0, format('concurrent: session %s writes zero foreign rows', j));
    perform dblink_disconnect(v_cname);
  end loop;

  raise notice 'ok: % concurrent sessions, each isolated to its own org', v_conns;
end $$;

-- No foreign write landed: every fixture universe keeps its original name.
select provio_test.as_owner();
do $$
declare
  i int;
  v_org uuid;
  v_name text;
begin
  for i in 1..4 loop
    v_org := format('c0000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    select name into v_name from universes where org_id = v_org and id = format('c2000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid;
    perform provio_test.assert_eq(v_name, 'U' || i, format('concurrent: org %s universe name is unchanged', i));
  end loop;
end $$;

-- dblink is a test tool here only. Remove it so no later test sees it (matches test 15).
drop extension if exists dblink;

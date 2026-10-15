-- Test 21: role deletion guards and the append-only configuration history (2D, spec §4.1, L5).
-- NOTE: a role change is recorded in role_config_log (migration 0014), the hash-chained role
-- history, not in config_versions. config_versions holds other configuration areas (0005).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- a: a seed role cannot be deleted.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$delete from roles where org_id = 'a0000000-0000-0000-0000-000000000001' and slug = 'observer'$q$,
    'seed roles cannot be deleted', 'a seed role cannot be deleted');
end $$;
select provio_test.as_owner();

-- b: a custom role that a member still holds cannot be deleted.
insert into roles (id, org_id, name, slug, is_seed, rights)
  values ('20000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'Custom', 'custom_x', false, '{}')
  on conflict (id) do nothing;
insert into org_members (org_id, user_id, role_id, hierarchy_level)
  values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000c1', 3)
  on conflict (org_id, user_id) do nothing;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$delete from roles where id = '20000000-0000-0000-0000-0000000000c1'$q$,
    'role is in use', 'a role a member still holds cannot be deleted');
end $$;
select provio_test.as_owner();

-- c: a permitted role change appends exactly one row to role_config_log for that organisation.
do $$
declare
  before_n bigint;
  after_n bigint;
begin
  select count(*) into before_n from role_config_log where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform set_config('provio_test.before_n', before_n::text, false);
end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
update roles set rights = '{"manage_engagements":true}'
  where id = '20000000-0000-0000-0000-0000000000c1';
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from role_config_log where org_id = 'a0000000-0000-0000-0000-000000000001'),
    current_setting('provio_test.before_n')::bigint + 1,
    'a permitted role change appends exactly one row to role_config_log');
  perform provio_test.assert_true(
    (select action from role_config_log where org_id = 'a0000000-0000-0000-0000-000000000001' order by id desc limit 1)
      in ('insert','update','delete'),
    'the appended row carries an action of insert, update or delete');
  perform provio_test.assert_eq(
    (select action from role_config_log where org_id = 'a0000000-0000-0000-0000-000000000001' order by id desc limit 1),
    'update', 'the appended row records an update');
end $$;

-- d: role_config_log is append-only; UPDATE and DELETE are refused even for the owner.
do $$
begin
  perform provio_test.assert_raises('update role_config_log set entity = ''x''', 'role_config_log is append-only',
    'an UPDATE on role_config_log is refused by the append-only trigger');
  perform provio_test.assert_raises('delete from role_config_log', 'role_config_log is append-only',
    'a DELETE on role_config_log is refused by the append-only trigger');
end $$;

-- The same append-only property protects config_versions (the other configuration history).
do $$
begin
  perform provio_test.assert_raises('update config_versions set key = ''x''', 'append_only_violation',
    'an UPDATE on config_versions is refused by the append-only trigger');
  perform provio_test.assert_raises('delete from config_versions', 'append_only_violation',
    'a DELETE on config_versions is refused by the append-only trigger');
end $$;

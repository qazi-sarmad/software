-- Test 22: the invitation cap (2E, spec §4.1). Writes go only through invite_user_capped();
-- 20 per user per day by default, a platform ceiling of 100 per organisation per day.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The caller must exist in auth.users: invite_cap_events.invited_by references it.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a3', 'a3@provio-test.invalid')
on conflict (id) do nothing;

-- a: invite_user_capped requires manage_users.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('guest@provio-test.invalid')$q$,
    'not allowed to invite users', 'a caller without manage_users cannot invite');
end $$;
select provio_test.as_owner();

-- An invalid email is refused even for a caller who holds manage_users.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('not-an-email')$q$,
    'invalid email address', 'an invalid email address is refused');
end $$;
select provio_test.as_owner();

-- b: twenty invitations by one user succeed; the twenty-first is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  i int;
begin
  for i in 1..20 loop
    perform public.invite_user_capped('guest' || i || '@provio-test.invalid');
  end loop;
  perform provio_test.assert_eq(
    (select count(*) from invite_cap_events
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and invited_by = '10000000-0000-0000-0000-0000000000a3'),
    20, 'twenty invitations by one user succeed');
end $$;
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('guest21@provio-test.invalid')$q$,
    'daily invitation limit reached for this user',
    'the twenty-first invitation by the same user is refused');
end $$;
select provio_test.as_owner();

-- c: the organisation-wide ceiling of 100 per day is enforced.
update invite_cap_settings set per_user_daily = 100 where org_id = 'a0000000-0000-0000-0000-000000000001';
insert into invite_cap_events (org_id, invited_by, email)
  select 'a0000000-0000-0000-0000-000000000001', null, 'bulk' || g || '@provio-test.invalid'
  from generate_series(1, 100) g;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('onemore@provio-test.invalid')$q$,
    'daily invitation limit reached for this organisation',
    'the organisation-wide daily ceiling is enforced');
end $$;
select provio_test.as_owner();

-- d: a direct INSERT by an application role is refused by RLS, and both tables are locked down.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into invite_cap_events (org_id, invited_by, email)
       values ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a3', 'direct@provio-test.invalid')$q$,
    'row-level security', 'a direct INSERT into invite_cap_events is refused by RLS');
end $$;
select provio_test.as_owner();

do $$
declare
  r record;
  bad text[] := '{}';
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('invite_cap_events', 'invite_cap_settings')
  loop
    perform provio_test.assert_true(r.relrowsecurity, format('RLS is enabled on %s', r.relname));
  end loop;

  for r in
    select p.polname, c.relname,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as chk
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('invite_cap_events', 'invite_cap_settings')
  loop
    if btrim(coalesce(r.qual, '')) = 'true' or btrim(coalesce(r.chk, '')) = 'true' then
      bad := array_append(bad, format('%s.%s', r.relname, r.polname));
    end if;
  end loop;
  perform provio_test.assert_eq(array_length(bad, 1), null::int,
    format('no invite-cap policy is USING (true) (offenders: %s)', coalesce(array_to_string(bad, ', '), 'none')));

  perform provio_test.assert_eq(
    (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname in ('invite_cap_events', 'invite_cap_settings') and p.polcmd = 'a'),
    0, 'neither invite-cap table has an INSERT policy');
end $$;

-- e: a user in the other organisation sees no invite-cap rows.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from invite_cap_events), 0,
    'org B sees zero invite_cap_events of org A');
  perform provio_test.assert_eq((select count(*) from invite_cap_settings
    where org_id = 'a0000000-0000-0000-0000-000000000001'), 0,
    'org B sees no org A invite_cap_settings');
end $$;
select provio_test.as_owner();

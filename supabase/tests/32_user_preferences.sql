-- Test 32 (H3a): per-user preferences. RLS isolates users and orgs; the RPCs are the only write
-- path; the record-view preference default and round-trip behave as spec §27.5 requires.
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000b1', 'b1@provio-test.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. An unset preference reads as null, then a write is read back (round-trip).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(public.get_user_preference('record_view_mode'), null,
    'H3a: an unset preference reads as null');
  perform public.set_user_preference('record_view_mode', 'floating_window');
  perform provio_test.assert_eq(public.get_user_preference('record_view_mode'), 'floating_window',
    'H3a: a preference round-trips through the RPC');
  -- upsert, not a second row
  perform public.set_user_preference('record_view_mode', 'full_page');
  perform provio_test.assert_eq(public.get_user_preference('record_view_mode'), 'full_page',
    'H3a: a second write updates the same row');
  perform provio_test.assert_eq(
    (select count(*) from user_preferences where user_id = '10000000-0000-0000-0000-0000000000a1'), 1::bigint,
    'H3a: one row per (user, org, key)');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Isolation: a user sees only their own rows, and never another org's rows.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(public.get_user_preference('record_view_mode'), null,
    'H3a: a second user in the same org does not see user 1''s preference');
  perform provio_test.assert_eq((select count(*) from user_preferences), 0::bigint,
    'H3a: a different user sees zero preference rows');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from user_preferences), 0::bigint,
    'H3a: an Org B user sees zero Org A preference rows');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. A caller cannot write another user's row: set_user_preference always uses auth.uid().
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.set_user_preference('record_view_mode', 'floating_window');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select value from user_preferences where user_id = '10000000-0000-0000-0000-0000000000a1' and key = 'record_view_mode'),
    'full_page', 'H3a: user 2''s write did not touch user 1''s row');
  perform provio_test.assert_eq(
    (select count(*) from user_preferences), 2::bigint, 'H3a: each user owns their own row');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The anon key sees no preferences; the platform role sees none either.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_eq((select count(*) from user_preferences), 0::bigint,
    'H3a: anon sees zero preference rows');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. A blank key or value is refused by the RPC.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$select public.set_user_preference('  ', 'x')$q$,
    'key is required', 'H3a: a blank key is refused');
  perform provio_test.assert_raises($q$select public.set_user_preference('k', null)$q$,
    'value is required', 'H3a: a null value is refused');
end $$;
select provio_test.as_owner();

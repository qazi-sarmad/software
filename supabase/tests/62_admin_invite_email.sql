-- Test 62 (D20): the email-based admin invite. invite_user_capped records the email and the role
-- in the cap ledger and queues the invitation copy; an unknown role is refused; the cap and the
-- right check are unchanged (§4.1, §23). The copy is honest after S3: it is queued, not "sent".
-- The acceptance path (token, single use, expiry) is test 67.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The caller must exist in auth.users: invite_cap_events.invited_by references it.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a3', 'a3@provio-test.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. An org_admin invites by email and role. The ledger row carries the email (lower-cased) and the
--    role slug, and the invitation copy is queued.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.invite_user_capped('New.Auditor@Example.test', 'audit_manager');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select email from invite_cap_events
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and invited_by = '10000000-0000-0000-0000-0000000000a3'),
    'new.auditor@example.test', 'D20: the invite ledger records the lower-cased email');
  perform provio_test.assert_eq(
    (select role_slug from invite_cap_events
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and invited_by = '10000000-0000-0000-0000-0000000000a3'),
    'audit_manager', 'D20: the invite ledger records the intended role slug');
  perform provio_test.assert_eq(
    (select count(*) from email_queue
      where org_id = 'a0000000-0000-0000-0000-000000000001'
        and status = 'pending'
        and to_addresses = array['new.auditor@example.test']
        and body_text like 'You have been invited to join Provio.%'),
    1::bigint, 'D20 fix: one pending invitation email is queued, and the copy does not claim it was sent');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An unknown role is refused and writes nothing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('x@provio-test.invalid', 'no_such_role')$q$,
    'unknown role', 'D20: an unknown role slug is refused');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from invite_cap_events where email = 'x@provio-test.invalid'),
    0::bigint, 'D20: a refused invite writes no ledger row');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A caller without manage_users is still refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('guest@provio-test.invalid', 'preparer')$q$,
    'not allowed to invite users', 'D20: a caller without manage_users cannot invite');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. An invalid email is still refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_user_capped('not-an-email', 'preparer')$q$,
    'invalid email address', 'D20: an invalid email address is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. The role argument is optional: an invitation without a role still records and queues.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.invite_user_capped('norole@provio-test.invalid');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select role_slug from invite_cap_events where email = 'norole@provio-test.invalid'),
    null::text, 'D20: an invite without a role records a null role slug');
end $$;

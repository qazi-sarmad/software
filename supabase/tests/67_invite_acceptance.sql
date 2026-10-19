-- Test 67 (S3): real invitations — the token, the single use, the expiry and the acceptance (F6, F13).
--
-- The D20 defect was copy that claimed an invitation "has been sent" while nothing had been sent and
-- no account existed. Test 62 asserts the honest copy; this test asserts the mechanism behind it:
--   * invite_user_capped records a single-use invitation whose token is stored only as a hash;
--   * the queued email carries the acceptance link and is `pending`, never `sent`;
--   * admin_accept_invite is service_role only and refuses an unknown, used, revoked or expired
--     token, and provisions the member with the invited role when the token is good;
--   * invite_status reports queued/accepted and the queue status, never "sent" before it is.
\i supabase/tests/00_lib.sql
select provio_test.seed();

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a3', 'a3@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a4', 'a4@provio-test.invalid')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. An org_admin invites. The invitation is recorded, the token is hashed and never stored in the
--    clear, and the queued message is pending and carries the link.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_id uuid;
begin
  v_id := public.invite_user_capped('real.invitee@example.test', 'preparer');
  perform provio_test.assert_true(v_id is not null, 'S3: invite_user_capped returns the invitation id');
  perform set_config('provio.test.invite_id', v_id::text, false);
end $$;
select provio_test.as_owner();

do $$
declare
  v_id uuid := current_setting('provio.test.invite_id')::uuid;
  v_body text;
begin
  perform provio_test.assert_eq(
    (select email from auth_invites where id = v_id), 'real.invitee@example.test',
    'S3: the invitation records the lower-cased email');
  perform provio_test.assert_eq(
    (select role_slug from auth_invites where id = v_id), 'preparer',
    'S3: the invitation records the intended role');
  perform provio_test.assert_eq(
    (select accepted_at from auth_invites where id = v_id), null::timestamptz,
    'S3: a fresh invitation is not accepted');
  perform provio_test.assert_true(
    (select length(token_hash) = 64 from auth_invites where id = v_id),
    'S3: the token is stored as a sha256 hex digest, never in the clear');

  -- The queued email carries the acceptance link and is pending.
  select body_text into v_body from email_queue
   where metadata ->> 'invite_id' = v_id::text order by created_at desc limit 1;
  perform provio_test.assert_true(v_body like '%/invite/accept?token=%',
    'S3: the queued email carries the acceptance link');
  perform provio_test.assert_true(v_body not like '%has been sent%',
    'S3: the copy does not claim the invitation was sent');
  perform provio_test.assert_eq(
    (select status from email_queue where metadata ->> 'invite_id' = v_id::text order by created_at desc limit 1),
    'pending', 'S3: the invitation email is queued, not sent');

  -- invite_status reports queued (the queue has not accepted it).
  perform provio_test.assert_eq(
    (select status from public.invite_status(v_id)), 'queued',
    'S3: invite_status says queued while the message is pending');

  -- The cap ledger and the invitation are one story.
  perform provio_test.assert_eq(
    (select invite_id from invite_cap_events where email = 'real.invitee@example.test'),
    v_id, 'S3: the cap event links to the invitation');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An unknown token is refused, and a tenant role cannot reach the function at all.
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_accept_invite('not-a-real-token', '10000000-0000-0000-0000-0000000000a4')$q$,
    'invitation not found', 'S3: an unknown token is refused');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  -- Execute on admin_accept_invite is granted to service_role only, so a tenant role is refused at
  -- the function boundary before the body runs.
  perform provio_test.assert_raises(
    $q$select public.admin_accept_invite('not-a-real-token', '10000000-0000-0000-0000-0000000000a4')$q$,
    'permission denied', 'S3: an org admin cannot accept an invitation either');
  perform provio_test.assert_true((select count(*) from auth_invites) >= 1,
    'S3: an org admin reads its own organisation''s invitations');
end $$;
select provio_test.as_owner();

-- Another organisation reads none of them.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from auth_invites), 0::bigint,
    'S3: another organisation reads no invitation rows');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. Acceptance with the right token provisions the member with the invited role. The function is
--    run as the database owner here; the service_role-only grant is asserted in section 2.
-- ---------------------------------------------------------------------------
-- Re-issue an invitation whose plaintext token the test knows, so acceptance can be exercised
-- without the email body. The hash is computed the same way the function does.
do $$
declare
  v_token text := 'test-token-0000000000000000000000000000000000000000000000000';
  v_id uuid;
begin
  insert into auth_invites (org_id, email, role_slug, token_hash, kind, invited_by, expires_at)
  values ('a0000000-0000-0000-0000-000000000001', 'accept.me@example.test', 'preparer',
          encode(extensions.digest(v_token, 'sha256'), 'hex'), 'member',
          '10000000-0000-0000-0000-0000000000a3', now() + interval '7 days')
  returning id into v_id;
  perform set_config('provio.test.accept_id', v_id::text, false);
  perform set_config('provio.test.accept_token', v_token, false);
end $$;

do $$
declare
  v_token text := current_setting('provio.test.accept_token');
  v_id uuid := current_setting('provio.test.accept_id')::uuid;
  r record;
begin
  select * into r from public.admin_accept_invite(v_token, '10000000-0000-0000-0000-0000000000a4');
  perform provio_test.assert_eq(r.out_org_id, 'a0000000-0000-0000-0000-000000000001'::uuid,
    'S3: acceptance returns the organisation');
  perform provio_test.assert_eq(r.out_role_slug, 'preparer', 'S3: acceptance returns the invited role');
  perform provio_test.assert_true(
    (select accepted_at is not null from auth_invites where id = v_id),
    'S3: the invitation is marked accepted');

  -- The member exists with the invited role.
  perform provio_test.assert_eq(
    (select r2.slug from org_members m join roles r2 on r2.id = m.role_id
      where m.org_id = 'a0000000-0000-0000-0000-000000000001'
        and m.user_id = '10000000-0000-0000-0000-0000000000a4'),
    'preparer', 'S3: the invitee is provisioned with the invited role');

  -- Single use: the same token is refused the second time.
  perform provio_test.assert_raises(
    $q$select public.admin_accept_invite(current_setting('provio.test.accept_token'), '10000000-0000-0000-0000-0000000000a4')$q$,
    'already been used', 'S3: an invitation can be used once');
end $$;

-- ---------------------------------------------------------------------------
-- 4. An expired invitation and a revoked invitation are refused.
-- ---------------------------------------------------------------------------
do $$
begin
  insert into auth_invites (org_id, email, role_slug, token_hash, kind, invited_by, expires_at)
  values ('a0000000-0000-0000-0000-000000000001', 'expired@example.test', 'preparer',
          encode(extensions.digest('expired-token', 'sha256'), 'hex'), 'member',
          '10000000-0000-0000-0000-0000000000a3', now() - interval '1 minute');
  insert into auth_invites (org_id, email, role_slug, token_hash, kind, invited_by, expires_at, revoked_at)
  values ('a0000000-0000-0000-0000-000000000001', 'revoked@example.test', 'preparer',
          encode(extensions.digest('revoked-token', 'sha256'), 'hex'), 'member',
          '10000000-0000-0000-0000-0000000000a3', now() + interval '7 days', now());
end $$;

do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_accept_invite('expired-token', '10000000-0000-0000-0000-0000000000a4')$q$,
    'expired', 'S3: an expired invitation is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_accept_invite('revoked-token', '10000000-0000-0000-0000-0000000000a4')$q$,
    'revoked', 'S3: a revoked invitation is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_accept_invite('   ', '10000000-0000-0000-0000-0000000000a4')$q$,
    'token is required', 'S3: an empty token is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 5. invite_status reads across the org boundary only for the platform admin.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.invite_status(current_setting('provio.test.accept_id')::uuid)$q$,
    'not allowed to read that invitation', 'S3: another organisation cannot read the invitation');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', null, 'platform_admin');
do $$
begin
  perform provio_test.assert_eq(
    (select status from public.invite_status(current_setting('provio.test.accept_id')::uuid)),
    'accepted', 'S3: the platform admin can read the invitation status');
end $$;
select provio_test.as_owner();

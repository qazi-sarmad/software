-- Test 100: SCALE-1 WP2. The three former Partial clauses.
--   §10.1  a configurable grace period before the Testing hard lock.
--   §11.4  the central pre-flight acknowledgement store (append-only, logged).
--   §2     cross-universe view-only sharing: Head authority, revocation, expiry, isolation.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- §10.1 The grace period.
-- ===========================================================================
-- A1: with the default grace of 0, the hard lock behaves exactly as before: a testing workpaper is
-- refused for an engagement whose planning is not signed off.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select testing_grace_hours from org_lifecycle_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    null, 'grace: no lifecycle row means the default grace of 0 applies');
  perform provio_test.assert_true(public.testing_lock_active('50000000-0000-0000-0000-0000000000a2'),
    'grace: with no grace the lock is active before sign-off');
  perform provio_test.assert_raises(
    $q$insert into workpapers (org_id, engagement_id, stage) values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a2','testing')$q$,
    'testing_locked', 'grace: grace 0 keeps the hard lock');
end $$;
select provio_test.as_owner();

-- A2: an Org Admin sets a grace period. The setting is saved and the lock becomes inactive for an
-- engagement inside the window, so testing is allowed without sign-off.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.admin_save_lifecycle_settings('two_stage', 'reviewer', 'reviewer', 'reviewer', false, 24);
  perform provio_test.assert_eq(
    (select testing_grace_hours from org_lifecycle_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    24, 'grace: the Org Admin saved a 24 hour grace period');
  perform provio_test.assert_eq(
    (public.lifecycle_settings_get() ->> 'testing_grace_hours')::int, 24,
    'grace: the read returns the grace period');
end $$;
select provio_test.as_owner();

-- A3: with a live grace window, a testing workpaper is allowed without planning sign-off.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(not public.testing_lock_active('50000000-0000-0000-0000-0000000000a2'),
    'grace: inside the window the lock is inactive');
  insert into workpapers (org_id, engagement_id, stage) values
    ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a2','testing');
  perform provio_test.assert_true(true, 'grace: testing is allowed inside the grace window');
end $$;
select provio_test.as_owner();

-- A4: an expired grace window restores the hard lock. The engagement's created_at is moved back
-- beyond the window, and the lock is active again.
update engagements set created_at = now() - interval '48 hours'
 where id = '50000000-0000-0000-0000-0000000000a2';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(public.testing_lock_active('50000000-0000-0000-0000-0000000000a2'),
    'grace: an expired window restores the hard lock');
end $$;
select provio_test.as_owner();

-- A5: the grace period is validated (0..336 hours).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_save_lifecycle_settings('two_stage','reviewer','reviewer','reviewer',false, -1)$q$,
    'between 0 and 336', 'grace: a negative grace period is refused');
  perform provio_test.assert_raises(
    $q$select public.admin_save_lifecycle_settings('two_stage','reviewer','reviewer','reviewer',false, 400)$q$,
    'between 0 and 336', 'grace: a grace period over the cap is refused');
end $$;
select provio_test.as_owner();

-- A6: a Preparer (no edit_config) cannot set the grace period.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_save_lifecycle_settings('two_stage','reviewer','reviewer','reviewer',false, 5)$q$,
    null, 'grace: a caller without edit_config cannot set the grace period');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- §11.4 The central pre-flight acknowledgement store.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_ack uuid;
begin
  -- A full acknowledgement is written and read back.
  v_ack := public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1',
    'exceptions_without_rationale', 'ex-1', 'Reviewed by the manager and accepted.');
  perform provio_test.assert_true(v_ack is not null, 'preflight: an acknowledgement returns an id');
  perform provio_test.assert_eq(
    (select count(*) from preflight_acks where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    1, 'preflight: the acknowledgement row exists');
  perform provio_test.assert_eq(
    jsonb_array_length(public.preflight_acks_get('50000000-0000-0000-0000-0000000000a1')),
    1, 'preflight: the read returns the live acknowledgement');
  perform provio_test.assert_eq(
    (select count(*) from activity_log where action = 'preflight_acknowledged'),
    1, 'preflight: the acknowledgement is logged to the activity log');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where action = 'preflight_acknowledged'),
    1, 'preflight: the acknowledgement is written to the ledger');

  -- A short reason is refused.
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1','unresolved_flags','f-1','too short')$q$,
    'at least 10 characters', 'preflight: a reason under 10 characters is refused');

  -- A blank reason is refused.
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1','unresolved_flags','f-1','          ')$q$,
    'at least 10 characters', 'preflight: a blank reason is refused');

  -- An unknown check key is refused by the constraint.
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1','not_a_check','x','a long enough reason')$q$,
    'check_key', 'preflight: an unknown check key is refused');

  -- An engagement in another org is not acknowledgeable.
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000b1','unresolved_flags','f-1','a long enough reason')$q$,
    'not found', 'preflight: another organisation engagement is refused');
end $$;
select provio_test.as_owner();

-- The store is append-only: a second acknowledgement for the same item adds a row, and the read
-- returns only the latest.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1',
    'exceptions_without_rationale', 'ex-1', 'A second, later reason replaces the first.');
  perform provio_test.assert_eq(
    (select count(*) from preflight_acks where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    2, 'preflight: the store keeps both rows (append-only)');
  perform provio_test.assert_eq(
    (public.preflight_acks_get('50000000-0000-0000-0000-0000000000a1') -> 0 ->> 'reason'),
    'A second, later reason replaces the first.', 'preflight: the read returns the latest reason');
end $$;
select provio_test.as_owner();

-- A caller without perform_work cannot acknowledge.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.preflight_acknowledge('50000000-0000-0000-0000-0000000000a1','unresolved_flags','f-1','a long enough reason')$q$,
    'perform_work', 'preflight: a caller without perform_work cannot acknowledge');
end $$;
select provio_test.as_owner();

-- The acknowledgement table is never visible to another organisation.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from preflight_acks), 0,
    'preflight: org B reads no org A acknowledgements');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- §2 Cross-universe view-only sharing.
-- ===========================================================================
-- S1: a member without a Head level cannot grant a share.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(public.caller_head_level(), 0, 'share: a Preparer is not a Head');
  perform provio_test.assert_raises(
    $q$select public.share_grant('30000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a2')$q$,
    'Level-1 or Level-2 Head', 'share: a non-Head cannot grant');
end $$;
select provio_test.as_owner();

-- S2: an Org Admin sets the Head flag on the Preparer (Level-1), then the Preparer can grant.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.admin_set_head_level('10000000-0000-0000-0000-0000000000a2', 1);
  perform provio_test.assert_eq(
    (select head_level from org_members where org_id = 'a0000000-0000-0000-0000-000000000001'
      and user_id = '10000000-0000-0000-0000-0000000000a2'),
    1, 'share: the Org Admin set a Level-1 Head');
  -- An Org Admin may re-set the flag (the write is a plain update, not an error).
  perform public.admin_set_head_level('10000000-0000-0000-0000-0000000000a2', 1);
  perform provio_test.assert_true(true, 'share: an Org Admin may re-set the Head flag');
end $$;
select provio_test.as_owner();

-- A Preparer cannot set the Head flag.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_set_head_level('10000000-0000-0000-0000-0000000000a1', 2)$q$,
    null, 'share: a non-admin cannot set the Head flag');
end $$;
select provio_test.as_owner();

-- S3: the now-Level-1 Head grants a view-only share of U2 to a Preparer in the same org. The grant
-- writes a notification, an email and a ledger entry.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_share uuid;
begin
  v_share := public.share_grant('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_true(v_share is not null, 'share: a Head grants a share');
  perform provio_test.assert_eq(
    (select count(*) from universe_shares where id = v_share), 1, 'share: the share row exists');
  perform provio_test.assert_eq(
    (select count(*) from notifications where event_key = 'share.granted'), 1,
    'share: the grantee receives an in-app notification');
end $$;
select provio_test.as_owner();

-- The ledger and activity rows are readable only by cia/org_admin, so they are asserted as the owner.
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where action = 'share_granted'), 1,
    'share: the grant is written to the ledger');
end $$;

-- The email is queued as pending, which the org's RLS deliberately hides from authenticated callers
-- (only sent/failed rows are visible). It is asserted as the owner.
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from email_queue where metadata ->> 'event_key' = 'share.granted'), 1,
    'share: the grant sends an email');
end $$;

-- S4: the grantee sees the shared universe's entities and engagements read-only, and the read is
-- logged. The projection returns no write path.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_share uuid;
  v_view jsonb;
  v_written int;
begin
  select id into v_share from universe_shares
   where universe_id = '30000000-0000-0000-0000-0000000000a2'
     and grantee_user_id = '10000000-0000-0000-0000-0000000000a2';
  v_view := public.shared_universe_view(v_share);
  perform provio_test.assert_eq(v_view ->> 'live', 'true', 'share: the projection is live');
  perform provio_test.assert_true(jsonb_array_length(v_view -> 'entities') >= 1,
    'share: the projection lists the shared universe entities');
  perform provio_test.assert_true(jsonb_array_length(v_view -> 'engagements') >= 1,
    'share: the projection lists the shared universe engagements');
  perform provio_test.assert_eq(
    (select count(*) from share_access_log where share_id = v_share), 1,
    'share: the read is logged');

  -- The grantee can now READ the shared universe through RLS.
  perform provio_test.assert_eq(
    (select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 1,
    'share: the grantee reads the shared universe through RLS');
  -- But a share is view-only: the grantee's write touches no row (RLS filters it out) and the
  -- universe name is unchanged.
  update universes set name = 'renamed-by-grantee' where id = '30000000-0000-0000-0000-0000000000a2';
  get diagnostics v_written = row_count;
  perform provio_test.assert_eq(v_written, 0, 'share: a share grants no write to the universe');
end $$;
select provio_test.as_owner();

-- S5: the share does NOT leak another organisation's data. Org B's CIA reads no org A share and no
-- org A universe.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universe_shares), 0,
    'share: org B reads no org A share rows');
  perform provio_test.assert_eq(
    (select count(*) from universes where org_id = 'a0000000-0000-0000-0000-000000000001'), 0,
    'share: org B reads no org A universe');
  perform provio_test.assert_raises(
    $q$select public.shared_universe_view((select id from universe_shares limit 1))$q$,
    null, 'share: org B cannot open an org A share');
end $$;
select provio_test.as_owner();

-- S6: a revoked share is invisible. The granting Head revokes; the grantee loses the projection and
-- the RLS read.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_share uuid;
begin
  select id into v_share from universe_shares
   where universe_id = '30000000-0000-0000-0000-0000000000a2'
     and grantee_user_id = '10000000-0000-0000-0000-0000000000a2';
  perform public.share_revoke(v_share, 'No longer needed for this engagement.');
  perform provio_test.assert_true(
    (select revoked_at is not null from universe_shares where id = v_share),
    'share: the share is revoked');
  perform provio_test.assert_eq(public.has_active_share('30000000-0000-0000-0000-0000000000a2'), false,
    'share: a revoked share is not active');
  -- The projection is empty and not live.
  perform provio_test.assert_eq((public.shared_universe_view(v_share) ->> 'live'), 'false',
    'share: a revoked share projects nothing');
  -- The universe is no longer readable through RLS.
  perform provio_test.assert_eq(
    (select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 0,
    'share: a revoked share is invisible through RLS');
  -- A double revoke is refused.
  perform provio_test.assert_raises(
    format($q$select public.share_revoke('%s','again and again and again')$q$, v_share),
    'already revoked', 'share: a double revoke is refused');
end $$;
select provio_test.as_owner();

do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where action = 'share_revoked'), 1,
    'share: the revocation is written to the ledger');
end $$;

-- S7: an expired share is invisible. A new share is granted with a past expiry is refused; a live
-- share moved into the past stops being active.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_share uuid;
begin
  perform provio_test.assert_raises(
    $q$select public.share_grant('30000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2', now() - interval '1 hour')$q$,
    'must be in the future', 'share: a past expiry is refused');
  -- U2 is used because the Preparer holds no scope on it: the only way to see U2 is the share.
  v_share := public.share_grant('30000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-0000000000a2', now() + interval '1 hour');
  perform provio_test.assert_eq(public.has_active_share('30000000-0000-0000-0000-0000000000a2'), true,
    'share: a live share is active');
end $$;
select provio_test.as_owner();
-- Move the share into the past. The check constraint requires expires_at > granted_at, so both
-- move together: granted two hours ago, expired one hour ago.
update universe_shares set granted_at = now() - interval '2 hours',
  expires_at = now() - interval '1 hour' where revoked_at is null;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_eq(public.has_active_share('30000000-0000-0000-0000-0000000000a2'), false,
    'share: an expired share is not active');
  perform provio_test.assert_eq(
    (select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a2'), 0,
    'share: an expired share is invisible through RLS');
end $$;
select provio_test.as_owner();

-- S8: a share is intra-organisation only. A grant naming a universe in another org is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.share_grant('30000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000a2')$q$,
    'not found', 'share: a cross-organisation grant is refused');
  perform provio_test.assert_raises(
    $q$select public.share_grant('30000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000b1')$q$,
    'not a member', 'share: a grantee outside the organisation is refused');
end $$;
select provio_test.as_owner();

-- S9: the share tables are never visible to the platform administrator.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from universe_shares), 0,
    'share: the platform admin reads no share rows');
  perform provio_test.assert_eq((select count(*) from share_access_log), 0,
    'share: the platform admin reads no share access log');
end $$;
select provio_test.as_owner();

-- S10: anon cannot reach the sharing surface.
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises('select count(*) from universe_shares', 'permission denied',
    'share: anon cannot read the share table');
  perform provio_test.assert_raises('select count(*) from preflight_acks', 'permission denied',
    'preflight: anon cannot read the acknowledgement table');
end $$;
select provio_test.as_owner();

select provio_test.as_owner();

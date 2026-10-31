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
-- §2 Sharing. The view-only intra-tenant universe share this file used to cover was replaced by
-- the corrected group / joint-audit model (migration 0102). Its positive and negative coverage now
-- lives in supabase/tests/103_group_joint_audit.sql. What stays here is the anon refusal for the
-- tables this migration owns.
-- ===========================================================================
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises('select count(*) from preflight_acks', 'permission denied',
    'preflight: anon cannot read the acknowledgement table');
  perform provio_test.assert_raises('select count(*) from engagement_joint_shares', 'permission denied',
    'share: anon cannot read the joint-share table');
  perform provio_test.assert_raises('select count(*) from org_associations', 'permission denied',
    'share: anon cannot read the association table');
end $$;
select provio_test.as_owner();

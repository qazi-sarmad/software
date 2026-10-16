-- Test 48 (6E): Email queue — queueing, the visibility rules (org sees only sent/failed; pending is
-- platform-only) and the settings column-level privacy (spec §15.5, §23).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. queue_email writes a pending row.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
declare v_id uuid;
begin
  v_id := public.queue_email('a0000000-0000-0000-0000-000000000001', array['x@a.test'],
                             'Hello', null, 'Body', jsonb_build_object('kind', 'test'));
  perform provio_test.assert_true(v_id is not null, '6E: queue_email returns a row id');
  perform provio_test.assert_eq((select status from email_queue where id = v_id), 'pending',
    '6E: a queued email is pending');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An org user does not see its own pending rows (§6E RLS).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from email_queue where status = 'pending'), 0::bigint,
    '6E: an org user does not see pending rows');
end $$;

-- ---------------------------------------------------------------------------
-- 3. An org user sees its own sent rows, and only its own.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into email_queue (org_id, to_addresses, subject, status, sent_at) values
  ('a0000000-0000-0000-0000-000000000001', array['x@a.test'], 'Sent A', 'sent', now()),
  ('b0000000-0000-0000-0000-000000000001', array['y@b.test'], 'Sent B', 'sent', now());
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq((select count(*) from email_queue), 1::bigint,
    '6E: an org user sees exactly its own sent row');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A tenant role cannot write to the queue directly (privilege revoked).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into email_queue (org_id, subject, status) values ('a0000000-0000-0000-0000-000000000001','x','sent')$q$,
    'permission denied', '6E: a tenant role cannot insert into email_queue directly');
end $$;

-- ---------------------------------------------------------------------------
-- 5. email_settings hides provider_config from tenant roles (column-level grant, 0032).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select provider_config from email_settings$q$,
    'permission denied', '6E: a tenant role cannot read provider_config');
  perform provio_test.assert_true(
    (select count(*) >= 0 from email_settings),
    '6E: a tenant role can read the non-secret provider columns');
end $$;

select provio_test.as_owner();

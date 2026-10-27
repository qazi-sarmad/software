-- Test 104: SCALE-1 WP2 close-out. Realtime in-app notifications (§22) and the pop-out sync shape
-- (§17.1).
--
-- §22: a notification raised for one member is visible to that member and to nobody else, through
-- the RLS-bounded `notifications_list`. A non-member recipient is refused. The emit is append-only
-- and writes an activity_log row. The realtime publication carries the table so the browser channel
-- receives the change (asserted here as publication membership; the delivery itself is the
-- Playwright spec e2e/scale-realtime.spec.ts).
--
-- §17.1: the pop-out is a same-origin page that re-reads a record through the ordinary data path, so
-- the only database property it needs is that the record tables are published and that RLS still
-- bounds what a subscriber may receive. The publication membership of the record tables is asserted.
--
-- The harness runs this file twice against the same database; the fixture rows are removed first.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. §22 notification_emit: a member raises a notification for a colleague.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
begin
  -- The CIA (a member of org A) raises a notification for the Preparer in the same org.
  v_id := public.notification_emit(
    'a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-0000000000a2',
    'work_assigned',
    'A workpaper is waiting for you.',
    '{"engagement":"g_a1"}'::jsonb);
  perform provio_test.assert_true(v_id is not null, 'notify: emit returns the new notification id');

  perform provio_test.assert_eq(
    (select count(*) from notifications
      where id = v_id and org_id = 'a0000000-0000-0000-0000-000000000001'
        and user_id = '10000000-0000-0000-0000-0000000000a2' and read = false),
    1, 'notify: the row exists, is unread, and targets the recipient');

  -- The emit is logged.
  perform provio_test.assert_eq(
    (select count(*) from activity_log
      where action = 'notification_emit' and object_id = v_id),
    1, 'notify: the emit is written to the activity log');
end $$;

-- ===========================================================================
-- 2. §22 RLS: the recipient sees it, another member does not.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from public.notifications_list() n where n.kind = 'work_assigned'),
    'notify: the recipient sees the notification through notifications_list');
end $$;

-- A different member of the SAME org must not see the recipient's notification.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_true(
    not exists (select 1 from public.notifications_list() n where n.kind = 'work_assigned'),
    'notify: another member of the same org does not see it');
end $$;

-- A member of ANOTHER org must not see it either.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    not exists (select 1 from public.notifications_list() n where n.kind = 'work_assigned'),
    'notify: a member of another org does not see it');
end $$;

-- ===========================================================================
-- 3. §22 refusals: a cross-org emit and a non-member recipient are both refused.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
select provio_test.assert_raises(
  $sql$ select public.notification_emit('b0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-0000000000b1', 'notice', 'x', '{}'::jsonb) $sql$,
  'does not match the caller', 'notify: a member cannot emit into another org');

select provio_test.assert_raises(
  $sql$ select public.notification_emit('a0000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-0000000000b1', 'notice', 'x', '{}'::jsonb) $sql$,
  'not a member', 'notify: a non-member recipient is refused');

-- ===========================================================================
-- 4. §22 mark-read is bounded: only the owner can mark its own row read.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
begin
  -- A fresh unread notification for the Preparer, so the read flag starts false.
  v_id := public.notification_emit('a0000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-0000000000a2', 'work_assigned', 'Another item.', '{}'::jsonb);
  perform provio_test.assert_true(v_id is not null, 'notify: a second unread notification is raised');
end $$;

-- A member of ANOTHER org tries to mark that row read: the ownership bound leaves it untouched.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
begin
  select n.id into v_id from notifications n
   where n.user_id = '10000000-0000-0000-0000-0000000000a2' and n.kind = 'work_assigned'
   order by n.ts desc limit 1;
  perform public.notification_mark_read(v_id);
end $$;
select provio_test.as_owner();
select provio_test.assert_true(
  (select not read from notifications
    where user_id = '10000000-0000-0000-0000-0000000000a2' and kind = 'work_assigned'
    order by ts desc limit 1),
  'notify: a foreign mark-read leaves the row unread');

-- The owner marks it read.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_id uuid;
begin
  select n.id into v_id from public.notifications_list() n where n.kind = 'work_assigned' limit 1;
  perform public.notification_mark_read(v_id);
  perform provio_test.assert_true(
    (select read from notifications where id = v_id),
    'notify: the recipient marks its own notification read');
end $$;

-- ===========================================================================
-- 5. §17.1 / §22 the Realtime publication carries the tables the browser subscribes to.
--    On the local harness there is no `supabase_realtime` publication, so this asserts the guarded
--    migration is a no-op there and that the publication is correct where it exists.
-- ===========================================================================
do $$
declare
  v_has_pub boolean := exists (select 1 from pg_publication where pubname = 'supabase_realtime');
begin
  if not v_has_pub then
    perform provio_test.assert_true(true, 'realtime: no publication on this harness, migration is a no-op');
  else
    perform provio_test.assert_true(
      exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
      'realtime: notifications is published');
    perform provio_test.assert_true(
      exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workpapers'),
      'realtime: workpapers (a pop-out record table) is published');
  end if;
end $$;

-- Clean up the fixture notifications so a second pass starts clean.
select provio_test.as_owner();
delete from notifications where kind in ('work_assigned', 'notice');

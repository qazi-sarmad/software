-- Test 114 (Phase 5, C3): alert delivery.
--
-- Before migration 0113 a firing monitor alert was written and enriched but delivered to nobody:
-- the escalation path writes `notifications` with `user_id = null` and a `role_target`, and
-- `notifications_list()` filters `user_id = auth.uid()`, so a role-targeted row is visible to no one
-- in the Work Queue. 0113 adds `monitor_alert_notify(org, alert_id)`, called by `alert_record`, which
-- writes one in-app notification per member holding the `review_and_approve` right (the right triage
-- requires) and queues one email per recipient that has an address.
--
-- The fixtures are the seed (00_lib.sql) plus `auth.users` rows for the two org A triagers, so the
-- email join is exercised for real. Org A's members are: a1 (cia, review_and_approve), a2 (preparer,
-- no review_and_approve), a3 (org_admin, no review_and_approve), a4 (audit_manager, review_and_approve).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- The two triagers are real accounts, so the email join resolves an address. Upsert, because
-- earlier tests in the harness may already have created these ids with a different address.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'cia@orga.test'),
  ('10000000-0000-0000-0000-0000000000a2', 'preparer@orga.test'),
  ('10000000-0000-0000-0000-0000000000a4', 'manager@orga.test')
on conflict (id) do update set email = excluded.email;

-- ===========================================================================
-- 1. Writing an alert delivers it: one in-app notification per triager, one email per triager with
--    an address, and none for a member without the triage right.
-- ===========================================================================
select provio_test.as_owner();
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert_id uuid;
begin
  v_alert_id := public.alert_record(v_org, 'mon.c3', 1, 'threshold',
    'the ledger balance is 9, which is gt the threshold 8',
    jsonb_build_array(jsonb_build_object('type', 'signal', 'id', 'ledger:x1', 'contentHash', repeat('a', 64))),
    now(), null, repeat('3', 64));

  perform provio_test.assert_true(v_alert_id is not null, 'C3: the alert is written');

  -- The two triagers (cia and audit_manager) each get one in-app notification; the preparer and the
  -- org admin do not, because neither holds review_and_approve.
  perform provio_test.assert_eq(
    (select count(*) from notifications
      where org_id = v_org and event_key = 'watcher.signal'
        and payload ->> 'alert_id' = v_alert_id::text)::int, 2,
    'C3: exactly the two review_and_approve holders are notified in-app');
  perform provio_test.assert_true(
    exists (select 1 from notifications n where n.user_id = '10000000-0000-0000-0000-0000000000a1'
              and n.payload ->> 'alert_id' = v_alert_id::text),
    'C3: the cia member is notified');
  perform provio_test.assert_true(
    exists (select 1 from notifications n where n.user_id = '10000000-0000-0000-0000-0000000000a4'
              and n.payload ->> 'alert_id' = v_alert_id::text),
    'C3: the audit_manager member is notified');
  perform provio_test.assert_true(
    not exists (select 1 from notifications n where n.user_id = '10000000-0000-0000-0000-0000000000a2'
                  and n.payload ->> 'alert_id' = v_alert_id::text),
    'C3: a member without review_and_approve is not notified');

  -- The in-app row names the alert and its reason, and is a genuine per-recipient row.
  perform provio_test.assert_true(
    (select body from notifications where user_id = '10000000-0000-0000-0000-0000000000a1'
       and payload ->> 'alert_id' = v_alert_id::text) like '%mon.c3%',
    'C3: the notification body names the rule');
  perform provio_test.assert_true(
    (select user_id is not null from notifications where payload ->> 'alert_id' = v_alert_id::text limit 1),
    'C3: the notification is addressed to a real user, not a role target');

  -- One email per recipient that has an address: cia and audit_manager.
  perform provio_test.assert_eq(
    (select count(*) from email_queue
      where org_id = v_org and metadata ->> 'event_key' = 'watcher.signal'
        and metadata ->> 'alert_id' = v_alert_id::text)::int, 2,
    'C3: one email is queued per triager with an address');
  perform provio_test.assert_true(
    exists (select 1 from email_queue
             where metadata ->> 'alert_id' = v_alert_id::text
               and to_addresses && array['cia@orga.test']::text[]),
    'C3: the cia member''s address is an email recipient');
  perform provio_test.assert_true(
    not exists (select 1 from email_queue
                 where metadata ->> 'alert_id' = v_alert_id::text
                   and to_addresses && array['preparer@orga.test']::text[]),
    'C3: a non-triager''s address is not emailed');

  -- The delivery is logged.
  perform provio_test.assert_eq(
    (select count(*) from activity_log
      where org_id = v_org and action = 'monitor_alert_notified' and object_id = v_alert_id)::int, 2,
    'C3: each delivery is written to the activity log');
end $$;

-- ===========================================================================
-- 2. The recipient sees it through notifications_list — the Work Queue read path.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from public.notifications_list() n where n.kind = 'monitor.alert'),
    'C3: the triager sees the alert notification through notifications_list');
end $$;

-- A non-triager in the same org does not see the triager's notification.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_true(
    not exists (select 1 from public.notifications_list() n where n.kind = 'monitor.alert'),
    'C3: a non-triager does not see the alert notification');
end $$;

-- ===========================================================================
-- 3. Idempotent per alert: a second notify writes nothing new.
-- ===========================================================================
select provio_test.as_owner();
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert_id uuid;
  v_before bigint;
  v_after bigint;
begin
  select id into v_alert_id from monitor_alerts where org_id = v_org and rule_id = 'mon.c3' limit 1;
  select count(*) into v_before from notifications
   where org_id = v_org and payload ->> 'alert_id' = v_alert_id::text;
  perform public.monitor_alert_notify(v_org, v_alert_id);
  select count(*) into v_after from notifications
   where org_id = v_org and payload ->> 'alert_id' = v_alert_id::text;
  perform provio_test.assert_eq(v_before, v_after,
    'C3: a second notify for the same alert writes nothing new');
end $$;

-- ===========================================================================
-- 4. An alert whose records are not tied to an engagement still delivers — the enrichment is
--    optional, the delivery is not.
-- ===========================================================================
do $$
declare
  v_org uuid := 'a0000000-0000-0000-0000-000000000001';
  v_alert_id uuid;
begin
  v_alert_id := public.alert_record(v_org, 'mon.c3.bare', 1, 'threshold',
    'no linked records', '[]'::jsonb, now(), null, repeat('4', 64));
  perform provio_test.assert_eq(
    (select count(*) from notifications
      where org_id = v_org and payload ->> 'alert_id' = v_alert_id::text)::int, 2,
    'C3: an unenriched alert is still delivered to both triagers');
end $$;

-- ===========================================================================
-- 5. Cross-organisation isolation: org B never receives org A's alert, and org B's own alert does
--    not reach org A's members.
-- ===========================================================================
select provio_test.as_owner();
do $$
declare
  v_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_b uuid := 'b0000000-0000-0000-0000-000000000001';
  v_alert_b uuid;
begin
  insert into auth.users (id, email) values ('10000000-0000-0000-0000-0000000000b1', 'cia@orgb.test')
  on conflict (id) do update set email = excluded.email;

  v_alert_b := public.alert_record(v_b, 'mon.b.c3', 1, 'threshold', 'org B alert',
    '[]'::jsonb, now(), null, repeat('5', 64));

  perform provio_test.assert_true(
    exists (select 1 from notifications n where n.org_id = v_b
              and n.payload ->> 'alert_id' = v_alert_b::text),
    'C3: org B''s alert reaches an org B member');
  perform provio_test.assert_true(
    not exists (select 1 from notifications n where n.org_id = v_a
                  and n.payload ->> 'alert_id' = v_alert_b::text),
    'C3: org B''s alert reaches no org A member');
end $$;

-- ===========================================================================
-- 6. Grants: the delivery function is service-only; no client role may call it.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    not has_function_privilege('anon', 'public.monitor_alert_notify(uuid, uuid)', 'execute'),
    'C3: anon may not call monitor_alert_notify');
  perform provio_test.assert_true(
    not has_function_privilege('authenticated', 'public.monitor_alert_notify(uuid, uuid)', 'execute'),
    'C3: a signed-in tenant may not call monitor_alert_notify');
  perform provio_test.assert_true(
    has_function_privilege('service_role', 'public.monitor_alert_notify(uuid, uuid)', 'execute'),
    'C3: service_role may call monitor_alert_notify');
end $$;

-- ===========================================================================
-- 7. The platform template for watcher.signal exists, so the email frame is defined.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_true(
    exists (select 1 from notification_templates
             where event_key = 'watcher.signal' and org_id is null),
    'C3: the platform watcher.signal notification template is seeded');
end $$;

select provio_test.as_owner();

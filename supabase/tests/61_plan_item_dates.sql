-- Test 61 (D9): update_plan_item_dates persists a reschedule, obeys the configured create right,
-- refuses an approved plan, validates the date range, and writes a new plan version (§9, L5).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixture users must exist in auth.users for the FK-carrying writes the RPC makes (activity_log
-- has no FK, but plan_items.created_by references auth.users via the RPC's auth.uid()).
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-0000000000a1', 'a1@provio-test.invalid'),
  ('10000000-0000-0000-0000-0000000000a2', 'a2@provio-test.invalid')
on conflict (id) do nothing;

-- Seed one plan item on the draft plan for org A.
insert into plan_items (id, org_id, plan_id, entity_id, title, planned_start, planned_end, status, created_by)
values ('a3000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001',
        'a2000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
        'A plan item', '2026-01-01', '2026-01-31', 'proposed', '10000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------------------
-- 1. A preparer (no manage_engagements right, which is the default create_right) is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.update_plan_item_dates('a3000000-0000-0000-0000-0000000000a1', '2026-02-01', '2026-02-28')$q$,
    'manage_engagements', 'D9: a preparer cannot reschedule a plan item');
end $$;

-- ---------------------------------------------------------------------------
-- 2. A CIA (holds manage_engagements) reschedules: the row changes and a new version is written.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_versions_before int;
begin
  select count(*) into v_versions_before from plan_versions
   where plan_id = 'a2000000-0000-0000-0000-0000000000a1';

  perform public.update_plan_item_dates('a3000000-0000-0000-0000-0000000000a1', '2026-02-01', '2026-02-28');

  perform provio_test.assert_eq(
    (select planned_start from plan_items where id = 'a3000000-0000-0000-0000-0000000000a1'),
    '2026-02-01'::date, 'D9: the start date is persisted');
  perform provio_test.assert_eq(
    (select planned_end from plan_items where id = 'a3000000-0000-0000-0000-0000000000a1'),
    '2026-02-28'::date, 'D9: the end date is persisted');
  perform provio_test.assert_eq(
    (select count(*) from plan_versions where plan_id = 'a2000000-0000-0000-0000-0000000000a1'),
    v_versions_before + 1, 'D9: the reschedule writes exactly one new plan version');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The date range is validated.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.update_plan_item_dates('a3000000-0000-0000-0000-0000000000a1', '2026-03-31', '2026-03-01')$q$,
    'end date cannot be before', 'D9: an inverted date range is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A cross-org caller cannot touch another organisation's item.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.update_plan_item_dates('a3000000-0000-0000-0000-0000000000a1', '2026-02-01', '2026-02-28')$q$,
    'not found', 'D9: a cross-org caller cannot reschedule the item');
end $$;

-- ---------------------------------------------------------------------------
-- 5. An approved plan cannot be rescheduled in place.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
update plans set status = 'approved' where id = 'a2000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.update_plan_item_dates('a3000000-0000-0000-0000-0000000000a1', '2026-02-01', '2026-02-28')$q$,
    'approved plan cannot be changed', 'D9: an approved plan cannot be rescheduled in place');
end $$;

-- ---------------------------------------------------------------------------
-- 6. An unauthenticated caller is refused.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.update_plan_item_dates('a3000000-0000-0000-0000-0000000000a1', '2026-02-01', '2026-02-28')$q$,
    null, 'D9: anon cannot call update_plan_item_dates');
end $$;
select provio_test.as_owner();

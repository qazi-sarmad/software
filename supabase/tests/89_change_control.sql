-- 89_change_control.sql — C3.2-A, spec §21.
-- Routine change applies immediately; material change waits for the configured approver and, once
-- approved, is written to the hash-chained business ledger. Cross-org refusal on both.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------- 1. A routine change applies immediately and is logged. ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_status text;
begin
  v_id := public.request_change('50000000-0000-0000-0000-0000000000a1', 'workpaper_reassign',
                                'Reassign workpaper to a team member', jsonb_build_object('workpaper_id', 'x'));
  select status into v_status from change_requests where id = v_id;
  perform provio_test.assert_eq(v_status, 'applied', 'C3.2-A: a routine change is applied immediately');
  perform provio_test.assert_true(
    exists (select 1 from activity_log where object_id = v_id and action = 'change_routine_applied'),
    'C3.2-A: the routine change is logged');
  perform provio_test.assert_true(
    exists (select 1 from automation_events where event_key = 'change.routine_applied'
            and payload ->> 'change_request_id' = v_id::text),
    'C3.2-A: the routine change emits change.routine_applied');
end $$;

-- ---------- 2. A material change waits for a different approver (four-eyes). ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare
  v_id uuid;
  v_status text;
begin
  v_id := public.request_change('50000000-0000-0000-0000-0000000000a1', 'planned_dates',
                                'Move the planned dates', '{}'::jsonb);
  select status into v_status from change_requests where id = v_id;
  perform provio_test.assert_eq(v_status, 'pending', 'C3.2-A: a material change waits for approval');
  -- The requester does not hold the approver right, so cannot decide it.
  perform provio_test.assert_raises(
    format('select public.decide_change(%L, true, %L)', v_id, 'self approval'),
    'not allowed'::text, 'C3.2-A: a user without the approver right cannot decide a change');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_status text;
  v_before int;
  v_after int;
  v_seq bigint;
begin
  select id into v_id from change_requests
   where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'pending'
   order by requested_at desc limit 1;
  select count(*) into v_before from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform public.decide_change(v_id, true, 'Dates confirmed with the manager');
  select status, ledger_seq into v_status, v_seq from change_requests where id = v_id;
  perform provio_test.assert_eq(v_status, 'approved', 'C3.2-A: the approver approves a material change');
  select count(*) into v_after from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001';
  perform provio_test.assert_eq(v_after, v_before + 1, 'C3.2-A: approval writes one hash-chained ledger entry');
  perform provio_test.assert_eq(public.verify_ledger('a0000000-0000-0000-0000-000000000001'), null::bigint,
    'C3.2-A: the ledger chain stays intact after the approval');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries where org_id = 'a0000000-0000-0000-0000-000000000001'
            and seq = v_seq and action = 'change_approved'),
    'C3.2-A: the ledger entry carries action change_approved');
end $$;

-- ---------- 3. A decided change is append-only (the guard fires even for the owner). ----------
select provio_test.as_owner();
do $$
declare
  v_id uuid;
begin
  select id into v_id from change_requests
   where org_id = 'a0000000-0000-0000-0000-000000000001' and status = 'approved' limit 1;
  perform provio_test.assert_raises(
    format('update change_requests set status = %L where id = %L', 'pending', v_id),
    'append-only'::text, 'C3.2-A: a decided change request cannot be re-opened');
end $$;

-- ---------- 4. Cross-org refusal: as an Org B user, name an Org A engagement. ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.request_change('50000000-0000-0000-0000-0000000000a1', 'scope', 'x')$q$,
    'not found in this organisation'::text, 'C3.2-A: Org B cannot raise a change on Org A engagement');
  perform provio_test.assert_eq(
    (select count(*) from change_requests where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'C3.2-A: Org B sees no Org A change requests');
end $$;

-- ---------- 5. Settings save requires edit_config and is versioned. ----------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform public.change_control_save('a0000000-0000-0000-0000-000000000001', 'review_and_approve', null, 24, null);
  perform provio_test.assert_eq(
    (select approver_right from change_control_settings where org_id = 'a0000000-0000-0000-0000-000000000001'),
    'review_and_approve', 'C3.2-A: the approver right is configurable');
  perform provio_test.assert_true(
    exists (select 1 from config_versions where org_id = 'a0000000-0000-0000-0000-000000000001'
            and key = 'change_control.settings'),
    'C3.2-A: a settings save is versioned in config_versions');
end $$;

-- A user without edit_config cannot read the settings.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select * from public.change_control_get('a0000000-0000-0000-0000-000000000001')$q$,
    'not allowed'::text, 'C3.2-A: a member without edit_config cannot read change-control settings');
end $$;

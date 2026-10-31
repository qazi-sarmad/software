-- Test 146 (integrator, final phase): no audit file can exist or be archived without a file owner.
--
-- Owner instruction 2026-10-30: "no audit file can ever be in existence or archival without any file
-- owner". Migration 0202 makes the owner an INVARIANT of an existing file, enforced on `engagements`
-- itself so every creation path is covered.
--
-- Happy path: a file created by any path is owned; the default owner is the accountable person, and
-- an explicit owner is a versioned handover; a deployer may name the owner at deployment.
-- Bad paths: a file cannot be sealed without an owner (the exact refusal is named); the owner row of
-- an existing file cannot be deleted or cleared; a file's owner cannot be named from another tenant.
--
-- The seal gate is proven by CONTRAST, so no workpaper fixture is needed: an owned file passes the
-- owner check and is refused by the next check ('no working papers to seal'), while an unowned file
-- is refused by the owner check itself ('no_file_owner'). The two refusals name different reasons,
-- which is the proof that the owner gate sits exactly where this migration claims it does.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. Every existing file is owned. The three seeded engagements were backfilled, and none is
--    marked as an unowned defect.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from engagements e
      where not exists (select 1 from engagement_file_owners f where f.engagement_id = e.id)),
    0::bigint, 'F1: no seeded audit file is without an owner');
  perform provio_test.assert_eq(
    (select count(*) from engagement_file_owners where user_id is null), 0::bigint,
    'F1: no file is marked as an unowned defect (every file has a candidate owner)');
end $$;

-- ===========================================================================
-- 2. A file created by deploy_engagement is owned by default. The deployer is the accountable
--    person, and the owner row is version 1 with the default reason.
-- ===========================================================================
insert into plans (id, org_id, universe_id, period, status, approved_at)
values ('a2000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-0000000000a1', '2026', 'approved', now());
insert into plan_items (id, org_id, plan_id, entity_id, title, planned_start, planned_end, status)
values ('a3000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001',
        'a2000000-0000-0000-0000-0000000000f1', '40000000-0000-0000-0000-0000000000a1',
        'A-E1 FY2026 owner audit', '2026-06-01', '2026-08-31', 'approved');

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  r jsonb;
  v_eng uuid;
begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
                                'a2000000-0000-0000-0000-0000000000f1', '2026', 'Owner audit');
  perform provio_test.assert_eq(r->>'outcome', 'deployed', 'F2: the file is deployed');
  v_eng := (r->>'engagement_id')::uuid;
  perform provio_test.assert_eq(
    (select user_id from engagement_file_owners where engagement_id = v_eng),
    '10000000-0000-0000-0000-0000000000a1'::uuid,
    'F2: the deployer is the file owner by default');
  perform provio_test.assert_eq(
    (select version from engagement_file_owners where engagement_id = v_eng), 1,
    'F2: the default owner is version 1');
  perform provio_test.assert_true(
    (select reason from engagement_file_owners where engagement_id = v_eng) <> '',
    'F2: the default owner records why it was named');
end $$;

-- ===========================================================================
-- 3. A deployer may name the owner at deployment (deploying on another person's behalf). The named
--    person is the owner and the handover is version 2.
-- ===========================================================================
do $$
declare
  r jsonb;
  v_eng uuid;
begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
                                'a2000000-0000-0000-0000-0000000000f1', '2026', 'Owner audit 2',
                                '10000000-0000-0000-0000-0000000000a2');
  v_eng := (r->>'engagement_id')::uuid;
  perform provio_test.assert_eq(
    (select user_id from engagement_file_owners where engagement_id = v_eng),
    '10000000-0000-0000-0000-0000000000a2'::uuid,
    'F3: the named person is the file owner');
  perform provio_test.assert_eq(
    (select version from engagement_file_owners where engagement_id = v_eng), 2,
    'F3: naming the owner over the default is a versioned handover');
end $$;

-- ===========================================================================
-- 4. BAD PATH — a deployer cannot name an owner who is not a member of the organisation.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
                                    'a2000000-0000-0000-0000-0000000000f1', '2026', 'bad owner',
                                    '10000000-0000-0000-0000-0000000000f0')
  $q$, 'member of this organisation', 'F4: a non-member cannot be named as the file owner at deployment');
end $$;

-- ===========================================================================
-- 5. The seal gate, proven by contrast. An OWNED file passes the owner check and is refused by the
--    NEXT check (no working papers); an UNOWNED file is refused by the owner check itself.
-- ===========================================================================
do $$
declare
  r jsonb;
  v_eng uuid;
begin
  r := public.deploy_engagement('30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1',
                                'a2000000-0000-0000-0000-0000000000f1', '2026', 'Seal owner audit');
  v_eng := (r->>'engagement_id')::uuid;
  perform provio_test.assert_raises($q$
    select public.seal_engagement((select id from engagements where title = 'Seal owner audit'))
  $q$, 'there are no working papers to seal',
    'F5: an owned file passes the owner check and is refused by the next check');
end $$;

-- An unowned file cannot be produced by any product path (the trigger names an owner, and the guard
-- refuses to clear one). It is staged here with the invariant trigger disabled for THIS TRANSACTION
-- ONLY (`session_replication_role` is transaction-local, so it reverts even if the block fails —
-- no global state is ever left behind for another test file). The seal refusal itself is then proven.
select provio_test.as_owner();
do $$
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into engagements (id, org_id, universe_id, entity_id, title)
  values ('50000000-0000-0000-0000-0000000000f9', 'a0000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', 'Unowned file');
  perform provio_test.assert_eq(
    (select count(*) from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000f9'),
    0::bigint, 'F5: the staged file has no owner (the invariant was suspended to stage it)');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.seal_engagement('50000000-0000-0000-0000-0000000000f9')
  $q$, 'no_file_owner', 'F5: an audit file cannot be sealed without a file owner');
end $$;

-- ===========================================================================
-- 6. BAD PATH — the owner of an existing file cannot be removed. Two layers refuse it: an end user
--    has no table privilege at all, and the guard trigger refuses the removal even for the owner.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    delete from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000a1'
  $q$, 'permission denied', 'F6: an end user cannot delete a file owner row (no table privilege)');
  perform provio_test.assert_raises($q$
    update engagement_file_owners set user_id = null where engagement_id = '50000000-0000-0000-0000-0000000000a1'
  $q$, 'permission denied', 'F6: an end user cannot clear a file owner row (no table privilege)');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises($q$
    delete from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000a1'
  $q$, 'file_owner_required', 'F6: the guard refuses to delete the owner of an existing file');
  perform provio_test.assert_raises($q$
    update engagement_file_owners set user_id = null where engagement_id = '50000000-0000-0000-0000-0000000000a1'
  $q$, 'file_owner_required', 'F6: the guard refuses to clear the owner of an existing file');
end $$;

-- The staged unowned file can be repaired by naming a person, which resolves the defect marker.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.engagement_file_owner_set('50000000-0000-0000-0000-0000000000f9',
                                           '10000000-0000-0000-0000-0000000000a2', null, 'repairing the defect');
end $$;
do $$
begin
  perform provio_test.assert_eq(
    (select user_id from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000f9'),
    '10000000-0000-0000-0000-0000000000a2'::uuid, 'F6: naming a person repairs an unowned file');
  perform provio_test.assert_true(
    not (select backfill_required from engagement_file_owners where engagement_id = '50000000-0000-0000-0000-0000000000f9'),
    'F6: naming a person resolves the unowned defect marker');
end $$;

-- ===========================================================================
-- 7. The audit reader names the owner of every file and flags an unowned one. Org B sees only its
--    own file; it can never name an owner on org A's file.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from public.engagement_owner_audit_list() where owner_user_id is null and not backfill_required),
    0::bigint, 'F7: no live file is unowned');
  perform provio_test.assert_true(
    exists (select 1 from public.engagement_owner_audit_list()
             where engagement_id = '50000000-0000-0000-0000-0000000000f9' and owner_user_id is not null),
    'F7: the repaired file shows its owner');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.engagement_file_owner_set('50000000-0000-0000-0000-0000000000a1',
                                            '10000000-0000-0000-0000-0000000000b1', null, 'cross tenant')
  $q$, 'engagement not found in this organisation',
    'F7: org B cannot name an owner on org A''s file');
  perform provio_test.assert_eq(
    (select count(*) from public.engagement_owner_audit_list()
      where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    0::bigint, 'F7: org B sees none of org A''s files in the owner audit');
end $$;

select provio_test.as_owner();

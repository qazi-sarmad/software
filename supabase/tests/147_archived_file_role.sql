-- Test 147 (integrator, final phase): a permanently configurable role owns an archived file.
--
-- Owner instruction: "for archived files add a permanently configurable role." An archived file
-- outlives the person who owned it, so its custodian is a role the organisation chooses, and that
-- choice is versioned, audited and never deleted.
--
-- Happy path: the default custodian is `cia`; a change is versioned and audited; every archive is
-- stamped with the custodian in force; the reader names it.
-- Bad paths: an unknown role is refused; a short reason is refused; a caller without manage_roles is
-- refused; the configuration cannot be deleted or cleared; org B never sees org A's configuration.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. The default. Every organisation has a custodian even before it visits the screen.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select role_slug from public.archived_file_role_get()), 'cia',
    'R1: the default custodian role is cia');
  perform provio_test.assert_true(
    (select is_default from public.archived_file_role_get()),
    'R1: an organisation with no row reports the platform default');
  perform provio_test.assert_eq(
    (select role_name from public.archived_file_role_get()), 'CIA',
    'R1: the reader names the role');
end $$;

-- ===========================================================================
-- 2. A change is versioned and audited. It never replaces the row.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_eq(
    public.archived_file_role_set('audit_manager', 'the custodian moves to the audit manager'),
    1, 'R2: the first explicit change is version 1');
  perform provio_test.assert_eq(
    public.archived_file_role_set('reviewer', 'the reviewer now holds archived files'),
    2, 'R2: a second change bumps the version');
  perform provio_test.assert_eq(
    (select role_slug from public.archived_file_role_get()), 'reviewer',
    'R2: the effective custodian is the latest choice');
  perform provio_test.assert_eq(
    (select count(*) from public.archived_file_role where org_id = 'a0000000-0000-0000-0000-000000000001'),
    1::bigint, 'R2: one configuration row per organisation');
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'archived_file_custodian_changed'),
    2::bigint, 'R2: every change is appended to the ledger');
end $$;

-- ===========================================================================
-- 3. The archive carries the custodian in force. The effect is real, not echoed: change the
--    configuration, then archive, and the archive names the new custodian.
-- ===========================================================================
-- A population with working rows in org A (the population gate requires rows and a SHA-256).
insert into populations (id, org_id, engagement_id, sha256, row_count, status)
values ('c2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', repeat('ab', 32), 2, 'pending')
on conflict (id) do update set sha256 = excluded.sha256, status = 'pending';
insert into population_rows (org_id, population_id, row_ref, data) values
  ('a0000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 1, '{"a": 1}'::jsonb),
  ('a0000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 2, '{"a": 2}'::jsonb)
on conflict do nothing;
update populations set status = 'verified'
 where id = 'c2000000-0000-0000-0000-000000000001';

do $$
declare
  v_id uuid;
begin
  v_id := public.archive_population('c2000000-0000-0000-0000-000000000001');
  perform provio_test.assert_true(v_id is not null, 'R3: the population is archived');
  perform provio_test.assert_eq(
    (select custodian_role_slug from population_archives where id = v_id), 'reviewer',
    'R3: the archive is stamped with the custodian in force');
  perform provio_test.assert_eq(
    (select custodian_role_slug from public.archived_file_custodians() where archive_id = v_id), 'reviewer',
    'R3: the reader reports the custodian of the archived file');
  perform provio_test.assert_eq(
    (select custodian_role_name from public.archived_file_custodians() where archive_id = v_id), 'Reviewer',
    'R3: the reader names the custodian role');
end $$;

-- ===========================================================================
-- 4. BAD PATH — an unknown role, a short reason, and a caller without manage_roles are refused.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises($q$
    select public.archived_file_role_set('not_a_role', 'a role that does not exist here')
  $q$, 'unknown role', 'R4: an unknown role is refused');
  perform provio_test.assert_raises($q$
    select public.archived_file_role_set('preparer', 'short')
  $q$, 'reason of at least 10 characters', 'R4: a short reason is refused');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises($q$
    select public.archived_file_role_set('preparer', 'a preparer cannot change the custodian')
  $q$, 'manage_roles', 'R4: a caller without manage_roles is refused');
end $$;

-- ===========================================================================
-- 5. BAD PATH — the configuration cannot be deleted or cleared (privilege layer, then guard).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises($q$
    delete from archived_file_role where org_id = 'a0000000-0000-0000-0000-000000000001'
  $q$, 'permission denied', 'R5: an end user cannot delete the custodian configuration');
  perform provio_test.assert_raises($q$
    update archived_file_role set role_slug = '' where org_id = 'a0000000-0000-0000-0000-000000000001'
  $q$, 'permission denied', 'R5: an end user cannot clear the custodian configuration');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises($q$
    delete from archived_file_role where org_id = 'a0000000-0000-0000-0000-000000000001'
  $q$, 'archived_file_role_required', 'R5: the guard refuses to delete the custodian configuration');
  perform provio_test.assert_raises($q$
    update archived_file_role set role_slug = '' where org_id = 'a0000000-0000-0000-0000-000000000001'
  $q$, 'archived_file_role_required', 'R5: the guard refuses to clear the custodian configuration');
end $$;

-- ===========================================================================
-- 6. ISOLATION — org B has its own configuration and never sees org A's.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select role_slug from public.archived_file_role_get()), 'cia',
    'R6: org B has its own default custodian, not org A''s choice');
  perform provio_test.assert_eq(
    (select count(*) from public.archived_file_role where org_id = 'a0000000-0000-0000-0000-000000000001'),
    0::bigint, 'R6: org B sees none of org A''s configuration');
  perform provio_test.assert_eq(
    (select count(*) from public.archived_file_custodians()
      where archive_id = 'c2000000-0000-0000-0000-000000000001'),
    0::bigint, 'R6: org B sees none of org A''s archived files');
end $$;

select provio_test.as_owner();

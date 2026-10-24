-- Test 47 (6D): CAP register — the §16.2 status vocabulary, mandatory evidence, reviewer closure, the
-- hash-chained ledger entry and the report/CAP reconciliation (§16.3).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- A CAP for a finding of A-Eng1, inserted as the owner.
insert into caps (id, org_id, finding_id, responsible_dept, due_date, status) values
  ('c0000000-0000-0000-0000-0000000000d1','a0000000-0000-0000-0000-000000000001',
   (select id from findings where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
   'Finance', current_date + 30, 'open');

-- ---------------------------------------------------------------------------
-- 1. update_cap moves an open CAP to unverified (§16.2).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform public.update_cap('c0000000-0000-0000-0000-0000000000d1', 'Reconciled the ledger', 'Evidence pack 1');
  perform provio_test.assert_eq(
    (select status from caps where id = 'c0000000-0000-0000-0000-0000000000d1'), 'unverified',
    '6D: an updated CAP awaits review');
end $$;

-- ---------------------------------------------------------------------------
-- 2. close_cap requires review_and_approve (rights, not role names).
-- ---------------------------------------------------------------------------
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.close_cap('c0000000-0000-0000-0000-0000000000d1', true, false)$q$,
    'review_and_approve', '6D: a caller without review_and_approve cannot close a CAP');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A reviewer closes it verified; the status and a ledger entry follow (§16.2).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_status text;
begin
  v_status := public.close_cap('c0000000-0000-0000-0000-0000000000d1', true, false);
  perform provio_test.assert_eq(v_status, 'verified_closed', '6D: a verified close is verified_closed');
  perform provio_test.assert_true(
    (select verified_at is not null and verified_by is not null from caps
      where id = 'c0000000-0000-0000-0000-0000000000d1'),
    '6D: the close records the verifier and the time');
end $$;

-- The ledger is visible only to cia/org_admin, so read it as cia.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'cap_closed'),
    '6D: the close writes a hash-chained ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A delayed verified close is verified_closed_delay (§16.2).
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into caps (id, org_id, finding_id, responsible_dept, due_date, action_description,
                  remediation_evidence, status) values
  ('c0000000-0000-0000-0000-0000000000d2','a0000000-0000-0000-0000-000000000001',
   (select id from findings where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
   'Finance', current_date - 5, 'Done late', 'Evidence pack 2', 'unverified');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(public.close_cap('c0000000-0000-0000-0000-0000000000d2', true, true),
    'verified_closed_delay', '6D: a delayed verified close is verified_closed_delay');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Verified closure without evidence is refused by the CHECK (§16.2 "mandatory").
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises(
    $q$insert into caps (org_id, finding_id, responsible_dept, due_date, status, verified_at, verified_by)
       values ('a0000000-0000-0000-0000-000000000001',
               (select id from findings where org_id = 'a0000000-0000-0000-0000-000000000001' limit 1),
               'Finance', current_date, 'verified_closed', now(), gen_random_uuid())$q$,
    'caps_verified_evidence_chk', '6D: verified closure without evidence is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reconciliation: a report finding without a CAP row fails the check (§16.3).
-- ---------------------------------------------------------------------------
-- Compose a report for A-Eng1 (requires a signed Conclusion).
select provio_test.as_owner();
insert into workpaper_rows (org_id, workpaper_id, row_ref, result) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','tick');
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid;
begin
  v_version := public.compose_report('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(public.check_cap_reconciliation(v_version), true,
    '6D: reconciliation passes when every report finding has a matching CAP');
end $$;

-- Add a finding with no CAP row, recompose, and the reconciliation fails.
select provio_test.as_owner();
insert into findings (id, org_id, entity_id, severity) values
  ('f0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001',
   (select entity_id from engagements where id = '50000000-0000-0000-0000-0000000000a1'), 'high');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v_version uuid;
begin
  v_version := public.compose_report('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq(public.check_cap_reconciliation(v_version), false,
    '6D: reconciliation fails when a report finding has no CAP row');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Another organisation reads no CAP rows.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from caps), 0::bigint,
    '6D: another organisation reads no CAP rows');
end $$;

select provio_test.as_owner();

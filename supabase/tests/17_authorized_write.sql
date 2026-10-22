-- Test 17: positive control — an authorised user can write within its own org and scope.
-- Isolation tests are only meaningful if the allowed path still works.
\i supabase/tests/00_lib.sql
select provio_test.seed();
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

do $$
begin
  insert into universes (id, org_id, name) values ('30000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000001', 'A-U9');
  perform provio_test.assert_eq((select count(*) from universes where id = '30000000-0000-0000-0000-0000000000a9'), 1,
    'cia_A can INSERT a universe in its own org');

  -- Audit 2026-10-23: engagements are created only by deploy_engagement (spec §7). A direct insert,
  -- even by the CIA in its own org, is refused; the gated path is tested in 92_hardening.sql.
  perform provio_test.assert_raises(
    $q$insert into engagements (id, org_id, universe_id, entity_id, title) values ('50000000-0000-0000-0000-0000000000a9', 'a0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-0000000000a9', '40000000-0000-0000-0000-0000000000a1', 'A-Eng9')$q$,
    'permission denied', 'cia_A cannot INSERT an engagement directly (deploy_engagement is the only path)');
end $$;

-- An explicit org_id that matches the claim is accepted; the row is readable afterwards.
select provio_test.as_owner();
select provio_test.assert_eq((select count(*) from universes where name = 'A-U9'), 1, 'the new universe persisted');

-- Audit trail: activity_log and ledger accept appends through authorised paths.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  insert into activity_log (org_id, action, object_type) values ('a0000000-0000-0000-0000-000000000001', 'create', 'universe');
  perform provio_test.assert_true(true, 'cia_A can append to activity_log');
end $$;
select provio_test.as_owner();

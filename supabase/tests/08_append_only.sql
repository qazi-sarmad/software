-- Test 8: the append-only tables are protected by two independent layers:
--   layer 1 — application roles hold no UPDATE/DELETE privilege (D5);
--   layer 2 — a trigger refuses the write even for a role that has the privilege.
-- A database owner or superuser can always alter schema or disable a trigger; that is
-- outside the application threat model.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Layer 1: privileges.
do $$
declare
  t text;
  r text;
begin
  foreach t in array array['ledger_entries', 'activity_log', 'config_versions', 'plan_versions'] loop
    foreach r in array array['authenticated', 'anon'] loop
      perform provio_test.assert_true(not has_table_privilege(r, t, 'UPDATE'), format('%s has no UPDATE privilege on %s', r, t));
      perform provio_test.assert_true(not has_table_privilege(r, t, 'DELETE'), format('%s has no DELETE privilege on %s', r, t));
    end loop;
  end loop;
  perform provio_test.assert_true(not has_table_privilege('authenticated', 'ledger_entries', 'INSERT'),
    'authenticated has no INSERT privilege on ledger_entries');
  perform provio_test.assert_true(not has_table_privilege('authenticated', 'reopen_grants', 'INSERT'),
    'authenticated has no INSERT privilege on reopen_grants');
end $$;

-- Layer 1 in practice: an application role is refused with a permission error.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises('update ledger_entries set org_id = org_id', 'permission denied',
    'cia_A UPDATE on ledger_entries is refused by privilege');
  perform provio_test.assert_raises('delete from ledger_entries', 'permission denied',
    'cia_A DELETE on ledger_entries is refused by privilege');
end $$;
select provio_test.as_owner();

-- Layer 2: the trigger, exercised as the owner which does hold the privilege.
do $$
declare
  t text;
begin
  foreach t in array array['ledger_entries', 'activity_log', 'config_versions', 'plan_versions'] loop
    perform provio_test.assert_raises(format('update %I set org_id = org_id', t), 'append_only_violation',
      format('owner UPDATE on %s is refused by the append-only trigger', t));
    perform provio_test.assert_raises(format('delete from %I', t), 'append_only_violation',
      format('owner DELETE on %s is refused by the append-only trigger', t));
  end loop;
end $$;

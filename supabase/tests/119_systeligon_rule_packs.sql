-- 119: Systeligon rule packs (S10/S11, 0117). Packs are versioned, append-only, signed, and an
--      unverifiable save is refused AND logged — the refusal is returned as {ok:false, reason}, not
--      raised, because a RAISE would roll back the row that records the refusal.
--   * RLS on both tables; no direct write from a tenant; isolation between organisations.
--   * A save needs the feature, the edit_config right and a registered, unretired key.
--   * A shipped version is immutable; a change is a new version.
--   * rule_pack_list returns the newest version per name, own-org only.
-- M5: fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. RLS is on for both tables; no direct write from a tenant.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n int;
  v_n int;
begin
  foreach t in array array['rule_packs', 'rule_pack_refusals'] loop
    select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relname = t and c.relrowsecurity;
    perform provio_test.assert_eq(n, 1, format('RLS is enabled on %s', t));
    select count(*) into v_n from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = t
        and g.grantee in ('anon', 'authenticated', 'public')
        and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE');
    perform provio_test.assert_eq(v_n, 0, format('%s takes no direct write from a tenant', t));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A key is provisioned by the platform path (as 101 does), then a pack is saved.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$ begin
  insert into signing_keys (org_id, scope, key_id, public_key)
  values ('a0000000-0000-0000-0000-000000000001', 'org', 'rule-key-1', 'PUBKEY');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.rule_pack_save('audit-default', 1, 'population',
    '[{"id":"numeric.duplicates","version":1,"kind":"duplicates"}]'::jsonb,
    repeat('a', 64), 'rule-key-1', repeat('c', 128), now(), true);
  perform provio_test.assert_eq((v ->> 'ok'), 'true', 'pack: a signed pack saves and returns ok');
  perform provio_test.assert_eq(
    (select released from rule_packs where name = 'audit-default' and version = 1), true,
    'pack: the released flag is stored');
  perform provio_test.assert_true(
    (select count(*) from ledger_entries where action = 'rule_pack_saved') = 1,
    'pack: the save appends a ledger entry');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A shipped version is immutable — an UPDATE and a DELETE both raise.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_raises(
    $q$update rule_packs set released = false where name = 'audit-default' and version = 1$q$,
    'append-only', 'pack: an update is refused');
  perform provio_test.assert_raises(
    $q$delete from rule_packs where name = 'audit-default' and version = 1$q$,
    'append-only', 'pack: a delete is refused');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A duplicate version is refused and logged; a higher version is accepted.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.rule_pack_save('audit-default', 1, 'population', '[]'::jsonb, repeat('a',64), 'rule-key-1', repeat('c',128), now(), false);
  perform provio_test.assert_eq((v ->> 'ok'), 'false', 'pack: a duplicate version is refused');
  perform provio_test.assert_eq((v ->> 'reason'), 'duplicate', 'pack: the refusal names the reason');
  v := public.rule_pack_save('audit-default', 2, 'population', '[]'::jsonb, repeat('b',64), 'rule-key-1', repeat('d',128), now(), false);
  perform provio_test.assert_eq((v ->> 'ok'), 'true', 'pack: a higher version is accepted');
end $$;
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_true(
    (select count(*) from rule_pack_refusals where reason = 'duplicate') = 1,
    'pack: the duplicate refusal is logged (it survived the failed save)');
end $$;
-- rule_pack_list filters on jwt_org_id(), so it is called from a session, not from the owner.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq(
    (select version from public.rule_pack_list() where name = 'audit-default'), 2,
    'pack: rule_pack_list returns the newest version');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. An unknown key is refused and logged.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.rule_pack_save('x', 1, 'population', '[]'::jsonb, repeat('a',64), 'no-key', repeat('c',128), now(), false);
  perform provio_test.assert_eq((v ->> 'reason'), 'unknown_key', 'pack: an unknown key is refused');
end $$;
select provio_test.as_owner();
do $$ begin
  perform provio_test.assert_eq(
    (select count(*) from rule_pack_refusals where reason = 'unknown_key'), 1,
    'pack: the unknown-key refusal is logged');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A caller without edit_config is refused. A preparer lacks the right.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v jsonb;
begin
  v := public.rule_pack_save('y', 1, 'population', '[]'::jsonb, repeat('a',64), 'rule-key-1', repeat('c',128), now(), false);
  perform provio_test.assert_eq((v ->> 'reason'), 'no_right', 'pack: a caller without edit_config is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 7. Isolation: org B sees no pack or refusal of org A.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin
  perform provio_test.assert_eq((select count(*) from rule_packs), 0,
    'isolation: org B reads no pack of org A');
  perform provio_test.assert_eq((select count(*) from public.rule_pack_list()), 0,
    'isolation: org B lists no pack');
  perform provio_test.assert_eq((select count(*) from rule_pack_refusals), 0,
    'isolation: org B reads no refusal of org A');
end $$;
select provio_test.as_owner();

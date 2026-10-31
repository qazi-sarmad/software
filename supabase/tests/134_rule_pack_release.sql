-- 134: rule-pack release, key registration and the refusal reader (L2, 0128).
--   * signing_key_register retires the previous live org key and stores the new public key.
--   * rule_pack_release flips a draft to released, once, idempotently; the rules stay immutable.
--   * rule_pack_refusals_list returns the org's refusals, newest first, own-org only.
--   * a caller without edit_config is refused; isolation between organisations holds.
-- M5: fixtures are written as the owner and removed by provio_test.seed() on the next run.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Provision a first key as the owner, then register a second from the client path.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
do $$ begin
  insert into signing_keys (org_id, scope, key_id, public_key)
  values ('a0000000-0000-0000-0000-000000000001', 'org', 'rule-key-1', 'PUBKEY-1');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.signing_key_register('client-key-1', 'PUBKEY-2');
  perform provio_test.assert_eq((v ->> 'ok'), 'true', 'key: register returns ok');
  perform provio_test.assert_eq(
    (select public_key from signing_keys where key_id = 'client-key-1'), 'PUBKEY-2',
    'key: the new public key is stored');
  perform provio_test.assert_true(
    (select retired_at is not null from signing_keys where key_id = 'rule-key-1'),
    'key: the previous live key is retired');
  perform provio_test.assert_eq(
    (select count(*) from signing_keys where org_id = 'a0000000-0000-0000-0000-000000000001'
       and scope = 'org' and retired_at is null), 1,
    'key: exactly one live org key remains');
  perform provio_test.assert_true(
    (select count(*) from ledger_entries where action = 'signing_key_registered') = 1,
    'key: the registration is logged');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Save a draft pack, list it, release it, and confirm the transition is one-way and idempotent.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.rule_pack_save('audit-default', 1, 'population',
    '[{"id":"numeric.duplicates","version":1,"kind":"duplicates"}]'::jsonb,
    repeat('a', 64), 'client-key-1', repeat('c', 128), now(), false);
  perform provio_test.assert_eq((v ->> 'ok'), 'true', 'release: a draft pack saves');
  perform provio_test.assert_eq(
    (select released from rule_packs where name = 'audit-default' and version = 1), false,
    'release: the pack ships as a draft');
end $$;

do $$
declare v jsonb;
begin
  v := public.rule_pack_release((select id from rule_packs where name = 'audit-default' and version = 1));
  perform provio_test.assert_eq((v ->> 'ok'), 'true', 'release: releasing a draft returns ok');
  perform provio_test.assert_eq((v ->> 'already_released'), 'false', 'release: the first release is not a repeat');
  perform provio_test.assert_eq(
    (select released from rule_packs where name = 'audit-default' and version = 1), true,
    'release: the pack is now released');
  perform provio_test.assert_eq(
    (select released from public.rule_pack_list() where name = 'audit-default'), true,
    'release: rule_pack_list reports it released');
  perform provio_test.assert_true(
    (select count(*) from ledger_entries where action = 'rule_pack_released') = 1,
    'release: the release is logged');
end $$;

-- Idempotent: releasing again is ok and does not double-log.
do $$
declare v jsonb;
begin
  v := public.rule_pack_release((select id from rule_packs where name = 'audit-default' and version = 1));
  perform provio_test.assert_eq((v ->> 'already_released'), 'true', 'release: a second release is a no-op');
  perform provio_test.assert_true(
    (select count(*) from ledger_entries where action = 'rule_pack_released') = 1,
    'release: the second release does not double-log');
end $$;

-- The release carve-out is exactly the flag: changing the rules still raises. Run as the owner,
-- because a tenant holds no direct UPDATE grant on the table at all.
select provio_test.as_owner();
select provio_test.assert_raises(
  $sql$ update rule_packs set rules = '[]'::jsonb where name = 'audit-default' and version = 1 $sql$,
  'append-only', 'release: changing a shipped pack''s rules still raises');
select provio_test.assert_raises(
  $sql$ update rule_packs set released = false where name = 'audit-default' and version = 1 $sql$,
  'append-only', 'release: un-releasing a pack still raises');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');

-- ---------------------------------------------------------------------------
-- 3. The refusal reader. An unknown-key save is refused and then readable.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.rule_pack_save('bad', 1, 'population', '[]'::jsonb,
    repeat('a', 64), 'no-such-key', repeat('c', 128), now(), false);
  perform provio_test.assert_eq((v ->> 'reason'), 'unknown_key', 'refusal: an unknown key is refused');
  perform provio_test.assert_eq(
    (select count(*) from public.rule_pack_refusals_list() where name = 'bad' and reason = 'unknown_key'), 1,
    'refusal: rule_pack_refusals_list returns the refusal');
end $$;

-- ---------------------------------------------------------------------------
-- 4. A caller without edit_config cannot release. A preparer lacks the right.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v jsonb;
begin
  v := public.rule_pack_release((select id from rule_packs where name = 'audit-default' and version = 1));
  perform provio_test.assert_eq((v ->> 'ok'), 'false', 'release: a caller without edit_config is refused');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Isolation: org B reads no refusal and cannot release org A's pack.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  perform provio_test.assert_eq((select count(*) from public.rule_pack_refusals_list()), 0,
    'isolation: org B reads no refusal of org A');
  v := public.rule_pack_release((select id from rule_packs where name = 'audit-default' and version = 1));
  perform provio_test.assert_eq((v ->> 'ok'), 'false',
    'isolation: org B cannot release org A''s pack (it does not exist for B)');
  perform provio_test.assert_eq(
    (select public.rule_pack_released_rules()), null,
    'isolation: org B sees no released pack of org A');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. The released-rules reader. The pack released in section 2 is the one returned, with its stored
--    rules, so the rule-run screen can run what was released rather than the in-code default.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.rule_pack_released_rules();
  perform provio_test.assert_eq((v ->> 'name'), 'audit-default', 'released-rules: names the released pack');
  perform provio_test.assert_eq((v ->> 'version'), '1', 'released-rules: names its version');
  perform provio_test.assert_true((v -> 'rules') is not null, 'released-rules: carries the stored rules');
end $$;
select provio_test.as_owner();

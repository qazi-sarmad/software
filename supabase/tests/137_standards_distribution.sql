-- Test 137 (D16): standards distribution has a real effect.
--
-- Before 0191 a rule pack could be signed and released for its own org, and a feature could be
-- switched per tenant, but there was no path that takes a standards update and rolls it out through
-- the Super Admin to the tenants that pay for it. This test proves the whole path, happy and bad:
--
--   * the platform publishes a signed standards pack version; the catalogue shows it;
--   * a rollout applies to an ENTITLED tenant and is SKIPPED-AND-RECORDED for a non-entitled one;
--   * a non-entitled tenant never gets a subscription row (no partial write);
--   * a tenant that pins a version is skipped when a newer version is rolled out;
--   * every bad path is refused with its exact reason, and nothing is written.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. The platform registers its signing key and publishes a standards pack. The catalogue is
--    readable by any signed-in caller (platform metadata, L2), and the pack carries its sources and
--    the scopes it covers.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_res jsonb;
begin
  v_res := public.platform_signing_key_register('plat-key-1', 'aabbccdd');
  perform provio_test.assert_eq(v_res ->> 'ok', 'true', 'D16: the platform registers its signing key');

  v_res := public.standards_pack_publish(
    'standards.forensic.core', 1, 'Forensic core', 'management',
    '[{"doc":"analyticsEngine","edition":"2026"}]'::jsonb,
    array['population','journal','document'],
    '[{"id":"mon.c3","version":1,"kind":"threshold"}]'::jsonb,
    repeat('a',64), 'plat-key-1', repeat('b',128), now());
  perform provio_test.assert_eq(v_res ->> 'ok', 'true', 'D16: the platform publishes a standards pack');
  perform provio_test.assert_eq(
    (select count(*) from standards_packs where pack_id = 'standards.forensic.core' and version = 1)::int, 1,
    'D16: the published pack version is stored');
  perform provio_test.assert_true(
    (select 'population' = any(scopes) from standards_packs where pack_id = 'standards.forensic.core'),
    'D16: the pack records the scopes it covers');
  perform provio_test.assert_true(
    exists (select 1 from feature_catalogue where key = 'standards.forensic.core' and price_class = 'add_on'),
    'D16: a published pack becomes an add-on feature (the paying gate)');
end $$;
select provio_test.as_owner();

-- A plain tenant reads the catalogue (platform metadata) but sees no subscriptions yet.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select jsonb_array_length(public.standards_catalogue_list()))::int, 1,
    'D16: a signed-in tenant can read the standards catalogue');
  perform provio_test.assert_eq(
    (select jsonb_array_length(public.standards_subscriptions_get()))::int, 0,
    'D16: a tenant with no rollout has no subscription');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. The bad paths of publish. Each is REFUSED with its exact reason, and the row count is unchanged.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq(
    (public.standards_pack_publish('standards.x', 1, 'X', 'management', '[]'::jsonb, '{}',
      '[]'::jsonb, repeat('a',64), 'plat-key-1', repeat('b',128), now())) ->> 'reason',
    'not_platform_admin', 'D16: a tenant cannot publish a standards pack');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_before int;
begin
  select count(*) into v_before from standards_packs;
  perform provio_test.assert_eq(
    (public.standards_pack_publish('standards.x', 1, 'X', 'management', '[]'::jsonb, '{}',
      '[]'::jsonb, 'notahash', 'plat-key-1', repeat('b',128), now())) ->> 'reason',
    'content_hash_malformed', 'D16: a malformed content hash is refused');
  perform provio_test.assert_eq(
    (public.standards_pack_publish('standards.x', 1, 'X', 'management', '[]'::jsonb, '{}',
      '[]'::jsonb, repeat('a',64), 'plat-key-1', 'short', now())) ->> 'reason',
    'signature_malformed', 'D16: a malformed signature is refused');
  perform provio_test.assert_eq(
    (public.standards_pack_publish('standards.x', 1, 'X', 'management', '[]'::jsonb, '{}',
      '[]'::jsonb, repeat('a',64), 'nope', repeat('b',128), now())) ->> 'reason',
    'unknown_platform_key', 'D16: a pack signed with an unknown key is refused');
  perform provio_test.assert_eq(
    (public.standards_pack_publish('standards.forensic.core', 1, 'Dup', 'management', '[]'::jsonb, '{}',
      '[]'::jsonb, repeat('a',64), 'plat-key-1', repeat('b',128), now())) ->> 'reason',
    'version_exists', 'D16: re-publishing a shipped version is refused (immutable)');
  perform provio_test.assert_eq(
    (select count(*) from standards_packs)::int, v_before,
    'D16: every refused publish wrote no row (no partial write)');
end $$;
select provio_test.as_owner();

-- A tenant registers an org key, then the platform tries to publish with it: refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$ begin perform public.signing_key_register('org-key-1', 'ffee'); end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform provio_test.assert_eq(
    (public.standards_pack_publish('standards.x', 1, 'X', 'management', '[]'::jsonb, '{}',
      '[]'::jsonb, repeat('a',64), 'org-key-1', repeat('b',128), now())) ->> 'reason',
    'unknown_platform_key', 'D16: an org key cannot sign a platform standards update');
end $$;
select provio_test.as_owner();

-- The catalogue is append-only: a shipped version cannot be edited.
do $$
begin
  perform provio_test.assert_raises(
    $q$update standards_packs set title = 'edited' where pack_id = 'standards.forensic.core' and version = 1$q$,
    'append-only', 'D16: a shipped standards pack version is immutable');
end $$;

-- ---------------------------------------------------------------------------
-- 3. The rollout. Entitle Org A only; roll version 1 out to A and B. A is applied, B is
--    skipped-and-recorded, and B never gets a subscription row.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001',
    'standards.forensic.core', true, 'Assurance', 'pays for the forensic core');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_res jsonb;
begin
  -- A bad path first: an unknown pack.
  perform provio_test.assert_eq(
    (public.standards_rollout('standards.nope', 1,
      array['a0000000-0000-0000-0000-000000000001']::uuid[])) ->> 'reason',
    'unknown_pack', 'D16: a rollout of an unknown pack is refused');

  v_res := public.standards_rollout('standards.forensic.core', 1,
    array['a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001']::uuid[]);
  perform provio_test.assert_eq(v_res ->> 'ok', 'true', 'D16: the rollout runs');
  perform provio_test.assert_eq((v_res ->> 'applied')::int, 1, 'D16: exactly one tenant is applied');
  perform provio_test.assert_eq(
    (select count(*) from standards_rollout_log
      where pack_id = 'standards.forensic.core' and org_id = 'a0000000-0000-0000-0000-000000000001'
        and outcome = 'applied')::int, 1,
    'D16: the entitled tenant is recorded as applied');
  perform provio_test.assert_eq(
    (select outcome from standards_rollout_log
      where pack_id = 'standards.forensic.core' and org_id = 'b0000000-0000-0000-0000-000000000001'),
    'skipped-not-entitled', 'D16: the non-entitled tenant is skipped AND recorded');
  perform provio_test.assert_eq(
    (select count(*) from org_standards_subscriptions
      where org_id = 'b0000000-0000-0000-0000-000000000001')::int, 0,
    'D16: a non-entitled tenant never gets a subscription (no partial write)');
end $$;
select provio_test.as_owner();

-- A tenant cannot roll out.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq(
    (public.standards_rollout('standards.forensic.core', 1,
      array['a0000000-0000-0000-0000-000000000001']::uuid[])) ->> 'reason',
    'not_platform_admin', 'D16: a tenant cannot roll a standards pack out');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. The tenant sees the subscribed version (L2: only its own).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (public.standards_subscriptions_get() -> 0 ->> 'pack_id'), 'standards.forensic.core',
    'D16: org A sees the pack it was rolled out');
  perform provio_test.assert_eq(
    (public.standards_subscriptions_get() -> 0 ->> 'version'), '1',
    'D16: org A sees the subscribed version');
  perform provio_test.assert_eq(
    (select count(*) from org_standards_subscriptions)::int, 1,
    'D16: RLS restricts the subscription table to the caller''s org');
  perform provio_test.assert_true(
    exists (select 1 from ledger_entries
             where org_id = 'a0000000-0000-0000-0000-000000000001'
               and action = 'standards_pack_applied'),
    'D16: the applied rollout is written to the tenant ledger');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from org_standards_subscriptions)::int, 0,
    'D16: org B cannot see org A''s subscription (L2)');
  -- Org B sees exactly its own rollout row (its own skip), and never org A's applied row.
  perform provio_test.assert_eq(
    (select count(*) from standards_rollout_log)::int, 1,
    'D16: org B sees only its own rollout row (L2)');
  perform provio_test.assert_eq(
    (select outcome from standards_rollout_log limit 1), 'skipped-not-entitled',
    'D16: org B sees its own skip, never org A''s applied row (L2)');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. Pin. Org A pins version 1; publishing and rolling out version 2 is then skipped-pinned, and the
--    effective version stays 1. The bad pin paths are refused.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$ begin
  perform public.standards_pack_publish(
    'standards.forensic.core', 2, 'Forensic core', 'management',
    '[{"doc":"analyticsEngine","edition":"2027"}]'::jsonb,
    array['population','journal','document'],
    '[{"id":"mon.c3","version":2,"kind":"threshold"}]'::jsonb,
    repeat('c',64), 'plat-key-1', repeat('d',128), now());
end $$;
select provio_test.as_owner();

-- A user without edit_config cannot pin.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$ begin
  perform provio_test.assert_eq(
    (public.standards_pin('standards.forensic.core', 1, 'freeze')) ->> 'reason',
    'edit_config or a Head is required to pin a standards version',
    'D16: a Preparer cannot pin a standards version');
end $$;
select provio_test.as_owner();

-- The Org Admin pins version 1; a missing reason is refused; an unknown pack is refused.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq(
    (public.standards_pin('standards.forensic.core', 1, '  ')) ->> 'reason',
    'a reason is required to pin a standards version', 'D16: a pin without a reason is refused');
  perform provio_test.assert_eq(
    (public.standards_pin('standards.nope', 1, 'freeze')) ->> 'reason',
    'unknown_pack', 'D16: pinning an unknown pack is refused');
  perform provio_test.assert_eq(
    (public.standards_pin('standards.forensic.core', 1, 'frozen mid-engagement')) ->> 'ok',
    'true', 'D16: the Org Admin pins the version it runs');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_res jsonb;
begin
  v_res := public.standards_rollout('standards.forensic.core', 2,
    array['a0000000-0000-0000-0000-000000000001']::uuid[]);
  perform provio_test.assert_eq((v_res ->> 'applied')::int, 0, 'D16: a pinned tenant is not moved forward');
  perform provio_test.assert_eq(
    (select outcome from standards_rollout_log
      where pack_id = 'standards.forensic.core' and version = 2
        and org_id = 'a0000000-0000-0000-0000-000000000001'),
    'skipped-pinned', 'D16: the pinned tenant is recorded as skipped-pinned');
end $$;
select provio_test.as_owner();

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    (public.standards_subscriptions_get() -> 0 ->> 'version'), '1',
    'D16: the pinned tenant keeps running version 1');
  perform provio_test.assert_eq(
    (public.standards_subscriptions_get() -> 0 ->> 'pinned'), 'true',
    'D16: the subscription is shown as pinned');
end $$;
select provio_test.as_owner();

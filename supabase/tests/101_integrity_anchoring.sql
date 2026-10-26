-- Test 101: Item A. Integrity anchoring: signing keys, signatures, timestamp queueing, the token
-- checks, the minimum-authority policy, rights refusals and tenant isolation.
--
-- Every assertion that reads a ledger or activity row runs as the owner: those tables are visible
-- only to cia/org_admin by policy, and asserting them as a lower role would be a false failure.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- A1: the catalogue and the seeded authorities.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true(
    (select exists (select 1 from feature_catalogue where key = 'integrity_anchoring' and status = 'live')),
    'anchor: the integrity_anchoring feature is in the catalogue');
  perform provio_test.assert_true(
    (select exists (select 1 from feature_catalogue where key = 'timestamp_dual')),
    'anchor: the timestamp_dual feature is in the catalogue');
  perform provio_test.assert_true(
    (select count(*) from timestamp_authorities where enabled) >= 3,
    'anchor: at least three timestamp authorities are seeded and enabled');
  perform provio_test.assert_eq(public.anchoring_min_authorities(null), 2,
    'anchor: the default minimum is two authorities');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A2: signature_record. The happy path, then every refusal.
-- ===========================================================================
-- The org's key. signing_keys has no INSERT policy by design: keys are provisioned by the platform
-- path (WP3), so the test creates it as the owner, exactly as that path does.
select provio_test.as_owner();
do $$
begin
  insert into signing_keys (org_id, scope, key_id, public_key)
  values ('a0000000-0000-0000-0000-000000000001', 'org', 'test-key-1', 'PUBKEY');
end $$;

-- A2a: while the feature is off, a signature is refused even though the key exists. The feature is
-- on by default, so it is explicitly disabled first.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  -- The entitlement is the effective switch: feature_enabled_internal reads tenant_entitlements
  -- before the catalogue default.
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'integrity_anchoring', false, null, 'test');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.signature_record('report_graph_root','60000000-0000-0000-0000-0000000000a1','%s','test-key-1','%s', now())$q$, repeat('a',64), repeat('b',128)),
    'feature_off', 'anchor: a signature is refused while the feature is off');
end $$;
select provio_test.as_owner();

-- Only the platform administrator may enable the feature for an org.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.platform_set_entitlement('a0000000-0000-0000-0000-000000000001', 'integrity_anchoring', true, null, 'test');
end $$;
select provio_test.as_owner();

-- A2b: with the feature on, the happy path and every refusal.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_id uuid;
  v_root text := repeat('a', 64);
  v_sig text := repeat('b', 128);
begin
  v_id := public.signature_record('report_graph_root', '60000000-0000-0000-0000-0000000000a1', v_root, 'test-key-1', v_sig, '2026-10-27T00:00:00Z');
  perform provio_test.assert_true(v_id is not null, 'anchor: a signature is recorded and returns an id');

  -- Malformed inputs.
  perform provio_test.assert_raises(
    format($q$select public.signature_record('report_graph_root','x','%s','test-key-1','%s', now())$q$, repeat('c',63), v_sig),
    '64 lowercase hex', 'anchor: a short root hash is refused');
  perform provio_test.assert_raises(
    format($q$select public.signature_record('report_graph_root','x','%s','test-key-1','%s', now())$q$, v_root, repeat('b',127)),
    '128 lowercase hex', 'anchor: a short signature is refused');
  perform provio_test.assert_raises(
    format($q$select public.signature_record('report_graph_root','x','%s','missing-key','%s', now())$q$, v_root, v_sig),
    'unknown signing key', 'anchor: an unknown key is refused');

  -- The status read reflects the signature.
  perform provio_test.assert_eq((public.anchoring_status('report_graph_root','60000000-0000-0000-0000-0000000000a1') ->> 'signed'), 'true',
    'anchor: the status reports the signature');
  perform provio_test.assert_eq((public.anchoring_status('report_graph_root','60000000-0000-0000-0000-0000000000a1') ->> 'timestamp_status'), 'queued',
    'anchor: a signature alone leaves the timestamp queued');

  -- An idempotent re-sign of the same subject updates in place, not a second row.
  perform public.signature_record('report_graph_root', '60000000-0000-0000-0000-0000000000a1', v_root, 'test-key-1', repeat('d',128), '2026-10-27T01:00:00Z');
  perform provio_test.assert_eq(
    (select count(*) from signatures where subject_id = '60000000-0000-0000-0000-0000000000a1'), 1,
    'anchor: re-signing a subject updates in place');
end $$;
select provio_test.as_owner();

-- The signature is written to the ledger, which only cia/org_admin may read.
do $$
begin
  -- Two: the first sign and the idempotent re-sign. The signature row updates in place, but the
  -- ledger is append-only, so every sign is logged.
  perform provio_test.assert_eq(
    (select count(*) from ledger_entries where action = 'signature_recorded'), 2,
    'anchor: every signature is written to the ledger');
end $$;

-- ===========================================================================
-- A3: a Preparer may not sign. The right check refuses.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.signature_record('report_graph_root','x','%s','test-key-1','%s', now())$q$, repeat('a',64), repeat('b',128)),
    'not permitted', 'anchor: a Preparer may not sign');
  perform provio_test.assert_eq(public.caller_head_level(), 0, 'anchor: a Preparer is not a Head');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A4: a retired key cannot sign. Retiring is a platform/owner action (no UPDATE policy), so it runs
-- as the owner; the refusal is then asserted as the tenant user.
select provio_test.as_owner();
do $$
begin
  update signing_keys set retired_at = now(), retired_reason = 'rotation' where key_id = 'test-key-1';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    format($q$select public.signature_record('report_graph_root','y','%s','test-key-1','%s', now())$q$, repeat('a',64), repeat('b',128)),
    'is retired', 'anchor: a retired key may not sign');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A5: the timestamp queue. Idempotent, then stamped, then the minimum policy.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_req uuid;
  v_req2 uuid;
  v_root text := repeat('e', 64);
begin
  v_req := public.timestamp_queue('report_graph_root', '60000000-0000-0000-0000-0000000000a1', v_root, 'test-key-1');
  perform provio_test.assert_true(v_req is not null, 'anchor: a timestamp request is queued');
  v_req2 := public.timestamp_queue('report_graph_root', '60000000-0000-0000-0000-0000000000a1', v_root, 'test-key-1');
  perform provio_test.assert_eq(v_req, v_req2, 'anchor: queueing the same root twice is idempotent');
  perform provio_test.assert_eq(
    (select count(*) from timestamp_requests where root_hash = v_root), 1,
    'anchor: the same root queues one row');
  perform provio_test.assert_raises(
    format($q$select public.timestamp_queue('report_graph_root','z','%s','test-key-1')$q$, repeat('f',63)),
    '64 lowercase hex', 'anchor: a short root is refused by the queue');
end $$;
select provio_test.as_owner();

-- A6: record one token: partial, because the minimum is two.
do $$
declare
  v_req uuid;
begin
  select id into v_req from timestamp_requests where root_hash = repeat('e', 64);
  perform public.timestamp_record(v_req, 'FreeTSA', 'TOKEN-1', '2026-10-27T00:00:00Z');
  perform provio_test.assert_eq((select status from timestamp_requests where id = v_req), 'partial',
    'anchor: one token below the minimum is partial');
  -- A second token from a different authority reaches the minimum.
  perform public.timestamp_record(v_req, 'DigiCert', 'TOKEN-2', '2026-10-27T00:00:01Z');
  perform provio_test.assert_eq((select status from timestamp_requests where id = v_req), 'stamped',
    'anchor: two tokens reach the minimum and stamp');
  perform provio_test.assert_true((select stamped_at is not null from timestamp_requests where id = v_req),
    'anchor: stamping records the time');
  -- Re-recording the same authority replaces the token, it does not add a second.
  perform public.timestamp_record(v_req, 'FreeTSA', 'TOKEN-1b', '2026-10-27T00:00:02Z');
  perform provio_test.assert_eq((select count(*) from timestamp_tokens where request_id = v_req), 2,
    'anchor: the same authority replaces its token');
end $$;

-- The status read needs an org claim, so it is asserted as the tenant user. Only service_role may
-- call timestamp_record, which is why the recording above ran as the owner.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((public.anchoring_status('report_graph_root','60000000-0000-0000-0000-0000000000a1') ->> 'timestamps'), '2',
    'anchor: the status counts the tokens');
  perform provio_test.assert_eq((public.anchoring_status('report_graph_root','60000000-0000-0000-0000-0000000000a1') ->> 'timestamp_status'), 'stamped',
    'anchor: two tokens stamp the subject');
end $$;
select provio_test.as_owner();

-- A7: a raised minimum makes an already-stamped request partial again on the next token, and the
-- failure path backs off.
select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
begin
  perform public.admin_set_anchoring_min('a0000000-0000-0000-0000-000000000001', 3);
  perform provio_test.assert_eq(public.anchoring_min_authorities('a0000000-0000-0000-0000-000000000001'), 3,
    'anchor: the minimum is raised to three');
end $$;
select provio_test.as_owner();
do $$
declare
  v_req uuid;
begin
  select id into v_req from timestamp_requests where root_hash = repeat('e', 64);
  perform public.timestamp_record(v_req, 'Sectigo', 'TOKEN-3', '2026-10-27T00:00:03Z');
  perform provio_test.assert_eq((select status from timestamp_requests where id = v_req), 'stamped',
    'anchor: a third token meets the raised minimum');

  -- The failure path.
  perform public.timestamp_fail(v_req, 'connection refused');
  perform provio_test.assert_eq((select attempts from timestamp_requests where id = v_req), 1,
    'anchor: a failure records the attempt');
  perform provio_test.assert_eq((select status from timestamp_requests where id = v_req), 'queued',
    'anchor: a failed attempt returns the request to the queue');
  perform provio_test.assert_true((select next_attempt_at > now() from timestamp_requests where id = v_req),
    'anchor: the retry is scheduled in the future');
  -- The error is truncated, never unbounded.
  perform public.timestamp_fail(v_req, repeat('x', 500));
  perform provio_test.assert_true((select length(last_error) <= 200 from timestamp_requests where id = v_req),
    'anchor: the stored error is truncated to 200 characters');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A8: the platform-admin-only writes.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_save_timestamp_authority(null,'X','https://x.test',true,9,'n')$q$,
    'platform administrator', 'anchor: a tenant user may not add an authority');
  perform provio_test.assert_raises(
    $q$select public.admin_set_anchoring_min('a0000000-0000-0000-0000-000000000001', 2)$q$,
    'platform administrator', 'anchor: a tenant user may not set the minimum');
  perform provio_test.assert_raises(
    $q$select public.admin_save_trust_anchor(null,'X','short',true)$q$,
    'platform administrator', 'anchor: a tenant user may not add a trust anchor');
end $$;
select provio_test.as_owner();

-- The harness runs every test twice against the same database, so the row this block adds is
-- removed first. The seeded catalogue rows stay: they are global, not org data.
select provio_test.as_owner();
do $$
begin
  delete from timestamp_authorities where url = 'https://tsa.test/tsr';
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000f0', '', 'platform_admin');
do $$
declare v_id uuid;
begin
  v_id := public.admin_save_timestamp_authority(null, 'Test TSA', 'https://tsa.test/tsr', true, 9, 'test');
  perform provio_test.assert_true(v_id is not null, 'anchor: the platform admin adds an authority');
  perform provio_test.assert_raises(
    $q$select public.admin_save_timestamp_authority(null,'Bad','ftp://nope',true,9,'n')$q$,
    'must start with http', 'anchor: a non-http authority URL is refused');
  perform public.admin_set_anchoring_min('a0000000-0000-0000-0000-000000000001', 2);
  perform provio_test.assert_eq(public.anchoring_min_authorities('a0000000-0000-0000-0000-000000000001'), 2,
    'anchor: the platform admin lowers the minimum');
  perform provio_test.assert_raises(
    $q$select public.admin_set_anchoring_min('a0000000-0000-0000-0000-000000000001', 9)$q$,
    'between 1 and 3', 'anchor: an out-of-range minimum is refused');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A9: isolation. Org B sees none of Org A's keys, signatures or requests, and a platform admin
-- cannot read a tenant's signature set through the tenant RPC.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq((select count(*) from signing_keys), 0,
    'anchor: org B sees no signing key');
  perform provio_test.assert_eq((select count(*) from signatures), 0,
    'anchor: org B sees no signature');
  perform provio_test.assert_eq((select count(*) from timestamp_requests), 0,
    'anchor: org B sees no timestamp request');
  perform provio_test.assert_eq(public.signatures_get('report_graph_root','60000000-0000-0000-0000-0000000000a1')::text, '[]',
    'anchor: org B reads an empty signature set for org A''s subject');
  perform provio_test.assert_eq((public.anchoring_status('report_graph_root','60000000-0000-0000-0000-0000000000a1') ->> 'signed'), 'false',
    'anchor: org B sees org A''s subject as unsigned');
end $$;
select provio_test.as_owner();

-- The catalogue tables carry no tenant data, so any signed-in user may read them.
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_true((select count(*) from timestamp_authorities) >= 3,
    'anchor: the authority catalogue is readable by any signed-in user');
  perform provio_test.assert_true(public.timestamp_authorities_get()::text like '[%',
    'anchor: the authority list RPC returns a JSON array');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- A10: anon reaches none of the anchoring tables or RPCs.
-- ===========================================================================
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises('select count(*) from signatures', 'permission denied',
    'anchor: anon cannot read signatures');
  perform provio_test.assert_raises('select count(*) from signing_keys', 'permission denied',
    'anchor: anon cannot read signing keys');
  perform provio_test.assert_raises('select count(*) from timestamp_requests', 'permission denied',
    'anchor: anon cannot read timestamp requests');
  perform provio_test.assert_raises('select count(*) from timestamp_tokens', 'permission denied',
    'anchor: anon cannot read timestamp tokens');
end $$;
select provio_test.as_owner();

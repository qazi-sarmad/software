-- Test 104 (Phase 2.6): the report graph root is persisted, and the database is the authority on it.
--
-- Before migration 0103 `report_graphs` and `report_claims` had no writer anywhere in the repository:
-- the engine computed roots in `src/lib/writing/` and the result was discarded, so `verify_report_root`
-- (0094) had no data to verify. 0103 adds `report_graph_commit`, which recomputes every claim hash
-- from the claim's canonical facts and rebuilds the Merkle root before writing, so a caller cannot
-- record a root that does not match its claims.
--
-- The root algorithm is proven to be the same as the TypeScript engine's: the three canonical claim
-- texts below and their root were produced by `src/lib/writing/graph.ts` (`graphHashes`) and are
-- pinned here, so a drift between the two implementations fails this test.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. report_graph_root_of matches the TypeScript engine byte for byte.
--    Canonical texts and the expected root were produced by src/lib/writing/graph.ts.
-- ===========================================================================
do $$
declare
  v_canon text[] := array[
    '{"claimLevel":"calculated","figures":[],"id":"c-a","kind":"calculated","modelId":"M1","phraseId":"scope.period","phraseVersion":1,"references":[],"ruleId":"r","ruleVersion":1,"sectionId":"scope","slots":[{"kind":"date","name":"start_date","value":"2026-01-01"}]}',
    '{"claimLevel":"calculated","figures":[],"id":"c-b","kind":"calculated","modelId":"M1","phraseId":"scope.period","phraseVersion":1,"references":[],"ruleId":"r","ruleVersion":1,"sectionId":"exec","slots":[{"kind":"date","name":"start_date","value":"2026-01-01"}]}',
    '{"claimLevel":"calculated","figures":[],"id":"c-c","kind":"calculated","modelId":"M1","phraseId":"scope.period","phraseVersion":1,"references":[],"ruleId":"r","ruleVersion":1,"sectionId":"findings","slots":[{"kind":"date","name":"start_date","value":"2026-01-01"}]}'
  ];
  v_leaf text[];
  v_root text;
begin
  -- The claim hashes the engine produced (sha256 of each canonical text).
  perform provio_test.assert_eq(
    encode(extensions.digest(v_canon[1], 'sha256'), 'hex'),
    'd7f0f4146f6ed8f91302c95608497d6952b7e65f120a9947cb8fde1912cef8ae',
    '2.6: the first claim hashes to the engine value');
  -- Leaf hash = sha256('00' || canonical); the root reduces with '01' node prefixes.
  v_leaf := array[
    encode(extensions.digest('00' || v_canon[1], 'sha256'), 'hex'),
    encode(extensions.digest('00' || v_canon[2], 'sha256'), 'hex'),
    encode(extensions.digest('00' || v_canon[3], 'sha256'), 'hex')
  ];
  v_root := public.report_graph_root_of(v_leaf);
  perform provio_test.assert_eq(
    v_root, 'fae44ed002034482c6c479bfc4e42d199513f036450849b8dad99a1c1cb96956',
    '2.6: report_graph_root_of reproduces the TypeScript engine root');
end $$;

-- ===========================================================================
-- 2. Commit a real graph for a real report version and read it back.
-- ===========================================================================
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;

do $$
declare
  v_version uuid;
  v_canon text := '{"claimLevel":"calculated","figures":[],"id":"c-a","kind":"calculated","modelId":"M1","phraseId":"scope.period","phraseVersion":1,"references":[],"ruleId":"r","ruleVersion":1,"sectionId":"scope","slots":[{"kind":"date","name":"start_date","value":"2026-01-01"}]}';
  v_hash text := 'd7f0f4146f6ed8f91302c95608497d6952b7e65f120a9947cb8fde1912cef8ae';
  v_root text := 'fae44ed002034482c6c479bfc4e42d199513f036450849b8dad99a1c1cb96956';
  v_claims jsonb;
  v_id uuid;
  v_read jsonb;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;

  v_claims := jsonb_build_array(
    jsonb_build_object('claim_id', 'c-a', 'section_id', 'scope', 'position', 1, 'kind', 'calculated',
      'claim_level', 'calculated', 'phrase_id', 'scope.period', 'phrase_version', 1,
      'rule_id', 'r', 'rule_version', 1, 'canonical', v_canon, 'claim_hash', v_hash),
    jsonb_build_object('claim_id', 'c-b', 'section_id', 'exec', 'position', 2, 'kind', 'calculated',
      'claim_level', 'calculated', 'phrase_id', 'scope.period', 'phrase_version', 1,
      'rule_id', 'r', 'rule_version', 1,
      'canonical', replace(replace(v_canon, '"id":"c-a"', '"id":"c-b"'), '"sectionId":"scope"', '"sectionId":"exec"'),
      'claim_hash', '8015e77108a8d4dc8217975802b1f1f13cf3eb35f12741223ee564136c913931'),
    jsonb_build_object('claim_id', 'c-c', 'section_id', 'findings', 'position', 3, 'kind', 'calculated',
      'claim_level', 'calculated', 'phrase_id', 'scope.period', 'phrase_version', 1,
      'rule_id', 'r', 'rule_version', 1,
      'canonical', replace(replace(v_canon, '"id":"c-a"', '"id":"c-c"'), '"sectionId":"scope"', '"sectionId":"findings"'),
      'claim_hash', '64a9ea8d9cfb9ef68cbe40cf17d4ba030bb1b511d8d31ad50badd174c1d344c0')
  );

  v_id := public.report_graph_commit(v_version, 'M1', 3, 2, 'active', 'en-GB',
    '1.0.0', 'M1@1', '1.0.0', '2026-10-25T09:00:00Z'::timestamptz, v_root, repeat('f', 64), v_claims);
  perform provio_test.assert_true(v_id is not null, '2.6: the graph commits and returns an id');

  perform provio_test.assert_eq(
    (select graph_root from report_graphs where id = v_id), v_root,
    '2.6: the committed graph root is the verified root');
  perform provio_test.assert_eq(
    (select claim_count from report_graphs where id = v_id), 3,
    '2.6: the committed claim count is recorded');
  perform provio_test.assert_true(
    (select ledger_seq from report_graphs where id = v_id) is not null,
    '2.6: the graph is anchored to a ledger entry');
  perform provio_test.assert_eq(
    (select count(*) from report_claims where report_version_id = v_version), 3::bigint,
    '2.6: every claim is written');
  perform provio_test.assert_eq(
    (select count(*) from report_claim_versions where report_version_id = v_version), 3::bigint,
    '2.6: the hash-chained claim version log is written by the trigger');

  -- The reader returns exactly what the database holds.
  v_read := public.report_graph_get(v_version);
  perform provio_test.assert_eq(
    v_read -> 'graphs' -> 0 ->> 'graph_root', v_root,
    '2.6: report_graph_get returns the committed root');
  perform provio_test.assert_eq(
    jsonb_array_length(v_read -> 'claims'), 3,
    '2.6: report_graph_get returns the claims');

  -- verify_report_root, the anonymous third-party proof, now finds the root.
  perform provio_test.assert_eq(
    (select status from public.verify_report_root(v_root)), 'not_found',
    '2.6: public verification is off until the org enables public_verification');
end $$;

-- ===========================================================================
-- 3. Idempotent: a second commit of the same variant returns the same row.
-- ===========================================================================
do $$
declare
  v_version uuid;
  v_first uuid;
  v_second uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  select id into v_first from report_graphs where report_version_id = v_version and model_id = 'M1';
  v_second := public.report_graph_commit(v_version, 'M1', 3, 2, 'active', 'en-GB',
    '1.0.0', 'M1@1', '1.0.0', '2026-10-25T09:00:00Z'::timestamptz,
    'fae44ed002034482c6c479bfc4e42d199513f036450849b8dad99a1c1cb96956', repeat('f', 64),
    jsonb_build_array(jsonb_build_object('claim_id', 'c-a', 'section_id', 'scope',
      'canonical', '{"claimLevel":"calculated","figures":[],"id":"c-a","kind":"calculated","modelId":"M1","phraseId":"scope.period","phraseVersion":1,"references":[],"ruleId":"r","ruleVersion":1,"sectionId":"scope","slots":[{"kind":"date","name":"start_date","value":"2026-01-01"}]}',
      'claim_hash', 'd7f0f4146f6ed8f91302c95608497d6952b7e65f120a9947cb8fde1912cef8ae')));
  perform provio_test.assert_eq(v_second, v_first, '2.6: a repeat commit is idempotent');
end $$;

-- ===========================================================================
-- 4. The database refuses a root that does not match the claims.
-- ===========================================================================
do $$
declare
  v_version uuid;
  v_bad_claims jsonb := jsonb_build_array(
    jsonb_build_object('claim_id', 'x', 'canonical', '{"id":"x"}', 'claim_hash', 'deadbeef'));
  v_good_claims jsonb;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  -- A claim whose recorded hash is not the hash of its canonical form is refused.
  perform provio_test.assert_raises(
    format($q$select public.report_graph_commit('%s','M2',3,2,'active','en-GB','1.0.0','M2@1','1.0.0', now(), '%s', '%s', %L::jsonb)$q$,
      v_version, repeat('0', 64), repeat('f', 64), v_bad_claims),
    'claim_hash_mismatch', '2.6: a claim whose hash does not match its canonical form is refused');

  -- A correct claim hash but a root that does not match the claims is refused.
  v_good_claims := jsonb_build_array(jsonb_build_object('claim_id', 'x',
    'canonical', '{"id":"x"}',
    'claim_hash', encode(extensions.digest('{"id":"x"}', 'sha256'), 'hex')));
  perform provio_test.assert_raises(
    format($q$select public.report_graph_commit('%s','M3',3,2,'active','en-GB','1.0.0','M3@1','1.0.0', now(), '%s', '%s', %L::jsonb)$q$,
      v_version, repeat('0', 64), repeat('f', 64), v_good_claims),
    'graph_root_mismatch', '2.6: a root that does not match the claims is refused');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. Append-only and rights.
-- ===========================================================================
do $$
begin
  perform provio_test.assert_raises(
    $q$update report_graphs set graph_root = repeat('9', 64) where org_id = 'a0000000-0000-0000-0000-000000000001'$q$,
    'append-only', '2.6: a committed graph cannot be edited');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare
  v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.report_graph_commit('%s','M4',3,2,'active','en-GB','1.0.0','M4@1','1.0.0', now(), '%s', '%s', '[]'::jsonb)$q$,
      v_version, repeat('0', 64), repeat('f', 64)),
    'review_and_approve', '2.6: a caller without review_and_approve cannot commit a graph');
end $$;

-- ===========================================================================
-- 6. Cross-organisation: org B sees nothing of org A's graph.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_eq(
    jsonb_array_length(public.report_graph_get(v_version) -> 'graphs'), 0,
    '2.6: another organisation reads no graphs for this report version');
end $$;
select provio_test.as_owner();

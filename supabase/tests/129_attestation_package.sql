-- Test 129 (T3/T4): the portable attestation package's data supply.
--
-- Proves: report_graph_commit records each claim's Merkle leaf hash, so a third party can re-fold the
-- root from the package alone; attestation_input_get gathers a subject's facts (roots, versions,
-- leaves, signatures, public keys, timestamps, ledger seq) and refuses a caller who is not an
-- integrity owner; attestation_subjects_list lists signed subjects and is rights-gated. Only hashes,
-- ids, public keys, timestamps and version strings leave (Law L2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ===========================================================================
-- 1. report_graph_commit records leaf_hash on each claim.
-- ===========================================================================
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$ begin perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.compose_report('50000000-0000-0000-0000-0000000000a1'); end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_version uuid;
  v_canon text := '{"claimLevel":"calculated","figures":[],"id":"c-a","kind":"calculated","modelId":"M1","phraseId":"scope.period","phraseVersion":1,"references":[],"ruleId":"r","ruleVersion":1,"sectionId":"scope","slots":[{"kind":"date","name":"start_date","value":"2026-01-01"}]}';
  v_hash text := 'd7f0f4146f6ed8f91302c95608497d6952b7e65f120a9947cb8fde1912cef8ae';
  v_root text := 'fae44ed002034482c6c479bfc4e42d199513f036450849b8dad99a1c1cb96956';
  v_claims jsonb;
  v_id uuid;
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

  v_id := public.report_graph_commit(
    v_version, 'M1', 3, 2, 'active', 'en-GB', '1.0.0', 'M1@1', '1.0.0',
    '2026-10-25T09:00:00Z'::timestamptz, v_root, repeat('f', 64), v_claims);

  perform provio_test.assert_true(v_id is not null, 'T3: the graph commits');
  perform provio_test.assert_eq(
    (select leaf_hash from report_claims
      where report_version_id = v_version and claim_id = 'c-a'),
    encode(extensions.digest('00' || v_canon, 'sha256'), 'hex'),
    'T3: the claim records its domain-separated leaf hash');
end $$;
select provio_test.as_owner();

-- The leaves fold to the recorded root, using the same function the package verifier mirrors. The
-- fold function is not executable by a tenant user, so it is asserted as the owner.
do $$
declare
  v_version uuid;
  v_root text := 'fae44ed002034482c6c479bfc4e42d199513f036450849b8dad99a1c1cb96956';
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;

  perform provio_test.assert_eq(
    public.report_graph_root_of(array(
      select leaf_hash from report_claims where report_version_id = v_version order by position)),
    v_root,
    'T3: the recorded leaf hashes re-fold to the graph root');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 2. attestation_input_get returns the facts the package needs, for the graph root.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_version uuid;
  v jsonb;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;

  v := public.attestation_input_get('report_graph_root', v_version::text);
  perform provio_test.assert_true(v is not null, 'T3: the input is returned');
  perform provio_test.assert_true((v -> 'roots') is not null and jsonb_array_length(v -> 'roots') >= 1,
    'T3: at least the graph root is present');
  perform provio_test.assert_true((v -> 'leaves') is not null and jsonb_array_length(v -> 'leaves') = 3,
    'T3: all three leaves are present');
  perform provio_test.assert_true((v ->> 'label') <> '', 'T3: the label is present');
  perform provio_test.assert_true((v -> 'versions') is not null, 'T3: the versions are present');
  perform provio_test.assert_true((v -> 'signatures') is not null, 'T3: the signatures array is present');
  perform provio_test.assert_true((v -> 'keys') is not null, 'T3: the keys array is present');
  perform provio_test.assert_true((v -> 'timestamps') is not null, 'T3: the timestamps array is present');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 3. Rights: a Preparer may not build a package; an integrity owner may.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_raises(
    format($q$select public.attestation_input_get('report_graph_root', %L)$q$, v_version::text),
    'not permitted', 'T3: a Preparer may not build an attestation package');
  perform provio_test.assert_raises(
    $q$select public.attestation_subjects_list()$q$,
    'not permitted', 'T3: a Preparer may not list attestation subjects');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 4. attestation_subjects_list lists a signed subject once it is signed.
-- ===========================================================================
select provio_test.as_owner();
do $$
begin
  insert into signing_keys (org_id, scope, key_id, public_key)
  values ('a0000000-0000-0000-0000-000000000001', 'org', 'att-key-1', repeat('ab', 32));
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  v_version uuid;
  v_root text := 'fae44ed002034482c6c479bfc4e42d199513f036450849b8dad99a1c1cb96956';
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform public.signature_record('report_graph_root', v_version::text, v_root, 'att-key-1', repeat('c', 128),
    '2026-10-27T00:00:00Z');

  perform provio_test.assert_true(
    exists (select 1 from public.attestation_subjects_list()
             where kind = 'report_graph_root' and subject_id = v_version::text),
    'T5: the signed subject is listed');
  perform provio_test.assert_eq(
    (select has_timestamp from public.attestation_subjects_list()
      where kind = 'report_graph_root' and subject_id = v_version::text),
    false, 'T5: the subject has no timestamp yet');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 5. Isolation: org B sees no subject and reads no input for org A's report.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v_version uuid;
begin
  select id into v_version from report_versions
   where engagement_id = '50000000-0000-0000-0000-0000000000a1' order by version_number desc limit 1;
  perform provio_test.assert_eq((select count(*) from public.attestation_subjects_list()), 0::bigint,
    'T3: org B lists no subject');
  perform provio_test.assert_raises(
    format($q$select public.attestation_input_get('report_graph_root', %L)$q$, v_version::text),
    'no such subject', 'T3: org B cannot read org A''s package input');
end $$;
select provio_test.as_owner();

-- ===========================================================================
-- 6. Anon reaches neither RPC.
-- ===========================================================================
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.attestation_input_get('report_graph_root', '00000000-0000-0000-0000-000000000000')$q$,
    'permission denied', 'T3: anon cannot call attestation_input_get');
  perform provio_test.assert_raises(
    $q$select public.attestation_subjects_list()$q$,
    'permission denied', 'T3: anon cannot call attestation_subjects_list');
end $$;
select provio_test.as_owner();

-- The harness runs every test twice against the same database; the key this test adds is removed so
-- the second run starts clean (the unique index on key_id would otherwise collide).
do $$ begin delete from signing_keys where key_id = 'att-key-1'; end $$;

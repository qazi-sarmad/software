-- Test 54 (5E): Phase 5 acceptance — the cross-cutting guarantees for findings, conclusion and the
-- document viewer in one place. Cross-org reads/writes refused, unauthenticated calls refused,
-- no-right caller refused, the readability gate, the Testing-sign-off gate, four-eyes and the seal
-- (spec §14, §15.1, §17.2; L2, L3).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Cross-org: an Org B caller reads zero Org A rows in every Phase 5 table and cannot call a
--    Phase 5 RPC that targets an Org A object.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['observations', 'severity_levels', 'document_extractions', 'evidence_files',
                           'conclusion_records'] loop
    execute format('select count(*) from %I where org_id = %L', t, 'a0000000-0000-0000-0000-000000000001') into n;
    perform provio_test.assert_eq(n, 0::bigint, format('5E: an Org B caller reads zero Org A rows in %s', t));
  end loop;
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    'not found in this organisation', '5E: an Org B caller cannot pull Org A exceptions');
  perform provio_test.assert_raises(
    $q$select public.search_documents('50000000-0000-0000-0000-0000000000a1', 'x', 'conclusion')$q$,
    'not found in this organisation', '5E: an Org B caller cannot search Org A documents');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 2. Unauthenticated: anon cannot call any Phase 5 RPC and reads zero rows.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '5E: anon cannot pull exceptions');
  perform provio_test.assert_raises(
    $q$select public.sign_conclusion('50000000-0000-0000-0000-0000000000a1')$q$,
    null, '5E: anon cannot sign a conclusion');
  perform provio_test.assert_eq((select count(*) from observations), 0::bigint,
    '5E: anon reads zero observations');
  perform provio_test.assert_eq((select count(*) from conclusion_records), 0::bigint,
    '5E: anon reads zero conclusion records');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 3. No-right caller: the Observer holds neither perform_work nor review_and_approve.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.create_observation('50000000-0000-0000-0000-0000000000a1', null, 'T', '{}'::jsonb)$q$,
    'perform_work', '5E: an Observer cannot create an observation');
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    'review_and_approve', '5E: an Observer cannot pull exceptions');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 4. The readability gate: promotion is refused while a mandatory tag is missing.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_obs uuid;
begin
  v_obs := public.create_observation('50000000-0000-0000-0000-0000000000a1', null, 'Incomplete',
    jsonb_build_object('context', 'c'));
  perform provio_test.assert_raises(
    format($q$select public.promote_to_finding('%s')$q$, v_obs),
    'readability', '5E: an observation missing mandatory tags cannot become a finding');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 5. The Testing-sign-off gate: pull_exceptions is refused before Testing is signed off.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.pull_exceptions('50000000-0000-0000-0000-0000000000a1')$q$,
    'testing', '5E: exceptions cannot be pulled before Testing is signed off');
end $$;
select provio_test.as_owner();

-- ---------------------------------------------------------------------------
-- 6. Four-eyes and the seal: sign_conclusion writes a hash-chained entry and seals the engagement.
-- ---------------------------------------------------------------------------
insert into workpaper_rows (org_id, workpaper_id, row_ref, result) values
  ('a0000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-0000000000a1','R1','tick');
update workpapers set status = 'signed_off' where id = '60000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$ begin perform public.pull_exceptions('50000000-0000-0000-0000-0000000000a1'); end $$;
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform public.sign_conclusion('50000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_true(
    (select count(*) > 0 from ledger_entries
      where org_id = 'a0000000-0000-0000-0000-000000000001' and action = 'conclusion_signed_off'),
    '5E: signing the conclusion writes a hash-chained ledger entry');
  perform provio_test.assert_true(
    (select locked_at is not null from conclusion_records
      where engagement_id = '50000000-0000-0000-0000-0000000000a1'),
    '5E: signing the conclusion locks the record');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Document search is stage-aware and org-scoped.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-0000000000a1','plan.pdf','planning');
insert into document_extractions (org_id, file_id, extracted_text, page_count, extraction_status) values
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000a1','material weakness in revenue', 2, 'done');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v jsonb;
begin
  v := public.search_documents('50000000-0000-0000-0000-0000000000a1', 'material', 'planning');
  perform provio_test.assert_eq(jsonb_array_length(v), 1, '5E: a planning search finds the planning document');
  v := public.search_documents('50000000-0000-0000-0000-0000000000a1', 'material', 'conclusion');
  perform provio_test.assert_eq(jsonb_array_length(v), 1, '5E: a conclusion search also finds it');
end $$;
select provio_test.as_owner();

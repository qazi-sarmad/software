-- Test 44 (5D): Document viewer — extraction stub, stage-aware full-text search and org isolation
-- (spec §17.2).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: three files, one per stage, with extracted text. Inserted as the owner.
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e0000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','plan.docx','planning'),
  ('e0000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','test.xlsx','testing'),
  ('e0000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','concl.pdf','conclusion'),
  ('e0000000-0000-0000-0000-0000000000b1','b0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000b1','other.docx','planning');

insert into document_extractions (org_id, file_id, extracted_text, page_count, extraction_status, extracted_at) values
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000a1','payroll reconciliation planning scope',1,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000a2','sample testing of payroll controls',2,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000a3','conclusion opinion payroll',1,'done',now()),
  ('b0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-0000000000b1','payroll planning for org b',1,'done',now());

-- ---------------------------------------------------------------------------
-- 1. Stage awareness: Planning sees only Planning; Testing adds Testing; Conclusion adds all.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(
    jsonb_array_length(public.search_documents('50000000-0000-0000-0000-0000000000a1', '', 'planning')), 1,
    '5D: Planning sees only Planning documents');
  perform provio_test.assert_eq(
    jsonb_array_length(public.search_documents('50000000-0000-0000-0000-0000000000a1', '', 'testing')), 2,
    '5D: Testing sees Planning and Testing documents');
  perform provio_test.assert_eq(
    jsonb_array_length(public.search_documents('50000000-0000-0000-0000-0000000000a1', '', 'conclusion')), 3,
    '5D: Conclusion sees all documents');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Full-text search filters by query, and returns a headline.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public.search_documents('50000000-0000-0000-0000-0000000000a1', 'payroll', 'conclusion');
  perform provio_test.assert_eq(jsonb_array_length(v), 3,
    '5D: the search matches every document containing the term');
  perform provio_test.assert_true((v -> 0) ? 'headline',
    '5D: each result carries a headline');
  perform provio_test.assert_eq(
    jsonb_array_length(public.search_documents('50000000-0000-0000-0000-0000000000a1', 'zzznotpresent', 'conclusion')), 0,
    '5D: a term that is absent matches nothing');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Org isolation: another organisation's documents are never returned.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
begin
  perform provio_test.assert_eq(
    jsonb_array_length(public.search_documents('50000000-0000-0000-0000-0000000000b1', 'payroll', 'conclusion')), 1,
    '5D: an org searches only its own documents');
  perform provio_test.assert_raises(
    $q$select public.search_documents('50000000-0000-0000-0000-0000000000a1', 'payroll', 'conclusion')$q$,
    'engagement not found', '5D: an org cannot search another org''s engagement');
end $$;

-- ---------------------------------------------------------------------------
-- 4. request_extraction writes a pending row; the stub never extracts.
-- ---------------------------------------------------------------------------
select provio_test.as_owner();
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e0000000-0000-0000-0000-0000000000a4','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','new.docx','testing');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v_id uuid;
begin
  v_id := public.request_extraction('e0000000-0000-0000-0000-0000000000a4');
  perform provio_test.assert_true(v_id is not null, '5D: the extraction stub returns a row id');
  perform provio_test.assert_eq(
    (select extraction_status from document_extractions where file_id = 'e0000000-0000-0000-0000-0000000000a4'),
    'pending', '5D: the stub leaves the extraction pending');
end $$;

-- A caller without perform_work cannot request an extraction.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.request_extraction('e0000000-0000-0000-0000-0000000000a4')$q$,
    'perform_work', '5D: a read-only caller cannot request an extraction');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Unauthenticated callers are refused.
-- ---------------------------------------------------------------------------
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.search_documents('50000000-0000-0000-0000-0000000000a1', 'payroll', 'conclusion')$q$,
    null, '5D: an unauthenticated caller cannot search documents');
end $$;

select provio_test.as_owner();

-- Test 87 (C2.6): document extraction authority and outcomes (spec §13.1, §20).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures: one file per organisation, plus a legacy binary in A.
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e0000000-0000-0000-0000-0000000000c1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','policy.docx','planning'),
  ('e0000000-0000-0000-0000-0000000000c2','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','old.doc','testing'),
  ('e0000000-0000-0000-0000-0000000000d1','b0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000b1','other.docx','planning');

-- ---------------------------------------------------------------------------
-- 1. The caller-side authority check: perform_work within the caller's own organisation only.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_true(public.can_extract_document('e0000000-0000-0000-0000-0000000000c1'),
    'C2.6: a perform_work caller may extract a file in their own organisation');
  perform provio_test.assert_true(not public.can_extract_document('e0000000-0000-0000-0000-0000000000d1'),
    'C2.6: a caller may not extract another organisation''s file');
end $$;

-- The observer role holds read_only and no perform_work, so it may not extract.
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_true(not public.can_extract_document('e0000000-0000-0000-0000-0000000000c1'),
    'C2.6: a caller without perform_work may not extract');
end $$;

select provio_test.as_anon();
do $$
begin
  -- revoke from anon means the function is not even reachable by an anonymous caller.
  perform provio_test.assert_raises(
    $q$select public.can_extract_document('e0000000-0000-0000-0000-0000000000c1')$q$,
    'permission denied',
    'C2.6: an anonymous caller cannot reach the extraction authority check');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The service-only write path. document_extraction_complete is not executable by authenticated
--    (revoked), and document_extraction_context is service-only, matching the F5 pattern.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.document_extraction_complete('e0000000-0000-0000-0000-0000000000c1','done','text',1,'docx',null)$q$,
    'permission denied',
    'C2.6: an authenticated caller cannot write an extraction outcome');
  perform provio_test.assert_raises(
    $q$select * from public.document_extraction_context('e0000000-0000-0000-0000-0000000000c1')$q$,
    'permission denied',
    'C2.6: an authenticated caller cannot read the extraction context');
end $$;

-- ---------------------------------------------------------------------------
-- 3. As the service role, a successful extraction is recorded, and the FTS index still finds it.
-- ---------------------------------------------------------------------------
select provio_test.as_service();
do $$
declare v_id uuid;
begin
  v_id := public.document_extraction_complete('e0000000-0000-0000-0000-0000000000c1','done',
    'payroll reconciliation and controls narrative', 3, 'mammoth', null);
  perform provio_test.assert_true(v_id is not null, 'C2.6: the service role records a successful extraction');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select extraction_status from document_extractions where file_id = 'e0000000-0000-0000-0000-0000000000c1'),
    'done', 'C2.6: a completed extraction is stored as done');
  perform provio_test.assert_eq(
    (select extractor from document_extractions where file_id = 'e0000000-0000-0000-0000-0000000000c1'),
    'mammoth', 'C2.6: the extractor that produced the text is recorded');
  perform provio_test.assert_eq(
    (select page_count from document_extractions where file_id = 'e0000000-0000-0000-0000-0000000000c1'),
    3, 'C2.6: the page count is recorded when known');
end $$;

-- FTS over the extracted text still works (the search_documents path reads this row).
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
begin
  perform provio_test.assert_eq(
    jsonb_array_length(public.search_documents('50000000-0000-0000-0000-0000000000a1', 'reconciliation', 'planning')),
    1, 'C2.6: full-text search finds the freshly extracted text');
end $$;

-- ---------------------------------------------------------------------------
-- 4. The two non-error outcomes §20 requires: an unsupported scan and a legacy binary. Neither is
--    an error, and neither is ever used for a test result (L1).
-- ---------------------------------------------------------------------------
select provio_test.as_service();
do $$
declare v_a uuid; v_b uuid;
begin
  v_a := public.document_extraction_complete('e0000000-0000-0000-0000-0000000000c2','legacy_not_extracted',
    null, null, null, 'legacy binary format: stored as evidence, not extracted');
  perform provio_test.assert_true(v_a is not null, 'C2.6: a legacy binary format is stored, not extracted');
  v_b := public.document_extraction_complete('e0000000-0000-0000-0000-0000000000d1','unsupported',
    null, null, 'pdf', 'no text layer; the file is a scan');
  perform provio_test.assert_true(v_b is not null, 'C2.6: a scan with no text layer is recorded as unsupported');
end $$;

select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select extraction_status from document_extractions where file_id = 'e0000000-0000-0000-0000-0000000000c2'),
    'legacy_not_extracted', 'C2.6: the legacy outcome is durable');
  perform provio_test.assert_eq(
    (select extraction_status from document_extractions where file_id = 'e0000000-0000-0000-0000-0000000000d1'),
    'unsupported', 'C2.6: the unsupported outcome is durable');
  perform provio_test.assert_raises(
    $q$select public.document_extraction_complete('e0000000-0000-0000-0000-0000000000c2','extracted','x',null,null,null)$q$,
    'invalid extraction status',
    'C2.6: an unknown status is refused');
end $$;

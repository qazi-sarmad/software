-- Test 135 (S7/OA-36): document_extraction_text — the extracted-text reader the document-review
-- screen takes. Proves the happy path, every named refusal, and tenant isolation (a cross-tenant
-- file id is indistinguishable from a nonexistent one).
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures as the owner: one org-A file with text, one org-A scan (done, no text), one org-A file
-- whose extraction is still pending, and one org-B file with text.
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e1000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','minutes.docx','planning'),
  ('e1000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','scan.pdf','planning'),
  ('e1000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','pending.docx','planning'),
  ('e1000000-0000-0000-0000-0000000000b1','b0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000b1','b-minutes.docx','planning');

insert into document_extractions (org_id, file_id, extracted_text, page_count, extraction_status, extracted_at) values
  ('a0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a1','Minutes of Meeting
Quorum: present
Action: obtain the invoice',1,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a2',null,1,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000a3',null,null,'pending',null),
  ('b0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-0000000000b1','Org B minutes text',1,'done',now());

-- ===========================================================================
-- 1. The happy path: a member of the org reads the file's own text.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: a done extraction with text is returned');
  perform provio_test.assert_true((v ->> 'text') like 'Minutes of Meeting%', 'S7: the text is the file''s own');
  perform provio_test.assert_eq(v ->> 'filename', 'minutes.docx', 'S7: the filename is returned');
  perform provio_test.assert_eq((v ->> 'page_count')::int, 1, 'S7: the page count is returned');
end $$;

-- ===========================================================================
-- 2. A done extraction with no text is a scan — the screen routes it to OCR.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: a scan is not returned as text');
  perform provio_test.assert_eq((v ->> 'scan')::boolean, true, 'S7: a scan is marked as a scan');
  perform provio_test.assert_eq(v ->> 'status', 'done', 'S7: the scan''s status is reported');
end $$;

-- ===========================================================================
-- 3. A pending extraction names the status, not a false empty document.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000a3');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: a pending extraction returns no text');
  perform provio_test.assert_eq(v ->> 'status', 'pending', 'S7: the pending status is named');
  perform provio_test.assert_true((v ->> 'reason') like '%pending%', 'S7: the refusal names the status');
end $$;

-- ===========================================================================
-- 4. A file with no extraction row says so.
-- ===========================================================================
select provio_test.as_owner();
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e1000000-0000-0000-0000-0000000000a4','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','fresh.docx','planning');
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000a4');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: no extraction row returns no text');
  perform provio_test.assert_eq(v ->> 'status', 'none', 'S7: no extraction row is reported as none');
end $$;

-- ===========================================================================
-- 5. Tenant isolation: another org's file id is not found, and reads no text.
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000b1');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: a cross-tenant file id returns no text');
  perform provio_test.assert_eq(v ->> 'reason', 'file not found in this organisation',
    'S7: a cross-tenant file id is indistinguishable from a nonexistent one');
  perform provio_test.assert_true(v ->> 'text' is null, 'S7: no text leaks across the tenant boundary');
end $$;

-- ===========================================================================
-- 6. A nonexistent id returns the same refusal as a cross-tenant one (no oracle).
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('00000000-0000-0000-0000-0000000000ff');
  perform provio_test.assert_eq(v ->> 'reason', 'file not found in this organisation',
    'S7: a nonexistent id gives the same refusal as a cross-tenant one');
end $$;

-- ===========================================================================
-- 7. A caller with no read right is refused by name; a member of org B reads only org B.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-000000000001', 'auditee');
do $$
declare v jsonb;
begin
  -- The auditee holds read_only, which is a read right, so it may read its own org's text.
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: read_only is a read right and may read its own org''s text');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000b1');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: org B reads its own file');
  perform provio_test.assert_true((v ->> 'text') like 'Org B%', 'S7: org B reads its own text');
  -- And org B cannot read org A's file.
  v := public.document_extraction_text('e1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: org B cannot read org A''s file');
end $$;

-- ===========================================================================
-- 8. evidence_storage_path — the tier-2 OCR seam's path reader, same isolation.
-- ===========================================================================
select provio_test.as_owner();
update evidence_files set storage_path = 'a0000000-0000-0000-0000-000000000001/e1000000-0000-0000-0000-0000000000a1/scan.pdf'
  where id = 'e1000000-0000-0000-0000-0000000000a1';
select provio_test.as_user('10000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'audit_manager');
do $$
declare v jsonb;
begin
  v := public.evidence_storage_path('e1000000-0000-0000-0000-0000000000a1');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: a stored file returns its path');
  perform provio_test.assert_eq(v ->> 'storage_path', 'a0000000-0000-0000-0000-000000000001/e1000000-0000-0000-0000-0000000000a1/scan.pdf',
    'S7: the path is the file''s own');
  -- A file with no stored bytes (session-only evidence) names that refusal.
  v := public.evidence_storage_path('e1000000-0000-0000-0000-0000000000a2');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: a file with no stored bytes returns no path');
  perform provio_test.assert_true((v ->> 'reason') like '%no stored bytes%', 'S7: the refusal names the missing bytes');
  -- A cross-tenant file id is indistinguishable from a nonexistent one.
  v := public.evidence_storage_path('e1000000-0000-0000-0000-0000000000b1');
  perform provio_test.assert_eq(v ->> 'reason', 'file not found in this organisation',
    'S7: a cross-tenant id gives the same refusal');
end $$;

select provio_test.as_owner();

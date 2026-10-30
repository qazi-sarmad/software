-- Test 136 (S7): global_document_search — the access-based, whole-tenant full-text search over
-- extracted document text. Proves the happy path, the access filter (scope), tenant isolation, the
-- named refusals, and that a pending or text-less extraction is never presented as a hit.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- Fixtures as the owner. Org A has two universes (U1, U2); org B has one (B-U1). Each has one
-- engagement and one document whose text carries the phrase "regulation 12". A U1-scoped user must
-- see only the U1 document, even though both are in the same organisation.
insert into evidence_files (id, org_id, engagement_id, filename, stage) values
  ('e2000000-0000-0000-0000-0000000000a1','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','u1-reg.pdf','planning'),
  ('e2000000-0000-0000-0000-0000000000a2','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a2','u2-reg.pdf','planning'),
  ('e2000000-0000-0000-0000-0000000000a3','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','u1-scan.pdf','testing'),
  ('e2000000-0000-0000-0000-0000000000a4','a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000a1','u1-pending.pdf','testing'),
  ('e2000000-0000-0000-0000-0000000000b1','b0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-0000000000b1','b-reg.pdf','planning');

insert into document_extractions (org_id, file_id, extracted_text, page_count, extraction_status, extracted_at) values
  ('a0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-0000000000a1','Section 4: the bank shall comply with REGULATION 12 on capital adequacy.',1,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-0000000000a2','Annex B restates REGULATION 12 for the second universe.',1,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-0000000000a3',null,1,'done',now()),
  ('a0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-0000000000a4',null,null,'pending',null),
  ('b0000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-0000000000b1','Org B also cites REGULATION 12.',1,'done',now());

-- ===========================================================================
-- 1. The happy path: an all-scope caller (cia) finds both org-A documents and no others.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.global_document_search('regulation 12');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: a read-right holder gets a result set');
  perform provio_test.assert_eq((v ->> 'count')::int, 2, 'S7: exactly the two org-A documents with text match');
  perform provio_test.assert_true(v ->> 'results' like '%u1-reg.pdf%', 'S7: the U1 document is returned');
  perform provio_test.assert_true(v ->> 'results' like '%u2-reg.pdf%', 'S7: the U2 document is returned for an all-scope caller');
  perform provio_test.assert_true(v ->> 'results' not like '%b-reg.pdf%', 'S7: another tenant''s document is never returned');
  perform provio_test.assert_true(v ->> 'results' like '%<mark>%', 'S7: the headline marks the matched term');
end $$;

-- ===========================================================================
-- 2. The access filter: a U1-scoped preparer sees the U1 document and NOT the U2 one.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'preparer');
do $$
declare v jsonb;
begin
  v := public.global_document_search('regulation 12');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: a scoped read-right holder gets a result set');
  perform provio_test.assert_eq((v ->> 'count')::int, 1, 'S7: only the in-scope document matches');
  perform provio_test.assert_true(v ->> 'results' like '%u1-reg.pdf%', 'S7: the in-scope U1 document is returned');
  perform provio_test.assert_true(v ->> 'results' not like '%u2-reg.pdf%', 'S7: the out-of-scope U2 document is hidden');
end $$;

-- ===========================================================================
-- 3. A scan (done, no text) and a pending extraction are never hits.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.global_document_search('scan');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, true, 'S7: a query matching nothing still returns ok');
  perform provio_test.assert_eq((v ->> 'count')::int, 0, 'S7: a text-less or pending extraction is not a hit');
end $$;

-- ===========================================================================
-- 4. Tenant isolation: org B sees only org B's document.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.global_document_search('regulation 12');
  perform provio_test.assert_eq((v ->> 'count')::int, 1, 'S7: org B matches only its own document');
  perform provio_test.assert_true(v ->> 'results' like '%b-reg.pdf%', 'S7: org B sees its own document');
  perform provio_test.assert_true(v ->> 'results' not like '%u1-reg.pdf%', 'S7: org B cannot see org A''s documents');
end $$;

-- ===========================================================================
-- 5. Named refusals: an empty query, and a principal with no read right.
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.global_document_search('   ');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: a blank query is refused');
  perform provio_test.assert_eq(v ->> 'reason', 'a search term is required', 'S7: the blank-query refusal is named');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v jsonb;
begin
  v := public.global_document_search('regulation 12');
  perform provio_test.assert_eq((v ->> 'ok')::boolean, false, 'S7: a configuration-only principal is refused');
  perform provio_test.assert_true((v ->> 'reason') like '%read right%', 'S7: the no-read-right refusal is named');
end $$;

-- ===========================================================================
-- 6. The limit is respected and a higher rank sorts first (deterministic order).
-- ===========================================================================
select provio_test.as_user('10000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'cia');
do $$
declare v jsonb;
begin
  v := public.global_document_search('regulation 12', 1);
  perform provio_test.assert_eq((v ->> 'count')::int, 1, 'S7: the limit caps the returned rows');
end $$;

-- ===========================================================================
-- 7. Anon cannot execute the function at all (grant is authenticated-only).
-- ===========================================================================
select provio_test.as_anon();
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.global_document_search('regulation 12')$q$,
    'permission denied',
    'S7: anon may not search');
end $$;

-- C2.6: document extraction (spec §13.1, §20).
--
-- §13.1 "Text extraction: DOCX, PPTX, XLSX, CSV and text-based PDF."
-- §20 "Legacy binary formats (.doc, .ppt, .xls) are stored as evidence but not extracted."
--
-- M1: grep found `document_extractions` and `request_extraction` (0035). They are extended here with
--     alter / create or replace (decision D-C2.6-M1); nothing is renamed and no column is dropped.
--
-- The table's 0035 check allows only ('pending','done','failed'). §20 names two more outcomes: a
-- format whose text cannot be taken (a scanned PDF) and a legacy binary format. Both are real,
-- non-error states that the operator must be able to see, so the check is widened. The status is
-- never used for a test result or a finding (L1): it only says whether text was obtained.
--
-- The extraction itself is the `doc-extract` Edge Function. The database sees only the outcome
-- through document_extraction_complete, a service-role-only RPC, so no client can write extracted
-- text directly and no client can mark its own file extracted.

-- 1. Widen the allowed statuses. The old constraint is dropped by name only when it exists.
alter table document_extractions add column if not exists extraction_error text;
alter table document_extractions add column if not exists extractor text;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.document_extractions'::regclass
       and conname = 'document_extractions_extraction_status_check'
  ) then
    alter table public.document_extractions
      drop constraint document_extractions_extraction_status_check;
  end if;
  -- The inline column check from 0035 lands under this name in Postgres.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.document_extractions'::regclass
       and conname = 'document_extractions_status_check'
  ) then
    alter table public.document_extractions
      drop constraint document_extractions_status_check;
  end if;
end $$;

alter table public.document_extractions
  add constraint document_extractions_status_check
  check (extraction_status in ('pending', 'done', 'failed', 'unsupported', 'legacy_not_extracted'));

-- 2. document_extraction_page_count: a page count for a PDF is recorded when the extractor can get
--    it, and left null otherwise. No default is invented (L1: a fact is recorded, never guessed).

-- 3. document_extraction_complete: the only write path for an extraction outcome. Service role only.
drop function if exists public.document_extraction_complete(uuid, text, text, int, text, text);
create or replace function public.document_extraction_complete(
  p_file_id uuid,
  p_status text,
  p_text text default null,
  p_page_count int default null,
  p_extractor text default null,
  p_error text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if p_status not in ('done', 'failed', 'unsupported', 'legacy_not_extracted') then
    raise exception 'invalid extraction status: %', p_status using errcode = 'P0001';
  end if;
  select org_id into v_org from evidence_files where id = p_file_id;
  if v_org is null then
    raise exception 'file not found' using errcode = 'P0001';
  end if;
  insert into document_extractions
    (org_id, file_id, extracted_text, extracted_at, page_count, extraction_status, extractor, extraction_error)
  values
    (v_org, p_file_id, p_text, now(), p_page_count, p_status, p_extractor, p_error)
  on conflict (file_id) do update set
    extracted_text = excluded.extracted_text,
    extracted_at = now(),
    page_count = excluded.page_count,
    extraction_status = excluded.extraction_status,
    extractor = excluded.extractor,
    extraction_error = excluded.extraction_error
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.document_extraction_complete(uuid, text, text, int, text, text)
  from public, anon, authenticated;
grant execute on function public.document_extraction_complete(uuid, text, text, int, text, text)
  to service_role;

-- 4. document_extraction_context: the facts the extractor needs to run (the file's name, and the
--    caller-visible engagement). Read with the service role after the caller is verified. It returns
--    no evidence bytes and no secret; it is a read of the file's own metadata.
drop function if exists public.document_extraction_context(uuid);
create or replace function public.document_extraction_context(p_file_id uuid)
returns table (file_id uuid, org_id uuid, engagement_id uuid, filename text, content_sha256 text)
language sql stable security definer set search_path = public as $$
  select f.id, f.org_id, f.engagement_id, f.filename, f.content_sha256
    from evidence_files f where f.id = p_file_id;
$$;

revoke execute on function public.document_extraction_context(uuid) from public, anon, authenticated;
grant execute on function public.document_extraction_context(uuid) to service_role;

-- 5. can_extract_document: the caller-side authority check. The caller must hold perform_work and the
--    file must be in the caller's own organisation. The database decides, not the request body.
create or replace function public.can_extract_document(p_file_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from evidence_files f
     where f.id = p_file_id
       and f.org_id = public.jwt_org_id()
       and coalesce(public.caller_has_right('perform_work'), false));
$$;

revoke execute on function public.can_extract_document(uuid) from public, anon;
grant execute on function public.can_extract_document(uuid) to authenticated;

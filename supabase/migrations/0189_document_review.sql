-- 0189 (S7): the extracted-text reader the document-review screen needs.
--
-- The document-review screen (OA-36) parses an attached document's text and runs the structural,
-- sequential and pattern reviews over it. Tier 1 already stores that text: `document_extractions`
-- (0035) holds `extracted_text`, written by the doc-extract Edge Function (0078). But nothing hands
-- the text to a *screen*: `search_documents` (0035) returns only a ts_headline snippet, and the table
-- itself carries no read path a component may take (components never import the client, rule M8).
--
-- So this migration adds ONE reader: `document_extraction_text(p_file_id)`. It returns the caller's
-- own organisation's extracted text for a file, or a named refusal. It reads nothing else and writes
-- nothing, so it cannot leave a partial write.
--
-- L2: the only read path is RLS + `jwt_org_id()`. The function is security definer because it must
-- read `document_extractions` on the caller's behalf, but it filters every row by `jwt_org_id()`, so
-- a cross-tenant file id returns the same "not found in this organisation" a nonexistent id does —
-- it never reveals that another tenant's file exists.
--
-- M1: grepped migrations and tests for `document_extraction_text`; new, not redefined.
-- M2: create or replace; no table changes shape. M6: applied twice and all SQL tests run twice.

-- ---------------------------------------------------------------------------
-- 1. document_extraction_text(p_file_id) -> jsonb
--    {ok:true, text, status, page_count, filename} when the file is the caller's org's and extracted;
--    {ok:false, reason} otherwise (not found / not extracted / no right). Never raises for a caller
--    input, so a screen can render the reason in place.
-- ---------------------------------------------------------------------------
create or replace function public.document_extraction_text(p_file_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_file record;
  v_text text;
  v_status text;
  v_pages int;
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'not signed in');
  end if;
  if p_file_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no file was named');
  end if;
  if not coalesce(public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')
                  or public.caller_has_right('read_only'), false) then
    return jsonb_build_object('ok', false, 'reason', 'not permitted: a read right is required');
  end if;

  -- The org filter is the whole of the isolation: a file of another tenant is simply absent here.
  select f.id, f.filename into v_file
    from evidence_files f
   where f.id = p_file_id and f.org_id = v_org;
  if v_file.id is null then
    return jsonb_build_object('ok', false, 'reason', 'file not found in this organisation');
  end if;

  select d.extracted_text, d.extraction_status, d.page_count
    into v_text, v_status, v_pages
    from document_extractions d
   where d.file_id = p_file_id and d.org_id = v_org;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'no extraction has been requested for this file',
                              'status', 'none', 'filename', v_file.filename);
  end if;
  if v_status <> 'done' then
    return jsonb_build_object('ok', false, 'reason', format('extraction is %s, not done', v_status),
                              'status', v_status, 'filename', v_file.filename);
  end if;
  if coalesce(btrim(v_text), '') = '' then
    -- A done extraction with no text is a scan: the screen routes it to the OCR seam (tier 2).
    return jsonb_build_object('ok', false, 'reason', 'the extraction holds no text layer',
                              'status', v_status, 'filename', v_file.filename, 'scan', true);
  end if;

  return jsonb_build_object('ok', true, 'text', v_text, 'status', v_status,
                            'page_count', v_pages, 'filename', v_file.filename);
end $$;

comment on function public.document_extraction_text(uuid) is
  'S7/OA-36: reads a file''s tier-1 extracted text for the caller''s own organisation, or a named refusal. The only read path is RLS + jwt_org_id(); a cross-tenant file id is indistinguishable from a nonexistent one.';

-- ---------------------------------------------------------------------------
-- 2. evidence_storage_path(p_file_id) -> jsonb
--    {ok:true, storage_path} when the file is the caller's org's and has stored bytes; {ok:false,
--    reason} otherwise. The tier-2 OCR seam needs the stored bytes of a scan to read it locally, and
--    the screen may not read the table directly. Same isolation as above: the org filter is the whole
--    of it, so a cross-tenant id is indistinguishable from a nonexistent one.
-- ---------------------------------------------------------------------------
create or replace function public.evidence_storage_path(p_file_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_path text;
begin
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'not signed in');
  end if;
  if p_file_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no file was named');
  end if;
  if not coalesce(public.caller_has_right('perform_work') or public.caller_has_right('review_and_approve')
                  or public.caller_has_right('read_only'), false) then
    return jsonb_build_object('ok', false, 'reason', 'not permitted: a read right is required');
  end if;

  select f.storage_path into v_path
    from evidence_files f
   where f.id = p_file_id and f.org_id = v_org;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'file not found in this organisation');
  end if;
  if coalesce(btrim(v_path), '') = '' then
    -- Session-only evidence: the bytes were never stored, so there is nothing to read.
    return jsonb_build_object('ok', false, 'reason', 'this evidence holds no stored bytes');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', v_path);
end $$;

comment on function public.evidence_storage_path(uuid) is
  'S7/OA-36: returns a file''s stored-bytes path for the caller''s own organisation, or a named refusal. The tier-2 OCR seam reads a scan from these bytes; nothing leaves the tenant.';

-- ---------------------------------------------------------------------------
-- 3. Grants. Any authenticated member of the org may read their own org's evidence path (AF-11).
-- ---------------------------------------------------------------------------
revoke execute on function public.evidence_storage_path(uuid) from public, anon;
grant execute on function public.evidence_storage_path(uuid) to authenticated;

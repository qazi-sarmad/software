-- 5D: Document viewer DB and full-text search (spec §17.2).
--
-- The spec:
--   §17.2 "Stage-aware: Planning shows Planning documents; Testing shows Planning and Testing
--          documents; Conclusion shows all documents. … Full-text search over extracted text from
--          supported documents."
--
-- Reuse (grep first): no evidence-file table existed in the database. `evidence_files` is created
-- here as the minimal anchor the task's `file_id` needs; extraction is out of scope (NOT-DONE) and
-- the extraction row is written by a stub that returns immediately.

-- ---------------------------------------------------------------------------
-- evidence_files: the file a document extraction belongs to. Tenant-scoped.
-- ---------------------------------------------------------------------------
create table if not exists evidence_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  workpaper_id uuid null references workpapers(id) on delete set null,
  filename text not null,
  stage text not null default 'testing' check (stage in ('planning', 'testing', 'conclusion')),
  content_sha256 text null,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists evidence_files_engagement_idx on evidence_files (org_id, engagement_id, stage);

alter table evidence_files enable row level security;
drop policy if exists evidence_files_select on evidence_files;
create policy evidence_files_select on evidence_files for select to authenticated
  using (org_id = public.jwt_org_id());

drop trigger if exists evidence_files_pin_org on evidence_files;
create trigger evidence_files_pin_org before insert on evidence_files
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- document_extractions: the extracted text for a file (§17.2). Extraction is asynchronous: a stub
-- writes a 'pending' row and returns; the real extractor is out of scope (NOT-DONE).
-- ---------------------------------------------------------------------------
create table if not exists document_extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  file_id uuid not null references evidence_files(id) on delete cascade,
  extracted_text text null,
  extracted_at timestamptz null,
  page_count int null,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now(),
  unique (file_id)
);
create index if not exists document_extractions_org_idx on document_extractions (org_id, file_id);

-- Full-text search index over the extracted text (English). Created only when the column is present.
create index if not exists document_extractions_fts_idx
  on document_extractions using gin (to_tsvector('english', coalesce(extracted_text, '')));

alter table document_extractions enable row level security;
drop policy if exists document_extractions_select on document_extractions;
create policy document_extractions_select on document_extractions for select to authenticated
  using (org_id = public.jwt_org_id());

drop trigger if exists document_extractions_pin_org on document_extractions;
create trigger document_extractions_pin_org before insert on document_extractions
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- request_extraction: the stub. Writes a pending row for a file and returns. The real extraction
-- (an edge function) is out of scope and recorded in NOT-DONE. Rights: perform_work.
-- ---------------------------------------------------------------------------
create or replace function public.request_extraction(p_file_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from evidence_files f where f.id = p_file_id and f.org_id = v_org) then
    raise exception 'file not found in this organisation' using errcode = 'P0001';
  end if;
  insert into document_extractions (org_id, file_id, extraction_status)
  values (v_org, p_file_id, 'pending')
  on conflict (file_id) do update set extraction_status = 'pending'
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- search_documents: full-text search over the caller's organisation, filtered by engagement and by
-- stage (§17.2 stage awareness: Planning shows Planning documents; Testing adds Testing; Conclusion
-- adds all). Returns the matching extraction rows with a headline.
-- ---------------------------------------------------------------------------
create or replace function public.search_documents(
  p_engagement_id uuid, p_query text, p_stage text default 'conclusion'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_stages text[];
  v_out jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_stage not in ('planning', 'testing', 'conclusion') then
    raise exception 'invalid stage: %', p_stage using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;

  -- Stage awareness: Planning sees Planning documents; Testing sees Planning and Testing; Conclusion
  -- sees all three.
  v_stages := case p_stage
    when 'planning' then array['planning']
    when 'testing' then array['planning', 'testing']
    else array['planning', 'testing', 'conclusion']
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'extraction_id', d.id,
           'file_id', d.file_id,
           'filename', f.filename,
           'stage', f.stage,
           'page_count', d.page_count,
           'status', d.extraction_status,
           'headline', ts_headline('english', coalesce(d.extracted_text, ''),
                                    plainto_tsquery('english', coalesce(p_query, '')),
                                    'MaxWords=20, MinWords=5')
         ) order by f.filename), '[]'::jsonb)
    into v_out
  from document_extractions d
  join evidence_files f on f.id = d.file_id
  where d.org_id = v_org and f.org_id = v_org
    and f.engagement_id = p_engagement_id
    and f.stage = any (v_stages)
    and d.extraction_status = 'done'
    and (coalesce(btrim(p_query), '') = ''
         or to_tsvector('english', coalesce(d.extracted_text, ''))
            @@ plainto_tsquery('english', p_query));
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.request_extraction(uuid) from public, anon;
revoke execute on function public.search_documents(uuid, text, text) from public, anon;

grant execute on function public.request_extraction(uuid) to authenticated;
grant execute on function public.search_documents(uuid, text, text) to authenticated;

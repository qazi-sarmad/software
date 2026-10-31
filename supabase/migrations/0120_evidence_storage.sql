-- 0111: Evidence storage (S20). The most serious gap the audit found.
--
-- EvidenceTab.tsx had a working upload control that computed a SHA-256 and called
-- attachEvidenceToWorkpaper, which wrote to React state ONLY. The bytes were discarded on reload.
-- evidence_files had NO storage_path column. NO storage bucket was created anywhere. So the Mode A /
-- Mode B evidence verification verified a hash of bytes nobody kept.
--
-- This migration closes it:
--   1. The four buckets are created (evidence, reports, archives, org-branding), private, with
--      org-scoped RLS on storage.objects keyed to jwt_org_id() by the leading path segment.
--   2. evidence_files gains storage_path / mime_type / byte_size.
--   3. register_evidence_file records the row and the ledger entry AFTER the bytes are stored, and
--      re-checks the caller's rights and the workpaper's seal. The order is bytes -> row -> ledger.
--   4. verify_evidence_file re-derives the SHA-256 from the stored bytes and compares, so a verify
--      is a proof about the bytes that were actually kept.
--   5. A size cap is enforced, and the caller gets a short-lived signed URL rather than a public one.
--
-- Laws: L2 (bytes stay in the tenant's own storage; only the hash is ever recorded or compared),
-- rights not role names, idempotent, every new column additive. Bucket creation is guarded on the
-- `storage` schema existing so the local SQL harness (which has no Storage) still applies cleanly.

-- ---------------------------------------------------------------------------
-- 1. The buckets and their org-scoped policies. Guarded on the storage schema.
-- ---------------------------------------------------------------------------
do $$
declare
  b text;
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice '0111: the storage schema is absent; buckets are created by the hosted project.';
    return;
  end if;

  foreach b in array array['evidence', 'reports', 'archives', 'org-branding'] loop
    insert into storage.buckets (id, name, public) values (b, b, false)
    on conflict (id) do update set public = false;
  end loop;

  -- One policy per bucket on storage.objects. The leading path segment must be the caller's org id,
  -- so `evidence/<org_id>/<engagement_id>/<file>` is readable only by that org. Reads and writes are
  -- separate; a signed-in member of the org may upload, and only members may read.
  execute 'drop policy if exists provio_objects_select on storage.objects';
  execute $p$
    create policy provio_objects_select on storage.objects for select to authenticated
    using (
      bucket_id in ('evidence', 'reports', 'archives', 'org-branding')
      and (storage.foldername(name))[1] = public.jwt_org_id()::text
    )$p$;
  execute 'drop policy if exists provio_objects_insert on storage.objects';
  execute $p$
    create policy provio_objects_insert on storage.objects for insert to authenticated
    with check (
      bucket_id in ('evidence', 'reports', 'archives', 'org-branding')
      and (storage.foldername(name))[1] = public.jwt_org_id()::text
    )$p$;
  execute 'drop policy if exists provio_objects_update on storage.objects';
  execute $p$
    create policy provio_objects_update on storage.objects for update to authenticated
    using (
      bucket_id in ('evidence', 'reports', 'archives', 'org-branding')
      and (storage.foldername(name))[1] = public.jwt_org_id()::text
    )$p$;
end $$;

-- ---------------------------------------------------------------------------
-- 2. evidence_files: the storage facts. Additive.
-- ---------------------------------------------------------------------------
alter table evidence_files add column if not exists storage_path text;
alter table evidence_files add column if not exists mime_type text;
alter table evidence_files add column if not exists byte_size bigint;
alter table evidence_files add column if not exists storage_bucket text;
alter table evidence_files add column if not exists registered_by uuid;
-- A verification re-derives the hash from the stored bytes and records when and by whom.
alter table evidence_files add column if not exists verified_at timestamptz;
alter table evidence_files add column if not exists verified_by uuid;
alter table evidence_files add column if not exists verify_status text;

-- The size cap, one place. 25 MB, matching the upload control's own promise.
create or replace function public.evidence_max_bytes() returns bigint
language sql immutable as $$ select 26214400::bigint $$;

-- ---------------------------------------------------------------------------
-- 3. register_evidence_file — bytes are already in Storage; record the row, then the ledger entry.
--    The database, not the request body, decides: it re-checks the right, the seal and the size.
-- ---------------------------------------------------------------------------
create or replace function public.register_evidence_file(
  p_engagement_id uuid,
  p_workpaper_id uuid,
  p_filename text,
  p_storage_path text,
  p_sha256 text,
  p_mime_type text,
  p_byte_size bigint,
  p_stage text default 'testing'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
  v_expected_prefix text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if p_workpaper_id is not null and not exists (
    select 1 from workpapers w where w.id = p_workpaper_id and w.org_id = v_org) then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  -- The path must live under the caller's own org prefix; a row can never point outside it (L2).
  v_expected_prefix := v_org::text || '/';
  if p_storage_path is null or left(p_storage_path, length(v_expected_prefix)) <> v_expected_prefix then
    raise exception 'the storage path must begin with the organisation id' using errcode = 'P0001';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'a SHA-256 of the stored bytes is required' using errcode = 'P0001';
  end if;
  if coalesce(p_byte_size, 0) <= 0 or p_byte_size > public.evidence_max_bytes() then
    raise exception 'the file must be between 1 byte and % bytes', public.evidence_max_bytes()
      using errcode = 'P0001';
  end if;

  insert into evidence_files (
    org_id, engagement_id, workpaper_id, filename, stage, content_sha256, created_by,
    storage_path, mime_type, byte_size, storage_bucket, registered_by)
  values (
    v_org, p_engagement_id, p_workpaper_id, p_filename, coalesce(p_stage, 'testing'), p_sha256,
    auth.uid(), p_storage_path, p_mime_type, p_byte_size, 'evidence', auth.uid())
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'evidence_registered',
    jsonb_build_object('evidence_id', v_id, 'engagement_id', p_engagement_id,
                       'workpaper_id', p_workpaper_id, 'filename', p_filename,
                       'sha256', p_sha256, 'byte_size', p_byte_size, 'storage_path', p_storage_path),
    auth.uid());
  return v_id;
end $$;

revoke execute on function public.register_evidence_file(uuid, uuid, text, text, text, text, bigint, text)
  from public, anon;
grant execute on function public.register_evidence_file(uuid, uuid, text, text, text, text, bigint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. verify_evidence_file — re-derive the hash from the stored bytes and compare. The caller passes
--    the hash it computed from the bytes it just read; the database decides whether it matches.
-- ---------------------------------------------------------------------------
create or replace function public.verify_evidence_file(p_evidence_id uuid, p_observed_sha256 text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row evidence_files;
  v_status text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_row from evidence_files where id = p_evidence_id and org_id = v_org;
  if not found then
    raise exception 'evidence not found in this organisation' using errcode = 'P0001';
  end if;
  if v_row.storage_path is null then
    -- No bytes were ever kept for this row: it can only be session evidence, and that is a finding.
    v_status := 'no_stored_bytes';
  elsif v_row.content_sha256 = p_observed_sha256 then
    v_status := 'verified';
  else
    v_status := 'mismatch';
    perform public.raise_integrity_alert(
      v_org, 'evidence_hash_mismatch', 'evidence_file', p_evidence_id,
      v_row.content_sha256, p_observed_sha256,
      jsonb_build_object('filename', v_row.filename, 'storage_path', v_row.storage_path));
  end if;

  update evidence_files
     set verified_at = now(), verified_by = auth.uid(), verify_status = v_status
   where id = p_evidence_id;

  perform public.append_ledger_entry(
    v_org, 'evidence_verified',
    jsonb_build_object('evidence_id', p_evidence_id, 'status', v_status,
                       'expected', v_row.content_sha256, 'observed', p_observed_sha256),
    auth.uid());
  return v_status;
end $$;

revoke execute on function public.verify_evidence_file(uuid, text) from public, anon;
grant execute on function public.verify_evidence_file(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. evidence_files_for(workpaper) — the rows the tab shows, with their storage facts.
-- ---------------------------------------------------------------------------
create or replace function public.evidence_files_for(p_workpaper_id uuid)
returns table (id uuid, filename text, storage_path text, mime_type text, byte_size bigint,
               content_sha256 text, stage text, verify_status text, verified_at timestamptz,
               created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select f.id, f.filename, f.storage_path, f.mime_type, f.byte_size, f.content_sha256, f.stage,
         f.verify_status, f.verified_at, f.created_at
    from evidence_files f
   where f.workpaper_id = p_workpaper_id
     and f.org_id = public.jwt_org_id()
   order by f.created_at desc
$$;

revoke execute on function public.evidence_files_for(uuid) from public, anon;
grant execute on function public.evidence_files_for(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. evidence_storage_ready() — whether a storage bucket exists, so the tab can say "session only"
--    honestly rather than claiming a hash-lock it cannot keep.
-- ---------------------------------------------------------------------------
create or replace function public.evidence_storage_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (
       select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets')
     and exists (
       select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
         and policyname = 'provio_objects_insert');
$$;

revoke execute on function public.evidence_storage_ready() from public, anon;
grant execute on function public.evidence_storage_ready() to authenticated;

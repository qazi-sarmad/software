-- 0079 (C2.7): the export format vocabulary gains the binary formats §18 already lists, and a small
-- table records the report's issued PDF and DOCX so issuance can carry both hashes.
--
-- M1: grep found `exports_log` and `log_export` in 0041 and test 50; this migration extends them. The
-- 0041 format check is an inline constraint that must be dropped by its generated name before the
-- new one is added, so the drop is guarded by an existence check (M2/M7). Two SQL tests use 'docx'
-- as an example of an unknown format; docx is now a real format (D-C2.7-formats), so those fixtures
-- move to 'xml' with no change to what they assert.

-- ---------------------------------------------------------------------------
-- 1. Widen the export format vocabulary: add docx, png and svg.
-- ---------------------------------------------------------------------------
alter table exports_log drop constraint if exists exports_log_format_check;
alter table exports_log
  add constraint exports_log_format_check
  check (format in ('csv', 'xlsx', 'pdf', 'zip', 'json', 'docx', 'png', 'svg'));

create or replace function public.log_export(
  p_object_type text, p_object_id uuid, p_format text, p_filters jsonb, p_content_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_format not in ('csv', 'xlsx', 'pdf', 'zip', 'json', 'docx', 'png', 'svg') then
    raise exception 'unknown export format: %', p_format using errcode = 'P0001';
  end if;
  insert into exports_log (org_id, exported_by, object_type, object_id, format, filters, content_hash)
  values (v_org, auth.uid(), p_object_type, p_object_id, p_format,
          coalesce(p_filters, '{}'::jsonb), p_content_hash)
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'export_logged',
    jsonb_build_object('export_id', v_id, 'object_type', p_object_type, 'object_id', p_object_id,
                       'format', p_format, 'content_hash', p_content_hash), auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. report_files: the issued report's PDF and DOCX, with the hash the ledger records for each. A
--    report's files are immutable once written, so there is no update path: a new version is a new
--    row (spec §15.5). The bytes live in Storage; the row carries the path, the hash and the size.
-- ---------------------------------------------------------------------------
create table if not exists report_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  report_version_id uuid not null references report_versions(id) on delete cascade,
  kind text not null check (kind in ('pdf', 'docx')),
  storage_path text not null,
  sha256 text not null,
  byte_size integer not null default 0,
  write_mode text not null default 'storage',
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (report_version_id, kind)
);
create index if not exists report_files_org_idx on report_files (org_id, report_version_id);

alter table report_files enable row level security;

drop policy if exists report_files_select on report_files;
create policy report_files_select on report_files for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.report_files from public, anon, authenticated;

drop trigger if exists report_files_pin_org on report_files;
create trigger report_files_pin_org before insert on report_files
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 3. store_report_file: the single write path for an issued report's files. Requires approve_plan.
--    Records the file and a hash-chained ledger entry carrying the hash, exactly as §18 requires for
--    the issued report. Idempotent per (report_version_id, kind): a second write replaces the path so
--    a re-issue over the same version cannot fork the record.
-- ---------------------------------------------------------------------------
create or replace function public.store_report_file(
  p_report_version_id uuid, p_kind text, p_storage_path text, p_sha256 text, p_byte_size integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec report_versions;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('approve_plan'), false) then
    raise exception 'not allowed: caller lacks the approve_plan right' using errcode = 'P0001';
  end if;
  if p_kind not in ('pdf', 'docx') then
    raise exception 'unknown report file kind: %', p_kind using errcode = 'P0001';
  end if;
  select * into v_rec from report_versions r where r.id = p_report_version_id and r.org_id = v_org;
  if v_rec.id is null then
    raise exception 'report version not found in this organisation' using errcode = 'P0001';
  end if;
  if v_rec.status not in ('frozen', 'issued_v1') then
    raise exception 'not_frozen: a report file is only written for a frozen or issued report' using errcode = 'P0001';
  end if;

  insert into report_files (org_id, report_version_id, kind, storage_path, sha256, byte_size, created_by)
  values (v_org, p_report_version_id, p_kind, p_storage_path, p_sha256, coalesce(p_byte_size, 0), auth.uid())
  on conflict (report_version_id, kind) do update
    set storage_path = excluded.storage_path,
        sha256 = excluded.sha256,
        byte_size = excluded.byte_size,
        created_by = excluded.created_by,
        created_at = now()
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'report_file_stored',
    jsonb_build_object('report_version_id', p_report_version_id, 'kind', p_kind,
                       'storage_path', p_storage_path, 'sha256', p_sha256, 'byte_size', p_byte_size),
    auth.uid());
  return v_id;
end $$;

revoke execute on function public.store_report_file(uuid, text, text, text, integer) from public, anon;
grant execute on function public.store_report_file(uuid, text, text, text, integer) to authenticated;

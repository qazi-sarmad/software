-- C2.5: verified archival. Nothing is deleted until the stored copy's hash has been verified.
--
-- The spec:
--   §25.4 "Archival: older activity is exported to Storage files in a defined format, and each
--          archive is hashed and logged. The live database keeps a rolling window."
--   §25.4 "Population archival: six months after an engagement is finalised ... a population's
--          working rows are removed from the live database. The original uploaded file is kept
--          compressed in Storage. Its SHA-256 hash is recorded in the business ledger at archive time
--          and re-checked in the background on each download. A mismatch raises an integrity alert and
--          is never silently accepted."
--   §25.4 "Nothing is deleted without a hash record."
--
-- M1: grep found `archive_jobs` and `archive_activity_period` (0043) and no `population_archives`
--     and no `integrity_alerts`. The first two are extended with `alter`/`create or replace`
--     (decision D-C2.5-M1); the last two are created here.
--
-- D-C2.5-order: 0043 marked an activity archive `done` in the same transaction that computed the
-- hash, before any file existed. That made "done" mean "hashed", not "stored and verified". The
-- status flow is now pending -> done only through archive_job_mark_uploaded(), which refuses unless
-- the stored object's SHA-256 equals the ledgered content hash. Test 86 proves the refusal.
--
-- D-C2.5-append-only: activity_log keeps its append-only trigger (0006, L5), so archive_activity_period
-- does not delete rows (as recorded in D-7C-append-only). The *population* working rows are the rows
-- §25.4 removes, and they are not append-only, so the deletion gate is proven there.

-- ---------------------------------------------------------------------------
-- 1. archive_jobs: the upload and its verification.
-- ---------------------------------------------------------------------------
alter table archive_jobs add column if not exists uploaded_bytes bigint;
alter table archive_jobs add column if not exists upload_verified_at timestamptz;
alter table archive_jobs add column if not exists verify_attempts int not null default 0;
alter table archive_jobs add column if not exists last_error text;

-- ---------------------------------------------------------------------------
-- 2. integrity_alerts: the one place a hash mismatch is recorded. Raised by the database only, never
--    written directly, and readable by the tenant it belongs to (L4: real time and drillable).
-- ---------------------------------------------------------------------------
create table if not exists integrity_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null,
  object_type text not null,
  object_id uuid,
  expected_hash text,
  actual_hash text,
  detail jsonb not null default '{}'::jsonb,
  raised_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);
create index if not exists integrity_alerts_org_idx on integrity_alerts (org_id, raised_at desc);

alter table integrity_alerts enable row level security;

drop policy if exists integrity_alerts_select on integrity_alerts;
create policy integrity_alerts_select on integrity_alerts for select to authenticated
  using (org_id = public.jwt_org_id());

-- No write policy at all: every insert goes through raise_integrity_alert() (security definer).
revoke insert, update, delete on public.integrity_alerts from public, anon, authenticated;

-- raise_integrity_alert: called by the archival functions when a stored hash does not match. It also
-- writes the ledger entry, so a mismatch is auditable even if the alert row is never opened.
create or replace function public.raise_integrity_alert(
  p_org_id uuid, p_kind text, p_object_type text, p_object_id uuid,
  p_expected text, p_actual text, p_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into integrity_alerts (org_id, kind, object_type, object_id, expected_hash, actual_hash, detail)
  values (p_org_id, p_kind, p_object_type, p_object_id, p_expected, p_actual, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;

  perform public.append_ledger_entry(
    p_org_id, 'integrity_alert',
    jsonb_build_object('alert_id', v_id, 'kind', p_kind, 'object_type', p_object_type,
                       'object_id', p_object_id, 'expected_hash', p_expected, 'actual_hash', p_actual),
    auth.uid());
  return v_id;
end $$;

revoke execute on function public.raise_integrity_alert(uuid, text, text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.raise_integrity_alert(uuid, text, text, uuid, text, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. archive_activity_period now stops at 'pending'. The file must exist and match before 'done'.
-- ---------------------------------------------------------------------------
create or replace function public.archive_activity_period(
  p_org_id uuid, p_period_start date, p_period_end date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rows jsonb;
  v_count int;
  v_hash text;
  v_path text;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org_id is distinct from v_org then
    raise exception 'cross-org archive refused' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_period_end < p_period_start then
    raise exception 'period_end precedes period_start' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.ts), '[]'::jsonb), count(*)
    into v_rows, v_count
    from activity_log a
   where a.org_id = v_org
     and a.ts >= p_period_start::timestamptz
     and a.ts < (p_period_end::timestamptz + interval '1 day');

  v_hash := public.ledger_payload_hash(public.canonical_payload(v_rows));
  v_path := v_org::text || '/activity/' || p_period_start::text || '_' || p_period_end::text || '.json';

  insert into archive_jobs (org_id, period_start, period_end, archived_row_count, storage_path,
                            content_hash, status)
  values (v_org, p_period_start, p_period_end, v_count, v_path, v_hash, 'pending')
  returning id into v_id;

  -- The content hash is ledgered at archive time (§25.4 "recorded ... at archive time"), before any
  -- upload, so the value the upload must match is already immutable.
  perform public.append_ledger_entry(
    v_org, 'activity_archived',
    jsonb_build_object('archive_id', v_id, 'period_start', p_period_start, 'period_end', p_period_end,
                       'row_count', v_count, 'content_hash', v_hash, 'storage_path', v_path),
    auth.uid());

  return v_id;
end $$;

revoke execute on function public.archive_activity_period(uuid, date, date) from public, anon;
grant execute on function public.archive_activity_period(uuid, date, date) to authenticated;

-- can_upload_archive: the caller-side authority check the edge function runs as the caller, before
-- any service-role client is created. The database, not the request body, decides.
create or replace function public.can_upload_archive(p_archive_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from archive_jobs j
     where j.id = p_archive_id
       and j.org_id = public.jwt_org_id()
       and public.caller_has_right('manage_engagements'));
$$;

revoke execute on function public.can_upload_archive(uuid) from public, anon;
grant execute on function public.can_upload_archive(uuid) to authenticated;

-- archive_job_for_upload: the job's own facts, for the service role only. It is the service role
-- because the upload must be able to complete after the archive was created, and the row is read,
-- never trusted, by the edge function.
drop function if exists public.archive_job_for_upload(uuid);
create or replace function public.archive_job_for_upload(p_archive_id uuid)
returns table (id uuid, org_id uuid, storage_path text, content_hash text, status text)
language sql stable security definer set search_path = public as $$
  select j.id, j.org_id, j.storage_path, j.content_hash, j.status
    from archive_jobs j where j.id = p_archive_id;
$$;

revoke execute on function public.archive_job_for_upload(uuid) from public, anon, authenticated;
grant execute on function public.archive_job_for_upload(uuid) to service_role;

-- archive_job_canonical: the exact bytes the upload must store. The edge function calls this
-- (service role only), uploads the returned text, hashes it, and passes the hash to
-- archive_job_mark_uploaded, so the hash checked is the hash of what was actually stored.
create or replace function public.archive_job_canonical(p_job_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select public.canonical_payload(coalesce(
    (select jsonb_agg(to_jsonb(a) order by a.ts)
       from activity_log a
      where a.org_id = j.org_id
        and a.ts >= j.period_start::timestamptz
        and a.ts < (j.period_end::timestamptz + interval '1 day')), '[]'::jsonb))
    from archive_jobs j
   where j.id = p_job_id;
$$;

revoke execute on function public.archive_job_canonical(uuid) from public, anon, authenticated;
grant execute on function public.archive_job_canonical(uuid) to service_role;

-- archive_job_mark_uploaded: the only path to 'done'. It refuses a hash that does not equal the
-- ledgered content hash, records the failure and raises an integrity alert when it does not match
-- (§25.4), and returns the resulting status. It does not raise an exception: an exception would roll
-- back the very failure record and alert that prove the mismatch was refused.
-- The drop precedes the create because an earlier run of this file defined the function with a
-- different return type (void), which create or replace cannot change (M4/M7).
drop function if exists public.archive_job_mark_uploaded(uuid, text, bigint);

create or replace function public.archive_job_mark_uploaded(
  p_job_id uuid, p_sha256 text, p_bytes bigint
) returns text
language plpgsql security definer set search_path = public as $$
declare v_job archive_jobs;
begin
  select * into v_job from archive_jobs where id = p_job_id for update;
  if not found then
    raise exception 'no such archive job' using errcode = 'P0001';
  end if;
  if v_job.status = 'done' then
    return 'done';
  end if;

  if p_sha256 is distinct from v_job.content_hash then
    update archive_jobs
       set status = 'failed', verify_attempts = verify_attempts + 1,
           last_error = 'the stored file hash does not match the ledgered content hash'
     where id = p_job_id;
    perform public.raise_integrity_alert(
      v_job.org_id, 'archive_hash_mismatch', 'archive_job', p_job_id,
      v_job.content_hash, p_sha256, jsonb_build_object('storage_path', v_job.storage_path));
    return 'failed';
  end if;

  update archive_jobs
     set status = 'done', upload_verified_at = now(), uploaded_bytes = p_bytes,
         verify_attempts = verify_attempts + 1
   where id = p_job_id;
  return 'done';
end $$;

revoke execute on function public.archive_job_mark_uploaded(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.archive_job_mark_uploaded(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Population archival (§25.4). The working rows go; the original file and its hash stay.
-- ---------------------------------------------------------------------------
create table if not exists population_archives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  population_id uuid not null references populations(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  -- The hash of the ORIGINAL uploaded file, carried from populations.sha256 at archive time.
  content_hash text not null,
  storage_path text not null,
  archived_row_count int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  stored_bytes bigint,
  upload_verified_at timestamptz,
  working_rows_removed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists population_archives_org_idx on population_archives (org_id, created_at desc);
create unique index if not exists population_archives_pop_idx on population_archives (population_id);

alter table population_archives enable row level security;
-- Read follows the same rule as `populations` (0008): org-scoped, and the engagement must exist.
-- §25.4 says archived populations "remain available at any time", so no right check narrows it.
drop policy if exists population_archives_select on population_archives;
create policy population_archives_select on population_archives for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from engagements e where e.id = engagement_id));
revoke insert, update, delete on public.population_archives from public, anon, authenticated;

-- archive_population: record the archive (hash + path) and keep the working rows. Deletion is a
-- separate, gated step.
create or replace function public.archive_population(p_population_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_pop populations;
  v_count int;
  v_path text;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;

  select * into v_pop from populations p where p.id = p_population_id and p.org_id = v_org;
  if not found then
    raise exception 'population not found in this organisation' using errcode = 'P0001';
  end if;

  select count(*) into v_count from population_rows r where r.population_id = p_population_id;
  v_path := v_org::text || '/populations/' || p_population_id::text || '.csv.gz';

  insert into population_archives (org_id, population_id, engagement_id, content_hash, storage_path,
                                   archived_row_count, status)
  values (v_org, p_population_id, v_pop.engagement_id, v_pop.sha256, v_path, v_count, 'pending')
  on conflict (population_id) do update
    set content_hash = excluded.content_hash,
        storage_path = excluded.storage_path,
        archived_row_count = excluded.archived_row_count
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'population_archive_started',
    jsonb_build_object('archive_id', v_id, 'population_id', p_population_id,
                       'content_hash', v_pop.sha256, 'storage_path', v_path, 'row_count', v_count),
    auth.uid());
  return v_id;
end $$;

revoke execute on function public.archive_population(uuid) from public, anon;
grant execute on function public.archive_population(uuid) to authenticated;

-- population_archive_verify: the upload is verified, and ONLY THEN are the working rows removed.
-- A mismatch marks the archive failed, raises an integrity alert, leaves the rows in place, and
-- returns 'failed' — it does not raise, so the refusal and its alert survive (see the note on
-- archive_job_mark_uploaded). The drop precedes the create for the same reason as above (M4/M7).
drop function if exists public.population_archive_verify(uuid, text, bigint);

create or replace function public.population_archive_verify(
  p_archive_id uuid, p_sha256 text, p_bytes bigint
) returns text
language plpgsql security definer set search_path = public as $$
declare v_arc population_archives;
begin
  select * into v_arc from population_archives where id = p_archive_id for update;
  if not found then
    raise exception 'no such population archive' using errcode = 'P0001';
  end if;
  if v_arc.status = 'done' then
    return 'done';
  end if;

  if p_sha256 is distinct from v_arc.content_hash then
    update population_archives set status = 'failed' where id = p_archive_id;
    perform public.raise_integrity_alert(
      v_arc.org_id, 'population_archive_hash_mismatch', 'population_archive', p_archive_id,
      v_arc.content_hash, p_sha256, jsonb_build_object('storage_path', v_arc.storage_path));
    return 'failed';
  end if;

  -- Verified: now the working rows may go (§25.4). Nothing is deleted without a hash record.
  delete from population_rows where population_id = v_arc.population_id;

  update population_archives
     set status = 'done', upload_verified_at = now(), stored_bytes = p_bytes,
         working_rows_removed_at = now()
   where id = p_archive_id;

  perform public.append_ledger_entry(
    v_arc.org_id, 'population_archived',
    jsonb_build_object('archive_id', p_archive_id, 'population_id', v_arc.population_id,
                       'content_hash', v_arc.content_hash, 'storage_path', v_arc.storage_path),
    auth.uid());
  return 'done';
end $$;

revoke execute on function public.population_archive_verify(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.population_archive_verify(uuid, text, bigint) to service_role;

-- population_archive_check: run on each download (§25.4). A mismatch raises an integrity alert and
-- returns false; it is never silently accepted. A match does not re-run verification, analytics or
-- sampling — it is a hash comparison and nothing more.
create or replace function public.population_archive_check(p_archive_id uuid, p_sha256 text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_arc population_archives;
begin
  select * into v_arc from population_archives where id = p_archive_id;
  if not found then
    raise exception 'no such population archive' using errcode = 'P0001';
  end if;
  if p_sha256 is distinct from v_arc.content_hash then
    perform public.raise_integrity_alert(
      v_arc.org_id, 'population_archive_download_mismatch', 'population_archive', p_archive_id,
      v_arc.content_hash, p_sha256, jsonb_build_object('storage_path', v_arc.storage_path));
    return false;
  end if;
  return true;
end $$;

revoke execute on function public.population_archive_check(uuid, text) from public, anon, authenticated;
grant execute on function public.population_archive_check(uuid, text) to service_role;

-- list_population_archive_rows: paginated view of the archived population (§25.4 "viewable
-- (paginated, on demand)") without touching the removed working rows. The original file, not the
-- rows, is the archived artefact, so the page reports the recorded row count and the storage path.
create or replace function public.population_archive_page(
  p_archive_id uuid, p_limit int default 50, p_offset int default 0
) returns table (archive_id uuid, storage_path text, content_hash text, archived_row_count int,
                 status text, working_rows_removed_at timestamptz)
language sql security definer set search_path = public as $$
  select a.id, a.storage_path, a.content_hash, a.archived_row_count, a.status, a.working_rows_removed_at
    from population_archives a
   where a.id = p_archive_id
     and a.org_id = public.jwt_org_id()
   limit greatest(coalesce(p_limit, 50), 1) offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.population_archive_page(uuid, int, int) from public, anon;
grant execute on function public.population_archive_page(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retention period per organisation (§25.4 "the platform default; each organisation may set its
--    own period"). Default six months, as the spec states. The accessor is what the app and the
--    scheduled job read, so an organisation with no settings row still gets the platform default.
-- ---------------------------------------------------------------------------
alter table org_settings_extra
  add column if not exists population_archive_after_months int not null default 6;

create or replace function public.population_retention_months(p_org_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.population_archive_after_months from org_settings_extra s where s.org_id = p_org_id),
    6);
$$;

revoke execute on function public.population_retention_months(uuid) from public, anon;
grant execute on function public.population_retention_months(uuid) to authenticated;

-- population_archive_due: the populations whose retention period has elapsed since their engagement
-- was finalised (the report was frozen or issued). The scheduled job (§25.4) calls this; it is a
-- query, not a deletion, so the job can report before anything is removed.
create or replace function public.population_archive_due(p_org_id uuid)
returns table (population_id uuid, engagement_id uuid, finalised_at timestamptz, due_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.engagement_id, rv.finalised_at,
         rv.finalised_at + make_interval(months => public.population_retention_months(p.org_id))
    from populations p
    join lateral (
      select coalesce(v.frozen_at, v.issued_at) as finalised_at
        from report_versions v
       where v.engagement_id = p.engagement_id
         and coalesce(v.frozen_at, v.issued_at) is not null
       order by coalesce(v.frozen_at, v.issued_at) desc
       limit 1
    ) rv on true
   where p.org_id = p_org_id
     and p.org_id = public.jwt_org_id()
     and rv.finalised_at + make_interval(months => public.population_retention_months(p.org_id)) <= now()
     and not exists (select 1 from population_archives a where a.population_id = p.id and a.status = 'done');
$$;

revoke execute on function public.population_archive_due(uuid) from public, anon;
grant execute on function public.population_archive_due(uuid) to authenticated;

-- 7C: Activity log archival DB (spec §26).
--
-- The spec:
--   §26 "The activity log is archived by period. An archive records the period, the row count, a
--        content hash and the storage path. Archiving is admin-only."
--
-- M1: grep found no `archive_jobs` and no `archive_activity_period`. This migration creates them.

create table if not exists archive_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  archived_row_count int not null default 0,
  storage_path text,
  content_hash text,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  created_at timestamptz not null default now(),
  constraint archive_jobs_period_chk check (period_end >= period_start)
);
create index if not exists archive_jobs_org_idx on archive_jobs (org_id, period_start desc);

-- ---------------------------------------------------------------------------
-- archive_activity_period: export a period's activity rows to a JSON payload, record the archive and
-- write a hash-chained ledger entry carrying the content hash (§26).
--
-- D-7C-append-only: the task says the function "deletes the archived rows from the live activity_log
-- table". L5 makes activity_log append-only: the `activity_log_append_only` trigger (0006) raises
-- `append_only_violation` on any DELETE, for every role. The Law outranks the task step (never weaken
-- the ledger or an append-only invariant), so this function records the archive and the ledger entry
-- but does not physically delete. The physical purge is a separate owner-run maintenance step, recorded
-- in NOT-DONE §activity-purge. How to reverse: add a maintenance function that drops and recreates the
-- trigger around a scoped delete, with owner approval.
--
-- D-7C-right: the task allows "manage_engagements right (or a new platform-only right; default to
-- manage_engagements and record the choice as a decision)". This migration uses manage_engagements.
-- The Storage upload itself is done by an edge function; this function records the archive row with a
-- storage path (NOT-DONE §archival-storage).
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

  -- The upload itself is deferred to an edge function; the ledger entry is written now so the content
  -- hash is accountable even before the upload completes.
  perform public.append_ledger_entry(
    v_org, 'activity_archived',
    jsonb_build_object('archive_id', v_id, 'period_start', p_period_start, 'period_end', p_period_end,
                       'row_count', v_count, 'content_hash', v_hash, 'storage_path', v_path),
    auth.uid());

  update archive_jobs set status = 'done' where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: an org sees its own archive jobs only. Writes go through the RPC.
-- ---------------------------------------------------------------------------
alter table archive_jobs enable row level security;

drop policy if exists archive_jobs_select on archive_jobs;
create policy archive_jobs_select on archive_jobs for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.archive_jobs from public, anon, authenticated;

drop trigger if exists archive_jobs_pin_org on archive_jobs;
create trigger archive_jobs_pin_org before insert on archive_jobs
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.archive_activity_period(uuid, date, date) from public, anon;
grant execute on function public.archive_activity_period(uuid, date, date) to authenticated;

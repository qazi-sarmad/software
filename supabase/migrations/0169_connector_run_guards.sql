-- 0169_connector_run_guards.sql — stream S5 (C1/C3): the connector run lifecycle guards.
--
-- 0090 defined connector_run_start / connector_run_finish / staged_record_ingest. They trusted the
-- caller: a record could be staged with no run, a run could be finished twice, and a second run could
-- start on an instance that was already running. A deterministic runtime needs the lifecycle to be
-- ordered, so this migration makes the three refusals explicit and proves no partial write:
--
--   * staged_record_ingest with a run id: the run must exist and belong to the same org and
--     instance. Ingest is never accepted for a run that is not this instance's.
--   * connector_run_finish: the run must exist and still be 'running'. A second finish is refused
--     with the reason 'the run is already finished', and the first outcome is left untouched.
--   * connector_run_start: a second run on an instance that already has a 'running' run is refused
--     with the reason 'a run is already in progress', so two runs cannot interleave.
--
-- Each guard raises before its insert/update, so a refusal writes nothing.

-- 1. Ingest is bound to a real run of this instance. A null run id stays accepted: 0090's own
--    contract and the enrichment tests (112/113/115) stage fixtures before a run exists. Staging
--    after a run has finished stays accepted (test 97 reconciles a finished run), so the guard is
--    the run's existence and ownership, not its status.
create or replace function public.staged_record_ingest(
  p_org uuid, p_instance_id uuid, p_run_id uuid, p_source text, p_source_id text,
  p_content_hash text, p_fetched_at timestamptz, p_values jsonb, p_tags jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  perform public.provio_org_guard(p_org);
  if p_run_id is not null then
    select r.status into v_status from connector_runs r
      where r.id = p_run_id and r.org_id = p_org and r.instance_id = p_instance_id;
    if v_status is null then
      raise exception 'no such run for this connector instance' using errcode = 'P0001';
    end if;
  end if;
  insert into staged_records (org_id, instance_id, run_id, source, source_id, content_hash, fetched_at, values, tags)
  values (p_org, p_instance_id, p_run_id, p_source, p_source_id, p_content_hash,
          coalesce(p_fetched_at, now()), coalesce(p_values, '{}'::jsonb), coalesce(p_tags, '[]'::jsonb))
  on conflict (org_id, instance_id, source_id, content_hash) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

-- 2. Finish once, and only a running run. The status check comes before the update, so a refused
--    finish changes no row.
create or replace function public.connector_run_finish(
  p_org uuid, p_run_id uuid, p_status text, p_fetched int, p_staged int, p_skipped int, p_error text, p_detail text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  perform public.provio_org_guard(p_org);
  if p_status not in ('succeeded', 'failed') then
    raise exception 'a finished run is succeeded or failed' using errcode = 'P0001';
  end if;
  select r.status into v_status from connector_runs r where r.id = p_run_id and r.org_id = p_org;
  if v_status is null then
    raise exception 'no such run in this organisation' using errcode = 'P0001';
  end if;
  if v_status <> 'running' then
    raise exception 'the run is already finished' using errcode = 'P0001';
  end if;
  update connector_runs set status = p_status, finished_at = now(), rows_fetched = coalesce(p_fetched, 0),
    rows_staged = coalesce(p_staged, 0), rows_skipped = coalesce(p_skipped, 0),
    error = p_error, detail = coalesce(p_detail, '')
    where id = p_run_id and org_id = p_org;
end $$;

-- 3. One live run per instance. The existence check comes before the insert.
create or replace function public.connector_run_start(p_org uuid, p_instance_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.provio_org_guard(p_org);
  if not exists (select 1 from connector_instances i where i.id = p_instance_id and i.org_id = p_org) then
    raise exception 'no such connector instance in this organisation' using errcode = 'P0001';
  end if;
  if exists (select 1 from connector_runs r
              where r.org_id = p_org and r.instance_id = p_instance_id and r.status = 'running') then
    raise exception 'a run is already in progress for this connector instance' using errcode = 'P0001';
  end if;
  insert into connector_runs (org_id, instance_id, status) values (p_org, p_instance_id, 'running')
  returning id into v_id;
  return v_id;
end $$;

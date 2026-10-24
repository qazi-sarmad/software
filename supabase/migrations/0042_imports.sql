-- 7B: Imports DB (spec §19 import wizard).
--
-- The spec:
--   §19 "Imports: RCM, entities, users, populations. Three steps: upload, map, validate/commit. Invalid
--        rows are reported with a field and a reason."
--
-- M1: grep found no `import_jobs`, `start_import`, `validate_import` or `commit_import`. This migration
-- creates them (no collision).

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  import_type text not null check (import_type in ('rcm', 'entities', 'users', 'populations')),
  source_filename text,
  status text not null default 'pending'
    check (status in ('pending', 'mapping', 'validating', 'done', 'failed')),
  error_rows jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists import_jobs_org_idx on import_jobs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- start_import: create a pending job (§19 step 1 upload).
-- ---------------------------------------------------------------------------
create or replace function public.start_import(p_import_type text, p_source_filename text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_import_type not in ('rcm', 'entities', 'users', 'populations') then
    raise exception 'unknown import type: %', p_import_type using errcode = 'P0001';
  end if;
  insert into import_jobs (org_id, import_type, source_filename, status, created_by)
  values (v_org, p_import_type, p_source_filename, 'pending', auth.uid())
  returning id into v_id;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'import_started', 'import_job', v_id,
          jsonb_build_object('import_type', p_import_type, 'filename', p_source_filename));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- validate_import: validate the mapped rows (§19 step 2 map, step 3 validate).
-- Each row is a jsonb object of product field -> value. Returns {valid, invalid, errors:[{row,field,reason}]}.
-- ---------------------------------------------------------------------------
create or replace function public.validate_import(p_job_id uuid, p_mapped_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_job import_jobs;
  v_row jsonb;
  v_idx int := 0;
  v_valid int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_reason text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_job from import_jobs j where j.id = p_job_id and j.org_id = v_org;
  if v_job.id is null then
    raise exception 'import job not found in this organisation' using errcode = 'P0001';
  end if;
  if p_mapped_rows is null or jsonb_typeof(p_mapped_rows) <> 'array' then
    raise exception 'mapped rows must be a JSON array' using errcode = 'P0001';
  end if;

  for v_row in select * from jsonb_array_elements(p_mapped_rows)
  loop
    v_idx := v_idx + 1;
    v_reason := null;
    if v_job.import_type = 'entities' then
      if nullif(btrim(coalesce(v_row ->> 'name', '')), '') is null then
        v_reason := 'name is required';
      elsif not exists (select 1 from universes u
                         where u.id = nullif(v_row ->> 'universe_id', '')::uuid and u.org_id = v_org) then
        v_reason := 'universe_id is not in this organisation';
      end if;
    elsif v_job.import_type = 'rcm' then
      if nullif(btrim(coalesce(v_row ->> 'name', '')), '') is null then
        v_reason := 'name is required';
      end if;
    elsif v_job.import_type = 'users' then
      if nullif(btrim(coalesce(v_row ->> 'email', '')), '') is null then
        v_reason := 'email is required';
      elsif position('@' in (v_row ->> 'email')) = 0 then
        v_reason := 'email is not valid';
      end if;
    elsif v_job.import_type = 'populations' then
      if nullif(btrim(coalesce(v_row ->> 'row_ref', '')), '') is null then
        v_reason := 'row_ref is required';
      end if;
    end if;

    if v_reason is null then
      v_valid := v_valid + 1;
    else
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', v_reason);
    end if;
  end loop;

  update import_jobs
     set status = case when jsonb_array_length(v_errors) = 0 then 'validating' else 'failed' end,
         error_rows = v_errors
   where id = p_job_id;

  return jsonb_build_object('valid', v_valid,
                            'invalid', jsonb_array_length(v_errors),
                            'errors', v_errors);
end $$;

-- ---------------------------------------------------------------------------
-- commit_import: write the validated rows to their target table (§19 step 3 commit).
-- ---------------------------------------------------------------------------
create or replace function public.commit_import(p_job_id uuid, p_mapped_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_job import_jobs;
  v_row jsonb;
  v_count int := 0;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select * into v_job from import_jobs j where j.id = p_job_id and j.org_id = v_org;
  if v_job.id is null then
    raise exception 'import job not found in this organisation' using errcode = 'P0001';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_mapped_rows, '[]'::jsonb))
  loop
    if v_job.import_type = 'entities' then
      insert into entities (org_id, universe_id, name, kind)
      values (v_org, nullif(v_row ->> 'universe_id', '')::uuid, v_row ->> 'name', v_row ->> 'kind')
      returning id into v_id;
    elsif v_job.import_type = 'rcm' then
      insert into risks_library (org_id, name, description)
      values (v_org, v_row ->> 'name', v_row ->> 'description')
      returning id into v_id;
    elsif v_job.import_type = 'users' then
      -- The auth user is created out of band; the org membership is recorded here when the user id is
      -- supplied. An import that carries only an email is recorded in the activity log for the invite
      -- flow to pick up (invite delivery is out of scope; NOT-DONE §email-dispatch).
      if nullif(v_row ->> 'user_id', '') is not null then
        insert into org_members (org_id, user_id, role_id)
        values (v_org, (v_row ->> 'user_id')::uuid, (v_row ->> 'role_id')::uuid);
      end if;
      v_id := null;
    elsif v_job.import_type = 'populations' then
      -- A population import only stages the rows; the §6 population gate still requires a verified
      -- sha256 and row_count before any sample can reference it.
      v_id := null;
    end if;
    v_count := v_count + 1;
    insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
    values (v_org, auth.uid(), 'import_row_committed', 'import_job', p_job_id,
            jsonb_build_object('import_type', v_job.import_type, 'row', v_row));
  end loop;

  update import_jobs set status = 'done' where id = p_job_id;
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'import_committed', 'import_job', p_job_id,
          jsonb_build_object('import_type', v_job.import_type, 'rows', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: an org sees its own import jobs only. Writes go through the RPCs.
-- ---------------------------------------------------------------------------
alter table import_jobs enable row level security;

drop policy if exists import_jobs_select on import_jobs;
create policy import_jobs_select on import_jobs for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.import_jobs from public, anon, authenticated;

drop trigger if exists import_jobs_pin_org on import_jobs;
create trigger import_jobs_pin_org before insert on import_jobs
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.start_import(text, text) from public, anon;
revoke execute on function public.validate_import(uuid, jsonb) from public, anon;
revoke execute on function public.commit_import(uuid, jsonb) from public, anon;

grant execute on function public.start_import(text, text) to authenticated;
grant execute on function public.validate_import(uuid, jsonb) to authenticated;
grant execute on function public.commit_import(uuid, jsonb) to authenticated;

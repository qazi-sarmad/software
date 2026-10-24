-- 0086 auth.role() NULL-safety (fixes the second step-7 SQL failure on the hosted test project).
--
-- `auth.role()` reads the `role` claim from the request JWT. Supabase's own definition returns NULL
-- when the token carries no `role` claim:
--
--   select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
--                   (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
--
-- Every guard written as `auth.role() <> 'service_role'` is therefore NULL for such a caller, the
-- `if` does not fire, and the guard FAILS OPEN. `has_feature` (0084) is the reachable one: an Org B
-- caller learns Org A's feature flags, which supabase/tests/93_cross_org.sql:73 catches.
--
-- The local shim used to fall back to `current_user`, so it always returned a non-NULL value and the
-- defect was invisible locally. The shim is now faithful to Supabase, so this class is caught there.
--
-- The fix is NULL-safe comparison: an absent or unknown role is treated as a plain tenant, never as
-- the service role. That is the restrictive default; no test is weakened. Only bodies change
-- (`create or replace`), no function is created or dropped, so no grant or anon surface moves.

-- ---------------------------------------------------------------------------
-- 1. has_feature (0084 section 3). `is distinct from` makes an absent role non-service-role.
-- ---------------------------------------------------------------------------
create or replace function public.has_feature(p_org uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  -- A signed-in caller asks about its own org (or is a platform administrator). Database-internal
  -- callers (no request claims, or the service role) are not restricted.
  if coalesce(current_setting('request.jwt.claims', true), '') <> ''
     and auth.role() is distinct from 'service_role'
     and p_org is distinct from public.jwt_org_id()
     and not public.is_platform_admin() then
    return false;
  end if;
  return public.feature_enabled_internal(p_org, p_key);
end $$;

-- ---------------------------------------------------------------------------
-- 2. The migration runner (0069). Same defect: a NULL role must not pass as the service role.
-- ---------------------------------------------------------------------------
create or replace function public.migration_step_upsert(
  p_job_id uuid, p_step_no int, p_step_key text, p_status text,
  p_rows_done bigint, p_checkpoint jsonb, p_detail text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the migration runner can write step progress.' using errcode = 'P0001';
  end if;
  select org_id into v_org from migration_jobs where id = p_job_id;
  if v_org is null then
    raise exception 'Unknown migration job.' using errcode = 'P0001';
  end if;

  insert into migration_steps (org_id, job_id, step_no, step_key, status, rows_done, checkpoint, detail,
                               started_at, finished_at)
  values (v_org, p_job_id, p_step_no, p_step_key, coalesce(p_status,'running'), coalesce(p_rows_done,0),
          coalesce(p_checkpoint,'{}'::jsonb), p_detail,
          case when p_status = 'running' then now() else null end,
          case when p_status in ('done','failed','skipped') then now() else null end)
  on conflict (job_id, step_no) do update set
    step_key = excluded.step_key, status = excluded.status, rows_done = excluded.rows_done,
    checkpoint = excluded.checkpoint, detail = excluded.detail,
    started_at = coalesce(migration_steps.started_at, excluded.started_at),
    finished_at = excluded.finished_at;

  update migration_jobs set current_step = greatest(current_step, p_step_no),
    rows_done = rows_done + case when p_status = 'running' then coalesce(p_rows_done,0) else 0 end
    where id = p_job_id;
end $$;

create or replace function public.migration_job_advance(
  p_job_id uuid, p_status text, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the migration runner can advance a job.' using errcode = 'P0001';
  end if;
  select org_id into v_org from migration_jobs where id = p_job_id;
  if v_org is null then
    raise exception 'Unknown migration job.' using errcode = 'P0001';
  end if;

  update migration_jobs set status = p_status, error_text = p_error,
    started_at = coalesce(started_at, now()),
    finished_at = case when p_status in ('retired','rolled_back') then now() else finished_at end,
    retire_after = case when p_status = 'awaiting_cutover'
                        then now() + (retention_days || ' days')::interval else retire_after end
    where id = p_job_id;

  if p_status = 'failed' then
    perform public.append_ledger_entry(v_org, 'hosting_migration_failed',
      jsonb_build_object('job_id', p_job_id, 'error', coalesce(p_error,'')), auth.uid());
    perform public.emit_event(v_org, 'hosting.migration.failed',
      jsonb_build_object('job_id', p_job_id, 'error', left(coalesce(p_error,''), 300)));
  elsif p_status = 'awaiting_cutover' then
    perform public.append_ledger_entry(v_org, 'hosting_migration_cutover',
      jsonb_build_object('job_id', p_job_id), auth.uid());
    perform public.emit_event(v_org, 'hosting.migration.completed', jsonb_build_object('job_id', p_job_id));
  elsif p_status = 'retired' then
    perform public.append_ledger_entry(v_org, 'hosting_migration_retired',
      jsonb_build_object('job_id', p_job_id), auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The email dispatcher (0064 section 5). `auth.role() = 'service_role'` is NULL for an absent
--    role, which made `not (... or NULL or ...)` NULL and skipped the refusal.
-- ---------------------------------------------------------------------------
create or replace function public.email_dispatch_claim(p_limit int default 10)
returns setof email_queue
language plpgsql security definer set search_path = public as $$
begin
  if not (current_user = 'service_role' or auth.role() is not distinct from 'service_role'
          or public.is_platform_admin()) then
    raise exception 'not allowed: only the dispatcher claims email' using errcode = 'P0001';
  end if;
  return query
    select * from email_queue q
     where q.status = 'pending'
       and (q.next_attempt_at is null or q.next_attempt_at <= now())
       and q.created_at > now() - interval '7 days'
     order by q.created_at
     limit least(coalesce(p_limit, 10), 50);
end $$;

create or replace function public.email_dispatch_complete(
  p_id uuid, p_status text, p_provider text default null, p_response_code int default null,
  p_provider_message_id text default null, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int;
begin
  if not (current_user = 'service_role' or auth.role() is not distinct from 'service_role'
          or public.is_platform_admin()) then
    raise exception 'not allowed: only the dispatcher completes email' using errcode = 'P0001';
  end if;

  select attempts + 1 into v_attempts from email_queue where id = p_id;

  if p_status = 'sent' then
    update email_queue
       set status = 'sent', sent_at = now(), attempts = v_attempts, error_text = null,
           provider = p_provider, response_code = p_response_code,
           provider_message_id = p_provider_message_id, next_attempt_at = null
     where id = p_id;
  else
    update email_queue
       set status = case when v_attempts >= 5 then 'failed' else 'pending' end,
           attempts = v_attempts, error_text = public.mask_secrets_text(p_error),
           provider = p_provider, response_code = p_response_code,
           next_attempt_at = case v_attempts
             when 1 then now() + interval '1 minute'
             when 2 then now() + interval '5 minutes'
             when 3 then now() + interval '15 minutes'
             when 4 then now() + interval '60 minutes'
             else now() + interval '240 minutes' end
     where id = p_id;
  end if;
end $$;

-- 0100 phase1 write-path RPCs — the operations the shell used to fake in memory.
--
-- Phase 1 of docs/SCALE-TASKS.md: the application shell read from an in-memory seed and its mutations
-- (seal an engagement, verify a population, finalize testing, add an entity, transition a CAP) only
-- changed that seed. Nothing was written, so a reload lost the change and no other principal ever saw
-- it. This migration adds the missing write paths so the shell can call a real RPC for each one.
--
-- Reuse (grep first): where an RPC already exists it is used and not redefined —
--   * reopen_engagement(uuid, text)         (0007)  — the engagement reopen path
--   * sign_off_workpaper(uuid)              (0028)  — the workpaper seal
--   * record_workpaper_row(...)             (0028)  — a row result (also seeds workpaper_rows)
--   * create_observation(uuid, uuid, text, jsonb) (0030)
--   * update_cap / close_cap                (0034-family) — CAP writes
--   * sign_planning / sign_conclusion       (0034)  — the lifecycle seals
-- What is genuinely missing and added here: finalize_testing, submit_population, add_entity and
-- comment_create. Each is a thin, right-checked, ledger-writing wrapper in the shape the repo already
-- uses (jwt_org_id + caller_has_right + append_ledger_entry).
--
-- M2: create or replace throughout, safe to re-apply. M8: one client. Grants: application roles only.

-- ---------------------------------------------------------------------------
-- finalize_testing: the "Testing finalized" action (src/lib/... finalizeTest). Testing may only be
-- concluded when every recorded row has a result and every exception row is flagged, mirroring the
-- pre-conditions sign_off_workpaper() enforces. Moves the workpaper to 'prepared' and writes a ledger
-- entry so the action is durable and visible to every other principal.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_testing(p_workpaper_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
  v_rows int;
  v_unresolved int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;

  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: a signed-off workpaper is read-only' using errcode = 'P0001';
  end if;

  select count(*) into v_rows from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org;
  if v_rows = 0 then
    raise exception 'no rows to finalize on workpaper %', p_workpaper_id using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org and result is null;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % row(s) have no result', v_unresolved using errcode = 'P0001';
  end if;

  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org
     and result in ('cross', 'unverifiable') and not exception_flag;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % exception row(s) are not flagged', v_unresolved using errcode = 'P0001';
  end if;

  update workpapers
     set status = 'prepared', prepared = true, prepared_by = auth.uid(), prepared_at = now()
   where id = p_workpaper_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'test_finalize',
    jsonb_build_object('workpaper_id', p_workpaper_id::text,
                       'engagement_id', v_wp.engagement_id::text, 'rows', v_rows),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'test_finalize', 'workpaper', p_workpaper_id,
          jsonb_build_object('rows', v_rows));
end $$;

-- ---------------------------------------------------------------------------
-- submit_population: record a verified population for a workpaper. The row is the authority the
-- existing verify_population() trigger checks (sha256 present, row_count > 0) and the anchor the
-- downstream sampling and row testing hang off. Upserts one population per workpaper.
-- ---------------------------------------------------------------------------
create or replace function public.submit_population(
  p_workpaper_id uuid,
  p_sha256 text,
  p_file_name text,
  p_row_count int,
  p_total_cents bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_population: a population needs a lowercase SHA-256' using errcode = 'P0001';
  end if;
  if coalesce(p_row_count, 0) < 1 then
    raise exception 'invalid_population: a verified population needs at least one row' using errcode = 'P0001';
  end if;

  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: a signed-off workpaper is read-only' using errcode = 'P0001';
  end if;

  select id into v_id from populations
   where workpaper_id = p_workpaper_id and org_id = v_org
   order by created_at desc limit 1;

  if v_id is null then
    insert into populations (org_id, engagement_id, workpaper_id, sha256, control_total_cents, status,
                             filename, row_count, verified_at, verified_by)
    values (v_org, v_wp.engagement_id, p_workpaper_id, p_sha256, p_total_cents, 'verified',
            nullif(btrim(coalesce(p_file_name, '')), ''), p_row_count, now(), auth.uid())
    returning id into v_id;
  else
    update populations
       set sha256 = p_sha256, control_total_cents = p_total_cents, status = 'verified',
           filename = nullif(btrim(coalesce(p_file_name, '')), ''), row_count = p_row_count,
           verified_at = now(), verified_by = auth.uid()
     where id = v_id;
  end if;

  perform public.append_ledger_entry(
    v_org, 'population_verified',
    jsonb_build_object('workpaper_id', p_workpaper_id::text, 'population_id', v_id::text,
                       'sha256', p_sha256, 'rows', p_row_count),
    auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- add_entity: create an auditable entity in the caller's organisation (spec §6). Requires the
-- configured initiate right; the entity starts as a draft, exactly as submit_entity() expects, so the
-- approval workflow is the only way to make it usable.
-- ---------------------------------------------------------------------------
create or replace function public.add_entity(
  p_universe_id uuid,
  p_name text,
  p_kind text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_cfg record;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.entity_approval_config(v_org);
  if not coalesce(public.caller_has_right(v_cfg.initiate_right), false) then
    raise exception 'not allowed: caller lacks the % right to add an entity', v_cfg.initiate_right
      using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'an entity needs a name' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes u where u.id = p_universe_id and u.org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;

  insert into entities (org_id, universe_id, name, kind, approved, status)
  values (v_org, p_universe_id, btrim(p_name), nullif(btrim(coalesce(p_kind, '')), ''), false, 'draft')
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'entity_added', 'entity', v_id,
          jsonb_build_object('universe_id', p_universe_id::text, 'name', btrim(p_name)));
  perform public.append_ledger_entry(
    v_org, 'config_changed',
    jsonb_build_object('entity_id', v_id::text, 'universe_id', p_universe_id::text,
                       'name', btrim(p_name)),
    auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- workpaper_step_state: the completion tick on a test step. Test steps are seeded on the workpaper
-- and their *definitions* become data in Phase 4; what must persist today is which steps are done, so
-- a reload does not forget. Phase 4 extends this table with the template it came from.
-- ---------------------------------------------------------------------------
create table if not exists workpaper_step_state (
  org_id uuid not null references orgs(id) on delete cascade,
  workpaper_id uuid not null references workpapers(id) on delete cascade,
  step_id text not null,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workpaper_id, step_id)
);

alter table workpaper_step_state enable row level security;
drop policy if exists workpaper_step_state_select on workpaper_step_state;
create policy workpaper_step_state_select on workpaper_step_state for select to authenticated
  using (org_id = public.jwt_org_id());

drop trigger if exists workpaper_step_state_pin_org on workpaper_step_state;
create trigger workpaper_step_state_pin_org before insert on workpaper_step_state
  for each row execute function public.pin_org_id();
drop trigger if exists workpaper_step_state_sealed_guard on workpaper_step_state;
create trigger workpaper_step_state_sealed_guard before update or delete on workpaper_step_state
  for each row execute function public.guard_workpaper_child_rows();

create or replace function public.set_test_step_state(
  p_workpaper_id uuid, p_step_id text, p_completed boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_step_id, '')), '') is null then
    raise exception 'a test step needs an identifier' using errcode = 'P0001';
  end if;

  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: a signed-off workpaper is read-only' using errcode = 'P0001';
  end if;

  insert into workpaper_step_state (org_id, workpaper_id, step_id, completed, updated_at)
  values (v_org, p_workpaper_id, btrim(p_step_id), coalesce(p_completed, false), now())
  on conflict (workpaper_id, step_id) do update
    set completed = excluded.completed, updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- seal_engagement: seal an engagement from the Audit File review surface. The staged lifecycle
-- (set_engagement_stage, signoff_role_* enforcement) is Phase 2; this is the flat seal that replaces
-- the in-memory mutation, with the same pre-conditions the screen already checks: review_and_approve,
-- at least one workpaper, and every workpaper signed off.
-- ---------------------------------------------------------------------------
create or replace function public.seal_engagement(p_engagement_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
  v_total int;
  v_open int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;

  select * into v_eng from engagements where id = p_engagement_id and org_id = v_org;
  if v_eng.id is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if v_eng.sealed then
    raise exception 'already_sealed: the engagement is already sealed' using errcode = 'P0001';
  end if;

  select count(*) into v_total from workpapers where engagement_id = p_engagement_id and org_id = v_org;
  if v_total = 0 then
    raise exception 'sign_off_blocked: there are no working papers to seal' using errcode = 'P0001';
  end if;
  select count(*) into v_open from workpapers
   where engagement_id = p_engagement_id and org_id = v_org and status <> 'signed_off';
  if v_open > 0 then
    raise exception 'sign_off_blocked: % working paper(s) are not signed off', v_open using errcode = 'P0001';
  end if;

  update engagements set sealed = true, stage = 'conclusion'
   where id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'audit_sign_off',
    jsonb_build_object('engagement_id', p_engagement_id::text, 'workpapers', v_total),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'audit_sign_off', 'engagement', p_engagement_id,
          jsonb_build_object('workpapers', v_total));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only (0085 has already revoked the inherited anon grant for new
-- functions; these grants make the surface explicit).
-- ---------------------------------------------------------------------------
revoke execute on function public.finalize_testing(uuid) from public, anon;
revoke execute on function public.submit_population(uuid, text, text, int, bigint) from public, anon;
revoke execute on function public.add_entity(uuid, text, text) from public, anon;
revoke execute on function public.set_test_step_state(uuid, text, boolean) from public, anon;
revoke execute on function public.seal_engagement(uuid) from public, anon;
grant execute on function public.finalize_testing(uuid) to authenticated;
grant execute on function public.submit_population(uuid, text, text, int, bigint) to authenticated;
grant execute on function public.add_entity(uuid, text, text) to authenticated;
grant execute on function public.set_test_step_state(uuid, text, boolean) to authenticated;
grant execute on function public.seal_engagement(uuid) to authenticated;

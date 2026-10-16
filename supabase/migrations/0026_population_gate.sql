-- 4C: Population gate DB (spec §11.1).
--
-- The spec:
--   §11.1 "Verification. SHA-256 hashing, integrity checks and a control-total reconciliation run.
--          Only then is the population marked VERIFIED and the test unlocked. The database rejects
--          any sample or test row that lacks a verified population hash."
--   L3 "Nothing is sampled or tested against an unverified population."
--
-- Reuse (grep first): `populations` already exists (0004) with sha256, control_total_cents and a
-- status CHECK of pending/verified/rejected; `enforce_population_gate` and `enforce_sample_row_gate`
-- already exist (0006). This migration ALTERs the table and CREATE OR REPLACEs the two gate
-- functions rather than creating parallel objects (M1: existing objects, extended).
--
-- D-4C-status: the task's vocabulary is uploading/verifying/verified/locked/archived. The existing
-- CHECK also allows pending/rejected, and SQL test 06 writes both, so the widened CHECK keeps them
-- (removing a value would weaken a passing test). `locked` is still a verified population: the gate
-- accepts 'verified' or 'locked'.

alter table populations add column if not exists workpaper_id uuid null references workpapers(id) on delete set null;
alter table populations add column if not exists filename text null;
alter table populations add column if not exists row_count int null;
alter table populations add column if not exists verified_at timestamptz null;
alter table populations add column if not exists verified_by uuid null;

-- Widen the status vocabulary. Drop the old unnamed/old-named CHECK first (M7: repair above the
-- failing statement), then add the new one with every value the product and the tests use.
alter table populations drop constraint if exists populations_status_check;
alter table populations drop constraint if exists populations_status_chk;
alter table populations add constraint populations_status_chk check (
  status in ('pending', 'uploading', 'verifying', 'verified', 'rejected', 'locked', 'archived')
);

-- ---------------------------------------------------------------------------
-- Verification trigger (§11.1): a population may only become verified when it carries a SHA-256 and
-- a positive row count. The trigger stamps verified_at/by. A row may only be locked once verified.
-- ---------------------------------------------------------------------------
create or replace function public.verify_population() returns trigger
language plpgsql as $$
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
    if new.sha256 is null or length(btrim(new.sha256)) = 0 then
      raise exception 'population_verify: a population needs a SHA-256 before it can be verified'
        using errcode = 'P0001';
    end if;
    if new.row_count is null or new.row_count <= 0 then
      raise exception 'population_verify: a population needs a positive row count before it can be verified'
        using errcode = 'P0001';
    end if;
    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(new.verified_by, auth.uid());
  end if;
  if new.status = 'locked' and (tg_op = 'INSERT' or old.status is distinct from 'locked') then
    if new.verified_at is null then
      raise exception 'population_lock: a population must be verified before it can be locked'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists populations_verify on populations;
create trigger populations_verify before insert or update on populations
  for each row execute function public.verify_population();

-- ---------------------------------------------------------------------------
-- Population gate (L3). CREATE OR REPLACE the two functions from 0006 so a locked population (still
-- verified) keeps accepting samples, while every other status is refused.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_population_gate() returns trigger
language plpgsql as $$
declare
  pop_status text;
  pop_sha text;
begin
  select p.status, p.sha256 into pop_status, pop_sha
  from populations p where p.id = new.population_id;

  if pop_status is null then
    raise exception 'population_gate: population % not found', new.population_id using errcode = 'P0001';
  end if;
  if pop_status not in ('verified', 'locked') then
    raise exception 'population_gate: population % is not verified (status=%)', new.population_id, pop_status
      using errcode = 'P0001';
  end if;
  if pop_sha is distinct from new.population_sha256 then
    raise exception 'population_gate: population_sha256 does not match the verified population hash'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.enforce_sample_row_gate() returns trigger
language plpgsql as $$
declare
  pop_status text;
  pop_sha text;
  s_sha text;
begin
  select p.status, p.sha256, s.population_sha256 into pop_status, pop_sha, s_sha
  from samples s join populations p on p.id = s.population_id
  where s.id = new.sample_id;

  if pop_status is null then
    raise exception 'population_gate: sample % not found', new.sample_id using errcode = 'P0001';
  end if;
  if pop_status not in ('verified', 'locked') or pop_sha is distinct from s_sha then
    raise exception 'population_gate: sample % is not backed by a verified population', new.sample_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- lock_population: freeze a verified population (§11.1). Writes a ledger entry.
-- ---------------------------------------------------------------------------
create or replace function public.lock_population(p_population_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_status text;
  v_eng uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select status, engagement_id into v_status, v_eng from populations
   where id = p_population_id and org_id = v_org;
  if v_status is null then
    raise exception 'population not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'locked' then
    raise exception 'population is already locked' using errcode = 'P0001';
  end if;
  if v_status <> 'verified' then
    raise exception 'only a verified population can be locked (status=%)', v_status using errcode = 'P0001';
  end if;

  update populations set status = 'locked' where id = p_population_id and org_id = v_org;
  perform public.append_ledger_entry(
    v_org, 'population_locked',
    jsonb_build_object('population_id', p_population_id, 'engagement_id', v_eng), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id)
  values (v_org, auth.uid(), 'population_locked', 'population', p_population_id);
end $$;

-- ---------------------------------------------------------------------------
-- replace_locked_population: a locked population is immutable; a replacement creates a NEW row and
-- logs the old one with a rationale (a material change, §21). The old row is never deleted.
-- ---------------------------------------------------------------------------
create or replace function public.replace_locked_population(p_population_id uuid, p_rationale text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_old populations;
  v_new uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_rationale is null or length(btrim(p_rationale)) < 10 then
    raise exception 'a replacement rationale of at least 10 characters is required' using errcode = 'P0001';
  end if;
  select * into v_old from populations where id = p_population_id and org_id = v_org;
  if v_old.id is null then
    raise exception 'population not found in this organisation' using errcode = 'P0001';
  end if;
  if v_old.status <> 'locked' then
    raise exception 'only a locked population may be replaced (status=%)', v_old.status using errcode = 'P0001';
  end if;

  insert into populations (org_id, engagement_id, workpaper_id, filename, sha256, control_total_cents,
                           row_count, status)
  values (v_org, v_old.engagement_id, v_old.workpaper_id, v_old.filename, v_old.sha256,
          v_old.control_total_cents, v_old.row_count, 'uploading')
  returning id into v_new;

  perform public.append_ledger_entry(
    v_org, 'population_replaced',
    jsonb_build_object('old_population_id', p_population_id, 'new_population_id', v_new,
                       'rationale', btrim(p_rationale)), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'population_replaced', 'population', p_population_id,
          jsonb_build_object('new_population_id', v_new, 'rationale', btrim(p_rationale)));
  return v_new;
end $$;

revoke execute on function public.lock_population(uuid) from public, anon;
revoke execute on function public.replace_locked_population(uuid, text) from public, anon;
grant execute on function public.lock_population(uuid) to authenticated;
grant execute on function public.replace_locked_population(uuid, text) to authenticated;

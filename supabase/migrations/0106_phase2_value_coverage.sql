-- 0106 phase2 value coverage — high-value items must be included or explicitly waived (SCALE-TASKS 2.9).
--
-- The audit found no value-coverage check: a sample could exclude the population's largest items and
-- still lock. The spec (§11.3) treats high-value coverage as non-negotiable and §11.1/§21 make a
-- departure a recorded, material decision. This migration adds the check the sample lock enforces:
-- `assert_value_coverage` raises while any high-value item is neither in the sample nor waived, and
-- a waiver is a row in `sample_value_waivers` with a >=10-character reason — append-only, so the
-- history is kept and a waiver can be withdrawn only by a later, logged act.
--
-- A *system* sample already covers the high-value items (0105 includes them), so this check bites on
-- an *auditor paste* that omits them. That is the case the spec names: the auditor must include them
-- or say why not.
--
-- Reuse (grep first): `high_value_row_refs` (0105), `samples` (0004/0027), `workpaper_rows` (0028),
-- `append_ledger_entry` (0073), `pin_org_id` (0009). `lock_sample` is replaced once more (its 0104
-- body plus the coverage assertion); the signature and every existing check are unchanged.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: application roles only.

create table if not exists sample_value_waivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  sample_id uuid not null references samples(id) on delete cascade,
  row_ref int not null,
  reason text not null,
  waived_by uuid null,
  waived_at timestamptz not null default now()
);
create index if not exists sample_value_waivers_sample_idx on sample_value_waivers (org_id, sample_id, row_ref);

alter table sample_value_waivers drop constraint if exists svw_reason_len_chk;
alter table sample_value_waivers add constraint svw_reason_len_chk
  check (length(btrim(reason)) >= 10);

alter table sample_value_waivers enable row level security;
drop policy if exists sample_value_waivers_select on sample_value_waivers;
create policy sample_value_waivers_select on sample_value_waivers for select to authenticated
  using (org_id = public.jwt_org_id());

do $$
begin
  execute 'drop trigger if exists sample_value_waivers_pin_org on sample_value_waivers';
  execute 'create trigger sample_value_waivers_pin_org before insert on sample_value_waivers for each row execute function public.pin_org_id()';
end $$;

-- A waiver is a historical fact: the latest row per (sample, row) is the live one, so an edit or
-- delete would rewrite history.
create or replace function public.sample_value_waivers_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'sample_value_waivers is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists sample_value_waivers_no_change on sample_value_waivers;
create trigger sample_value_waivers_no_change before update or delete on sample_value_waivers
  for each row execute function public.sample_value_waivers_append_only();

-- ---------------------------------------------------------------------------
-- value_coverage: the high-value items for a sample's population, which of them the sample holds and
-- which are waived. Returns the full picture so the screen can explain it (never a bare boolean).
-- ---------------------------------------------------------------------------
create or replace function public.value_coverage(p_sample_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_pop uuid;
  v_rows int[];
  v_in int[];
  v_waived int[];
begin
  select population_id into v_pop from samples where id = p_sample_id and org_id = v_org;
  if v_pop is null then
    raise exception 'sample not found in this organisation' using errcode = 'P0001';
  end if;
  v_rows := public.high_value_row_refs(v_pop);

  select coalesce(array_agg(distinct nullif(e ->> 'row_ref', '')::int), '{}'::int[])
    into v_in
    from samples s, jsonb_array_elements(coalesce(s.sample_rows, '[]'::jsonb)) e
   where s.id = p_sample_id and s.org_id = v_org;

  select coalesce(array_agg(distinct row_ref), '{}'::int[]) into v_waived
    from sample_value_waivers where org_id = v_org and sample_id = p_sample_id;

  return jsonb_build_object(
    'high_value_rows', to_jsonb(v_rows),
    'included', to_jsonb(coalesce(array(select unnest(v_rows) intersect select unnest(v_in)), '{}'::int[])),
    'missing', to_jsonb(coalesce(array(select unnest(v_rows) except select unnest(v_in) except select unnest(v_waived)), '{}'::int[])),
    'waived', to_jsonb(coalesce(array(select unnest(v_waived) intersect select unnest(v_rows)), '{}'::int[])),
    'covered', not exists (
      select 1 from unnest(v_rows) h
       where h <> all(v_in) and h <> all(v_waived)));
end $$;

-- assert_value_coverage: the gate the sample lock calls. Raises while any high-value item is missing.
create or replace function public.assert_value_coverage(p_sample_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_missing jsonb := public.value_coverage(p_sample_id) -> 'missing';
begin
  if jsonb_array_length(v_missing) > 0 then
    raise exception 'value_coverage: high-value item(s) % are neither in the sample nor waived',
      v_missing using errcode = 'P0001';
  end if;
end $$;

-- waive_value_coverage: record the departure. perform_work, >=10-character reason, ledger entry.
create or replace function public.waive_value_coverage(
  p_sample_id uuid, p_row_ref int, p_reason text
) returns uuid
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
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a waiver reason of at least 10 characters is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from samples where id = p_sample_id and org_id = v_org) then
    raise exception 'sample not found in this organisation' using errcode = 'P0001';
  end if;
  insert into sample_value_waivers (org_id, sample_id, row_ref, reason, waived_by)
  values (v_org, p_sample_id, p_row_ref, btrim(p_reason), auth.uid())
  returning id into v_id;
  perform public.append_ledger_entry(
    v_org, 'value_coverage_waived',
    jsonb_build_object('sample_id', p_sample_id, 'row_ref', p_row_ref, 'reason', btrim(p_reason)),
    auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- lock_sample, replaced in place: the 0104 body plus the value-coverage gate before the lock.
-- ---------------------------------------------------------------------------
create or replace function public.lock_sample(p_sample_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sample samples;
  v_seeded int := 0;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select * into v_sample from samples where id = p_sample_id and org_id = v_org;
  if v_sample.id is null then
    raise exception 'sample not found in this organisation' using errcode = 'P0001';
  end if;
  if v_sample.locked_at is not null then
    raise exception 'sample is already locked' using errcode = 'P0001';
  end if;
  if v_sample.size_floor is not null
     and jsonb_array_length(coalesce(v_sample.sample_rows, '[]'::jsonb)) < v_sample.size_floor then
    raise exception 'sample_floor: the sample holds % rows but the floor is %',
      jsonb_array_length(coalesce(v_sample.sample_rows, '[]'::jsonb)), v_sample.size_floor
      using errcode = 'P0001';
  end if;

  -- 2.9: high-value items must be included or explicitly waived before the sample locks.
  perform public.assert_value_coverage(p_sample_id);

  update samples set locked = true, locked_at = now(), locked_by = auth.uid()
   where id = p_sample_id and org_id = v_org;

  if v_sample.workpaper_id is not null then
    insert into workpaper_rows (org_id, workpaper_id, sample_id, row_ref, exception_flag)
    select v_org, v_sample.workpaper_id, v_sample.id, elem ->> 'row_ref', false
      from jsonb_array_elements(coalesce(v_sample.sample_rows, '[]'::jsonb)) elem
     where elem ? 'row_ref'
    on conflict (workpaper_id, row_ref) do update set sample_id = excluded.sample_id;
    get diagnostics v_seeded = row_count;
  end if;

  perform public.append_ledger_entry(
    v_org, 'sample_locked',
    jsonb_build_object('sample_id', p_sample_id, 'workpaper_id', v_sample.workpaper_id,
                       'rows', jsonb_array_length(coalesce(v_sample.sample_rows, '[]'::jsonb)),
                       'rows_seeded', v_seeded), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sample_locked', 'sample', p_sample_id,
          jsonb_build_object('rows_seeded', v_seeded));
end $$;

revoke execute on function public.sample_value_waivers_append_only() from public, anon;
revoke execute on function public.value_coverage(uuid) from public, anon;
revoke execute on function public.assert_value_coverage(uuid) from public, anon;
revoke execute on function public.waive_value_coverage(uuid, int, text) from public, anon;
revoke execute on function public.lock_sample(uuid) from public, anon;

grant execute on function public.value_coverage(uuid) to authenticated;
grant execute on function public.assert_value_coverage(uuid) to authenticated;
grant execute on function public.waive_value_coverage(uuid, int, text) to authenticated;
grant execute on function public.lock_sample(uuid) to authenticated;

-- 4D: Sampling engine DB (spec §11.2).
--
-- The spec:
--   §11.2 "Org Sampling Table: control type × frequency × population size band -> method and size.
--          System mode: seeded, deterministic, reproducible. Auditor paste: each item is validated
--          against the population. A sample size floor is enforced. A locked sample is immutable;
--          changing it needs a recorded rationale."
--
-- Reuse (grep first): a `samples` table already exists (0004) with population_id, population_sha256,
-- method, size_floor and a `locked` boolean, and `sample_rows` exists as a table. This migration
-- ALTERs `samples` (adding workpaper_id, mode, seed, sample_rows jsonb, locked_at/by) rather than
-- creating a second samples table (M1: existing object, extended). `sample_rows` is also the exact
-- column name the task asks for; Postgres keeps table and column names in separate namespaces, so the
-- jsonb column `samples.sample_rows` and the table `sample_rows` coexist (D-4D-column-name).

create table if not exists org_sampling_table (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  control_type text not null,
  frequency text not null,
  pop_band text not null,
  method text not null check (method in ('random', 'systematic', 'mus', 'stratified', 'high_value', 'low_value', 'haphazard')),
  base_size int not null default 5 check (base_size >= 1),
  pct numeric not null default 0.10 check (pct > 0 and pct <= 1),
  created_at timestamptz not null default now(),
  unique (org_id, control_type, frequency, pop_band)
);
create index if not exists org_sampling_table_org_idx on org_sampling_table (org_id);

alter table org_sampling_table enable row level security;
drop policy if exists ost_select on org_sampling_table;
create policy ost_select on org_sampling_table for select to authenticated
  using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- samples: extend the existing table.
-- ---------------------------------------------------------------------------
alter table samples add column if not exists workpaper_id uuid null references workpapers(id) on delete set null;
alter table samples add column if not exists mode text null;
alter table samples add column if not exists seed text null;
alter table samples add column if not exists sample_rows jsonb null;
alter table samples add column if not exists locked_at timestamptz null;
alter table samples add column if not exists locked_by uuid null;

alter table samples drop constraint if exists samples_mode_chk;
alter table samples add constraint samples_mode_chk check (mode is null or mode in ('system', 'auditor_paste'));

-- Floor enforcement: a locked sample must hold at least size_floor rows (§11.2).
alter table samples drop constraint if exists samples_floor_chk;
alter table samples add constraint samples_floor_chk check (
  locked_at is null
  or (size_floor is null or jsonb_array_length(coalesce(sample_rows, '[]'::jsonb)) >= size_floor)
);

-- A locked sample is immutable. replace_sample() never mutates the locked row; it creates a new one.
create or replace function public.guard_locked_sample() returns trigger
language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.locked_at is not null then
    raise exception 'sample_locked: sample % is locked and immutable', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists samples_locked_guard on samples;
create trigger samples_locked_guard before update on samples
  for each row execute function public.guard_locked_sample();

-- ---------------------------------------------------------------------------
-- get_sample_size: the minimum sample size for a control/frequency/band (§11.2).
-- Deterministic: least(pop_count, greatest(base_size, ceil(pop_count * pct))).
-- ---------------------------------------------------------------------------
create or replace function public.get_sample_size(
  p_org_id uuid, p_control_type text, p_frequency text, p_pop_band text, p_pop_count int
) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_base int;
  v_pct numeric;
begin
  if p_pop_count is null or p_pop_count <= 0 then
    return 0;
  end if;
  select base_size, pct into v_base, v_pct
  from org_sampling_table
  where org_id = p_org_id and control_type = p_control_type
    and frequency = p_frequency and pop_band = p_pop_band;
  if v_base is null then
    raise exception 'no sampling rule for control_type=% frequency=% band=%', p_control_type, p_frequency, p_pop_band
      using errcode = 'P0001';
  end if;
  return least(p_pop_count, greatest(v_base, ceil(p_pop_count * v_pct)::int));
end $$;

-- seed_org_sampling_table: give an org a working default rule set (§11.2 configuration-not-code).
create or replace function public.seed_org_sampling_table(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into org_sampling_table (org_id, control_type, frequency, pop_band, method, base_size, pct) values
    (p_org_id, 'any', 'any', 'small',  'random',     5,  0.10),
    (p_org_id, 'any', 'any', 'medium', 'systematic', 10, 0.08),
    (p_org_id, 'any', 'any', 'large',  'mus',        15, 0.05)
  on conflict (org_id, control_type, frequency, pop_band) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- compute_sample: build the sample rows for a workpaper (§11.2).
--   mode 'system':        seed = sha256(population.sha256 || workpaper_id), deterministic order.
--   mode 'auditor_paste': every pasted item is validated against the population; an item that is not
--                         present is refused.
-- Returns the sample rows as a jsonb array.
-- ---------------------------------------------------------------------------
create or replace function public.compute_sample(
  p_workpaper_id uuid, p_mode text, p_items jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng uuid;
  v_pop populations;
  v_sample samples;
  v_seed text;
  v_n int;
  v_rows jsonb;
  v_bad jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_mode not in ('system', 'auditor_paste') then
    raise exception 'unknown sampling mode: %', p_mode using errcode = 'P0001';
  end if;

  select engagement_id into v_eng from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_eng is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;

  -- The verified/locked population attached to this workpaper (most recent).
  select * into v_pop from populations
   where org_id = v_org and workpaper_id = p_workpaper_id and status in ('verified', 'locked')
   order by created_at desc limit 1;
  if v_pop.id is null then
    raise exception 'population_gate: no verified population is attached to workpaper %', p_workpaper_id
      using errcode = 'P0001';
  end if;

  -- Reuse or create the sample row for this workpaper.
  select * into v_sample from samples where org_id = v_org and workpaper_id = p_workpaper_id
   order by created_at desc limit 1;
  if v_sample.id is null then
    perform public.seed_org_sampling_table(v_org);
    v_n := public.get_sample_size(v_org, 'any', 'any',
             case when coalesce(v_pop.row_count, 0) < 50 then 'small'
                  when coalesce(v_pop.row_count, 0) < 500 then 'medium' else 'large' end,
             coalesce(v_pop.row_count, (select count(*)::int from population_rows where population_id = v_pop.id)));
    insert into samples (org_id, population_id, population_sha256, workpaper_id, mode, method, size_floor, sample_rows)
    values (v_org, v_pop.id, v_pop.sha256, p_workpaper_id, p_mode, 'random', v_n, '[]'::jsonb)
    returning * into v_sample;
  end if;

  if v_sample.locked_at is not null then
    raise exception 'sample_locked: sample % is locked and immutable', v_sample.id using errcode = 'P0001';
  end if;

  if p_mode = 'system' then
    v_seed := encode(extensions.digest(v_pop.sha256 || p_workpaper_id::text, 'sha256'), 'hex');
    v_n := coalesce(v_sample.size_floor, 1);
    select coalesce(jsonb_agg(jsonb_build_object('row_ref', r.row_ref, 'data', r.data)
                              order by r.ord), '[]'::jsonb)
      into v_rows
    from (
      select pr.row_ref, pr.data,
             row_number() over (order by md5(v_seed || pr.row_ref::text), pr.row_ref) as ord
      from population_rows pr where pr.population_id = v_pop.id
    ) r
    where r.ord <= v_n;
  else
    -- auditor_paste: every pasted item must exist in the population.
    select coalesce(jsonb_agg(x.item), '[]'::jsonb) into v_rows
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x(item);
    if v_rows = '[]'::jsonb then
      raise exception 'auditor_paste: at least one row is required' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(x.item), '[]'::jsonb) into v_bad
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x(item)
    where not exists (
      select 1 from population_rows pr
      where pr.population_id = v_pop.id and pr.row_ref = nullif(x.item ->> 'row_ref', '')::int);
    if v_bad <> '[]'::jsonb then
      raise exception 'auditor_paste: % item(s) are not in population %', jsonb_array_length(v_bad), v_pop.id
        using errcode = 'P0001';
    end if;
  end if;

  update samples
     set mode = p_mode, seed = v_seed, sample_rows = v_rows, method = coalesce(v_sample.method, 'random')
   where id = v_sample.id and org_id = v_org;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- lock_sample: freeze a sample once it meets the floor (§11.2).
-- ---------------------------------------------------------------------------
create or replace function public.lock_sample(p_sample_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_sample samples;
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
  update samples set locked = true, locked_at = now(), locked_by = auth.uid()
   where id = p_sample_id and org_id = v_org;
end $$;

-- ---------------------------------------------------------------------------
-- replace_sample: a locked sample is immutable; replacement needs a rationale and writes a new
-- sample row, retaining the old one (§11.2, §21).
-- ---------------------------------------------------------------------------
create or replace function public.replace_sample(p_sample_id uuid, p_rationale text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_old samples;
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
  select * into v_old from samples where id = p_sample_id and org_id = v_org;
  if v_old.id is null then
    raise exception 'sample not found in this organisation' using errcode = 'P0001';
  end if;
  if v_old.locked_at is null then
    raise exception 'only a locked sample may be replaced' using errcode = 'P0001';
  end if;

  insert into samples (org_id, population_id, population_sha256, workpaper_id, mode, method, size_floor, sample_rows)
  values (v_org, v_old.population_id, v_old.population_sha256, v_old.workpaper_id, v_old.mode, v_old.method,
          v_old.size_floor, '[]'::jsonb)
  returning id into v_new;

  perform public.append_ledger_entry(
    v_org, 'sample_replaced',
    jsonb_build_object('old_sample_id', p_sample_id, 'new_sample_id', v_new, 'rationale', btrim(p_rationale)),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'sample_replaced', 'sample', p_sample_id,
          jsonb_build_object('new_sample_id', v_new, 'rationale', btrim(p_rationale)));
  return v_new;
end $$;

-- Pin org_id on the new configuration table for application roles (same defence as 0009).
do $$
begin
  execute 'drop trigger if exists org_sampling_table_pin_org on org_sampling_table';
  execute 'create trigger org_sampling_table_pin_org before insert on org_sampling_table for each row execute function public.pin_org_id()';
end $$;


revoke execute on function public.get_sample_size(uuid, text, text, text, int) from public, anon;
revoke execute on function public.seed_org_sampling_table(uuid) from public, anon;
revoke execute on function public.compute_sample(uuid, text, jsonb) from public, anon;
revoke execute on function public.lock_sample(uuid) from public, anon;
revoke execute on function public.replace_sample(uuid, text) from public, anon;

grant execute on function public.get_sample_size(uuid, text, text, text, int) to authenticated;
grant execute on function public.seed_org_sampling_table(uuid) to authenticated;
grant execute on function public.compute_sample(uuid, text, jsonb) to authenticated;
grant execute on function public.lock_sample(uuid) to authenticated;
grant execute on function public.replace_sample(uuid, text) to authenticated;

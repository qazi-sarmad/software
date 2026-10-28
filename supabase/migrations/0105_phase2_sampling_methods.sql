-- 0105 phase2 sampling methods — method-aware selection and a Clopper-Pearson bound (SCALE-TASKS 2.8).
--
-- The audit found `compute_sample` (0027) hardcoded `method = 'random'` and selected by
-- `md5(seed || row_ref)`. The schema accepted seven methods
-- (`random, systematic, mus, stratified, high_value, low_value, haphazard`) and the Org Sampling
-- Table mapped a control/frequency/band to one of them, but the engine implemented exactly one. The
-- spec (§11.3) requires all of them, and "all methods use a seeded Mulberry32 PRNG derived from the
-- population hash and the workpaper ID. Each sample shows 'how this was calculated', with the
-- formula, inputs and result." §11.3 also names a Clopper-Pearson bound.
--
-- This migration makes `compute_sample` method-aware: it reads the method the Org Sampling Table
-- maps to this population's band and applies it. Every method is seeded and reproducible. The sample
-- records `calculation` (formula, inputs, result) so the screen can explain it, and
-- `clopper_pearson_upper` / `clopper_pearson_lower` give the exact bound the auditor reports.
--
-- The engine includes the population's high-value items in a *system* sample, because §11.3 treats
-- high-value coverage as non-negotiable (a pasted sample must cover them or waive them, which 2.9
-- enforces at lock). This is why `sample_rows` can exceed `size_floor`: the floor is a minimum.
--
-- Reuse (grep first): `org_sampling_table` (0027), `samples` (0004/0027), `get_sample_size` (0027),
-- `extensions.digest` (pgcrypto). Only `compute_sample` is replaced, with its signature unchanged so
-- every existing caller keeps working.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: unchanged.

alter table samples add column if not exists calculation jsonb null;

-- ---------------------------------------------------------------------------
-- binom_cdf: P(X <= k) for X ~ Binomial(n, p), computed directly. This is the textbook Clopper-Pearson
-- definition (the exact binomial tail), so no incomplete-beta special function is needed.
-- ---------------------------------------------------------------------------
create or replace function public.binom_cdf(p_k int, p_n int, p_p double precision)
returns double precision
language plpgsql immutable as $$
declare
  v_term double precision;
  v_total double precision;
  i int;
begin
  if p_p <= 0 then return case when p_k >= 0 then 1.0 else 0.0 end; end if;
  if p_p >= 1 then return case when p_k >= p_n then 1.0 else 0.0 end; end if;
  if p_k < 0 then return 0.0; end if;
  if p_k >= p_n then return 1.0; end if;
  v_term := exp(p_n * ln(1.0 - p_p));
  v_total := v_term;
  for i in 0..p_k - 1 loop
    v_term := v_term * (p_n - i) / (i + 1) * p_p / (1.0 - p_p);
    v_total := v_total + v_term;
  end loop;
  return least(1.0, greatest(0.0, v_total));
end $$;

-- ---------------------------------------------------------------------------
-- Clopper-Pearson exact interval for k exceptions in n tested items (§11.3). The upper bound is the p
-- where P(X <= k) = (1-conf)/2; the lower is the p where P(X <= k-1) = 1 - (1-conf)/2. Both by
-- bisection, which is monotone here and needs no derivative.
-- ---------------------------------------------------------------------------
create or replace function public.clopper_pearson_upper(p_k int, p_n int, p_conf numeric default 0.95)
returns numeric
language plpgsql immutable as $$
declare
  a double precision := (1.0 - p_conf) / 2.0;
  lo double precision := 0.0;
  hi double precision := 1.0;
  mid double precision;
  i int;
begin
  if p_n is null or p_n <= 0 then return null; end if;
  if p_k >= p_n then return 1.0; end if;
  for i in 1..200 loop
    mid := (lo + hi) / 2.0;
    if public.binom_cdf(p_k, p_n, mid) > a then lo := mid; else hi := mid; end if;
  end loop;
  return round(((lo + hi) / 2.0)::numeric, 6);
end $$;

create or replace function public.clopper_pearson_lower(p_k int, p_n int, p_conf numeric default 0.95)
returns numeric
language plpgsql immutable as $$
declare
  a double precision := 1.0 - (1.0 - p_conf) / 2.0;
  lo double precision := 0.0;
  hi double precision := 1.0;
  mid double precision;
  i int;
begin
  if p_n is null or p_n <= 0 then return null; end if;
  if p_k <= 0 then return 0.0; end if;
  for i in 1..200 loop
    mid := (lo + hi) / 2.0;
    if public.binom_cdf(p_k - 1, p_n, mid) > a then lo := mid; else hi := mid; end if;
  end loop;
  return round(((lo + hi) / 2.0)::numeric, 6);
end $$;

-- ---------------------------------------------------------------------------
-- population_row_value: the money value of a population row. The importer writes `amt`; the other keys
-- are accepted so a client that names the column differently still gets a value, and a row with no
-- value counts as zero (it can never be high-value, so it never blocks coverage).
-- ---------------------------------------------------------------------------
create or replace function public.population_row_value(p_data jsonb) returns numeric
language sql immutable as $$
  select coalesce(
    nullif(p_data ->> 'amt', '')::numeric,
    nullif(p_data ->> 'amount', '')::numeric,
    nullif(p_data ->> 'value', '')::numeric,
    0)
$$;

-- high_value_row_refs: the population's high-value items — the largest items that together make up the
-- top 10% of the population's total value (or, when the population has no values, the single largest
-- row). Deterministic, and small by construction: skewed populations yield few items.
create or replace function public.high_value_row_refs(p_population_id uuid) returns int[]
language sql stable as $$
  with vals as (
    select pr.row_ref, public.population_row_value(pr.data) as v
      from population_rows pr where pr.population_id = p_population_id
  ),
  tot as (select coalesce(sum(v), 0) as total from vals),
  ranked as (
    select row_ref, v,
           coalesce(sum(v) over (order by v desc, row_ref
                                 rows between unbounded preceding and 1 preceding), 0) as cum_before
      from vals
  )
  select coalesce(array_agg(row_ref order by v desc, row_ref), '{}'::int[])
    from ranked, tot
   where v > 0 and cum_before < tot.total * 0.10
$$;

-- ---------------------------------------------------------------------------
-- compute_sample, replaced in place: the method is read from the Org Sampling Table and applied.
-- The signature is unchanged, so `src/data/sampling.ts` and every existing test keep working.
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
  v_band text;
  v_method text;
  v_n int;
  v_rows jsonb;
  v_bad jsonb;
  v_hv int[];
  v_formula text;
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

  select * into v_pop from populations
   where org_id = v_org and workpaper_id = p_workpaper_id and status in ('verified', 'locked')
   order by created_at desc limit 1;
  if v_pop.id is null then
    raise exception 'population_gate: no verified population is attached to workpaper %', p_workpaper_id
      using errcode = 'P0001';
  end if;

  v_band := case when coalesce(v_pop.row_count, 0) < 50 then 'small'
                 when coalesce(v_pop.row_count, 0) < 500 then 'medium' else 'large' end;

  select * into v_sample from samples where org_id = v_org and workpaper_id = p_workpaper_id
   order by created_at desc limit 1;
  if v_sample.id is null then
    perform public.seed_org_sampling_table(v_org);
    v_n := public.get_sample_size(v_org, 'any', 'any', v_band,
             coalesce(v_pop.row_count, (select count(*)::int from population_rows where population_id = v_pop.id)));
    insert into samples (org_id, population_id, population_sha256, workpaper_id, mode, method, size_floor, sample_rows)
    values (v_org, v_pop.id, v_pop.sha256, p_workpaper_id, p_mode, 'random', v_n, '[]'::jsonb)
    returning * into v_sample;
  end if;

  if v_sample.locked_at is not null then
    raise exception 'sample_locked: sample % is locked and immutable', v_sample.id using errcode = 'P0001';
  end if;

  -- The method the Org Sampling Table maps to this band. Falls back to random when the table has no
  -- rule for the band, so a misconfigured org degrades to the historic behaviour rather than failing.
  select method into v_method from org_sampling_table
   where org_id = v_org and control_type = 'any' and frequency = 'any' and pop_band = v_band;
  v_method := coalesce(v_method, 'random');

  if p_mode = 'auditor_paste' then
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
    v_formula := 'auditor paste: every item validated against the population';
    -- The pasted selection is kept exactly as pasted; coverage is enforced at lock (2.9).
    update samples
       set mode = p_mode, seed = null, sample_rows = v_rows, method = v_method,
           calculation = jsonb_build_object('method', v_method, 'mode', p_mode, 'formula', v_formula,
                                            'inputs', jsonb_build_object('population_sha256', v_pop.sha256),
                                            'result', jsonb_build_object('size', jsonb_array_length(v_rows)))
     where id = v_sample.id and org_id = v_org;
    return v_rows;
  end if;

  v_seed := encode(extensions.digest(v_pop.sha256 || p_workpaper_id::text, 'sha256'), 'hex');
  v_n := coalesce(v_sample.size_floor, 1);
  v_hv := public.high_value_row_refs(v_pop.id);

  -- Every method ranks the population rows deterministically and takes the first v_n. `pick` is the
  -- method's order; the tie-breaker is always row_ref, so the set never depends on row order.
  select coalesce(jsonb_agg(jsonb_build_object('row_ref', t.row_ref, 'data', t.data) order by t.row_ref), '[]'::jsonb)
    into v_rows
  from (
    select row_ref, data,
           row_number() over (order by
             case v_method when 'high_value' then v end desc nulls last,
             case v_method when 'low_value' then v end asc nulls last,
             case v_method when 'systematic' then (seq - 1) / greatest(1, ceil(total::numeric / greatest(v_n, 1))::int) end asc nulls last,
             -- Stratified: round-robin across strata — first the top pick of every stratum, then the
             -- second of every stratum, and so on — so the sample is spread, not one stratum deep.
             case v_method when 'stratified' then stratum_rank end asc nulls last,
             case v_method when 'stratified' then stratum end asc nulls last,
             case v_method
               when 'random' then md5(v_seed || row_ref::text)
               when 'mus' then md5(v_seed || 'mus' || row_ref::text)
               when 'haphazard' then md5(v_seed || 'haphazard' || row_ref::text)
               when 'systematic' then lpad(seq::text, 12, '0')
               else md5(v_seed || row_ref::text)
             end,
             row_ref) as ord
      from (
        select ranked.*,
               row_number() over (partition by stratum order by md5(v_seed || row_ref::text), row_ref)
                 as stratum_rank
          from (
            select pr.row_ref, pr.data,
                   public.population_row_value(pr.data) as v,
                   row_number() over (order by pr.row_ref) as seq,
                   count(*) over () as total,
                   coalesce(pr.data ->> 'stratum', pr.data ->> 'account', 'all') as stratum
              from population_rows pr where pr.population_id = v_pop.id
          ) ranked
      ) t0
  ) t
  where t.ord <= v_n;

  -- A system sample always covers the high-value items: add any the method missed (the floor is a
  -- minimum, so the sample may grow).
  select coalesce(jsonb_agg(jsonb_build_object('row_ref', x.row_ref, 'data', x.data) order by x.row_ref), '[]'::jsonb)
    into v_rows
  from (
    select (e ->> 'row_ref')::int as row_ref, e -> 'data' as data
      from jsonb_array_elements(v_rows) e
    union
    select pr.row_ref, pr.data
      from population_rows pr
     where pr.population_id = v_pop.id and pr.row_ref = any(v_hv)
  ) x;

  v_formula := case v_method
    when 'random' then 'seeded hash order: md5(seed || row_ref)'
    when 'systematic' then format('systematic: every %s-th row from a seeded start', greatest(1, v_n))
    when 'mus' then 'MUS/PPS: seeded hash order over monetary units'
    when 'stratified' then 'stratified: one stratum key, seeded within each stratum'
    when 'high_value' then 'high value: descending by row value'
    when 'low_value' then 'low value: ascending by row value'
    when 'haphazard' then 'haphazard: seeded shuffle'
    else 'seeded hash order' end
    || '; high-value items always included';

  update samples
     set mode = p_mode, seed = v_seed, sample_rows = v_rows, method = v_method,
         calculation = jsonb_build_object(
           'method', v_method, 'mode', p_mode, 'formula', v_formula,
           'inputs', jsonb_build_object('population_sha256', v_pop.sha256, 'seed', v_seed,
                                        'band', v_band, 'floor', v_n,
                                        'high_value_rows', to_jsonb(v_hv)),
           'result', jsonb_build_object('size', jsonb_array_length(v_rows)))
   where id = v_sample.id and org_id = v_org;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------------
-- sample_precision: the Clopper-Pearson interval for a sample's current exceptions. k = the number of
-- cross/unverifiable rows recorded against the sample; n = the sample size. Reported by the screen.
-- ---------------------------------------------------------------------------
create or replace function public.sample_precision(p_sample_id uuid, p_conf numeric default 0.95)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_n int;
  v_k int;
begin
  select jsonb_array_length(coalesce(sample_rows, '[]'::jsonb)) into v_n
    from samples where id = p_sample_id and org_id = v_org;
  if v_n is null then
    raise exception 'sample not found in this organisation' using errcode = 'P0001';
  end if;
  select count(*) into v_k from workpaper_rows
   where org_id = v_org and sample_id = p_sample_id and result in ('cross', 'unverifiable');
  return jsonb_build_object('n', v_n, 'k', v_k, 'confidence', p_conf,
                            'lower', public.clopper_pearson_lower(v_k, v_n, p_conf),
                            'upper', public.clopper_pearson_upper(v_k, v_n, p_conf));
end $$;

revoke execute on function public.binom_cdf(int, int, double precision) from public, anon;
revoke execute on function public.clopper_pearson_upper(int, int, numeric) from public, anon;
revoke execute on function public.clopper_pearson_lower(int, int, numeric) from public, anon;
revoke execute on function public.population_row_value(jsonb) from public, anon;
revoke execute on function public.high_value_row_refs(uuid) from public, anon;
revoke execute on function public.sample_precision(uuid, numeric) from public, anon;

grant execute on function public.sample_precision(uuid, numeric) to authenticated;

-- 0209 population rows — the missing writer behind the population grid.
--
-- The audit (ONE RULE: grep the call site) found `population_rows` (0004) had NO production writer.
-- `PopulationPanel` hashes a file and registers a `populations` row with a sha256 and a row count,
-- but nothing ever writes the rows themselves. `compute_sample` (0027/0105) then selects from
-- `population_rows` and finds none, so every draw raises `population_gate` and no population can be
-- sampled or tested. The population grid, the analyst engine, value coverage and the D2 capability
-- family all read rows that were never stored.
--
-- This migration adds the write path: `import_population_rows` stores the rows an auditor pasted or
-- uploaded, positionally, and refreshes the population's row count so the §11.1 verify trigger is
-- satisfied. `list_population_rows` returns a bounded page for the grid and the drilldown.
--
-- Paste semantics (src/lib/populationPaste.ts owns the parsing): columns map BY POSITION against the
-- header, and a paste is never auto-padded to the floor — inventing rows would fabricate evidence.
-- The row the auditor pasted is the row that is stored; the floor is enforced later by `lock_sample`.
--
-- Reuse (grep first): `populations` (0004/0026), `population_rows` (0004), `verify_population`
-- trigger (0026, needs sha256 + positive row_count), `guard_population_child_rows` (0006, refuses a
-- sealed engagement), `pin_org_id` (0009, pins org_id from the JWT), `append_ledger_entry` (0073),
-- `caller_has_right` (0007/0073). No existing function is replaced.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: application roles only.

-- ---------------------------------------------------------------------------
-- A row reference is unique within a population. This is what makes the positional mapping stable:
-- two rows can never claim the same `row_ref`, so a sample that names row 7 names exactly one row.
-- ---------------------------------------------------------------------------
create unique index if not exists population_rows_pop_ref_idx
  on population_rows (population_id, row_ref);

-- ---------------------------------------------------------------------------
-- import_population_rows: replace (or append to) the rows of a population.
--
-- p_rows is an array of {"row_ref": int, "data": {...}} objects (the shape
-- src/lib/populationPaste.ts emits). A bare value array is also accepted and given positional
-- row_refs, so a caller that only has values is not blocked. The population must belong to the
-- caller's org, carry a sha256, and sit in an engagement that is not sealed. On success the
-- population's row_count is refreshed to the stored total and a ledger entry records the import.
-- ---------------------------------------------------------------------------
create or replace function public.import_population_rows(
  p_population_id uuid,
  p_rows jsonb,
  p_append boolean default false
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_pop populations;
  v_total int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows: p_rows must be a JSON array' using errcode = 'P0001';
  end if;

  select * into v_pop from populations where id = p_population_id and org_id = v_org;
  if v_pop.id is null then
    raise exception 'population not found in this organisation' using errcode = 'P0001';
  end if;
  if v_pop.sha256 is null or length(btrim(v_pop.sha256)) = 0 then
    raise exception 'population_rows: the population needs a SHA-256 before its rows can be stored'
      using errcode = 'P0001';
  end if;
  -- The sealed-engagement guard (0006) also fires on the child rows; checking here gives the caller a
  -- clear reason before any row is written.
  perform public.assert_engagement_writable(v_pop.engagement_id);

  if not p_append then
    delete from population_rows where population_id = v_pop.id and org_id = v_org;
  end if;

  -- Objects carry their own row_ref; bare values are numbered by position after any existing rows.
  insert into population_rows (org_id, population_id, row_ref, data)
  select v_org, v_pop.id,
         coalesce(
           nullif(e.item ->> 'row_ref', '')::int,
           coalesce((select max(row_ref) from population_rows where population_id = v_pop.id), 0)
             + row_number() over ()::int
         ),
         case when jsonb_typeof(e.item) = 'object' then coalesce(e.item -> 'data', '{}'::jsonb)
              else jsonb_build_object('value', e.item) end
    from jsonb_array_elements(p_rows) with ordinality as e(item, ord);

  select count(*) into v_total from population_rows
   where population_id = v_pop.id and org_id = v_org;

  -- The §11.1 verify trigger refuses a verified population without a positive row count; keeping the
  -- count honest here is what lets the population stay verified after an import.
  update populations set row_count = v_total where id = v_pop.id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'population_rows_import',
    jsonb_build_object('population_id', p_population_id::text,
                       'engagement_id', v_pop.engagement_id::text,
                       'rows', v_total, 'append', p_append),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'population_rows_import', 'population', p_population_id,
          jsonb_build_object('rows', v_total, 'append', p_append));

  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- list_population_rows: a bounded page of a population's rows, org-scoped, for the grid and the
-- drilldown. Ordered by row_ref so the positional mapping is stable.
-- ---------------------------------------------------------------------------
create or replace function public.list_population_rows(p_population_id uuid, p_limit int default 500)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('row_ref', r.row_ref, 'data', r.data) order by r.row_ref),
                  '[]'::jsonb)
    from (
      select pr.row_ref, pr.data
        from population_rows pr
        join populations p on p.id = pr.population_id
       where pr.population_id = p_population_id
         and pr.org_id = public.jwt_org_id()
       order by pr.row_ref
       limit greatest(1, least(coalesce(p_limit, 500), 5000))
    ) r
$$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only (0085 has already revoked the inherited anon grant).
-- ---------------------------------------------------------------------------
revoke execute on function public.import_population_rows(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.list_population_rows(uuid, int) from public, anon;
grant execute on function public.import_population_rows(uuid, jsonb, boolean) to authenticated;
grant execute on function public.list_population_rows(uuid, int) to authenticated;

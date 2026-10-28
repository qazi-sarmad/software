-- 0104 phase2 row seeding — the drawn sample becomes the tested set (SCALE-TASKS 2.7).
--
-- The audit found `lock_sample` (0027) locked a sample and stopped there. `workpaper_rows` (0028) is
-- the per-row test result the whole testing stage hangs off — `sign_off_workpaper` requires every row
-- to carry a result and `preflight_items` reads `exception_flag`/`reviewed_result` from it — but its
-- only writer was `record_workpaper_row`, one row at a time. Nothing linked the sample the auditor
-- drew to the rows they then tested: the auditor had to re-key every `row_ref` by hand, and the
-- `workpaper_rows.sample_id` column existed with no writer. `grep -rn 'insert into workpaper_rows'
-- supabase/migrations/` returned only `record_workpaper_row`.
--
-- This migration makes locking a sample seed its rows. When a sample is locked, every `row_ref` in
-- `samples.sample_rows` is inserted into `workpaper_rows` with `sample_id` pointing back at the
-- sample and no result yet. The auditor then records a tick/cross/unverifiable against rows that
-- already exist, and `record_workpaper_row`'s upsert keeps the `sample_id` link (it updates only the
-- result columns). Re-locking cannot clobber a recorded result: the conflict branch updates only
-- `sample_id`. The lock also writes a ledger entry, so the seeded set is anchored with its sample.
--
-- Reuse (grep first): `workpaper_rows` (0028, unique (workpaper_id, row_ref)), `samples` (0004/0027),
-- `append_ledger_entry` (0073), `pin_org_id` (0009), `guard_workpaper_child_rows` (0006). Only
-- `lock_sample` is replaced, with its existing signature and checks unchanged.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: unchanged.

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

  update samples set locked = true, locked_at = now(), locked_by = auth.uid()
   where id = p_sample_id and org_id = v_org;

  -- 2.7: the drawn sample becomes the tested set. The conflict branch keeps the sample link and never
  -- touches a result the auditor has already recorded.
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

-- ---------------------------------------------------------------------------
-- sample_tested_rows: the tested rows a sample produced, for the screen's drilldown. The join is the
-- proof of the link, so the UI never guesses it.
-- ---------------------------------------------------------------------------
create or replace function public.sample_tested_rows(p_sample_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'row_ref', r.row_ref, 'result', r.result, 'rationale', r.rationale,
           'exception_flag', r.exception_flag, 'reviewed_result', r.reviewed_result)
         order by r.row_ref), '[]'::jsonb)
    from workpaper_rows r
   where r.org_id = public.jwt_org_id() and r.sample_id = p_sample_id
$$;

revoke execute on function public.lock_sample(uuid) from public, anon;
revoke execute on function public.sample_tested_rows(uuid) from public, anon;
grant execute on function public.lock_sample(uuid) to authenticated;
grant execute on function public.sample_tested_rows(uuid) to authenticated;

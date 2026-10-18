-- D9: persist plan item date changes ("Approve shift", spec §9 "After approval, rescheduling is
-- easy").
--
-- The Gantt offers an "Approve Shift" action for a pending milestone change, but the panel only
-- cleared local state: there was no RPC to persist the new dates. `update_plan_item_dates` did not
-- exist (grep found no such name in supabase/ or src/; the task text names migration 0025, which is
-- the Planning migration and has no such function). This migration adds it.
--
-- Rules (§9): creation/approval authority is configurable per organisation, but rescheduling is a
-- plan *change*, so it reuses the configured create_right (the same right add_plan_item needs) and
-- writes a new immutable plan version via snapshot_plan_version (L5). An approved plan cannot be
-- rescheduled in place; like every other plan change it must go through a new version, so the RPC
-- refuses an approved plan with the same message add_plan_item uses. Dates must be a valid range.
--
-- Reuse (grep first): plan_items, plans, plan_approval_settings, snapshot_plan_version,
-- append_ledger_entry, activity_log all exist (0021 / 0007 / 0005). No new table, no new column.

create or replace function public.update_plan_item_dates(
  p_item uuid,
  p_start date,
  p_end date
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_right text;
  v_plan uuid;
  v_status text;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;

  select i.plan_id, i.status into v_plan, v_status
    from plan_items i where i.id = p_item and i.org_id = v_org;
  if v_plan is null then
    raise exception 'plan item not found in this organisation' using errcode = 'P0001';
  end if;

  if (select status from plans where id = v_plan and org_id = v_org) = 'approved' then
    raise exception 'an approved plan cannot be changed without a new version' using errcode = 'P0001';
  end if;

  if p_start is null or p_end is null then
    raise exception 'a rescheduled item needs both a start and an end date' using errcode = 'P0001';
  end if;
  if p_end < p_start then
    raise exception 'the end date cannot be before the start date' using errcode = 'P0001';
  end if;

  perform public.seed_plan_approval_settings(v_org);
  select create_right into v_right from plan_approval_settings where org_id = v_org;
  if not coalesce(public.caller_has_right(v_right), false) then
    raise exception 'not allowed: caller lacks the % right', v_right using errcode = 'P0001';
  end if;

  update plan_items
     set planned_start = p_start, planned_end = p_end
   where id = p_item and org_id = v_org;

  perform public.snapshot_plan_version(v_plan, 'item rescheduled');
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'plan_item_rescheduled', 'plan_item', p_item,
          jsonb_build_object('plan_id', v_plan, 'start', p_start, 'end', p_end));
end $$;

revoke execute on function public.update_plan_item_dates(uuid, date, date) from public, anon;
grant execute on function public.update_plan_item_dates(uuid, date, date) to authenticated;

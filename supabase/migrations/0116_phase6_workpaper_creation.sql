-- 0116: the missing workpaper-creation path (Phase 6, G1 production-build proof).
--
-- Defect this migration fixes. `workpapers` (0004) is the spine of the testing stage: `lock_sample`
-- seeds `workpaper_rows` against it (0104), `record_workpaper_row` and `sign_off_workpaper` (0028)
-- write against it, and the Audit File's testing workspace gates its sampling and row-testing panels
-- on `workpapers[0]`. But NO migration ever inserted a workpaper and NO RPC created one:
--   grep -rn 'insert into workpapers' supabase/migrations/   -> nothing
-- The `create_workpaper` ACTION already exists in the rights model (`src/lib/access.ts`, mapped to
-- `perform_work`), so the product intended the action and simply never built it. In production (empty
-- seed) an engagement therefore had zero workpapers, and the sampling and row-testing panels — gated
-- on `workpapers[0]` — never rendered. The Playwright suite never saw it because it ran against the
-- dev demo seed, which ships workpapers. This is the exact "green test, empty screen" class the
-- remediation plan names.
--
-- What is added. `create_workpaper(p_engagement_id, p_control_id, p_title)` is the one write path.
-- It is SECURITY DEFINER (the repo convention for tenant writes), so the `guard_testing_lock` trigger
-- does not fire for it (the trigger exempts non-`authenticated` callers) — the RPC therefore repeats
-- the trigger's rule explicitly: a testing workpaper needs a signed-off planning section (§10.1).
-- A direct table insert by `authenticated` is still refused by the trigger, so both paths agree.
--
-- `workpapers.title` is added: the tenant loader hardcoded `'Working paper'`, so a created workpaper
-- had no name to show. Nullable, so every existing row and every existing test is unchanged.
--
-- Reuse (grep first): `workpapers` (0004), `engagements` (0003), `planning_signed_off` (0025),
-- `caller_has_right` (0016), `append_ledger_entry` (0073). No new table, no new trigger.
--
-- M2: create or replace / add column if not exists; safe to apply repeatedly.

alter table workpapers add column if not exists title text null;

create or replace function public.create_workpaper(
  p_engagement_id uuid,
  p_control_id uuid default null,
  p_title text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_eng engagements;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;

  select * into v_eng from engagements where id = p_engagement_id and org_id = v_org;
  if v_eng.id is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if v_eng.sealed then
    raise exception 'engagement_sealed: a sealed engagement is read-only' using errcode = 'P0001';
  end if;

  -- The same rule the `workpapers_testing_lock` trigger enforces for a direct insert (§10.1).
  if not public.planning_signed_off(p_engagement_id) then
    raise exception 'testing_locked: planning must be signed off before a testing workpaper can be created'
      using errcode = 'P0001';
  end if;

  insert into workpapers (org_id, engagement_id, control_id, stage, title)
  values (v_org, p_engagement_id, p_control_id, 'testing',
          nullif(btrim(coalesce(p_title, '')), ''))
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'workpaper_created',
    jsonb_build_object('workpaper_id', v_id::text, 'engagement_id', p_engagement_id::text),
    auth.uid());

  return v_id;
end $$;

comment on function public.create_workpaper(uuid, uuid, text) is
  'The one write path for a workpaper. Requires perform_work, an unsealed engagement in the caller''s '
  'org, and a signed-off planning section (the guard_testing_lock rule, repeated because SECURITY '
  'DEFINER does not fire that trigger). Returns the new workpaper id.';

revoke execute on function public.create_workpaper(uuid, uuid, text) from public, anon;
grant execute on function public.create_workpaper(uuid, uuid, text) to authenticated;

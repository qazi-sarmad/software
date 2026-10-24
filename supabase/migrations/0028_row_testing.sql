-- 4E: Row testing DB (spec §11.3, §11.4).
--
-- The spec:
--   §11.3 "Each sampled row gets a tick, a cross or unverifiable, with a rationale. A cross or an
--          unverifiable requires a rationale." (§12 findings come from exceptions.)
--   §11.4 "Sign-off requires review (four-eyes) and every row resolved; the file then locks. A reopen
--          needs a justification and the can_reopen right."
--
-- Reuse (grep first): no `workpaper_rows` object exists (the 0004 `test_rows` table is a different,
-- thinner shape and is left intact; D-4E-M1 records why a dedicated table is the simplest option).
-- `workpapers` (0004) exists, so this migration ALTERs it (status, prepared_at/by, signed_off_at/by)
-- rather than recreating it. `sign_offs` (0004) already carries the four-eyes CHECK.

-- ---------------------------------------------------------------------------
-- workpaper_rows: the per-row test result (§11.3).
-- ---------------------------------------------------------------------------
create table if not exists workpaper_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  workpaper_id uuid not null references workpapers(id) on delete cascade,
  sample_id uuid null references samples(id) on delete set null,
  row_ref text not null,
  result text null check (result in ('tick', 'cross', 'unverifiable')),
  rationale text null,
  exception_flag boolean not null default false,
  prepared_by uuid null,
  prepared_at timestamptz null,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  reviewed_result text null check (reviewed_result in ('accepted', 'reverted')),
  created_at timestamptz not null default now(),
  unique (workpaper_id, row_ref)
);
create index if not exists workpaper_rows_wp_idx on workpaper_rows (org_id, workpaper_id);

-- A cross or unverifiable result requires a rationale (§11.3). A tick may carry one but need not.
alter table workpaper_rows drop constraint if exists wpr_rationale_chk;
alter table workpaper_rows add constraint wpr_rationale_chk check (
  result is null
  or result = 'tick'
  or (rationale is not null and length(btrim(rationale)) > 0)
);

-- Four-eyes on review: a reviewer is never the preparer.
alter table workpaper_rows drop constraint if exists wpr_four_eyes_chk;
alter table workpaper_rows add constraint wpr_four_eyes_chk check (
  reviewed_by is null or prepared_by is null or reviewed_by <> prepared_by
);

alter table workpaper_rows enable row level security;
drop policy if exists workpaper_rows_select on workpaper_rows;
create policy workpaper_rows_select on workpaper_rows for select to authenticated
  using (org_id = public.jwt_org_id() and exists (select 1 from workpapers w where w.id = workpaper_id));

-- ---------------------------------------------------------------------------
-- workpapers: extend with the lifecycle the task names (§11.4).
-- ---------------------------------------------------------------------------
alter table workpapers add column if not exists status text not null default 'open';
alter table workpapers add column if not exists prepared_by uuid null;
alter table workpapers add column if not exists prepared_at timestamptz null;
alter table workpapers add column if not exists signed_off_at timestamptz null;
alter table workpapers add column if not exists signed_off_by uuid null;

alter table workpapers drop constraint if exists workpapers_status_chk;
alter table workpapers add constraint workpapers_status_chk check (
  status in ('open', 'sampling', 'locked', 'prepared', 'reviewed', 'signed_off')
);

-- Pin org_id and guard child rows.
do $$
declare
  t text;
begin
  foreach t in array array['workpaper_rows'] loop
    execute format('drop trigger if exists %I_pin_org on %I', t, t);
    execute format('create trigger %I_pin_org before insert on %I for each row execute function public.pin_org_id()', t, t);
  end loop;
end $$;

-- Sealed-engagement guard for the new table (mirrors test_rows in 0006).
drop trigger if exists workpaper_rows_sealed_guard on workpaper_rows;
create trigger workpaper_rows_sealed_guard before update or delete on workpaper_rows
  for each row execute function public.guard_workpaper_child_rows();

-- ---------------------------------------------------------------------------
-- record_workpaper_row: the only write path for a row result (§11.3). perform_work. Refused once the
-- workpaper is signed off. Stamps the preparer; the rationale CHECK enforces the exception rationale.
-- ---------------------------------------------------------------------------
create or replace function public.record_workpaper_row(
  p_workpaper_id uuid, p_row_ref text, p_result text, p_rationale text default null,
  p_exception_flag boolean default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_status text;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  select status into v_status from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_status is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status = 'signed_off' then
    raise exception 'workpaper_locked: a signed-off workpaper is read-only' using errcode = 'P0001';
  end if;
  insert into workpaper_rows (org_id, workpaper_id, row_ref, result, rationale, exception_flag,
                              prepared_by, prepared_at)
  values (v_org, p_workpaper_id, p_row_ref, p_result, nullif(btrim(coalesce(p_rationale, '')), ''),
          coalesce(p_exception_flag, p_result in ('cross', 'unverifiable')), auth.uid(), now())
  on conflict (workpaper_id, row_ref) do update
    set result = excluded.result, rationale = excluded.rationale,
        exception_flag = excluded.exception_flag, prepared_by = auth.uid(), prepared_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- sign_off_workpaper: lock the workpaper (§11.4). Requires review_and_approve, four-eyes (the signer
-- did not prepare every row), every row resolved, and every exception justified. Writes a ledger entry.
-- ---------------------------------------------------------------------------
create or replace function public.sign_off_workpaper(p_workpaper_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_wp workpapers;
  v_rows int;
  v_unresolved int;
  v_self int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  select * into v_wp from workpapers where id = p_workpaper_id and org_id = v_org;
  if v_wp.id is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_wp.status = 'signed_off' then
    raise exception 'workpaper_locked: workpaper is already signed off' using errcode = 'P0001';
  end if;

  select count(*) into v_rows from workpaper_rows where workpaper_id = p_workpaper_id and org_id = v_org;
  if v_rows = 0 then
    raise exception 'no rows to sign off on workpaper %', p_workpaper_id using errcode = 'P0001';
  end if;

  -- Every row must have a result; the rationale CHECK enforces the exception rationale.
  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org and result is null;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % row(s) have no result', v_unresolved using errcode = 'P0001';
  end if;

  -- An exception must have been disclosed as such (a cross/unverifiable).
  select count(*) into v_unresolved from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org
     and result in ('cross', 'unverifiable') and not exception_flag;
  if v_unresolved > 0 then
    raise exception 'workpaper_incomplete: % exception row(s) are not flagged', v_unresolved using errcode = 'P0001';
  end if;

  -- Four-eyes: the signer must not have prepared every row.
  select count(*) into v_self from workpaper_rows
   where workpaper_id = p_workpaper_id and org_id = v_org and prepared_by = auth.uid();
  if v_self = v_rows then
    raise exception 'four_eyes: the signer prepared every row' using errcode = 'P0001';
  end if;

  update workpapers
     set status = 'signed_off', signed_off_at = now(), signed_off_by = auth.uid(), prepared = true
   where id = p_workpaper_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'workpaper_signed_off',
    jsonb_build_object('workpaper_id', p_workpaper_id, 'engagement_id', v_wp.engagement_id, 'rows', v_rows),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'workpaper_signed_off', 'workpaper', p_workpaper_id,
          jsonb_build_object('rows', v_rows));
end $$;

-- ---------------------------------------------------------------------------
-- reopen_workpaper: reopen a signed-off workpaper (§11.4). Requires can_reopen and a >=10-character
-- justification. Writes a ledger entry.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_workpaper(p_workpaper_id uuid, p_justification text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_status text;
  v_eng uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('can_reopen'), false) then
    raise exception 'not allowed: caller lacks the can_reopen right' using errcode = 'P0001';
  end if;
  if p_justification is null or length(btrim(p_justification)) < 10 then
    raise exception 'a justification of at least 10 characters is required' using errcode = 'P0001';
  end if;
  select status, engagement_id into v_status, v_eng from workpapers
   where id = p_workpaper_id and org_id = v_org;
  if v_status is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  if v_status <> 'signed_off' then
    raise exception 'only a signed-off workpaper can be reopened (status=%)', v_status using errcode = 'P0001';
  end if;
  if public.is_engagement_sealed(v_eng) then
    raise exception 'sealed_engagement: reopen the engagement before reopening its workpaper'
      using errcode = 'P0001';
  end if;

  update workpapers
     set status = 'reviewed', signed_off_at = null, signed_off_by = null
   where id = p_workpaper_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'workpaper_reopened',
    jsonb_build_object('workpaper_id', p_workpaper_id, 'justification', btrim(p_justification)), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'workpaper_reopened', 'workpaper', p_workpaper_id,
          jsonb_build_object('justification', btrim(p_justification)));
end $$;

revoke execute on function public.record_workpaper_row(uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.sign_off_workpaper(uuid) from public, anon;
revoke execute on function public.reopen_workpaper(uuid, text) from public, anon;
grant execute on function public.record_workpaper_row(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.sign_off_workpaper(uuid) to authenticated;
grant execute on function public.reopen_workpaper(uuid, text) to authenticated;

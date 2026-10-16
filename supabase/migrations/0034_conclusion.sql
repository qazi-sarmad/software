-- 5B: Conclusion stage DB (spec §10.3, §10.4, §15.1).
--
-- The spec:
--   §10.3 "Auto-pulls all exceptions from Testing. The auditor finalises wording, rationale and
--          supporting evidence. Removing an item requires a mandatory comment. An overall opinion or
--          rating is optional, and is configurable as required or optional."
--   §10.4 "Every stage sign-off requires review by a role configured for that stage. After sign-off
--          the file is locked and read-only, with a cumulative hash. Reopening requires the reopen
--          capability and a justification of at least 10 characters."
--   §15.1 "The report becomes available only after Conclusion sign-off."
--
-- Reuse (grep first): there is no conclusion table yet, so `conclusion_records` is created here.
-- Testing sign-off is derived from the workpapers (0028), not stored again.

-- ---------------------------------------------------------------------------
-- testing_signed_off: the Testing stage is signed off once every workpaper of the engagement is
-- signed off and at least one exists (§10.4). This is the gate Conclusion builds on.
-- ---------------------------------------------------------------------------
create or replace function public.testing_signed_off(p_engagement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workpapers w
    where w.engagement_id = p_engagement_id and w.org_id = public.jwt_org_id())
  and not exists (
    select 1 from workpapers w
    where w.engagement_id = p_engagement_id and w.org_id = public.jwt_org_id()
      and w.status is distinct from 'signed_off')
$$;

-- ---------------------------------------------------------------------------
-- conclusion_records: one row per engagement Conclusion. Carries the pulled exceptions, the
-- (optional) overall opinion, the sign-off and the per-record hash chain (§10.4 cumulative hash).
-- ---------------------------------------------------------------------------
create table if not exists conclusion_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  exceptions jsonb not null default '[]'::jsonb,
  exceptions_pulled_at timestamptz null,
  overall_opinion text null,
  prepared_by uuid null,
  signed_off_at timestamptz null,
  signed_off_by uuid null,
  locked_at timestamptz null,
  prev_hash text null,
  row_hash text null,
  created_at timestamptz not null default now(),
  unique (engagement_id)
);
create index if not exists conclusion_records_org_idx on conclusion_records (org_id, engagement_id);

-- The signer must not be the preparer (four-eyes, §10.4), enforced as a CHECK not in code.
alter table conclusion_records drop constraint if exists conclusion_records_four_eyes_chk;
alter table conclusion_records add constraint conclusion_records_four_eyes_chk check (
  signed_off_by is null or prepared_by is null or signed_off_by <> prepared_by
);

-- ---------------------------------------------------------------------------
-- The per-record hash chain. Each row links to the previous row of the same engagement.
-- ---------------------------------------------------------------------------
create or replace function public.conclusion_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(new.engagement_id::text));
  select c.row_hash into v_prev from conclusion_records c
   where c.engagement_id = new.engagement_id and c.id <> new.id
   order by c.created_at desc limit 1;
  new.prev_hash := coalesce(v_prev, '');
  v_body := coalesce(v_prev, '') || '|' || coalesce(new.overall_opinion, '') || '|'
            || coalesce(new.exceptions::text, '[]') || '|' || coalesce(new.signed_off_at::text, '');
  new.row_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  return new;
end $$;

drop trigger if exists conclusion_records_chain on conclusion_records;
create trigger conclusion_records_chain before insert or update on conclusion_records
  for each row execute function public.conclusion_chain();

-- ---------------------------------------------------------------------------
-- pull_exceptions: copy every cross/unverifiable row from Testing into the conclusion (§10.3).
-- Requires review_and_approve and a signed-off Testing stage. Idempotent: re-running refreshes the
-- exception list. Records the preparer so four-eyes can be enforced at sign-off.
-- ---------------------------------------------------------------------------
create or replace function public.pull_exceptions(p_engagement_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rows jsonb;
  v_count int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not public.testing_signed_off(p_engagement_id) then
    raise exception 'testing_not_signed_off: Testing must be signed off before Conclusion'
      using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'workpaper_row_id', r.id,
           'workpaper_id', r.workpaper_id,
           'row_ref', r.row_ref,
           'result', r.result,
           'rationale', r.rationale)
         order by r.workpaper_id, r.row_ref), '[]'::jsonb),
         count(*)
    into v_rows, v_count
  from workpaper_rows r
  join workpapers w on w.id = r.workpaper_id
  where w.engagement_id = p_engagement_id and r.org_id = v_org
    and r.result in ('cross', 'unverifiable');

  insert into conclusion_records (org_id, engagement_id, exceptions, exceptions_pulled_at, prepared_by)
  values (v_org, p_engagement_id, v_rows, now(), auth.uid())
  on conflict (engagement_id) do update
    set exceptions = excluded.exceptions, exceptions_pulled_at = now(), prepared_by = auth.uid();

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'conclusion_exceptions_pulled', 'engagement', p_engagement_id,
          jsonb_build_object('exceptions', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- remove_conclusion_exception: removing a pulled item requires a mandatory comment (§10.3).
-- ---------------------------------------------------------------------------
create or replace function public.remove_conclusion_exception(
  p_engagement_id uuid, p_workpaper_row_id uuid, p_comment text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if length(v_comment) < 10 then
    raise exception 'comment_required: removing a conclusion item needs a comment of at least 10 characters'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from conclusion_records c
              where c.engagement_id = p_engagement_id and c.org_id = v_org and c.locked_at is not null) then
    raise exception 'conclusion_locked: the conclusion is signed off and read-only' using errcode = 'P0001';
  end if;

  update conclusion_records c
     set exceptions = coalesce((
           select jsonb_agg(e) from jsonb_array_elements(c.exceptions) e
            where (e ->> 'workpaper_row_id') <> p_workpaper_row_id::text), '[]'::jsonb)
   where c.engagement_id = p_engagement_id and c.org_id = v_org;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'conclusion_exception_removed', 'engagement', p_engagement_id,
          jsonb_build_object('workpaper_row_id', p_workpaper_row_id, 'comment', v_comment));
end $$;

-- ---------------------------------------------------------------------------
-- sign_conclusion: lock the Conclusion stage (§10.4). Requires review_and_approve, four-eyes (the
-- signer did not pull the exceptions), a pulled exception list, and an overall opinion when the org
-- config requires one. Writes a hash-chained ledger entry and seals the engagement (§10.4).
-- ---------------------------------------------------------------------------
create or replace function public.sign_conclusion(p_engagement_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec conclusion_records;
  v_opinion_required boolean;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;

  select * into v_rec from conclusion_records c
   where c.engagement_id = p_engagement_id and c.org_id = v_org;
  if v_rec.id is null then
    raise exception 'conclusion_missing: pull the Testing exceptions before signing off'
      using errcode = 'P0001';
  end if;
  if v_rec.locked_at is not null then
    raise exception 'conclusion_locked: the conclusion is already signed off' using errcode = 'P0001';
  end if;

  -- Four-eyes: the signer must not be the preparer who pulled the exceptions.
  if v_rec.prepared_by is not null and v_rec.prepared_by = auth.uid() then
    raise exception 'four_eyes: the signer pulled the exceptions' using errcode = 'P0001';
  end if;

  -- The overall opinion is optional unless the organisation's methodology requires it (§10.3).
  select coalesce((select (v.value)::boolean from config_versions v
                    where v.org_id = v_org and v.key = 'conclusion.opinion_required'
                    order by v.version desc limit 1), false)
    into v_opinion_required;
  if v_opinion_required and nullif(btrim(coalesce(v_rec.overall_opinion, '')), '') is null then
    raise exception 'opinion_required: this organisation requires an overall opinion before sign-off'
      using errcode = 'P0001';
  end if;

  update conclusion_records c
     set signed_off_at = now(), signed_off_by = auth.uid(), locked_at = now()
   where c.id = v_rec.id;

  -- After Conclusion sign-off the engagement is sealed and read-only (§10.4). The seal guard only
  -- blocks unsealing outside reopen_engagement(), so this update is allowed.
  update engagements set sealed = true where id = p_engagement_id and org_id = v_org;

  perform public.append_ledger_entry(
    v_org, 'conclusion_signed_off',
    jsonb_build_object('engagement_id', p_engagement_id,
                       'exceptions', jsonb_array_length(v_rec.exceptions)), auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'conclusion_signed_off', 'engagement', p_engagement_id,
          jsonb_build_object('exceptions', jsonb_array_length(v_rec.exceptions)));
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: org-scoped select only. Writes go through the RPCs above.
-- ---------------------------------------------------------------------------
alter table conclusion_records enable row level security;

drop policy if exists conclusion_records_select on conclusion_records;
create policy conclusion_records_select on conclusion_records for select to authenticated
  using (org_id = public.jwt_org_id());

-- Pin org_id on insert for application roles only (same defence as 0009).
drop trigger if exists conclusion_records_pin_org on conclusion_records;
create trigger conclusion_records_pin_org before insert on conclusion_records
  for each row execute function public.pin_org_id();

-- A sealed engagement is read-only (§10.4): the conclusion is a child of the engagement.
drop trigger if exists conclusion_records_sealed_guard on conclusion_records;
create trigger conclusion_records_sealed_guard before update or delete on conclusion_records
  for each row execute function public.guard_engagement_rows();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.testing_signed_off(uuid) from public, anon;
revoke execute on function public.pull_exceptions(uuid) from public, anon;
revoke execute on function public.remove_conclusion_exception(uuid, uuid, text) from public, anon;
revoke execute on function public.sign_conclusion(uuid) from public, anon;

grant execute on function public.testing_signed_off(uuid) to authenticated;
grant execute on function public.pull_exceptions(uuid) to authenticated;
grant execute on function public.remove_conclusion_exception(uuid, uuid, text) to authenticated;
grant execute on function public.sign_conclusion(uuid) to authenticated;

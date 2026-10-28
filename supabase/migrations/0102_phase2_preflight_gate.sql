-- 0102 phase2 preflight gate — wire the §11.4 pre-flight into freeze_report (SCALE-TASKS 2.5).
--
-- The audit found the pre-flight engine dead: `runPreflight` (src/lib/preflight.ts) had no caller but
-- its own test, and `freeze_report` (0040) gated on exactly two inline checks (open comments, CAP
-- reconciliation), never consulting `preflight_acks`. A report could therefore be frozen and issued
-- with the eight-check pre-flight never executed. This migration makes the database the authority:
-- `freeze_report` now computes the open pre-flight items from real tables and refuses while any item
-- carries no acknowledgement. An acknowledgement is a row in `preflight_acks` (0095) keyed by
-- (engagement_id, check_key, item_id) with a >=10-character reason — append-only, so the history is
-- kept and the latest row per item is the live one.
--
-- The eight check keys are the closed list the `preflight_acks_check_key_chk` constraint already
-- pins. Each check reads a real column, so an item appears exactly when the underlying state is
-- open, and disappears when it is fixed. The pure TypeScript module (`src/lib/preflight.ts`) remains
-- the screen's preview; the database is the gate.
--
-- Reuse (grep first): preflight_acks / preflight_acknowledge / preflight_acks_get (0095), the open
-- comment count (0037), CAP reconciliation (0040), population status (0026), samples.workpaper_id and
-- lock (0027), workpaper_rows exception_flag / reviewed_result (0028), evidence_files (0035),
-- findings.severity (0004/0030), append_ledger_entry (0011). Nothing is redefined; freeze_report is
-- extended in place and keeps its signature.
--
-- M2: create or replace; safe to apply repeatedly. M8: one client. Grants: application roles only.

-- ---------------------------------------------------------------------------
-- preflight_acks is append-only (0095 says so in prose; this makes it true). An acknowledgement is a
-- historical fact: the latest row per (check, item) is the live one, so an edit would rewrite history.
-- ---------------------------------------------------------------------------
create or replace function public.preflight_acks_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'preflight_acks is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists preflight_acks_no_change on preflight_acks;
create trigger preflight_acks_no_change before update or delete on preflight_acks
for each row execute function public.preflight_acks_append_only();

-- ---------------------------------------------------------------------------
-- preflight_items: every open pre-flight item for an engagement, computed from the database. The
-- result is a jsonb array of {check_key, item_id, detail}, ordered deterministically.
-- ---------------------------------------------------------------------------
create or replace function public.preflight_items(p_engagement_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
with
  -- 1. exceptions_without_rationale: a pulled Conclusion exception with no rationale.
  ex AS (
    select 'exceptions_without_rationale'::text as check_key,
           coalesce(e ->> 'workpaper_row_id', 'exception') as item_id,
           'A pulled exception has no rationale.'::text as detail
      from conclusion_records c
      cross join lateral jsonb_array_elements(coalesce(c.exceptions, '[]'::jsonb)) e
     where c.org_id = public.jwt_org_id() and c.engagement_id = p_engagement_id
       and length(btrim(coalesce(e ->> 'rationale', ''))) = 0
  ),
  -- 2. unresolved_flags: an exception row (cross/unverifiable) that has not been reviewed.
  fl AS (
    select 'unresolved_flags'::text, r.id::text,
           'An exception row has no review decision.'::text
      from workpaper_rows r
      join workpapers w on w.id = r.workpaper_id
     where r.org_id = public.jwt_org_id() and w.engagement_id = p_engagement_id
       and r.result in ('cross', 'unverifiable') and r.reviewed_result is null
  ),
  -- 3. missing_evidence: a workpaper carrying an exception row with no evidence file attached.
  me AS (
    select 'missing_evidence'::text, w.id::text,
           'A workpaper with an exception has no evidence file.'::text
      from workpapers w
     where w.org_id = public.jwt_org_id() and w.engagement_id = p_engagement_id
       and exists (select 1 from workpaper_rows r
                    where r.workpaper_id = w.id and r.result in ('cross', 'unverifiable'))
       and not exists (select 1 from evidence_files f where f.workpaper_id = w.id)
  ),
  -- 4. sample_below_floor: a sample attached to the engagement is unlocked or holds fewer rows than
  --    its floor.
  sf AS (
    select 'sample_below_floor'::text, s.id::text,
           format('A sample holds %s row(s); the floor is %s.', 
                  jsonb_array_length(coalesce(s.sample_rows, '[]'::jsonb)), coalesce(s.size_floor, 0))::text
      from samples s
      join workpapers w on w.id = s.workpaper_id
     where s.org_id = public.jwt_org_id() and w.engagement_id = p_engagement_id
       and (s.locked_at is null
            or (s.size_floor is not null
                and jsonb_array_length(coalesce(s.sample_rows, '[]'::jsonb)) < s.size_floor))
  ),
  -- 5. reviewer_equals_preparer: a row reviewed by its own preparer. The wpr_four_eyes_chk CHECK
  --    (0028) makes this structurally impossible; the check is kept so the pre-flight list is the
  --    spec's full eight and a future schema change cannot silently drop it.
  rp AS (
    select 'reviewer_equals_preparer'::text, r.id::text,
           'A row was reviewed by its preparer.'::text
      from workpaper_rows r
      join workpapers w on w.id = r.workpaper_id
     where r.org_id = public.jwt_org_id() and w.engagement_id = p_engagement_id
       and r.reviewed_by is not null and r.reviewed_by = r.prepared_by
  ),
  -- 6. incomplete_findings: a finding of the engagement's entity with no severity rating.
  fi AS (
    select 'incomplete_findings'::text, f.id::text,
           'A finding has no severity rating.'::text
      from findings f
      join engagements en on en.entity_id = f.entity_id
     where f.org_id = public.jwt_org_id() and en.id = p_engagement_id
       and (f.severity is null or length(btrim(f.severity)) = 0)
  ),
  -- 7. unanswered_comments: an open management comment on a report version of the engagement.
  cm AS (
    select 'unanswered_comments'::text, c.id::text,
           'A management comment is unresolved.'::text
      from report_comments c
      join report_versions v on v.id = c.report_version_id
     where c.org_id = public.jwt_org_id() and v.engagement_id = p_engagement_id
       and c.status = 'open'
  ),
  -- 8. population_gate: a workpaper with a sample whose population is not verified or locked.
  pg AS (
    select 'population_gate'::text, w.id::text,
           'A sampled workpaper has no verified population.'::text
      from workpapers w
     where w.org_id = public.jwt_org_id() and w.engagement_id = p_engagement_id
       and exists (select 1 from samples s where s.workpaper_id = w.id)
       and not exists (
         select 1 from populations p
          where p.workpaper_id = w.id and p.status in ('verified', 'locked'))
  )
select coalesce(jsonb_agg(jsonb_build_object('check_key', x.check_key, 'item_id', x.item_id,
                                             'detail', x.detail)
                         order by x.check_key, x.item_id), '[]'::jsonb)
  from (
    select * from ex union all select * from fl union all select * from me
    union all select * from sf union all select * from rp union all select * from fi
    union all select * from cm union all select * from pg
  ) x
$$;

-- preflight_blocking: the open items that carry no live acknowledgement. A missing popout looks like
-- a bug; a missing acknowledgement is a real block, so this returns the items, not a boolean.
create or replace function public.preflight_blocking(p_engagement_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(i order by i ->> 'check_key', i ->> 'item_id'), '[]'::jsonb)
  from jsonb_array_elements(public.preflight_items(p_engagement_id)) i
  where not exists (
    select 1 from (
      select distinct on (check_key, item_id) check_key, item_id
        from preflight_acks
       where org_id = public.jwt_org_id() and engagement_id = p_engagement_id
         and length(btrim(reason)) >= 10
       order by check_key, item_id, acked_at desc, id desc
    ) a
    where a.check_key = i ->> 'check_key' and a.item_id = i ->> 'item_id')
$$;

-- assert_preflight_clear: the gate freeze_report calls. Raises while any item is unacknowledged.
create or replace function public.assert_preflight_clear(p_engagement_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_blocking jsonb := public.preflight_blocking(p_engagement_id);
  v_n int := jsonb_array_length(v_blocking);
begin
  if v_n > 0 then
    raise exception 'preflight_blocked: % pre-flight item(s) are unacknowledged', v_n using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- freeze_report, extended in place: after the existing gates, the pre-flight must be clear. Body is
-- the 0040 definition plus the assert_preflight_clear call. The open-comment and CAP gates stay, so
-- their specific refusals (and the tests that pin them) are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.freeze_report(p_report_version_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec report_versions;
  v_open int;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('approve_plan'), false) then
    raise exception 'not allowed: caller lacks the approve_plan right' using errcode = 'P0001';
  end if;
  select * into v_rec from report_versions r where r.id = p_report_version_id and r.org_id = v_org;
  if v_rec.id is null then
    raise exception 'report version not found in this organisation' using errcode = 'P0001';
  end if;
  if v_rec.status = 'frozen' then
    raise exception 'already_frozen: the report is already frozen' using errcode = 'P0001';
  end if;

  v_open := public.open_report_comment_count(p_report_version_id);
  if v_open > 0 then
    raise exception 'open_comments: % management comment(s) are unresolved', v_open using errcode = 'P0001';
  end if;

  if not public.check_cap_reconciliation(p_report_version_id) then
    raise exception 'cap_mismatch: the CAP register does not match the report' using errcode = 'P0001';
  end if;

  -- §11.4: the central pre-flight must be clear (every open item acknowledged with a reason).
  perform public.assert_preflight_clear(v_rec.engagement_id);

  update report_versions
     set status = 'frozen', frozen_at = now()
   where id = p_report_version_id;

  perform public.append_ledger_entry(
    v_org, 'report_frozen',
    jsonb_build_object('report_version_id', p_report_version_id, 'version', v_rec.version_number),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'report_frozen', 'report_version', p_report_version_id,
          jsonb_build_object('version', v_rec.version_number));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.preflight_items(uuid) from public, anon;
revoke execute on function public.preflight_blocking(uuid) from public, anon;
revoke execute on function public.assert_preflight_clear(uuid) from public, anon;
revoke execute on function public.freeze_report(uuid) from public, anon;
revoke execute on function public.preflight_acks_append_only() from public, anon;

grant execute on function public.preflight_items(uuid) to authenticated;
grant execute on function public.preflight_blocking(uuid) to authenticated;
grant execute on function public.assert_preflight_clear(uuid) to authenticated;
grant execute on function public.freeze_report(uuid) to authenticated;

-- 6C: Freeze and issuance DB (spec §15.5, §16.3).
--
-- The spec:
--   §15.5 "Freeze. Once management comments are resolved and the CAP register matches, the report is
--          frozen. … Issue. The report is issued … The email is queued."
--   §16.3 "The CAP register and the issued report must match exactly (§15.5). Any mismatch blocks the
--          freeze."
--
-- Depends on 6D's `check_cap_reconciliation` (built first; see D-6C-6D-order) and 6E's `queue_email`.

-- ---------------------------------------------------------------------------
-- freeze_report: freeze a draft (§15.5). Requires approve_plan. Blocks while any management comment
-- is open and while the CAP register does not reconcile. Writes a hash-chained ledger entry.
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
-- issue_report: issue a frozen report (§15.5). Requires approve_plan. Writes the issued timestamp,
-- flips the status to issued_v1, writes a hash-chained ledger entry and queues the email.
-- ---------------------------------------------------------------------------
create or replace function public.issue_report(p_report_version_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rec report_versions;
  v_to text[];
  v_subject text;
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
  if v_rec.status <> 'frozen' then
    raise exception 'not_frozen: only a frozen report can be issued' using errcode = 'P0001';
  end if;

  update report_versions
     set status = 'issued_v1', issued_at = now()
   where id = p_report_version_id;

  perform public.append_ledger_entry(
    v_org, 'report_issued',
    jsonb_build_object('report_version_id', p_report_version_id, 'version', v_rec.version_number),
    auth.uid());
  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'report_issued', 'report_version', p_report_version_id,
          jsonb_build_object('version', v_rec.version_number));

  -- Queue the email. The send itself is deferred (§15.5 "The email is queued"); dispatch is out of
  -- scope (NOT-DONE §email-dispatch).
  v_subject := 'Audit report issued';
  select coalesce(array_agg(u.email), '{}') into v_to
    from org_members m join auth.users u on u.id = m.user_id
   where m.org_id = v_org;
  perform public.queue_email(
    v_org, coalesce(v_to, '{}'), v_subject, null, null,
    jsonb_build_object('report_version_id', p_report_version_id, 'kind', 'report_issued'));
end $$;

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.freeze_report(uuid) from public, anon;
revoke execute on function public.issue_report(uuid) from public, anon;

grant execute on function public.freeze_report(uuid) to authenticated;
grant execute on function public.issue_report(uuid) to authenticated;

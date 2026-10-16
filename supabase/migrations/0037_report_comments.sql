-- 6B: Management comments DB (spec §15.2 step 5).
--
-- The spec:
--   §15.2 step 5 "The draft goes out for management comments. Each comment is attached to a block, and
--          each is resolved as incorporated or rejected with a reason. The report cannot be frozen
--          while any comment is unresolved."
--
-- Reuse (grep first): no comment table existed. `report_comments` is created here.

create table if not exists report_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  report_version_id uuid not null references report_versions(id) on delete cascade,
  block_id uuid null references report_blocks(id) on delete cascade,
  comment_text text not null,
  commenter_id uuid null,
  status text not null default 'open' check (status in ('open', 'incorporated', 'rejected')),
  resolution_reason text null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null
);
create index if not exists report_comments_version_idx on report_comments (org_id, report_version_id, status);

-- A resolution (incorporated or rejected) must carry a reason and a resolver (§15.2 step 5).
alter table report_comments drop constraint if exists report_comments_resolution_chk;
alter table report_comments add constraint report_comments_resolution_chk check (
  status = 'open'
  or (resolved_at is not null and resolved_by is not null
      and nullif(btrim(coalesce(resolution_reason, '')), '') is not null)
);

-- ---------------------------------------------------------------------------
-- open_report_comment_count: the count the freeze gate reads (§15.2 step 5). A report version cannot
-- be frozen while any comment is open.
-- ---------------------------------------------------------------------------
create or replace function public.open_report_comment_count(p_report_version_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from report_comments c
   where c.report_version_id = p_report_version_id
     and c.org_id = public.jwt_org_id()
     and c.status = 'open'
$$;

-- ---------------------------------------------------------------------------
-- add_report_comment: attach a comment to a block (§15.2 step 5). Requires perform_work.
-- ---------------------------------------------------------------------------
create or replace function public.add_report_comment(
  p_report_version_id uuid, p_block_id uuid, p_comment_text text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('perform_work'), false) then
    raise exception 'not allowed: caller lacks the perform_work right' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_comment_text, '')), '') is null then
    raise exception 'comment_required: a comment needs text' using errcode = 'P0001';
  end if;
  if not exists (select 1 from report_versions r
                  where r.id = p_report_version_id and r.org_id = v_org) then
    raise exception 'report version not found in this organisation' using errcode = 'P0001';
  end if;
  insert into report_comments (org_id, report_version_id, block_id, comment_text, commenter_id)
  values (v_org, p_report_version_id, p_block_id, btrim(p_comment_text), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- resolve_report_comment: incorporate or reject a comment, with a reason (§15.2 step 5). Requires
-- review_and_approve. Four-eyes: the resolver must not be the commenter.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_report_comment(
  p_comment_id uuid, p_status text, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_comment report_comments;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('review_and_approve'), false) then
    raise exception 'not allowed: caller lacks the review_and_approve right' using errcode = 'P0001';
  end if;
  if p_status not in ('incorporated', 'rejected') then
    raise exception 'invalid status: %', p_status using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'resolution_reason_required: a resolution needs a reason' using errcode = 'P0001';
  end if;
  select * into v_comment from report_comments c where c.id = p_comment_id and c.org_id = v_org;
  if v_comment.id is null then
    raise exception 'comment not found in this organisation' using errcode = 'P0001';
  end if;
  if v_comment.commenter_id is not null and v_comment.commenter_id = auth.uid() then
    raise exception 'four_eyes: the resolver cannot be the commenter' using errcode = 'P0001';
  end if;

  update report_comments
     set status = p_status, resolution_reason = btrim(p_reason),
         resolved_at = now(), resolved_by = auth.uid()
   where id = p_comment_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: org-scoped select only. Writes go through the RPCs above.
-- ---------------------------------------------------------------------------
alter table report_comments enable row level security;

drop policy if exists report_comments_select on report_comments;
create policy report_comments_select on report_comments for select to authenticated
  using (org_id = public.jwt_org_id());

drop trigger if exists report_comments_pin_org on report_comments;
create trigger report_comments_pin_org before insert on report_comments
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.open_report_comment_count(uuid) from public, anon;
revoke execute on function public.add_report_comment(uuid, uuid, text) from public, anon;
revoke execute on function public.resolve_report_comment(uuid, text, text) from public, anon;

grant execute on function public.open_report_comment_count(uuid) to authenticated;
grant execute on function public.add_report_comment(uuid, uuid, text) to authenticated;
grant execute on function public.resolve_report_comment(uuid, text, text) to authenticated;

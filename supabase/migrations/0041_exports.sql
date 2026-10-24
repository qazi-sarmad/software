-- 7A: Exports DB (spec §18 export table, §26 activity log export).
--
-- The spec:
--   §18 "Every export is recorded: who, what, when, the format and a content hash." The export
--        functions return the data to be serialised; the application writes the file. Nothing here
--        generates a file.
--
-- M1: grep found no `exports_log`, no `log_export` and no `export_*` function. This migration creates
-- them (no collision).

create table if not exists exports_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  exported_by uuid,
  object_type text not null,
  object_id uuid,
  format text not null check (format in ('csv', 'xlsx', 'pdf', 'zip', 'json')),
  filters jsonb not null default '{}'::jsonb,
  content_hash text,
  created_at timestamptz not null default now()
);
create index if not exists exports_log_org_idx on exports_log (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- log_export: the single write path. Security definer, writes the row and a hash-chained ledger
-- entry (§18). Every export in the application calls this.
-- ---------------------------------------------------------------------------
create or replace function public.log_export(
  p_object_type text, p_object_id uuid, p_format text, p_filters jsonb, p_content_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_format not in ('csv', 'xlsx', 'pdf', 'zip', 'json') then
    raise exception 'unknown export format: %', p_format using errcode = 'P0001';
  end if;
  insert into exports_log (org_id, exported_by, object_type, object_id, format, filters, content_hash)
  values (v_org, auth.uid(), p_object_type, p_object_id, p_format,
          coalesce(p_filters, '{}'::jsonb), p_content_hash)
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'export_logged',
    jsonb_build_object('export_id', v_id, 'object_type', p_object_type, 'object_id', p_object_id,
                       'format', p_format, 'content_hash', p_content_hash), auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- export_workpaper: the workpaper, its rows and its sign-offs.
-- ---------------------------------------------------------------------------
create or replace function public.export_workpaper(p_workpaper_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'workpaper', to_jsonb(w),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.row_ref)
                        from workpaper_rows r where r.workpaper_id = w.id and r.org_id = v_org), '[]'::jsonb),
    'sign_offs', coalesce((select jsonb_agg(to_jsonb(s))
                             from sign_offs s where s.org_id = v_org and s.workpaper_id = w.id), '[]'::jsonb)
  ) into v_result
  from workpapers w where w.id = p_workpaper_id and w.org_id = v_org;
  if v_result is null then
    raise exception 'workpaper not found in this organisation' using errcode = 'P0001';
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- export_engagement_bundle: everything scoped to one engagement.
-- ---------------------------------------------------------------------------
create or replace function public.export_engagement_bundle(p_engagement_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'engagement', to_jsonb(e),
    'populations', coalesce((select jsonb_agg(to_jsonb(p)) from populations p
                              where p.engagement_id = e.id and p.org_id = v_org), '[]'::jsonb),
    'samples', coalesce((select jsonb_agg(to_jsonb(s)) from samples s
                          join workpapers w2 on w2.id = s.workpaper_id
                          where w2.engagement_id = e.id and s.org_id = v_org), '[]'::jsonb),
    'workpapers', coalesce((select jsonb_agg(to_jsonb(w)) from workpapers w
                             where w.engagement_id = e.id and w.org_id = v_org), '[]'::jsonb),
    'planning_sections', coalesce((select jsonb_agg(to_jsonb(ps)) from planning_sections ps
                                    where ps.engagement_id = e.id and ps.org_id = v_org), '[]'::jsonb),
    'conclusion', (select to_jsonb(c) from conclusion_records c
                    where c.engagement_id = e.id and c.org_id = v_org limit 1),
    'reports', coalesce((select jsonb_agg(to_jsonb(rv)) from report_versions rv
                          where rv.engagement_id = e.id and rv.org_id = v_org), '[]'::jsonb)
  ) into v_result
  from engagements e where e.id = p_engagement_id and e.org_id = v_org;
  if v_result is null then
    raise exception 'engagement not found in this organisation' using errcode = 'P0001';
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- export_sira_results: the scores for one cycle of one universe.
-- ---------------------------------------------------------------------------
create or replace function public.export_sira_results(p_universe_id uuid, p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes u where u.id = p_universe_id and u.org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sira_cycles c
                  where c.id = p_cycle_id and c.org_id = v_org and c.universe_id = p_universe_id) then
    raise exception 'cycle not found for this universe' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'cycle', (select to_jsonb(c) from sira_cycles c where c.id = p_cycle_id),
    'scores', coalesce((select jsonb_agg(to_jsonb(s) order by s.score desc) from sira_scores s
                         where s.cycle_id = p_cycle_id and s.org_id = v_org), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- export_audit_plan: the plan and its version history for one universe.
-- ---------------------------------------------------------------------------
create or replace function public.export_audit_plan(p_universe_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_result jsonb;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from universes u where u.id = p_universe_id and u.org_id = v_org) then
    raise exception 'universe not found in this organisation' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(to_jsonb(p)) from plans p
                        where p.universe_id = p_universe_id and p.org_id = v_org), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(to_jsonb(v))
                           from plan_versions v join plans p on p.id = v.plan_id
                          where p.universe_id = p_universe_id and v.org_id = v_org), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- export_cap_register: the §16 register for one org.
-- ---------------------------------------------------------------------------
create or replace function public.export_cap_register(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org_id is distinct from v_org then
    raise exception 'cross-org export refused' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'caps', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from caps c
                       where c.org_id = v_org), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- export_ledger / export_activity_log: accountability tables (read via definer, org-scoped).
-- ---------------------------------------------------------------------------
create or replace function public.export_ledger(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org_id is distinct from v_org then
    raise exception 'cross-org export refused' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.seq) from ledger_entries e
                          where e.org_id = v_org), '[]'::jsonb));
end $$;

create or replace function public.export_activity_log(p_org_id uuid, p_since timestamptz, p_until timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org_id is distinct from v_org then
    raise exception 'cross-org export refused' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(a) order by a.ts) from activity_log a
                       where a.org_id = v_org
                         and (p_since is null or a.ts >= p_since)
                         and (p_until is null or a.ts <= p_until)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- export_full_tenant: every org-scoped table for the tenant. Requires manage_users (§18, §26).
-- ---------------------------------------------------------------------------
create or replace function public.export_full_tenant(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if p_org_id is distinct from v_org then
    raise exception 'cross-org export refused' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_users'), false) then
    raise exception 'not allowed: caller lacks the manage_users right' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'org_id', v_org,
    'exported_at', now(),
    'entities', coalesce((select jsonb_agg(to_jsonb(e)) from entities e where e.org_id = v_org), '[]'::jsonb),
    'engagements', coalesce((select jsonb_agg(to_jsonb(e)) from engagements e where e.org_id = v_org), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(to_jsonb(f)) from findings f where f.org_id = v_org), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(to_jsonb(i)) from issues i where i.org_id = v_org), '[]'::jsonb),
    'caps', coalesce((select jsonb_agg(to_jsonb(c)) from caps c where c.org_id = v_org), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(to_jsonb(l) order by l.seq) from ledger_entries l where l.org_id = v_org), '[]'::jsonb),
    'activity_log', coalesce((select jsonb_agg(to_jsonb(a) order by a.ts) from activity_log a where a.org_id = v_org), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: an org reads its own export history only. Writes go through log_export.
-- ---------------------------------------------------------------------------
alter table exports_log enable row level security;

drop policy if exists exports_log_select on exports_log;
create policy exports_log_select on exports_log for select to authenticated
  using (org_id = public.jwt_org_id());

revoke insert, update, delete on public.exports_log from public, anon, authenticated;

drop trigger if exists exports_log_pin_org on exports_log;
create trigger exports_log_pin_org before insert on exports_log
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- Grants: application roles only.
-- ---------------------------------------------------------------------------
revoke execute on function public.log_export(text, uuid, text, jsonb, text) from public, anon;
revoke execute on function public.export_workpaper(uuid) from public, anon;
revoke execute on function public.export_engagement_bundle(uuid) from public, anon;
revoke execute on function public.export_sira_results(uuid, uuid) from public, anon;
revoke execute on function public.export_audit_plan(uuid) from public, anon;
revoke execute on function public.export_cap_register(uuid) from public, anon;
revoke execute on function public.export_ledger(uuid) from public, anon;
revoke execute on function public.export_activity_log(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.export_full_tenant(uuid) from public, anon;

grant execute on function public.log_export(text, uuid, text, jsonb, text) to authenticated;
grant execute on function public.export_workpaper(uuid) to authenticated;
grant execute on function public.export_engagement_bundle(uuid) to authenticated;
grant execute on function public.export_sira_results(uuid, uuid) to authenticated;
grant execute on function public.export_audit_plan(uuid) to authenticated;
grant execute on function public.export_cap_register(uuid) to authenticated;
grant execute on function public.export_ledger(uuid) to authenticated;
grant execute on function public.export_activity_log(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.export_full_tenant(uuid) to authenticated;

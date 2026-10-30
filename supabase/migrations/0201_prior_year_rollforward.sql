-- 0201 (integrator, final phase): prior-year workpaper roll-forward, the export check, and the
-- prior-year-access gate on every prior-year import.
--
-- Owner instruction 2026-10-30: "prior-year workpaper roll-forward + export check; only those with
-- prior-year access may raise such requests."
--
-- What this migration adds:
--   1. prior_year_access_ok(p_engagement) — whether the caller may read a given engagement under the
--      scope rules (view_all_scopes, or a scope on the engagement's universe/entity/engagement, or
--      membership). This is the "prior-year access" the owner names: the right to see last year's file.
--   2. prior_year_rollforwards — one roll-forward per engagement, recording the source engagement it
--      rolls forward from, the manifest of items it expects, and whether their exports are present.
--      A re-build is a new version.
--   3. prior_year_rollforward_build — build the roll-forward manifest from the source engagement. It
--      refuses unless the caller holds prior-year access to the SOURCE engagement, so only a person
--      who could open last year's file may raise the request.
--   4. prior_year_export_check — the export check: for every item the roll-forward expects, is there
--      a matching recorded export? It returns the missing items by name and a `complete` flag. It
--      never fabricates a file; it reads `exports_log` (0041), the one record of every export.
--   5. import_prior_year_item — replaced (CREATE OR REPLACE) to add the same prior-year-access gate to
--      every import, so the gate is one predicate wherever a prior-year request is raised.
--
-- Laws: L1 (a comparison of recorded rows and hashes — no model), L2 (pinned to the session org; the
-- scope predicate is the RLS one), L3/L5 (a build is versioned, logged and ledger-appended).
--
-- M1: grepped migrations and tests for every new name; all new except import_prior_year_item, which
-- is deliberately replaced. M2: create table if not exists / create index if not exists.

-- ---------------------------------------------------------------------------
-- 1. prior_year_access_ok — the scope predicate, in the same shape as the RLS policies (0016).
-- ---------------------------------------------------------------------------
create or replace function public.prior_year_access_ok(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from engagements e
     where e.id = p_engagement
       and e.org_id = public.jwt_org_id()
       and (public.can_read_all_scopes() or public.has_scope(e.universe_id, e.entity_id, e.id))
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. The roll-forward record.
-- ---------------------------------------------------------------------------
create table if not exists prior_year_rollforwards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null unique references engagements(id) on delete cascade,
  source_engagement_id uuid not null references engagements(id) on delete cascade,
  manifest jsonb not null default '[]'::jsonb,
  items_expected int not null default 0,
  items_present int not null default 0,
  export_complete boolean not null default false,
  version int not null default 1,
  created_by uuid null,
  created_at timestamptz not null default now()
);
create index if not exists prior_year_rollforwards_org_idx on prior_year_rollforwards (org_id, engagement_id);

alter table prior_year_rollforwards enable row level security;
drop policy if exists prior_year_rollforwards_select on prior_year_rollforwards;
create policy prior_year_rollforwards_select on prior_year_rollforwards for select to authenticated
  using (org_id = public.jwt_org_id());
drop trigger if exists prior_year_rollforwards_pin_org on prior_year_rollforwards;
create trigger prior_year_rollforwards_pin_org before insert on prior_year_rollforwards
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 3. prior_year_rollforward_build — build the manifest, gated on prior-year access to the source.
-- ---------------------------------------------------------------------------
create or replace function public.prior_year_rollforward_build(
  p_engagement uuid, p_source uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_manifest jsonb;
  v_expected int;
  v_id uuid;
  v_version int;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_engagements');
  if p_engagement is null or p_source is null then
    raise exception 'a target and a source engagement are required' using errcode = 'P0001';
  end if;
  if p_engagement = p_source then
    raise exception 'an engagement cannot roll forward from itself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement and e.org_id = v_org) then
    raise exception 'target engagement not found in this organisation' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_source and e.org_id = v_org) then
    raise exception 'source engagement not found in this organisation' using errcode = 'P0001';
  end if;
  -- The owner's rule: only those with prior-year access may raise the request.
  if not public.prior_year_access_ok(p_source) then
    raise exception 'prior-year access: the caller cannot read the source engagement' using errcode = 'P0001';
  end if;

  -- The manifest: one entry per workpaper of the source engagement, with whether it was exported.
  select coalesce(jsonb_agg(jsonb_build_object(
           'workpaper_id', w.id,
           'stage', w.stage,
           'exported', exists (select 1 from exports_log x
                                where x.org_id = v_org and x.object_type = 'workpaper'
                                  and x.object_id = w.id)
         ) order by w.created_at, w.id), '[]'::jsonb)
    into v_manifest
    from workpapers w
   where w.org_id = v_org and w.engagement_id = p_source;
  v_expected := jsonb_array_length(v_manifest);

  insert into prior_year_rollforwards (org_id, engagement_id, source_engagement_id, manifest, items_expected,
                                       items_present, export_complete, created_by)
  values (v_org, p_engagement, p_source, v_manifest, v_expected,
          (select count(*) from jsonb_array_elements(v_manifest) e where (e ->> 'exported')::boolean),
          not exists (select 1 from jsonb_array_elements(v_manifest) e where (e ->> 'exported')::boolean is not true),
          auth.uid())
  on conflict (engagement_id) do update
    set source_engagement_id = excluded.source_engagement_id,
        manifest = excluded.manifest,
        items_expected = excluded.items_expected,
        items_present = excluded.items_present,
        export_complete = excluded.export_complete,
        version = prior_year_rollforwards.version + 1,
        created_by = excluded.created_by,
        created_at = now()
  returning id, version into v_id, v_version;

  perform public.admin_log_change(v_org, 'prior_year_rollforward:' || p_engagement::text,
    jsonb_build_object('engagement_id', p_engagement, 'source_engagement_id', p_source,
                       'items_expected', v_expected, 'version', v_version),
    'prior_year_rollforward_built', 'engagement', p_engagement);
  perform public.append_ledger_entry(v_org, 'prior_year_rollforward_built',
    jsonb_build_object('engagement_id', p_engagement::text, 'source_engagement_id', p_source::text,
                       'items_expected', v_expected, 'version', v_version), auth.uid());

  return jsonb_build_object('rollforward_id', v_id, 'items_expected', v_expected,
                            'export_complete', (select export_complete from prior_year_rollforwards where id = v_id));
end $$;

-- ---------------------------------------------------------------------------
-- 4. prior_year_export_check — for every expected item, is there a recorded export?
--    Returns the missing items by name and a `complete` flag. Never fabricates a file.
-- ---------------------------------------------------------------------------
create or replace function public.prior_year_export_check(p_engagement uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_rf prior_year_rollforwards;
  v_missing jsonb;
begin
  perform public.admin_assert_org(v_org);
  select * into v_rf from prior_year_rollforwards r
   where r.org_id = v_org and r.engagement_id = p_engagement;
  if v_rf.id is null then
    raise exception 'no roll-forward has been built for that engagement' using errcode = 'P0001';
  end if;
  -- Only a caller with prior-year access to the source may see the check.
  if not public.prior_year_access_ok(v_rf.source_engagement_id) then
    raise exception 'prior-year access: the caller cannot read the source engagement' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(e order by e ->> 'workpaper_id'), '[]'::jsonb)
    into v_missing
    from jsonb_array_elements(v_rf.manifest) e
   where (e ->> 'exported')::boolean is not true;

  return jsonb_build_object(
    'engagement_id', p_engagement,
    'source_engagement_id', v_rf.source_engagement_id,
    'items_expected', v_rf.items_expected,
    'items_present', v_rf.items_expected - jsonb_array_length(v_missing),
    'complete', jsonb_array_length(v_missing) = 0,
    'missing', v_missing
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reader.
-- ---------------------------------------------------------------------------
create or replace function public.prior_year_rollforwards_list()
returns table (engagement_id uuid, engagement_title text, source_engagement_id uuid,
               items_expected int, items_present int, export_complete boolean, version int)
language sql stable security definer set search_path = public as $$
  select r.engagement_id, e.title, r.source_engagement_id, r.items_expected, r.items_present,
         r.export_complete, r.version
    from prior_year_rollforwards r
    join engagements e on e.id = r.engagement_id
   where r.org_id = public.jwt_org_id()
   order by e.title
$$;

-- ---------------------------------------------------------------------------
-- 6. import_prior_year_item — replaced from 0044 to add the prior-year-access gate. The body is the
--    0044 body with one added predicate: the caller must be able to read the source engagement.
-- ---------------------------------------------------------------------------
create or replace function public.import_prior_year_item(
  p_source_engagement_id uuid, p_item_type text, p_engagement_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;
  if p_item_type not in ('risk_control_mapping', 'scope', 'procedures', 'resource_estimates') then
    raise exception 'not importable: % is not a prior-year import type (populations, samples, results, conclusions and evidence are never importable)', p_item_type
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_source_engagement_id and e.org_id = v_org) then
    raise exception 'source engagement not found in this organisation' using errcode = 'P0001';
  end if;
  -- The owner's rule: only those with prior-year access may raise the request.
  if not public.prior_year_access_ok(p_source_engagement_id) then
    raise exception 'prior-year access: the caller cannot read the source engagement' using errcode = 'P0001';
  end if;
  if not exists (select 1 from engagements e where e.id = p_engagement_id and e.org_id = v_org) then
    raise exception 'target engagement not found in this organisation' using errcode = 'P0001';
  end if;

  insert into prior_year_imports (org_id, engagement_id, item_type, source_engagement_id, status, imported_by)
  values (v_org, p_engagement_id, p_item_type, p_source_engagement_id, 'imported_confirm', auth.uid())
  returning id into v_id;

  insert into activity_log (org_id, actor_id, action, object_type, object_id, detail)
  values (v_org, auth.uid(), 'prior_year_imported', 'prior_year_import', v_id,
          jsonb_build_object('item_type', p_item_type, 'source_engagement_id', p_source_engagement_id,
                             'engagement_id', p_engagement_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on prior_year_rollforwards from public, anon, authenticated;

revoke execute on function public.prior_year_access_ok(uuid) from public, anon;
revoke execute on function public.prior_year_rollforward_build(uuid, uuid) from public, anon;
revoke execute on function public.prior_year_export_check(uuid) from public, anon;
revoke execute on function public.prior_year_rollforwards_list() from public, anon;

grant execute on function public.prior_year_access_ok(uuid) to authenticated;
grant execute on function public.prior_year_rollforward_build(uuid, uuid) to authenticated;
grant execute on function public.prior_year_export_check(uuid) to authenticated;
grant execute on function public.prior_year_rollforwards_list() to authenticated;

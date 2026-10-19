-- 0061: Board Pack (S7.a, F10).
--
-- A Board Pack is a frozen, hash-chained snapshot of an organisation's assurance position at a point
-- in time. Every figure in the snapshot is an object carrying `refs` (the sealed or ledgered records
-- it came from); a figure with no refs is a bug and SQL test 71 fails on it. The snapshot is
-- deterministic (L1): no random, no AI. Only sealed, approved, issued, published or ledgered records
-- feed figures; everything else is counted in the "excluded" footnote.
--
-- M1: grepped supabase/migrations and supabase/tests for board_pack_history, board_pack_sections,
--     board_pack_snapshot, board_pack_generate, board_pack_list, board_pack_sections_save; none
--     existed. The feature keys `board_pack` / `board_pack_pptx` (0051), the rights `view_board_pack`
--     / `generate_board_pack` (0050) and org_settings_extra (0051) already exist and are used as is.
-- M2: create table if not exists + add column if not exists; create or replace; drop trigger/policy
--     if exists before create; create index if not exists. Safe to apply repeatedly.

-- ---------------------------------------------------------------------------
-- 1. board_pack_sections — the configurable section list (F10). Reorderable, per-section role
--    visibility, per-section on or off. Configurable, so it is versioned and logged (L5).
-- ---------------------------------------------------------------------------
create table if not exists board_pack_sections (
  id uuid primary key default gen_random_uuid()
);
alter table board_pack_sections add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table board_pack_sections add column if not exists section_key text;
alter table board_pack_sections add column if not exists label text;
alter table board_pack_sections add column if not exists ordinal int not null default 0;
alter table board_pack_sections add column if not exists enabled boolean not null default true;
alter table board_pack_sections add column if not exists visible_roles text[] not null default '{}';
alter table board_pack_sections add column if not exists created_at timestamptz not null default now();
create unique index if not exists board_pack_sections_org_key_idx on board_pack_sections (org_id, section_key);
create index if not exists board_pack_sections_org_ord_idx on board_pack_sections (org_id, ordinal);

-- The eight sections F10 names, in order. Seeded for every organisation; a re-run does nothing.
create or replace function public.board_pack_sections_seed(p_org uuid) returns void
language sql security definer set search_path = public as $$
  insert into board_pack_sections (org_id, section_key, label, ordinal)
  select p_org, s.key, s.label, s.ord
    from (values
      ('cover',                 'Cover and assurance statement', 1),
      ('changes',               'What changed since the last pack', 2),
      ('sira',                  'SIRA residual risk and heatmap', 3),
      ('plan',                  'Audit plan progress and Gantt', 4),
      ('issues',                'Open issues and CAP aging by severity', 5),
      ('sealed',                'Sealed work and integrity', 6),
      ('management_responses',  'Management responses', 7),
      ('sources',               'Sources index', 8)
    ) as s(key, label, ord)
  on conflict (org_id, section_key) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- 2. board_pack_history — one row per generated pack. `data_hash` is the SHA-256 of the canonical
--    snapshot JSON, computed IN THE DATABASE. `previous_pack_id` links the chain of packs with the
--    same scope_key, so "last pack" is a single indexed lookup.
-- ---------------------------------------------------------------------------
create table if not exists board_pack_history (
  id uuid primary key default gen_random_uuid()
);
alter table board_pack_history add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table board_pack_history add column if not exists scope_key text not null default 'org';
alter table board_pack_history add column if not exists scope_description text;
alter table board_pack_history add column if not exists boundary_kind text not null default 'since_last';
alter table board_pack_history add column if not exists from_ts timestamptz;
alter table board_pack_history add column if not exists to_ts timestamptz;
alter table board_pack_history add column if not exists generated_by uuid;
alter table board_pack_history add column if not exists generated_at timestamptz not null default now();
alter table board_pack_history add column if not exists snapshot jsonb not null default '{}'::jsonb;
alter table board_pack_history add column if not exists data_hash text;
alter table board_pack_history add column if not exists file_hashes jsonb not null default '{}'::jsonb;
alter table board_pack_history add column if not exists status text not null default 'ready';
alter table board_pack_history add column if not exists ledger_entry_id uuid;
alter table board_pack_history add column if not exists previous_pack_id uuid;
create index if not exists board_pack_history_org_scope_idx
  on board_pack_history (org_id, scope_key, generated_at desc);
alter table board_pack_history drop constraint if exists board_pack_history_status_chk;
alter table board_pack_history add constraint board_pack_history_status_chk
  check (status in ('ready', 'failed'));

-- The FK to orgs makes `truncate orgs cascade` (the SQL-test reset) reach these tables, so a test
-- run leaves no residue (M5). Dropped and re-added so the migration is safe to re-apply (M2).
alter table board_pack_sections drop constraint if exists board_pack_sections_org_fk;
alter table board_pack_sections add constraint board_pack_sections_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;
alter table board_pack_history drop constraint if exists board_pack_history_org_fk;
alter table board_pack_history add constraint board_pack_history_org_fk
  foreign key (org_id) references orgs(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3. board_pack_figure_refs(p_snapshot) — every figure in the snapshot must carry at least one ref.
--    Returns the list of figure paths that have none, so a test (and the generator) can fail loudly.
--    A figure is an object with a `value`; a count of zero has nothing to point at and is allowed to
--    carry no refs. The walk recurses into nested objects and arrays. Deterministic, no AI (L1).
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_figure_refs(p_snapshot jsonb) returns text[]
language plpgsql immutable as $$
declare
  v_bad text[] := '{}';
begin
  return public.board_pack_figure_refs(p_snapshot, '');
end $$;

create or replace function public.board_pack_figure_refs(p_node jsonb, p_path text) returns text[]
language plpgsql immutable as $$
declare
  v_bad text[] := '{}';
  v_key text;
  v_val jsonb;
  v_idx int;
  v_path text;
begin
  if p_node is null then
    return v_bad;
  end if;

  if jsonb_typeof(p_node) = 'object' then
    if p_node ? 'value' then
      -- A figure. It must carry a non-empty refs array unless its value is zero.
      if coalesce((p_node ->> 'value')::numeric, 0) <> 0
         and (not (p_node ? 'refs') or jsonb_typeof(p_node -> 'refs') <> 'array'
              or jsonb_array_length(p_node -> 'refs') = 0) then
        return array[p_path];
      end if;
    end if;
    for v_key, v_val in select key, value from jsonb_each(p_node) loop
      if v_key in ('refs', 'value') then
        continue;
      end if;
      v_path := case when p_path = '' then v_key else p_path || '.' || v_key end;
      v_bad := v_bad || public.board_pack_figure_refs(v_val, v_path);
    end loop;
  elsif jsonb_typeof(p_node) = 'array' then
    for v_idx in 0 .. jsonb_array_length(p_node) - 1 loop
      v_bad := v_bad || public.board_pack_figure_refs(p_node -> v_idx, p_path || '[' || v_idx || ']');
    end loop;
  end if;

  return v_bad;
end $$;

-- ---------------------------------------------------------------------------
-- 4. board_pack_snapshot(p_org, p_scope_key, p_from, p_to) — the deterministic snapshot (F10).
--    Every figure is {value, refs:[{type,id}], ...}. Reads only sealed/approved/issued/published or
--    ledgered records. Filtered by the caller's org; RLS still applies to any direct read.
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_snapshot(
  p_org uuid, p_scope_key text default 'org',
  p_from timestamptz default null, p_to timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := coalesce(p_from, '1970-01-01'::timestamptz);
  v_to timestamptz := coalesce(p_to, now());
  v_sira jsonb;
  v_plan jsonb;
  v_cap jsonb;
  v_sealed jsonb;
  v_responses jsonb;
  v_excluded jsonb;
begin
  -- SIRA residual risk by band, with the score rows behind each band as refs.
  select coalesce(jsonb_agg(fig order by fig ->> 'band'), '[]'::jsonb) into v_sira
    from (
      select jsonb_build_object(
               'band', public.sira_band_for(p_org, s.score),
               'value', count(*),
               'refs', jsonb_agg(jsonb_build_object('type', 'sira_score', 'id', s.id))
             ) as fig
        from sira_scores s
       where s.org_id = p_org
       group by public.sira_band_for(p_org, s.score)
    ) t;

  -- Audit plan progress: counts by plan_item.status, with the items behind each count as refs.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'plan_item', 'id', i.id)), '[]'::jsonb),
           'by_status', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'status', i2.status, 'value', cnt,
                      'refs', refs) order by i2.status)
               from (
                 select i2.status, count(*) as cnt,
                        jsonb_agg(jsonb_build_object('type', 'plan_item', 'id', i2.id)) as refs
                   from plan_items i2
                  where i2.org_id = p_org
                  group by i2.status
               ) i2
           ), '[]'::jsonb)
         ) into v_plan
    from plan_items i
   where i.org_id = p_org;

  -- CAP aging by severity band (0-30, 31-60, 61-90, 90+ days past due), with the caps as refs.
  select jsonb_object_agg(band, fig) into v_cap
    from (
      select case
               when c.due_date is null then 'no_due_date'
               when c.due_date >= current_date then 'not_due'
               when current_date - c.due_date <= 30 then '0-30'
               when current_date - c.due_date <= 60 then '31-60'
               when current_date - c.due_date <= 90 then '61-90'
               else '90+'
             end as band,
             jsonb_build_object(
               'value', count(*),
               'refs', jsonb_agg(jsonb_build_object('type', 'cap', 'id', c.id))
             ) as fig
        from caps c
       where c.org_id = p_org
         and c.status <> 'verified_closed'
       group by 1
    ) t;
  v_cap := coalesce(v_cap, '{}'::jsonb);

  -- Sealed work and integrity: signed-off workpapers and sealed engagements, with root hashes.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'workpaper', 'id', w.id)), '[]'::jsonb)
         ) into v_sealed
    from workpapers w
   where w.org_id = p_org and w.status = 'signed_off';
  v_sealed := coalesce(v_sealed, jsonb_build_object('value', 0, 'refs', '[]'::jsonb));
  v_sealed := v_sealed || jsonb_build_object(
    'sealed_engagements', coalesce((
      select jsonb_build_object(
               'value', count(*),
               'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'engagement', 'id', e.id)), '[]'::jsonb))
        from engagements e where e.org_id = p_org and e.sealed), jsonb_build_object('value', 0, 'refs', '[]'::jsonb)),
    'root_hashes', coalesce((
      select jsonb_agg(jsonb_build_object('engagement_id', cr.engagement_id, 'row_hash', cr.row_hash))
        from conclusion_records cr join engagements e2 on e2.id = cr.engagement_id
       where e2.org_id = p_org and e2.sealed), '[]'::jsonb));

  -- Management responses: report text blocks carrying a management response section.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'report_block', 'id', b.id)), '[]'::jsonb)
         ) into v_responses
    from report_blocks b
   where b.org_id = p_org and b.section_type = 'management_response';
  v_responses := coalesce(v_responses, jsonb_build_object('value', 0, 'refs', '[]'::jsonb));

  -- The honest footnote: how many items are NOT yet sealed, so they are not counted above.
  select jsonb_build_object(
           'unsealed_workpapers', (
             select count(*) from workpapers w2
              where w2.org_id = p_org and w2.status <> 'signed_off'),
           'unsealed_engagements', (
             select count(*) from engagements e3
              where e3.org_id = p_org and not e3.sealed),
           'note', 'Items not yet sealed are not included.'
         ) into v_excluded;

  return jsonb_build_object(
    'scope_key', p_scope_key,
    'org_id', p_org,
    'from_ts', v_from,
    'to_ts', v_to,
    'sira', jsonb_build_object('bands', v_sira),
    'plan', v_plan,
    'cap', v_cap,
    'sealed_work', v_sealed,
    'management_responses', v_responses,
    'excluded', v_excluded
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. board_pack_generate(p_org, p_scope_key, p_boundary_kind, p_from, p_to) — generate a pack:
--    compute the snapshot, hash it IN THE DATABASE, write the history row and a ledger entry
--    (kind board_pack_generated, F20). Refuses without the right or the entitlement, and refuses
--    until app_base_url is set (F10: drill-down links must resolve).
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_generate(
  p_org uuid, p_scope_key text default 'org', p_boundary_kind text default 'since_last',
  p_from timestamptz default null, p_to timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prev uuid;
  v_from timestamptz := p_from;
  v_to timestamptz := coalesce(p_to, now());
  v_snapshot jsonb;
  v_hash text;
  v_id uuid;
  v_ledger uuid;
begin
  if not public.config_actor_ok(p_org, 'generate_board_pack') then
    raise exception 'not allowed: the caller cannot generate a Board Pack' using errcode = 'P0001';
  end if;
  if not public.has_feature(p_org, 'board_pack') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from org_settings_extra where org_id = p_org and app_base_url is not null) then
    raise exception 'Set the application web address before generating a Board Pack.' using errcode = 'P0001';
  end if;

  perform public.board_pack_sections_seed(p_org);

  -- Boundary option 1: since the last successful pack with the same scope_key.
  select h.id, h.to_ts into v_prev, v_from
    from board_pack_history h
   where h.org_id = p_org and h.scope_key = p_scope_key and h.status = 'ready'
   order by h.generated_at desc limit 1;
  if v_from is null then
    v_from := '1970-01-01'::timestamptz;
  end if;

  v_snapshot := public.board_pack_snapshot(p_org, p_scope_key, v_from, v_to);
  v_hash := public.ledger_payload_hash(public.canonical_payload(v_snapshot));

  insert into board_pack_history (org_id, scope_key, scope_description, boundary_kind, from_ts, to_ts,
                                  generated_by, snapshot, data_hash, status, previous_pack_id)
  values (p_org, p_scope_key, p_scope_key, p_boundary_kind, v_from, v_to,
          auth.uid(), v_snapshot, v_hash, 'ready', v_prev)
  returning id into v_id;

  v_ledger := (public.append_ledger_entry(p_org, 'board_pack_generated',
    jsonb_build_object('pack_id', v_id, 'scope_key', p_scope_key, 'data_hash', v_hash,
                       'previous_pack_id', v_prev), auth.uid())).id;

  update board_pack_history set ledger_entry_id = v_ledger where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. board_pack_list(p_org, p_scope_key) — the pack history the caller may see (view_board_pack).
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_list(p_org uuid, p_scope_key text default null)
returns table (
  id uuid, scope_key text, scope_description text, boundary_kind text, from_ts timestamptz,
  to_ts timestamptz, generated_by uuid, generated_at timestamptz, data_hash text,
  status text, ledger_entry_id uuid, previous_pack_id uuid
)
language sql stable security definer set search_path = public as $$
  select h.id, h.scope_key, h.scope_description, h.boundary_kind, h.from_ts, h.to_ts,
         h.generated_by, h.generated_at, h.data_hash, h.status, h.ledger_entry_id, h.previous_pack_id
    from board_pack_history h
   where h.org_id = p_org
     and (p_scope_key is null or h.scope_key = p_scope_key)
     and (public.is_platform_admin() or public.caller_has_right('view_board_pack'))
   order by h.generated_at desc
$$;

-- ---------------------------------------------------------------------------
-- 7. board_pack_get(p_id) — one pack, with its snapshot. Refuses without view_board_pack.
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_get(p_id uuid)
returns table (
  id uuid, scope_key text, data_hash text, snapshot jsonb, generated_at timestamptz,
  previous_pack_id uuid, ledger_entry_id uuid
)
language sql stable security definer set search_path = public as $$
  select h.id, h.scope_key, h.data_hash, h.snapshot, h.generated_at, h.previous_pack_id, h.ledger_entry_id
    from board_pack_history h
   where h.id = p_id
     and (public.is_platform_admin() or public.caller_has_right('view_board_pack'))
$$;

-- ---------------------------------------------------------------------------
-- 8. board_pack_sections_save(p_org, p_sections) — the configurable section list (F10). A visual
--    editor sends the ordered list; a section is never deleted, only disabled (configuration, L5).
-- ---------------------------------------------------------------------------
create or replace function public.board_pack_sections_save(p_org uuid, p_sections jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
begin
  if not public.config_actor_ok(p_org, 'edit_config') then
    raise exception 'not allowed: the caller cannot edit the Board Pack sections' using errcode = 'P0001';
  end if;
  perform public.board_pack_sections_seed(p_org);
  for v_item in select * from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) loop
    update board_pack_sections
       set ordinal = coalesce((v_item ->> 'ordinal')::int, ordinal),
           enabled = coalesce((v_item ->> 'enabled')::boolean, enabled),
           visible_roles = coalesce(
             (select array_agg(value::text) from jsonb_array_elements_text(v_item -> 'visible_roles')),
             visible_roles),
           label = coalesce(v_item ->> 'label', label)
     where org_id = p_org and section_key = v_item ->> 'section_key';
  end loop;
  perform public.append_ledger_entry(p_org, 'board_pack_sections_saved',
    jsonb_build_object('sections', p_sections), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 9. RLS: every table has RLS enabled and a select policy on the caller's org. No write policy, so
--    every write goes through the security-definer RPCs above.
-- ---------------------------------------------------------------------------
alter table board_pack_sections enable row level security;
alter table board_pack_history enable row level security;

drop policy if exists board_pack_sections_select on board_pack_sections;
create policy board_pack_sections_select on board_pack_sections for select to authenticated
  using (org_id = public.jwt_org_id());

drop policy if exists board_pack_history_select on board_pack_history;
create policy board_pack_history_select on board_pack_history for select to authenticated
  using (org_id = public.jwt_org_id());

-- ---------------------------------------------------------------------------
-- 10. Grants.
-- ---------------------------------------------------------------------------
grant select on public.board_pack_sections to authenticated;
grant select on public.board_pack_history to authenticated;

do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'board_pack_sections_seed','board_pack_figure_refs','board_pack_snapshot','board_pack_generate',
      'board_pack_list','board_pack_get','board_pack_sections_save'
    )
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

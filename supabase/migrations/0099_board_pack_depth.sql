-- 0099: Board Pack depth (F10, S7) — the boundary is applied, and the snapshot gains the two
-- visuals the section list already promised: a SIRA heatmap and a plan Gantt.
--
-- Three defects this closes:
--   1. `board_pack_snapshot` accepted from_ts/to_ts and echoed them but never filtered on them, so a
--      "since the last pack" boundary produced the same numbers as a full pack. The boundary is now
--      applied to every source row (sira_scores, plan_items, caps, workpapers, engagements,
--      report_blocks).
--   2. The section list names "SIRA residual risk and heatmap" but the snapshot carried only a
--      per-band count. It now carries a real two-dimensional heatmap: entity (rows) x band (columns),
--      every cell a figure whose refs are the sira_score rows behind it.
--   3. The section list names "Audit plan progress and Gantt" but the snapshot carried only status
--      counts. It now carries `plan.gantt`: one row per dated plan item with its start, end and
--      status, each a figure pointing at the plan item.
--
-- The figure-refs invariant is unchanged and still enforced by board_pack_figure_refs: every figure
-- whose value is non-zero must carry at least one ref. The heatmap cells and the Gantt rows are
-- built so that a non-zero figure always carries its refs.
--
-- M1: grepped supabase/migrations and supabase/tests for board_pack_snapshot, sira_band_for,
--     plan_items, sira_scores, caps, workpapers, engagements, report_blocks. All exist; only
--     board_pack_snapshot is replaced, with the same signature, volatility, security and grants.
-- M2: create or replace is idempotent, so this file is safe to apply repeatedly.
--
-- Authored by: Qazi Sarmad Ali Mahesar

-- ---------------------------------------------------------------------------
-- 1. board_pack_snapshot, boundary-aware, with the SIRA heatmap and the plan Gantt.
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
  v_heatmap jsonb;
  v_plan jsonb;
  v_gantt jsonb;
  v_cap jsonb;
  v_sealed jsonb;
  v_responses jsonb;
  v_excluded jsonb;
begin
  if not public.has_feature(p_org, 'board_pack') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;

  -- SIRA residual risk by band, with the score rows behind each band as refs. Boundary applied.
  select coalesce(jsonb_agg(fig order by fig ->> 'band'), '[]'::jsonb) into v_sira
    from (
      select jsonb_build_object(
               'band', coalesce(public.sira_band_for(p_org, s.score), 'Unbanded'),
               'value', count(*),
               'refs', jsonb_agg(jsonb_build_object('type', 'sira_score', 'id', s.id))
             ) as fig
        from sira_scores s
       where s.org_id = p_org
         and s.created_at >= v_from and s.created_at <= v_to
       group by coalesce(public.sira_band_for(p_org, s.score), 'Unbanded')
    ) t;

  -- The SIRA heatmap: entity x band. Each non-empty cell is a figure whose refs are its scores.
  select jsonb_build_object(
    'entities', coalesce((
      select jsonb_agg(x.name order by x.name) from (
        select distinct e.name
          from sira_scores s join entities e on e.id = s.entity_id
         where s.org_id = p_org
           and s.created_at >= v_from and s.created_at <= v_to
      ) x), '[]'::jsonb),
    -- The org's configured bands in order, then 'Unbanded' only if a score fell outside every band.
    'bands', (
      select coalesce(jsonb_agg(name order by ord), '[]'::jsonb) from (
        select b.name, b.ordinal as ord from sira_bands b where b.org_id = p_org
        union all
        select 'Unbanded', 2147483647
         where exists (
           select 1 from sira_scores s2
            where s2.org_id = p_org
              and s2.created_at >= v_from and s2.created_at <= v_to
              and public.sira_band_for(p_org, s2.score) is null)
      ) bb),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity', c.ename, 'band', c.bname, 'value', c.cnt, 'refs', c.refs)
             order by c.ename, c.bname)
        from (
          select e.name as ename,
                 coalesce(public.sira_band_for(p_org, s.score), 'Unbanded') as bname,
                 count(*) as cnt,
                 jsonb_agg(jsonb_build_object('type', 'sira_score', 'id', s.id)) as refs
            from sira_scores s join entities e on e.id = s.entity_id
           where s.org_id = p_org
             and s.created_at >= v_from and s.created_at <= v_to
           group by 1, 2
        ) c), '[]'::jsonb)
  ) into v_heatmap;

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
                    and i2.created_at >= v_from and i2.created_at <= v_to
                  group by i2.status
               ) i2
           ), '[]'::jsonb)
         ) into v_plan
    from plan_items i
   where i.org_id = p_org
     and i.created_at >= v_from and i.created_at <= v_to;

  -- The Gantt rows: every plan item that carries a planned start. Each is a figure pointing at the
  -- plan item, so the Gantt bar is a drill-down too. Deterministic order (start, then title).
  select coalesce(jsonb_agg(jsonb_build_object(
           'value', 1,
           'refs', jsonb_build_array(jsonb_build_object('type', 'plan_item', 'id', i.id)),
           'title', i.title,
           'start', to_char(i.planned_start, 'YYYY-MM-DD'),
           'end', to_char(coalesce(i.planned_end, i.planned_start), 'YYYY-MM-DD'),
           'status', i.status) order by i.planned_start, i.title), '[]'::jsonb) into v_gantt
    from plan_items i
   where i.org_id = p_org
     and i.planned_start is not null
     and i.created_at >= v_from and i.created_at <= v_to;

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
         and c.created_at >= v_from and c.created_at <= v_to
       group by 1
    ) t;
  v_cap := coalesce(v_cap, '{}'::jsonb);

  -- Sealed work and integrity: signed-off workpapers and sealed engagements, with root hashes.
  select jsonb_build_object(
           'value', count(*),
           'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'workpaper', 'id', w.id)), '[]'::jsonb)
         ) into v_sealed
    from workpapers w
   where w.org_id = p_org and w.status = 'signed_off'
     and w.created_at >= v_from and w.created_at <= v_to;
  v_sealed := coalesce(v_sealed, jsonb_build_object('value', 0, 'refs', '[]'::jsonb));
  v_sealed := v_sealed || jsonb_build_object(
    'sealed_engagements', coalesce((
      select jsonb_build_object(
               'value', count(*),
               'refs', coalesce(jsonb_agg(jsonb_build_object('type', 'engagement', 'id', e.id)), '[]'::jsonb))
        from engagements e
       where e.org_id = p_org and e.sealed
         and e.created_at >= v_from and e.created_at <= v_to), jsonb_build_object('value', 0, 'refs', '[]'::jsonb)),
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
   where b.org_id = p_org and b.section_type = 'management_response'
     and b.created_at >= v_from and b.created_at <= v_to;
  v_responses := coalesce(v_responses, jsonb_build_object('value', 0, 'refs', '[]'::jsonb));

  -- The honest footnote: how many items are NOT yet sealed, so they are not counted above.
  select jsonb_build_object(
           'unsealed_workpapers', (
             select count(*) from workpapers w2
              where w2.org_id = p_org and w2.status <> 'signed_off'
                and w2.created_at >= v_from and w2.created_at <= v_to),
           'unsealed_engagements', (
             select count(*) from engagements e3
              where e3.org_id = p_org and not e3.sealed
                and e3.created_at >= v_from and e3.created_at <= v_to),
           'note', 'Items not yet sealed are not included.'
         ) into v_excluded;

  return jsonb_build_object(
    'scope_key', p_scope_key,
    'org_id', p_org,
    'from_ts', v_from,
    'to_ts', v_to,
    'sira', jsonb_build_object('bands', v_sira, 'heatmap', v_heatmap),
    'plan', v_plan || jsonb_build_object('gantt', v_gantt),
    'cap', v_cap,
    'sealed_work', v_sealed,
    'management_responses', v_responses,
    'excluded', v_excluded
  );
end $$;

-- Grants: unchanged from 0065 (the same signature is replaced, so the existing grants still apply;
-- this is stated rather than repeated, and the revoke below keeps anon out for the avoidance of
-- doubt on a fresh database).
revoke execute on function public.board_pack_snapshot(uuid, text, timestamptz, timestamptz) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. board_pack_sections_save already accepts a per-section `label`, so the Org Admin can rename a
--    section without a code change. Nothing to add; the capability is exercised by test 105.
-- ---------------------------------------------------------------------------

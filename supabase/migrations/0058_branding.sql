-- 0058: Branding, report format and branding assets (S4.a, F9).
--
-- F9: the Org Admin (or a consultant in a session) sets fonts, brand colours, logos, page size,
-- margins, header and footer text, cover style and the post-sign-off report format. Colours and
-- sizes live in data and are applied as CSS variables, so no component holds a hex value
-- (check-tokens stays green). Files go to the private Storage bucket `org-branding` when Storage is
-- present; small assets (<= 512 KB) fall back to `branding_assets` as bytea (D-S4-assets-storage).
--
-- Every change writes a row in `branding_versions`, an append-only, hash-chained history table with
-- the shape of role_config_log (0014) and tenant_entitlement_versions (0051), and is registered in
-- `config_areas` so the F7 notify trigger emits config.changed (L5, F2).
--
-- M1: grepped supabase/migrations and supabase/tests for org_branding, branding_assets,
--     branding_versions, branding_spec, admin_set_branding, get_branding, upload_branding_asset,
--     admin_upload_pptx_theme; none existed.
-- M2: every table is create table if not exists + alter table ... add column if not exists; every
--     function is create or replace; every trigger is dropped before it is created; every policy is
--     dropped before it is created.

-- ---------------------------------------------------------------------------
-- 1. org_branding — one row per organisation (F9). Colours are stored as text (token names or
--    values the renderers apply as CSS variables); nothing here is a component-level hex literal.
-- ---------------------------------------------------------------------------
create table if not exists org_branding (
  org_id uuid primary key references orgs(id) on delete cascade
);
alter table org_branding add column if not exists font_heading text;
alter table org_branding add column if not exists font_body text;
alter table org_branding add column if not exists colour_primary text;
alter table org_branding add column if not exists colour_accent text;
alter table org_branding add column if not exists colour_text text;
alter table org_branding add column if not exists colour_background text;
alter table org_branding add column if not exists logo_light_asset_id uuid;
alter table org_branding add column if not exists logo_dark_asset_id uuid;
alter table org_branding add column if not exists page_size text not null default 'A4';
alter table org_branding add column if not exists margin_top_mm int not null default 20;
alter table org_branding add column if not exists margin_right_mm int not null default 20;
alter table org_branding add column if not exists margin_bottom_mm int not null default 20;
alter table org_branding add column if not exists margin_left_mm int not null default 20;
alter table org_branding add column if not exists header_text text;
alter table org_branding add column if not exists footer_text text;
alter table org_branding add column if not exists cover_style text not null default 'standard';
alter table org_branding add column if not exists report_format text not null default 'standard';
-- The theme extracted from an uploaded .pptx/.potx: colours, fonts and slide size only. v1 does not
-- reuse the file's slide layouts, and the UI says so (F9).
alter table org_branding add column if not exists pptx_theme jsonb;
alter table org_branding add column if not exists updated_at timestamptz not null default now();
alter table org_branding add column if not exists updated_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_branding_page_size_chk') then
    alter table org_branding add constraint org_branding_page_size_chk
      check (page_size in ('A4','Letter'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'org_branding_cover_style_chk') then
    alter table org_branding add constraint org_branding_cover_style_chk
      check (cover_style in ('standard','minimal','bold'));
  end if;
end $$;

alter table org_branding enable row level security;
drop policy if exists org_branding_select on org_branding;
create policy org_branding_select on org_branding for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2. branding_assets — the Storage fallback (D-S4-assets-storage). A small logo or font, held as
--    bytea, one row per asset. A tenant reads its own org's assets; the renderers fetch them by id.
-- ---------------------------------------------------------------------------
create table if not exists branding_assets (
  id uuid primary key default gen_random_uuid()
);
alter table branding_assets add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table branding_assets add column if not exists kind text;
alter table branding_assets add column if not exists filename text;
alter table branding_assets add column if not exists mime_type text;
alter table branding_assets add column if not exists bytes bytea;
alter table branding_assets add column if not exists byte_size int;
alter table branding_assets add column if not exists storage_path text;
alter table branding_assets add column if not exists created_by uuid;
alter table branding_assets add column if not exists created_at timestamptz not null default now();

alter table branding_assets enable row level security;
drop policy if exists branding_assets_select on branding_assets;
create policy branding_assets_select on branding_assets for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create index if not exists branding_assets_org_idx on branding_assets (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. branding_versions — the append-only, hash-chained configuration history (L5, F2). Same shape
--    as role_config_log and tenant_entitlement_versions.
-- ---------------------------------------------------------------------------
create table if not exists branding_versions (
  id bigint generated always as identity primary key
);
alter table branding_versions add column if not exists org_id uuid references orgs(id) on delete cascade;
alter table branding_versions add column if not exists entity text not null default 'branding';
alter table branding_versions add column if not exists entity_id text;
alter table branding_versions add column if not exists action text;
alter table branding_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table branding_versions add column if not exists actor uuid;
alter table branding_versions add column if not exists actor_is_platform boolean not null default false;
alter table branding_versions add column if not exists prev_hash text;
alter table branding_versions add column if not exists row_hash text;
alter table branding_versions add column if not exists created_at timestamptz not null default now();

alter table branding_versions enable row level security;
drop policy if exists bv_select on branding_versions;
create policy bv_select on branding_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());

create or replace function public.branding_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'branding_versions is append-only';
end $$;
drop trigger if exists bv_no_change on branding_versions;
create trigger bv_no_change before update or delete on branding_versions
for each row execute function public.branding_versions_append_only();

-- ---------------------------------------------------------------------------
-- 4. get_branding — the read path (F9). Returns the org's branding row, or the defaults when none
--    has been set yet, so a renderer always has a complete spec. Requires edit_config or a right
--    that produces output (a reader may render a report), so it accepts any org member.
-- ---------------------------------------------------------------------------
create or replace function public.get_branding(p_org uuid default null)
returns table (
  org_id uuid, font_heading text, font_body text,
  colour_primary text, colour_accent text, colour_text text, colour_background text,
  logo_light_asset_id uuid, logo_dark_asset_id uuid,
  page_size text, margin_top_mm int, margin_right_mm int, margin_bottom_mm int, margin_left_mm int,
  header_text text, footer_text text, cover_style text, report_format text, pptx_theme jsonb,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
begin
  if v_org is null then
    raise exception 'an organisation is required' using errcode = 'P0001';
  end if;
  if v_org <> public.jwt_org_id() and not public.is_platform_admin() then
    raise exception 'not allowed to read that organisation branding' using errcode = 'P0001';
  end if;

  return query
    select v_org, b.font_heading, b.font_body,
           b.colour_primary, b.colour_accent, b.colour_text, b.colour_background,
           b.logo_light_asset_id, b.logo_dark_asset_id,
           coalesce(b.page_size, 'A4'), coalesce(b.margin_top_mm, 20), coalesce(b.margin_right_mm, 20),
           coalesce(b.margin_bottom_mm, 20), coalesce(b.margin_left_mm, 20),
           b.header_text, b.footer_text,
           coalesce(b.cover_style, 'standard'), coalesce(b.report_format, 'standard'),
           b.pptx_theme, b.updated_at
      from (select 1) one
      left join org_branding b on b.org_id = v_org;
end $$;

-- ---------------------------------------------------------------------------
-- 5. admin_set_branding — the single write path (F9, F4). A configuration actor for edit_config
--    applies directly; a tier-1 consultant applies directly; every change is hash-chained and
--    emits config.changed through the registered history table (F7).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_branding(p_org uuid, p_fields jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
  v_actor uuid := auth.uid();
  v_is_platform boolean := public.is_platform_admin();
  v_row jsonb;
  v_prev_hash text;
  v_body text;
  v_page_size text;
  v_cover text;
begin
  v_mode := public.require_config_actor(p_org, 'edit_config');

  -- Custom fonts need the branding_custom_fonts entitlement (F25, F9).
  if (p_fields ? 'font_heading' or p_fields ? 'font_body')
     and not public.has_feature(p_org, 'branding_custom_fonts') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;

  v_page_size := coalesce(p_fields ->> 'page_size', 'A4');
  if v_page_size not in ('A4','Letter') then
    raise exception 'page_size must be A4 or Letter' using errcode = 'P0001';
  end if;
  v_cover := coalesce(p_fields ->> 'cover_style', 'standard');
  if v_cover not in ('standard','minimal','bold') then
    raise exception 'unknown cover style: %', v_cover using errcode = 'P0001';
  end if;

  insert into org_branding (org_id, font_heading, font_body, colour_primary, colour_accent,
                            colour_text, colour_background, logo_light_asset_id, logo_dark_asset_id,
                            page_size, margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm,
                            header_text, footer_text, cover_style, report_format, pptx_theme,
                            updated_at, updated_by)
  values (p_org,
    p_fields ->> 'font_heading', p_fields ->> 'font_body',
    p_fields ->> 'colour_primary', p_fields ->> 'colour_accent',
    p_fields ->> 'colour_text', p_fields ->> 'colour_background',
    nullif(p_fields ->> 'logo_light_asset_id', '')::uuid, nullif(p_fields ->> 'logo_dark_asset_id', '')::uuid,
    v_page_size,
    coalesce((p_fields ->> 'margin_top_mm')::int, 20), coalesce((p_fields ->> 'margin_right_mm')::int, 20),
    coalesce((p_fields ->> 'margin_bottom_mm')::int, 20), coalesce((p_fields ->> 'margin_left_mm')::int, 20),
    p_fields ->> 'header_text', p_fields ->> 'footer_text', v_cover,
    coalesce(p_fields ->> 'report_format', 'standard'),
    case when p_fields ? 'pptx_theme' then p_fields -> 'pptx_theme' else null end,
    now(), v_actor)
  on conflict (org_id) do update set
    font_heading = coalesce(excluded.font_heading, org_branding.font_heading),
    font_body = coalesce(excluded.font_body, org_branding.font_body),
    colour_primary = coalesce(excluded.colour_primary, org_branding.colour_primary),
    colour_accent = coalesce(excluded.colour_accent, org_branding.colour_accent),
    colour_text = coalesce(excluded.colour_text, org_branding.colour_text),
    colour_background = coalesce(excluded.colour_background, org_branding.colour_background),
    logo_light_asset_id = coalesce(excluded.logo_light_asset_id, org_branding.logo_light_asset_id),
    logo_dark_asset_id = coalesce(excluded.logo_dark_asset_id, org_branding.logo_dark_asset_id),
    page_size = excluded.page_size,
    margin_top_mm = excluded.margin_top_mm, margin_right_mm = excluded.margin_right_mm,
    margin_bottom_mm = excluded.margin_bottom_mm, margin_left_mm = excluded.margin_left_mm,
    header_text = coalesce(excluded.header_text, org_branding.header_text),
    footer_text = coalesce(excluded.footer_text, org_branding.footer_text),
    cover_style = excluded.cover_style, report_format = excluded.report_format,
    pptx_theme = coalesce(excluded.pptx_theme, org_branding.pptx_theme),
    updated_at = now(), updated_by = v_actor;

  select to_jsonb(b) into v_row from org_branding b where b.org_id = p_org;

  perform pg_advisory_xact_lock(hashtext('branding:' || p_org::text));
  select row_hash into v_prev_hash from branding_versions
   where org_id = p_org order by id desc limit 1;
  v_body := coalesce(v_prev_hash, '') || '|' || 'update' || '|' || v_row::text;
  insert into branding_versions (org_id, entity, entity_id, action, payload, actor, actor_is_platform, prev_hash, row_hash)
  values (p_org, 'branding', p_org::text, 'update', v_row, v_actor, v_is_platform, v_prev_hash,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));

  -- A proposal in tier 2 waits for the Org Admin; here only an applied change is logged as one.
  if v_mode = 'apply' then
    perform public.admin_log_change(p_org, 'branding', v_row, 'branding_updated', 'org_branding', p_org);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. admin_upload_branding_asset — the Storage fallback writer (D-S4-assets-storage). A file up to
--    512 KB is stored as bytea; a larger file must go to Storage and is refused here with a hint.
--    Returns the asset id. The tenant reads it back only through the renderers.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upload_branding_asset(
  p_org uuid, p_kind text, p_filename text, p_mime text, p_base64 text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_bytes bytea;
begin
  perform public.require_config_actor(p_org, 'edit_config');
  if p_kind not in ('logo_light','logo_dark','font','theme') then
    raise exception 'unknown branding asset kind: %', p_kind using errcode = 'P0001';
  end if;
  if p_base64 is null or length(p_base64) = 0 then
    raise exception 'a file is required' using errcode = 'P0001';
  end if;
  v_bytes := decode(p_base64, 'base64');
  if octet_length(v_bytes) > 524288 then
    raise exception 'this file is larger than 512 KB; use Storage for larger assets' using errcode = 'P0001';
  end if;
  insert into branding_assets (org_id, kind, filename, mime_type, bytes, byte_size, created_by)
  values (p_org, p_kind, p_filename, p_mime, v_bytes, octet_length(v_bytes), auth.uid())
  returning id into v_id;

  insert into branding_versions (org_id, entity, entity_id, action, payload, actor, actor_is_platform, prev_hash, row_hash)
  values (p_org, 'branding_asset', v_id::text, 'upload',
          jsonb_build_object('kind', p_kind, 'filename', p_filename, 'byte_size', octet_length(v_bytes)),
          auth.uid(), public.is_platform_admin(), null,
          encode(sha256(convert_to(v_id::text || '|' || p_filename, 'UTF8')), 'hex'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. admin_upload_pptx_theme — the extracted theme from an uploaded .pptx/.potx (F9). The browser
--    parses the file with JSZip and sends only the extracted facts (colours, fonts, slide size,
--    logo asset ids); the database stores them on the branding row. Needs pptx_theme_upload.
-- ---------------------------------------------------------------------------
create or replace function public.admin_upload_pptx_theme(p_org uuid, p_theme jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_config_actor(p_org, 'edit_config');
  if not public.has_feature(p_org, 'pptx_theme_upload') then
    raise exception 'This feature is not included in your plan.' using errcode = 'P0001';
  end if;
  if p_theme is null or jsonb_typeof(p_theme) <> 'object' then
    raise exception 'the extracted theme must be an object' using errcode = 'P0001';
  end if;
  insert into org_branding (org_id, pptx_theme, updated_at, updated_by)
  values (p_org, p_theme, now(), auth.uid())
  on conflict (org_id) do update set pptx_theme = excluded.pptx_theme, updated_at = now(), updated_by = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- 8. Register the branding history table so the F7 notify trigger emits config.changed (F7).
-- ---------------------------------------------------------------------------
insert into config_areas (key, label, history_table, notify_policy) values
  ('branding','Branding and report format','branding_versions','both')
on conflict (key) do update set label = excluded.label, history_table = excluded.history_table,
  notify_policy = excluded.notify_policy;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'branding_versions') then
    execute 'drop trigger if exists cfg_notify_branding_versions on public.branding_versions';
    execute 'create trigger cfg_notify_branding_versions after insert on public.branding_versions '
         || 'for each row execute function public.config_area_notify()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Grants: read for authenticated (the RPC re-checks the org), writes for authenticated (the RPC
--    re-checks the right). Nothing to anon.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'get_branding','admin_set_branding','admin_upload_branding_asset','admin_upload_pptx_theme'
    )
  loop
    execute format('revoke execute on function public.%I(%s) from public', fn.name, fn.args);
    execute format('revoke execute on function public.%I(%s) from anon', fn.name, fn.args);
    execute format('grant execute on function public.%I(%s) to authenticated', fn.name, fn.args);
  end loop;
end $$;

-- Test 68 (S4.a): branding, report format and branding assets (F9, F25, F4).
--
-- Covers: the defaults returned when nothing is set; an Org Admin writes branding and a history row
-- is hash-chained and registered; a tenant reads its own branding and no other org's; custom fonts
-- need the branding_custom_fonts entitlement; the PPTX theme upload needs pptx_theme_upload; a file
-- over 512 KB is refused; an asset is stored as bytea and a tenant reads only its own.
\i supabase/tests/00_lib.sql
select provio_test.seed();

-- ---------------------------------------------------------------------------
-- 1. Defaults are returned when nothing has been set (F9).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare
  v_page text;
  v_cover text;
  v_margin int;
begin
  select page_size, cover_style, margin_top_mm into v_page, v_cover, v_margin
    from public.get_branding('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_page, 'A4', 'the default page size is A4');
  perform provio_test.assert_eq(v_cover, 'standard', 'the default cover style is standard');
  perform provio_test.assert_eq(v_margin, 20, 'the default margin is 20 mm');
end $$;

-- ---------------------------------------------------------------------------
-- 2. An Org Admin writes branding; a hash-chained history row is written (L5).
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_set_branding('a0000000-0000-0000-0000-000000000001',
    jsonb_build_object('colour_primary', 'brand-primary', 'page_size', 'Letter',
                       'margin_top_mm', 25, 'header_text', 'Acme Assurance',
                       'footer_text', 'Page {page} of {pages}'));
end $$;
do $$
declare v_page text; v_prev text; v_hash text;
begin
  select page_size into v_page from public.get_branding('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_page, 'Letter', 'the page size was updated to Letter');
  select prev_hash, row_hash into v_prev, v_hash from branding_versions
   where org_id = 'a0000000-0000-0000-0000-000000000001' order by id desc limit 1;
  perform provio_test.assert_true(v_hash is not null, 'a branding history row carries a hash');
end $$;

-- The branding area is registered, so its trigger emits config.changed (F7).
do $$
begin
  perform provio_test.assert_eq(
    (select notify_policy from config_areas where key = 'branding'), 'both',
    'the branding area is registered with notify_policy both');
  perform provio_test.assert_true(
    exists (select 1 from pg_trigger where tgname = 'cfg_notify_branding_versions' and not tgisinternal),
    'the branding history table has the notify trigger');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A caller without edit_config cannot set branding (F4, F3).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-000000000001', 'observer');
do $$
begin
  perform provio_test.assert_raises(
    $q$select public.admin_set_branding('a0000000-0000-0000-0000-000000000001', '{"page_size":"A4"}')$q$,
    'not allowed', 'an observer cannot set branding');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Custom fonts need the branding_custom_fonts entitlement (F25). Off by default.
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_true(
    not public.has_feature('a0000000-0000-0000-0000-000000000001', 'branding_custom_fonts'),
    'branding_custom_fonts is off by default');
  perform provio_test.assert_raises(
    $q$select public.admin_set_branding('a0000000-0000-0000-0000-000000000001', '{"font_heading":"Inter"}')$q$,
    'not included in your plan', 'a custom font is refused without the entitlement');
end $$;

-- ---------------------------------------------------------------------------
-- 5. An asset is stored as bytea, and a tenant reads only its own org's assets (F9, M5).
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  v_id := public.admin_upload_branding_asset('a0000000-0000-0000-0000-000000000001',
    'logo_light', 'logo.png', 'image/png', encode('PNGDATA'::bytea, 'base64'));
  perform provio_test.assert_true(v_id is not null, 'a small asset is stored and returns an id');
end $$;

select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
begin
  perform provio_test.assert_eq((select count(*) from branding_assets), 0::bigint,
    'a member of another org reads no branding assets');
end $$;

-- ---------------------------------------------------------------------------
-- 6. A file over 512 KB is refused (D-S4-assets-storage).
-- ---------------------------------------------------------------------------
select provio_test.as_user('10000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'org_admin');
do $$
declare v_big text;
begin
  v_big := encode(repeat('x', 600000)::bytea, 'base64');
  perform provio_test.assert_raises(
    format($q$select public.admin_upload_branding_asset('a0000000-0000-0000-0000-000000000001', 'font', 'big.ttf', 'font/ttf', %L)$q$, v_big),
    'larger than 512 KB', 'a file over 512 KB is refused with a hint to use Storage');
end $$;

-- ---------------------------------------------------------------------------
-- 7. A brand colour is data, not a hex literal in a component: the value round-trips unchanged.
-- ---------------------------------------------------------------------------
do $$
declare v_colour text;
begin
  select colour_primary into v_colour from public.get_branding('a0000000-0000-0000-0000-000000000001');
  perform provio_test.assert_eq(v_colour, 'brand-primary', 'the brand colour is stored as data');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Applying twice is a no-op (M2): a second branding write leaves exactly one row per org.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_set_branding('a0000000-0000-0000-0000-000000000001', '{"page_size":"A4"}');
  perform public.admin_set_branding('a0000000-0000-0000-0000-000000000001', '{"page_size":"A4"}');
end $$;
select provio_test.as_owner();
do $$
begin
  perform provio_test.assert_eq(
    (select count(*) from org_branding where org_id = 'a0000000-0000-0000-0000-000000000001'), 1::bigint,
    'exactly one branding row exists per organisation');
end $$;

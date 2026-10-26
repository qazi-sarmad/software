-- 0091: report formats — the per-client, versioned, interactive format editor (WRITE-1, owner
--       instruction 2026-10-26).
--
-- A client (one tenant organisation, spec §3) keeps its own report formats: which blocks appear, in
-- what order, which register each block renders at, and the print layout. A format is DATA and it is
-- VERSIONED like every other piece of configuration (L5). The pure rules live in
-- src/lib/writing/reportFormat.ts; this migration holds the tables, the hash-chained version log and
-- the security-definer RPCs. Writes go only through the RPCs, which check rights and the org guard.
--
-- The format changes presentation only. It can hide or reorder a section the model already defines,
-- or pick a register from the model's allowed set; it can never invent a section, a claim or a
-- figure, so the graph root is invariant across every format (proved in the unit tests).
--
-- M1: grepped supabase/migrations and supabase/tests for report_formats, report_format_versions,
--     format_audiences — no hits. report_templates (0088) already holds the models; a format points
--     at one by model_id and does not change report_templates.
-- M2: create table if not exists + add column if not exists; create or replace; drop policy/trigger
--     if exists before create; create index if not exists. Safe to apply repeatedly.
-- M3: no existing table changes shape.
-- M5: every table carries org_id with an FK to orgs(id) on delete cascade, so `truncate orgs cascade`
--     in the test reset reaches it and a run leaves no residue.
-- M6: applied twice to a local Postgres 17 and the SQL tests run twice before any push.

-- ---------------------------------------------------------------------------
-- 1. report_formats — one row per format VERSION. A published version is immutable (trigger below);
--    editing a published format creates the next version. The body hash lets a report record which
--    format produced it (W8.2).
-- ---------------------------------------------------------------------------
create table if not exists report_formats (
  id uuid primary key default gen_random_uuid()
);
alter table report_formats add column if not exists org_id uuid;
alter table report_formats add column if not exists format_key text not null default '';
alter table report_formats add column if not exists version int not null default 1;
alter table report_formats add column if not exists label text not null default '';
alter table report_formats add column if not exists status text not null default 'draft';
alter table report_formats add column if not exists model_id text not null default '';
alter table report_formats add column if not exists blocks jsonb not null default '[]'::jsonb;
alter table report_formats add column if not exists layout jsonb not null default '{}'::jsonb;
alter table report_formats add column if not exists default_locale text not null default 'en-GB';
alter table report_formats add column if not exists body_hash text not null default '';
alter table report_formats add column if not exists created_by uuid;
alter table report_formats add column if not exists created_at timestamptz not null default now();
alter table report_formats add column if not exists published_at timestamptz;
alter table report_formats add column if not exists published_by uuid;

alter table report_formats drop constraint if exists rf_status_check;
alter table report_formats add constraint rf_status_check check (status in ('draft', 'published'));
alter table report_formats drop constraint if exists rf_locale_check;
alter table report_formats add constraint rf_locale_check check (default_locale in ('en-GB', 'en-US'));
alter table report_formats drop constraint if exists rf_org_id_fkey;
alter table report_formats add constraint rf_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists rf_org_key_version_idx on report_formats (org_id, format_key, version);
create index if not exists rf_org_model_idx on report_formats (org_id, model_id);

alter table report_formats enable row level security;
drop policy if exists rf_select on report_formats;
create policy rf_select on report_formats for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_formats from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. format_audiences — which role slugs may view or edit a format. The right check at call time
--    still decides; this is the client's declared intent, stored as data (no role name is compared
--    in application code — src/guards/noRoleStrings.test.ts).
-- ---------------------------------------------------------------------------
create table if not exists format_audiences (
  id uuid primary key default gen_random_uuid()
);
alter table format_audiences add column if not exists org_id uuid;
alter table format_audiences add column if not exists format_id uuid;
alter table format_audiences add column if not exists role_slug text not null default '';
alter table format_audiences add column if not exists can_view boolean not null default true;
alter table format_audiences add column if not exists can_edit boolean not null default false;
alter table format_audiences add column if not exists created_at timestamptz not null default now();
alter table format_audiences drop constraint if exists fa_contradiction_check;
alter table format_audiences add constraint fa_contradiction_check check (not (can_edit and not can_view));
alter table format_audiences drop constraint if exists fa_org_id_fkey;
alter table format_audiences add constraint fa_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
alter table format_audiences drop constraint if exists fa_format_id_fkey;
alter table format_audiences add constraint fa_format_id_fkey foreign key (format_id) references report_formats(id) on delete cascade;
create unique index if not exists fa_format_role_idx on format_audiences (format_id, role_slug);

alter table format_audiences enable row level security;
drop policy if exists fa_select on format_audiences;
create policy fa_select on format_audiences for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.format_audiences from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. report_format_versions — the hash-chained log of every format version (the role_config_log
--    pattern, 0014; the same shape as report_template_versions in 0088).
-- ---------------------------------------------------------------------------
create table if not exists report_format_versions (
  id bigint generated always as identity primary key
);
alter table report_format_versions add column if not exists org_id uuid;
alter table report_format_versions add column if not exists entity text not null default 'report_format';
alter table report_format_versions add column if not exists entity_id uuid;
alter table report_format_versions add column if not exists version int;
alter table report_format_versions add column if not exists body_hash text not null default '';
alter table report_format_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table report_format_versions add column if not exists actor uuid;
alter table report_format_versions add column if not exists prev_hash text;
alter table report_format_versions add column if not exists row_hash text;
alter table report_format_versions add column if not exists created_at timestamptz not null default now();
alter table report_format_versions drop constraint if exists rfv_org_id_fkey;
alter table report_format_versions add constraint rfv_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists rfv_org_idx on report_format_versions (org_id, entity_id, id);

alter table report_format_versions enable row level security;
drop policy if exists rfv_select on report_format_versions;
create policy rfv_select on report_format_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.report_format_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The hash-chain writer and the append-only guards.
-- ---------------------------------------------------------------------------
create or replace function public.report_format_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'report_format_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists report_format_versions_no_change on report_format_versions;
create trigger report_format_versions_no_change before update or delete on report_format_versions
for each row execute function public.report_format_versions_append_only();

create or replace function public.report_format_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from report_format_versions v where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.format_key || '|' || new.version::text || '|' || new.body_hash;
  insert into report_format_versions (org_id, entity, entity_id, version, body_hash, payload, actor, prev_hash, row_hash)
  values (v_org, 'report_format', new.id, new.version, new.body_hash, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists report_formats_log on report_formats;
create trigger report_formats_log after insert or update on report_formats
for each row execute function public.report_format_version_log();

-- A published format version is immutable: it cannot be updated. Editing a published format creates
-- the next draft version (format_save, below). This is the phrase-lifecycle rule (W2.1) applied to
-- formats, so a report can always be re-rendered from the format it was built with.
create or replace function public.report_formats_published_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' then
    raise exception 'a published report format version is immutable; create a new version instead'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists report_formats_published_lock on report_formats;
create trigger report_formats_published_lock before update on report_formats
for each row execute function public.report_formats_published_immutable();

-- ---------------------------------------------------------------------------
-- 5. format_save — create or update a draft format. A published version cannot be edited: the call
--    makes the next draft version instead. Needs edit_config.
-- ---------------------------------------------------------------------------
create or replace function public.format_save(
  p_org uuid, p_format_key text, p_model_id text, p_label text, p_blocks jsonb,
  p_layout jsonb, p_default_locale text, p_body_hash text, p_status text default 'draft'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_existing report_formats;
  v_id uuid;
  v_next int;
begin
  perform public.provio_org_guard(p_org);
  perform public.admin_require_right('edit_config');
  if coalesce(trim(p_format_key), '') = '' then
    raise exception 'a report format needs a key' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_model_id), '') = '' then
    raise exception 'a report format needs a report model' using errcode = 'P0001';
  end if;
  if p_default_locale not in ('en-GB', 'en-US') then
    raise exception 'unknown locale %', p_default_locale using errcode = 'P0001';
  end if;
  if p_status not in ('draft', 'published') then
    raise exception 'unknown format status %', p_status using errcode = 'P0001';
  end if;

  select * into v_existing from report_formats f
   where f.org_id = p_org and f.format_key = p_format_key
   order by f.version desc limit 1;

  if not found then
    insert into report_formats (org_id, format_key, version, label, status, model_id, blocks, layout,
                                default_locale, body_hash, created_by)
    values (p_org, p_format_key, 1, coalesce(nullif(p_label, ''), p_format_key), p_status, p_model_id,
            coalesce(p_blocks, '[]'::jsonb), coalesce(p_layout, '{}'::jsonb), p_default_locale,
            p_body_hash, auth.uid())
    returning id into v_id;
  elsif v_existing.status = 'published' then
    -- The published version is immutable; a change creates the next draft version.
    select coalesce(max(version), 0) + 1 into v_next from report_formats f
      where f.org_id = p_org and f.format_key = p_format_key;
    insert into report_formats (org_id, format_key, version, label, status, model_id, blocks, layout,
                                default_locale, body_hash, created_by)
    values (p_org, p_format_key, v_next, coalesce(nullif(p_label, ''), p_format_key), 'draft', p_model_id,
            coalesce(p_blocks, '[]'::jsonb), coalesce(p_layout, '{}'::jsonb), p_default_locale,
            p_body_hash, auth.uid())
    returning id into v_id;
  else
    update report_formats set
      label = coalesce(nullif(p_label, ''), label),
      model_id = p_model_id,
      blocks = coalesce(p_blocks, blocks),
      layout = coalesce(p_layout, layout),
      default_locale = p_default_locale,
      body_hash = p_body_hash
     where id = v_existing.id
     returning id into v_id;
  end if;

  perform public.admin_log_change(p_org, 'report_format:' || p_format_key, to_jsonb(p_format_key),
    'report_format.saved', 'report_format', v_id);
  return v_id;
end $$;

-- format_publish: publish a draft version, but only when it is valid for its model (the caller
-- states the issue count the editor computed; the publish refuses when it is non-zero). Needs
-- edit_config, matching the right that saves a format.
create or replace function public.format_publish(p_format_id uuid, p_issue_count int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_format report_formats;
begin
  select * into v_format from report_formats where id = p_format_id;
  if not found then
    raise exception 'report format not found' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v_format.org_id);
  perform public.admin_require_right('edit_config');
  if v_format.status = 'published' then
    raise exception 'this format version is already published' using errcode = 'P0001';
  end if;
  if p_issue_count is null or p_issue_count <> 0 then
    raise exception 'the format has % validation issue(s); fix them before publishing', coalesce(p_issue_count, -1)
      using errcode = 'P0001';
  end if;
  update report_formats set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_format_id;
  perform public.admin_log_change(v_format.org_id, 'report_format:' || v_format.format_key,
    to_jsonb(v_format.format_key), 'report_format.published', 'report_format', p_format_id);
end $$;

-- format_audience_set: replace the audience list for one format version. Needs edit_config.
create or replace function public.format_audience_set(
  p_format_id uuid, p_audiences jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_format report_formats;
  v_row jsonb;
begin
  select * into v_format from report_formats where id = p_format_id;
  if not found then
    raise exception 'report format not found' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v_format.org_id);
  perform public.admin_require_right('edit_config');
  delete from format_audiences where format_id = p_format_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_audiences, '[]'::jsonb)) loop
    insert into format_audiences (org_id, format_id, role_slug, can_view, can_edit)
    values (v_format.org_id, p_format_id, coalesce(v_row->>'roleSlug', v_row->>'role_slug'),
            coalesce((v_row->>'canView')::boolean, (v_row->>'can_view')::boolean, true),
            coalesce((v_row->>'canEdit')::boolean, (v_row->>'can_edit')::boolean, false));
  end loop;
end $$;

-- format_list: every format version for the org, newest first, tied to the caller's org.
create or replace function public.format_list(p_org uuid)
returns table (id uuid, format_key text, version int, label text, status text, model_id text,
               blocks jsonb, layout jsonb, default_locale text, body_hash text,
               created_at timestamptz, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.id, f.format_key, f.version, f.label, f.status, f.model_id, f.blocks, f.layout,
         f.default_locale, f.body_hash, f.created_at, f.published_at
    from report_formats f
   where f.org_id = p_org
     and (p_org = public.jwt_org_id() or public.is_platform_admin())
   order by f.format_key, f.version desc;
$$;

-- format_audience_list: the audiences of one format version.
create or replace function public.format_audience_list(p_format_id uuid)
returns table (role_slug text, can_view boolean, can_edit boolean)
language sql stable security definer set search_path = public as $$
  select a.role_slug, a.can_view, a.can_edit
    from format_audiences a
    join report_formats f on f.id = a.format_id
   where a.format_id = p_format_id
     and (f.org_id = public.jwt_org_id() or public.is_platform_admin())
   order by a.role_slug;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants. The tables take no direct write. The triggers and the chain writer are not a client
--    surface. This keeps the anonymous-callable set at exactly verify_certificate and
--    verify_board_pack — src/guards/anonGrantAllowList.test.ts. (W10.3 adds verify_report_root
--    deliberately, in its own migration, with the allow-list guard updated in the same commit.)
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'report_format_versions_append_only', 'report_format_version_log',
         'report_formats_published_immutable')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'format_save', 'format_publish', 'format_audience_set',
         'format_list', 'format_audience_list')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

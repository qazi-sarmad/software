-- 0089: the phrase library and the review workbook (WRITE-1, W2).
--
-- The spec (§15.6) names `phrases` and `report_terminology`; 0088 created report_terminology. This
-- migration creates the phrase library, its hash-chained version log, the per-cell review status the
-- review workbook writes (W2.9), and the RPCs that write them. A released phrase is immutable: the
-- append-only guard refuses an update to a released row, so a change must create a version.
--
-- M1: grepped supabase/migrations and supabase/tests for phrases, phrase_versions, phrase_reviews,
--     phrase_version_log — no hits. report_terminology exists (0088) and is extended here with the
--     review columns, not recreated.
-- M2: create table if not exists + add column if not exists; create or replace; drop policy/trigger
--     if exists before create; insert ... on conflict do update for seeds.
-- M3: report_terminology keeps its shape; the review columns are additive and nullable.
-- M5: every table carries org_id with an FK to orgs(id) on delete cascade, so `truncate orgs cascade`
--     in the test reset reaches it and a run leaves no residue.

-- ---------------------------------------------------------------------------
-- 1. phrases — one row per phrase variant (id, version, register, locale). The condition is data:
--    a structured predicate, never code. Released rows are immutable (trigger below).
-- ---------------------------------------------------------------------------
create table if not exists phrases (
  id uuid primary key default gen_random_uuid()
);
alter table phrases add column if not exists org_id uuid;
alter table phrases add column if not exists phrase_id text;
alter table phrases add column if not exists version int not null default 1;
alter table phrases add column if not exists template text not null default '';
alter table phrases add column if not exists condition jsonb not null default '{"all":[]}'::jsonb;
alter table phrases add column if not exists claim_level text not null default 'calculated';
alter table phrases add column if not exists model_scope jsonb not null default '[]'::jsonb;
alter table phrases add column if not exists formality int not null default 3;
alter table phrases add column if not exists tone int not null default 2;
alter table phrases add column if not exists voice text not null default 'active';
alter table phrases add column if not exists locale text not null default 'en-GB';
alter table phrases add column if not exists banned_words jsonb not null default '[]'::jsonb;
alter table phrases add column if not exists status text not null default 'draft';
alter table phrases add column if not exists body_hash text not null default '';
alter table phrases add column if not exists created_by uuid;
alter table phrases add column if not exists created_at timestamptz not null default now();
alter table phrases add column if not exists released_at timestamptz;
alter table phrases add column if not exists released_by uuid;

alter table phrases drop constraint if exists phrases_status_chk;
alter table phrases add constraint phrases_status_chk check (status in ('draft', 'reviewed', 'released'));
alter table phrases drop constraint if exists phrases_formality_chk;
alter table phrases add constraint phrases_formality_chk check (formality between 1 and 5);
alter table phrases drop constraint if exists phrases_tone_chk;
alter table phrases add constraint phrases_tone_chk check (tone between 1 and 5);
alter table phrases drop constraint if exists phrases_voice_chk;
alter table phrases add constraint phrases_voice_chk check (voice in ('active', 'passive'));
alter table phrases drop constraint if exists phrases_locale_chk;
alter table phrases add constraint phrases_locale_chk check (locale in ('en-GB', 'en-US'));
alter table phrases drop constraint if exists phrases_org_id_fkey;
alter table phrases add constraint phrases_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists phrases_org_phrase_version_idx
  on phrases (org_id, phrase_id, version, formality, tone, voice, locale);
create index if not exists phrases_org_status_idx on phrases (org_id, status);

alter table phrases enable row level security;
drop policy if exists phrases_select on phrases;
create policy phrases_select on phrases for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.phrases from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. phrase_versions — the hash-chained log of every phrase change (L5, the role_config_log pattern).
-- ---------------------------------------------------------------------------
create table if not exists phrase_versions (
  id bigint generated always as identity primary key
);
alter table phrase_versions add column if not exists org_id uuid;
alter table phrase_versions add column if not exists phrase_row uuid;
alter table phrase_versions add column if not exists phrase_id text;
alter table phrase_versions add column if not exists version int;
alter table phrase_versions add column if not exists body_hash text;
alter table phrase_versions add column if not exists status text;
alter table phrase_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table phrase_versions add column if not exists actor uuid;
alter table phrase_versions add column if not exists prev_hash text;
alter table phrase_versions add column if not exists row_hash text;
alter table phrase_versions add column if not exists created_at timestamptz not null default now();
alter table phrase_versions drop constraint if exists phrase_versions_org_id_fkey;
alter table phrase_versions add constraint phrase_versions_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists phrase_versions_org_idx on phrase_versions (org_id, id);
alter table phrase_versions enable row level security;
drop policy if exists phrase_versions_select on phrase_versions;
create policy phrase_versions_select on phrase_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.phrase_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. phrase_reviews — the per-cell review status the workbook writes (W2.9). A release is refused
--    until every cell of a phrase is reviewed.
-- ---------------------------------------------------------------------------
create table if not exists phrase_reviews (
  id uuid primary key default gen_random_uuid()
);
alter table phrase_reviews add column if not exists org_id uuid;
alter table phrase_reviews add column if not exists phrase_id text;
alter table phrase_reviews add column if not exists version int not null default 1;
alter table phrase_reviews add column if not exists cell_key text not null default '';
alter table phrase_reviews add column if not exists model_id text not null default '';
alter table phrase_reviews add column if not exists status text not null default 'unreviewed';
alter table phrase_reviews add column if not exists reviewed_by uuid;
alter table phrase_reviews add column if not exists reviewed_at timestamptz;
alter table phrase_reviews add column if not exists created_at timestamptz not null default now();
alter table phrase_reviews drop constraint if exists phrase_reviews_status_chk;
alter table phrase_reviews add constraint phrase_reviews_status_chk
  check (status in ('unreviewed', 'reviewed', 'rejected'));
alter table phrase_reviews drop constraint if exists phrase_reviews_org_id_fkey;
alter table phrase_reviews add constraint phrase_reviews_org_id_fkey foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists phrase_reviews_cell_idx
  on phrase_reviews (org_id, phrase_id, version, model_id, cell_key);
alter table phrase_reviews enable row level security;
drop policy if exists phrase_reviews_select on phrase_reviews;
create policy phrase_reviews_select on phrase_reviews for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.phrase_reviews from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. report_terminology review columns (M1: the table exists in 0088; extend, do not recreate).
-- ---------------------------------------------------------------------------
alter table report_terminology add column if not exists reviewed_by uuid;
alter table report_terminology add column if not exists reviewed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. Append-only guards (L5). A released phrase cannot be updated; the log tables are append-only.
-- ---------------------------------------------------------------------------
create or replace function public.phrases_released_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'released' and new.status = 'released' then
    if new.template is distinct from old.template
       or new.condition is distinct from old.condition
       or new.body_hash is distinct from old.body_hash
       or new.formality is distinct from old.formality
       or new.tone is distinct from old.tone
       or new.voice is distinct from old.voice
       or new.locale is distinct from old.locale then
      raise exception 'a released phrase is immutable: create a new version' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists phrases_released_immutable on phrases;
create trigger phrases_released_immutable before update on phrases
for each row execute function public.phrases_released_immutable();

create or replace function public.phrase_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'phrase_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists phrase_versions_append_only on phrase_versions;
create trigger phrase_versions_append_only before update or delete on phrase_versions
for each row execute function public.phrase_versions_append_only();

create or replace function public.phrase_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from phrase_versions v where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.phrase_id || '|' || new.version::text || '|' || new.body_hash;
  insert into phrase_versions (org_id, phrase_row, phrase_id, version, body_hash, status, payload, actor, prev_hash, row_hash)
  values (v_org, new.id, new.phrase_id, new.version, new.body_hash, new.status, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists phrase_version_log on phrases;
create trigger phrase_version_log after insert or update on phrases
for each row execute function public.phrase_version_log();

-- ---------------------------------------------------------------------------
-- 6. RPCs. Writes only through security-definer functions that check rights and the org guard.
-- ---------------------------------------------------------------------------

-- phrase_create: create a draft phrase (needs edit_config).
create or replace function public.phrase_create(
  p_org uuid, p_phrase_id text, p_template text, p_claim_level text,
  p_formality int, p_tone int, p_voice text, p_locale text, p_body_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_next int;
begin
  perform public.provio_org_guard(p_org);
  perform public.admin_require_right('edit_config');
  if coalesce(trim(p_template), '') = '' then
    raise exception 'a phrase needs a template' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from phrases
    where org_id = p_org and phrase_id = p_phrase_id;
  insert into phrases (org_id, phrase_id, version, template, claim_level, formality, tone, voice, locale,
                       body_hash, status, created_by)
  values (p_org, p_phrase_id, v_next, p_template, p_claim_level, p_formality, p_tone, p_voice, p_locale,
          p_body_hash, 'draft', auth.uid())
  returning id into v_id;
  perform public.admin_log_change(p_org, 'phrase:' || p_phrase_id, to_jsonb(p_template),
    'phrase.created', 'phrase', v_id);
  return v_id;
end $$;

-- phrase_review_cell: mark one workbook cell reviewed (needs review_and_approve).
create or replace function public.phrase_review_cell(
  p_org uuid, p_phrase_id text, p_version int, p_model_id text, p_cell_key text, p_status text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  perform public.admin_require_right('review_and_approve');
  if p_status not in ('unreviewed', 'reviewed', 'rejected') then
    raise exception 'unknown review status %', p_status using errcode = 'P0001';
  end if;
  insert into phrase_reviews (org_id, phrase_id, version, model_id, cell_key, status, reviewed_by, reviewed_at)
  values (p_org, p_phrase_id, p_version, p_model_id, p_cell_key, p_status, auth.uid(), now())
  on conflict (org_id, phrase_id, version, model_id, cell_key)
  do update set status = excluded.status, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
end $$;

-- phrase_release: release a phrase, but only when every workbook cell is reviewed (W2.9). The
-- caller states how many cells the workbook carries for the phrase; the release refuses unless the
-- reviewed count equals it, so an empty workbook cannot slip a release through.
create or replace function public.phrase_release(p_phrase_row uuid, p_expected_cells int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phrase phrases;
  v_unreviewed int;
  v_reviewed int;
begin
  select * into v_phrase from phrases where id = p_phrase_row;
  if not found then
    raise exception 'phrase not found' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v_phrase.org_id);
  -- Releasing is a platform-admin action (W2.1): no new right is introduced.
  if not public.is_platform_admin() then
    raise exception 'releasing a phrase is a platform administrator action' using errcode = 'P0001';
  end if;
  select count(*) into v_unreviewed from phrase_reviews r
    where r.org_id = v_phrase.org_id and r.phrase_id = v_phrase.phrase_id
      and r.version = v_phrase.version and r.status <> 'reviewed';
  select count(*) into v_reviewed from phrase_reviews r
    where r.org_id = v_phrase.org_id and r.phrase_id = v_phrase.phrase_id
      and r.version = v_phrase.version and r.status = 'reviewed';
  if p_expected_cells is null or p_expected_cells < 1 then
    raise exception 'the release needs the workbook cell count for the phrase' using errcode = 'P0001';
  end if;
  if v_unreviewed > 0 or v_reviewed < p_expected_cells then
    raise exception 'the phrase has % unreviewed workbook cells and % of % reviewed; release requires a reviewed row for every cell',
      v_unreviewed, v_reviewed, p_expected_cells using errcode = 'P0001';
  end if;
  update phrases set status = 'released', released_at = now(), released_by = auth.uid()
    where id = p_phrase_row;
  perform public.admin_log_change(v_phrase.org_id, 'phrase:' || v_phrase.phrase_id,
    to_jsonb(v_phrase.phrase_id), 'phrase.released', 'phrase', p_phrase_row);
end $$;

-- phrase_list: the review workbook reads the phrases and their per-cell status.
create or replace function public.phrase_list(p_org uuid)
returns table (id uuid, phrase_id text, version int, template text, claim_level text,
               formality int, tone int, voice text, locale text, status text, body_hash text)
language sql stable security definer set search_path = public as $$
  select p.id, p.phrase_id, p.version, p.template, p.claim_level, p.formality, p.tone, p.voice,
         p.locale, p.status, p.body_hash
    from phrases p
   where p.org_id = p_org
     and (p.org_id = public.jwt_org_id() or public.is_platform_admin())
   order by p.phrase_id, p.version, p.formality, p.tone, p.voice, p.locale;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants. The tables take no direct write. The helper functions are not a client surface.
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('phrases_released_immutable', 'phrase_versions_append_only', 'phrase_version_log')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('phrase_create', 'phrase_review_cell', 'phrase_release', 'phrase_list')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

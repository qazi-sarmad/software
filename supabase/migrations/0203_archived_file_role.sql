-- 0203 (integrator, final phase): a permanently configurable role owns an ARCHIVED file.
--
-- Owner instruction 2026-10-30: "for archived files add a permanently configurable role." An archived
-- file outlives the person who owned it: the preparer leaves, the tenant is reorganised, and the file
-- must still have an accountable holder. So the custodian of an archived file is a ROLE, chosen by
-- the organisation, not a person — and that choice is permanent in two senses:
--
--   1. It can be changed at any time, and every change is versioned and appended to the audit trail.
--   2. The configuration itself is never deleted. A DELETE is refused by the privilege layer and by a
--      guard trigger, so there is always exactly one custodian role in force for the tenant.
--
-- The default is `cia` — the accountable head of the function, and a role every tenant is seeded
-- with — so an organisation that never visits the screen still has a custodian.
--
-- Enforcement (a setting that can be saved is enforced): `archive_population` stamps every archive it
-- creates with the custodian role in force, and `archived_file_custodians()` reports, for every
-- archived file, its custodian role and the person who owned it. The effect is proven by SQL test 147.
--
-- Laws honoured: L1 (the custodian is a stored, chosen role — no model), L2 (org-scoped; the reader
-- is bounded by jwt_org_id()), L3 (config-as-ledger: versioned, audited, never silently replaced),
-- L5 (the configuration row is never deleted).
--
-- M1: grepped migrations and tests for every new name; all new. M2: create table if not exists /
-- create or replace. M6: the harness applies this twice and runs the tests twice before the push.

-- ---------------------------------------------------------------------------
-- 1. The configuration. One row per organisation; it is never deleted.
-- ---------------------------------------------------------------------------
create table if not exists archived_file_role (
  org_id uuid primary key references orgs(id) on delete cascade,
  role_slug text not null,
  version int not null default 1,
  reason text not null default '',
  updated_by uuid null,
  updated_at timestamptz not null default now()
);

alter table archived_file_role enable row level security;

drop policy if exists archived_file_role_select on archived_file_role;
create policy archived_file_role_select on archived_file_role for select to authenticated
  using (org_id = public.jwt_org_id());

-- Written only through the RPC below; no end user holds a write privilege, so the configuration
-- cannot be deleted from a browser session.
revoke insert, update, delete on public.archived_file_role from public, anon, authenticated;

-- The custodian role of an archived file is never removed. There is no DELETE path in the product;
-- this guard closes the door anyway, so the invariant survives a future one.
create or replace function public.archived_file_role_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'archived_file_role_required: the custodian role for archived files cannot be removed'
      using errcode = 'P0001';
  end if;
  if new.role_slug is null or btrim(new.role_slug) = '' then
    raise exception 'archived_file_role_required: the custodian role for archived files cannot be cleared'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists archived_file_role_no_delete on archived_file_role;
create trigger archived_file_role_no_delete before delete or update on archived_file_role
  for each row execute function public.archived_file_role_guard();

-- ---------------------------------------------------------------------------
-- 2. The default, and the effective custodian. The platform default is `cia`: the accountable head
--    of the function, and a role every tenant is seeded with. An organisation with no row still has
--    a custodian, so an archived file is never holderless.
-- ---------------------------------------------------------------------------
create or replace function public.archived_file_role_default() returns text
language sql immutable as $$ select 'cia'::text $$;
revoke execute on function public.archived_file_role_default() from public, anon, authenticated;

create or replace function public.archived_file_role_effective(p_org uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select r.role_slug from archived_file_role r where r.org_id = p_org),
                  public.archived_file_role_default())
$$;

-- There is deliberately NO row until the organisation makes an explicit choice. The custodian in
-- force is the stored row when there is one, and the platform default when there is not — so a
-- tenant that never visits the screen still has a custodian, and `is_default` reports which case it
-- is in.

-- ---------------------------------------------------------------------------
-- 3. The reader and the writer for the screen.
-- ---------------------------------------------------------------------------
create or replace function public.archived_file_role_get()
returns table (role_slug text, role_name text, is_default boolean, version int, reason text,
               updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(r.role_slug, public.archived_file_role_default()),
         coalesce(ro.name, ''),
         r.org_id is null,
         coalesce(r.version, 1),
         coalesce(r.reason, 'the platform default'),
         r.updated_at
    from (select 1) one
    left join archived_file_role r on r.org_id = public.jwt_org_id()
    left join roles ro on ro.org_id = public.jwt_org_id()
                       and ro.slug = coalesce(r.role_slug, public.archived_file_role_default())
$$;

-- Change the custodian role. Requires manage_roles, refuses an unknown role, and never replaces the
-- row: it bumps the version and appends the change to the audit trail (L3, L5).
create or replace function public.archived_file_role_set(p_role_slug text, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_version int;
  v_role roles;
begin
  perform public.admin_assert_org(v_org);
  perform public.provio_org_guard(v_org);
  perform public.admin_require_right('manage_roles');

  if p_role_slug is null or p_role_slug !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'a role slug must be lower-case letters, digits or underscores' using errcode = 'P0001';
  end if;
  select * into v_role from roles r where r.org_id = v_org and r.slug = p_role_slug;
  if v_role.id is null then
    raise exception 'unknown role in this organisation: %', p_role_slug using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a reason of at least 10 characters is required when the custodian role changes'
      using errcode = 'P0001';
  end if;

  insert into archived_file_role (org_id, role_slug, version, reason, updated_by, updated_at)
  values (v_org, p_role_slug, 1, btrim(p_reason), auth.uid(), now())
  on conflict (org_id) do update
    set role_slug = excluded.role_slug,
        version = archived_file_role.version + 1,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning version into v_version;

  perform public.admin_log_change(v_org, 'archived_file_role:' || v_org::text,
    jsonb_build_object('role_slug', p_role_slug, 'version', v_version, 'reason', btrim(p_reason)),
    'archived_file_custodian_changed', 'archived_file_role', v_org);
  perform public.append_ledger_entry(v_org, 'archived_file_custodian_changed',
    jsonb_build_object('role_slug', p_role_slug, 'version', v_version), auth.uid());
  return v_version;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The archive carries the custodian. Every population archive is stamped with the custodian role
--    in force when it was created, so an archived file always names its permanent holder.
-- ---------------------------------------------------------------------------
alter table population_archives add column if not exists custodian_role_slug text;

create or replace function public.archive_population(p_population_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.jwt_org_id();
  v_pop populations;
  v_count int;
  v_path text;
  v_id uuid;
begin
  if v_org is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  if not coalesce(public.caller_has_right('manage_engagements'), false) then
    raise exception 'not allowed: caller lacks the manage_engagements right' using errcode = 'P0001';
  end if;

  select * into v_pop from populations p where p.id = p_population_id and p.org_id = v_org;
  if not found then
    raise exception 'population not found in this organisation' using errcode = 'P0001';
  end if;

  select count(*) into v_count from population_rows r where r.population_id = p_population_id;
  v_path := v_org::text || '/populations/' || p_population_id::text || '.csv.gz';

  -- The custodian role in force at archival time (the organisation's choice, or the platform default).
  insert into population_archives (org_id, population_id, engagement_id, content_hash, storage_path,
                                   archived_row_count, status, custodian_role_slug)
  values (v_org, p_population_id, v_pop.engagement_id, v_pop.sha256, v_path, v_count, 'pending',
          public.archived_file_role_effective(v_org))
  on conflict (population_id) do update
    set content_hash = excluded.content_hash,
        storage_path = excluded.storage_path,
        archived_row_count = excluded.archived_row_count,
        custodian_role_slug = excluded.custodian_role_slug
  returning id into v_id;

  perform public.append_ledger_entry(
    v_org, 'population_archive_started',
    jsonb_build_object('archive_id', v_id, 'population_id', p_population_id,
                       'content_hash', v_pop.sha256, 'storage_path', v_path, 'row_count', v_count),
    auth.uid());
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The reader that proves the effect: every archived file, its permanent custodian role, and the
--    person who owns the file.
-- ---------------------------------------------------------------------------
create or replace function public.archived_file_custodians()
returns table (archive_id uuid, population_id uuid, engagement_id uuid, status text,
               content_hash text, archived_row_count int, custodian_role_slug text,
               custodian_role_name text, owner_user_id uuid, owner_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.population_id, a.engagement_id, a.status, a.content_hash, a.archived_row_count,
         coalesce(a.custodian_role_slug, public.archived_file_role_default()),
         coalesce(r.name, ''),
         f.user_id,
         nullif(btrim(coalesce(m.display_name, '')), ''),
         a.created_at
    from population_archives a
    left join roles r on r.org_id = a.org_id
                     and r.slug = coalesce(a.custodian_role_slug, public.archived_file_role_default())
    left join engagement_file_owners f on f.engagement_id = a.engagement_id
    left join org_members m on m.org_id = a.org_id and m.user_id = f.user_id
   where a.org_id = public.jwt_org_id()
   order by a.created_at desc
$$;

revoke execute on function public.archived_file_role_get() from public, anon;
revoke execute on function public.archived_file_role_set(text, text) from public, anon;
revoke execute on function public.archived_file_custodians() from public, anon;
grant execute on function public.archived_file_role_get() to authenticated;
grant execute on function public.archived_file_role_set(text, text) to authenticated;
grant execute on function public.archived_file_custodians() to authenticated;

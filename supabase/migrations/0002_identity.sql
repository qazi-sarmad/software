-- 0002: tenant structure and identity.
-- Every business table carries org_id uuid not null, except orgs itself.
-- Roles and memberships are tenant data (L2): the platform owner reads none of it.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  -- Stable machine name used in the JWT claim and in policies (cia, org_admin, ...).
  slug text not null,
  is_seed boolean not null default false,
  rights jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, slug)
);

-- Platform staff (QSCorp). Not tenant members: they carry no org_id and read no tenant content (§24).
create table if not exists platform_admins (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  role_id uuid not null references roles(id) on delete restrict,
  hierarchy_level smallint null,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists user_scopes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null,
  universe_id uuid null,
  entity_id uuid null,
  engagement_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists org_members_user_idx on org_members (org_id, user_id);
create index if not exists user_scopes_user_idx on user_scopes (org_id, user_id);

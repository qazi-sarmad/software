-- 0003: audit structure — universes, entities, engagements, SIRA, plans.

create table if not exists universes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  domain text,
  created_at timestamptz not null default now()
);

create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  name text not null,
  kind text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists engagements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- An engagement belongs to exactly one universe.
  universe_id uuid not null references universes(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  title text not null,
  stage text not null default 'planning' check (stage in ('planning', 'testing', 'conclusion')),
  sealed boolean not null default false,
  ad_hoc boolean not null default false,
  plan_id uuid null,
  created_at timestamptz not null default now()
);

create table if not exists engagement_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  user_id uuid not null,
  team_role text not null,
  created_at timestamptz not null default now(),
  unique (engagement_id, user_id)
);

create table if not exists risks_library (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists sira_cycles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  year int not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists sira_scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  cycle_id uuid not null references sira_cycles(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  risk_id uuid not null references risks_library(id) on delete cascade,
  score numeric(6,2) not null default 0,
  factor_values jsonb not null default '{}'::jsonb,
  method text,
  created_at timestamptz not null default now()
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  universe_id uuid not null references universes(id) on delete cascade,
  period text,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  current_version int not null default 1,
  created_at timestamptz not null default now()
);

-- Append-only plan version history (L5).
create table if not exists plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  version int not null,
  snapshot jsonb not null default '{}'::jsonb,
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);

create index if not exists entities_universe_idx on entities (org_id, universe_id);
create index if not exists engagements_universe_idx on engagements (org_id, universe_id);
create index if not exists engagement_members_user_idx on engagement_members (org_id, user_id);

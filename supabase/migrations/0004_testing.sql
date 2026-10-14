-- 0004: testing — populations, samples, workpapers, sign-offs, findings, CAPs.

create table if not exists populations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  sha256 text not null,
  control_total_cents bigint,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists population_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  population_id uuid not null references populations(id) on delete cascade,
  row_ref int not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists samples (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  population_id uuid not null references populations(id) on delete cascade,
  population_sha256 text not null,
  method text,
  size_floor int,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sample_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  sample_id uuid not null references samples(id) on delete cascade,
  row_ref int not null,
  conclusion text check (conclusion in ('tick', 'cross', 'unverifiable')),
  rationale text
);

create table if not exists workpapers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  control_id uuid null,
  stage text not null default 'testing' check (stage in ('planning', 'testing', 'conclusion')),
  prepared boolean not null default false,
  created_at timestamptz not null default now()
);

-- D3: sign-offs. Four-eyes is a CHECK constraint, not application code.
create table if not exists sign_offs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  workpaper_id uuid not null references workpapers(id) on delete cascade,
  stage text not null check (stage in ('planning', 'testing', 'conclusion')),
  preparer_id uuid not null,
  reviewer_id uuid not null,
  decided_at timestamptz not null default now(),
  constraint sign_offs_four_eyes check (reviewer_id <> preparer_id)
);

create table if not exists test_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  workpaper_id uuid not null references workpapers(id) on delete cascade,
  sample_row_id uuid null references sample_rows(id) on delete set null,
  result text,
  created_at timestamptz not null default now()
);

create table if not exists observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  title text not null,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  observation_id uuid null references observations(id) on delete set null,
  entity_id uuid null references entities(id) on delete set null,
  severity text,
  sections jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  entity_id uuid null references entities(id) on delete set null,
  title text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists cap_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  issue_id uuid null references issues(id) on delete set null,
  action text,
  due_date date,
  status text,
  created_at timestamptz not null default now()
);

create index if not exists populations_engagement_idx on populations (org_id, engagement_id);
create index if not exists samples_population_idx on samples (org_id, population_id);
create index if not exists workpapers_engagement_idx on workpapers (org_id, engagement_id);

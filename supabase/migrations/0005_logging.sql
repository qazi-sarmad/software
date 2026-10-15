-- 0005: logging and ledger tables (L5, spec §26).
-- ledger_entries, activity_log, config_versions are append-only; the append-only triggers
-- and the ledger chain trigger live in 0006.

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null,
  org_id uuid not null references orgs(id) on delete cascade,
  prev_hash text not null,
  hash text not null,
  payload_hash text not null,
  actor_id uuid,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now(),
  unique (org_id, seq)
);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  actor_id uuid,
  action text not null,
  object_type text,
  object_id uuid,
  detail jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);

create table if not exists config_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  version int not null,
  actor_id uuid,
  ts timestamptz not null default now(),
  unique (org_id, key, version)
);

-- Platform trail: metadata only, no tenant business columns (spec §24, D1/E).
create table if not exists platform_trail (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  tenant_id uuid,
  object_type text,
  object_id uuid,
  ts timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid,
  kind text,
  body text,
  read boolean not null default false,
  ts timestamptz not null default now()
);

create table if not exists email_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  to_address text,
  subject text,
  status text not null default 'queued',
  ts timestamptz not null default now()
);

create index if not exists ledger_entries_org_seq_idx on ledger_entries (org_id, seq);
create index if not exists activity_log_org_ts_idx on activity_log (org_id, ts);

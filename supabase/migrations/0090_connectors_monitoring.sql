-- 0090: connectors, staging and deterministic continuous monitoring (WRITE-1, W11).
--
-- Connectors only PULL a tenant's own data into that tenant, read-only. Ingested records land in
-- staging tables with the source id, fetch time, source hash and run id, and can be promoted to a
-- population (L3). Monitors are rules as data, evaluated by a pure function; a triggered alert is a
-- hash-chained record carrying its rule id and version, its source records and their hashes. The
-- alert emits the existing generic `watcher.signal` catalogue event, which until now had no emitter.
--
-- M1: grepped supabase/migrations and supabase/tests for connector_instances, connector_runs,
--     staged_records, monitor_rules, monitor_rule_versions, monitor_alerts, alert_triage,
--     connector_egress_allowlist — no hits. `watcher.signal` exists in event_emitter_allowlist
--     (0075) but not in automation_events_catalogue; this migration adds the catalogue row and the
--     emitter, and removes the allow-list row (it now has a source).
-- M2: create table if not exists + add column if not exists; create or replace; drop policy/trigger
--     if exists before create.
-- M3: no existing table changes shape; everything here is new.
-- M5: every table carries org_id with an FK to orgs(id) on delete cascade, so `truncate orgs cascade`
--     in the test reset reaches it and a run leaves no residue. The catalogue and allow-list tables
--     are platform-level and are reset by provio_test.reset_data().

-- ---------------------------------------------------------------------------
-- 1. connector_instances — one row per organisation connector instance. Credentials are held only
--    as a secret reference (secret_store_ref); no credential value is ever stored here.
-- ---------------------------------------------------------------------------
create table if not exists connector_instances (
  id uuid primary key default gen_random_uuid()
);
alter table connector_instances add column if not exists org_id uuid;
alter table connector_instances add column if not exists connector_id text not null default '';
alter table connector_instances add column if not exists label text not null default '';
alter table connector_instances add column if not exists config jsonb not null default '{}'::jsonb;
alter table connector_instances add column if not exists credential_ref text;
alter table connector_instances add column if not exists cursor text;
alter table connector_instances add column if not exists enabled boolean not null default true;
alter table connector_instances add column if not exists health text not null default 'unknown';
alter table connector_instances add column if not exists health_detail text;
alter table connector_instances add column if not exists last_checked_at timestamptz;
alter table connector_instances add column if not exists created_by uuid;
alter table connector_instances add column if not exists created_at timestamptz not null default now();
alter table connector_instances drop constraint if exists ci_health_chk;
alter table connector_instances add constraint ci_health_chk
  check (health in ('unknown', 'ok', 'degraded', 'failed'));
alter table connector_instances drop constraint if exists connector_instances_org_id_fkey;
alter table connector_instances add constraint connector_instances_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists connector_instances_org_idx on connector_instances (org_id, connector_id);
alter table connector_instances enable row level security;
drop policy if exists connector_instances_select on connector_instances;
create policy connector_instances_select on connector_instances for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.connector_instances from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. connector_runs — the run history and health (W11.6). No secret or token ever appears here.
-- ---------------------------------------------------------------------------
create table if not exists connector_runs (
  id uuid primary key default gen_random_uuid()
);
alter table connector_runs add column if not exists org_id uuid;
alter table connector_runs add column if not exists instance_id uuid;
alter table connector_runs add column if not exists started_at timestamptz not null default now();
alter table connector_runs add column if not exists finished_at timestamptz;
alter table connector_runs add column if not exists status text not null default 'running';
alter table connector_runs add column if not exists rows_fetched int not null default 0;
alter table connector_runs add column if not exists rows_staged int not null default 0;
alter table connector_runs add column if not exists rows_skipped int not null default 0;
alter table connector_runs add column if not exists error text;
alter table connector_runs add column if not exists detail text not null default '';
alter table connector_runs drop constraint if exists connector_runs_status_chk;
alter table connector_runs add constraint connector_runs_status_chk
  check (status in ('running', 'succeeded', 'failed'));
alter table connector_runs drop constraint if exists connector_runs_org_id_fkey;
alter table connector_runs add constraint connector_runs_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists connector_runs_org_idx on connector_runs (org_id, started_at desc);
alter table connector_runs enable row level security;
drop policy if exists connector_runs_select on connector_runs;
create policy connector_runs_select on connector_runs for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.connector_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. staged_records — the ingested records, with the source id, fetch time, source hash and run id.
--    Idempotent ingestion keyed by content hash. Drillable; promotable to a population (L3).
-- ---------------------------------------------------------------------------
create table if not exists staged_records (
  id uuid primary key default gen_random_uuid()
);
alter table staged_records add column if not exists org_id uuid;
alter table staged_records add column if not exists instance_id uuid;
alter table staged_records add column if not exists run_id uuid;
alter table staged_records add column if not exists source text not null default '';
alter table staged_records add column if not exists source_id text not null default '';
alter table staged_records add column if not exists content_hash text not null default '';
alter table staged_records add column if not exists fetched_at timestamptz not null default now();
alter table staged_records add column if not exists values jsonb not null default '{}'::jsonb;
alter table staged_records add column if not exists tags jsonb not null default '[]'::jsonb;
alter table staged_records add column if not exists population_id uuid;
alter table staged_records drop constraint if exists staged_records_org_id_fkey;
alter table staged_records add constraint staged_records_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists staged_records_idem_idx
  on staged_records (org_id, instance_id, source_id, content_hash);
create index if not exists staged_records_org_idx on staged_records (org_id, source, fetched_at desc);
alter table staged_records enable row level security;
drop policy if exists staged_records_select on staged_records;
create policy staged_records_select on staged_records for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.staged_records from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. connector_egress_allowlist — the per-organisation egress allow-list (W11.1). A connector may
--    reach only a host on this list; the guard reuses the SSRF check from hosting-test.
-- ---------------------------------------------------------------------------
create table if not exists connector_egress_allowlist (
  id uuid primary key default gen_random_uuid()
);
alter table connector_egress_allowlist add column if not exists org_id uuid;
alter table connector_egress_allowlist add column if not exists host text not null default '';
alter table connector_egress_allowlist add column if not exists created_at timestamptz not null default now();
alter table connector_egress_allowlist drop constraint if exists connector_egress_allowlist_org_id_fkey;
alter table connector_egress_allowlist add constraint connector_egress_allowlist_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists connector_egress_org_host_idx on connector_egress_allowlist (org_id, host);
alter table connector_egress_allowlist enable row level security;
drop policy if exists connector_egress_allowlist_select on connector_egress_allowlist;
create policy connector_egress_allowlist_select on connector_egress_allowlist for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.connector_egress_allowlist from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. monitor_rules + monitor_rule_versions — the monitor rules as data, hash-chained. Rules ship as
--    drafts; release requires a qualified human (same lifecycle as phrases).
-- ---------------------------------------------------------------------------
create table if not exists monitor_rules (
  id uuid primary key default gen_random_uuid()
);
alter table monitor_rules add column if not exists org_id uuid;
alter table monitor_rules add column if not exists rule_id text not null default '';
alter table monitor_rules add column if not exists version int not null default 1;
alter table monitor_rules add column if not exists kind text not null default 'threshold';
alter table monitor_rules add column if not exists description text not null default '';
alter table monitor_rules add column if not exists spec jsonb not null default '{}'::jsonb;
alter table monitor_rules add column if not exists status text not null default 'draft';
alter table monitor_rules add column if not exists body_hash text not null default '';
alter table monitor_rules add column if not exists released_at timestamptz;
alter table monitor_rules add column if not exists released_by uuid;
alter table monitor_rules add column if not exists created_by uuid;
alter table monitor_rules add column if not exists created_at timestamptz not null default now();
alter table monitor_rules drop constraint if exists monitor_rules_kind_chk;
alter table monitor_rules add constraint monitor_rules_kind_chk
  check (kind in ('threshold', 'rate', 'sequence', 'set_membership', 'missing_event', 'reconciliation'));
alter table monitor_rules drop constraint if exists monitor_rules_status_chk;
alter table monitor_rules add constraint monitor_rules_status_chk
  check (status in ('draft', 'released'));
alter table monitor_rules drop constraint if exists monitor_rules_org_id_fkey;
alter table monitor_rules add constraint monitor_rules_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists monitor_rules_org_rule_version_idx on monitor_rules (org_id, rule_id, version);
alter table monitor_rules enable row level security;
drop policy if exists monitor_rules_select on monitor_rules;
create policy monitor_rules_select on monitor_rules for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.monitor_rules from public, anon, authenticated;

create table if not exists monitor_rule_versions (
  id bigint generated always as identity primary key
);
alter table monitor_rule_versions add column if not exists org_id uuid;
alter table monitor_rule_versions add column if not exists rule_row uuid;
alter table monitor_rule_versions add column if not exists rule_id text;
alter table monitor_rule_versions add column if not exists version int;
alter table monitor_rule_versions add column if not exists body_hash text;
alter table monitor_rule_versions add column if not exists status text;
alter table monitor_rule_versions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table monitor_rule_versions add column if not exists actor uuid;
alter table monitor_rule_versions add column if not exists prev_hash text;
alter table monitor_rule_versions add column if not exists row_hash text;
alter table monitor_rule_versions add column if not exists created_at timestamptz not null default now();
alter table monitor_rule_versions drop constraint if exists monitor_rule_versions_org_id_fkey;
alter table monitor_rule_versions add constraint monitor_rule_versions_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists monitor_rule_versions_org_idx on monitor_rule_versions (org_id, id);
alter table monitor_rule_versions enable row level security;
drop policy if exists monitor_rule_versions_select on monitor_rule_versions;
create policy monitor_rule_versions_select on monitor_rule_versions for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.monitor_rule_versions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. monitor_alerts — a hash-chained alert record: its rule id and version, its source records and
--    their hashes, and a lineage hash. Inserting one emits the `watcher.signal` catalogue event.
-- ---------------------------------------------------------------------------
create table if not exists monitor_alerts (
  id uuid primary key default gen_random_uuid()
);
alter table monitor_alerts add column if not exists org_id uuid;
alter table monitor_alerts add column if not exists rule_id text not null default '';
alter table monitor_alerts add column if not exists rule_version int not null default 1;
alter table monitor_alerts add column if not exists kind text not null default 'threshold';
alter table monitor_alerts add column if not exists reason text not null default '';
alter table monitor_alerts add column if not exists refs jsonb not null default '[]'::jsonb;
alter table monitor_alerts add column if not exists evaluated_at timestamptz not null default now();
alter table monitor_alerts add column if not exists window_start timestamptz;
alter table monitor_alerts add column if not exists lineage_hash text not null default '';
alter table monitor_alerts add column if not exists prev_hash text not null default '';
alter table monitor_alerts add column if not exists hash text not null default '';
alter table monitor_alerts add column if not exists created_at timestamptz not null default now();
alter table monitor_alerts drop constraint if exists monitor_alerts_org_id_fkey;
alter table monitor_alerts add constraint monitor_alerts_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create index if not exists monitor_alerts_org_idx on monitor_alerts (org_id, evaluated_at desc);
alter table monitor_alerts enable row level security;
drop policy if exists monitor_alerts_select on monitor_alerts;
create policy monitor_alerts_select on monitor_alerts for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.monitor_alerts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. alert_triage — the disposition of an alert. A dismissal requires a reason; a snooze requires an
--    expiry. Only an escalated alert can reach report content (W3.2, W11.4).
-- ---------------------------------------------------------------------------
create table if not exists alert_triage (
  id uuid primary key default gen_random_uuid()
);
alter table alert_triage add column if not exists org_id uuid;
alter table alert_triage add column if not exists alert_id uuid;
alter table alert_triage add column if not exists alert_hash text not null default '';
alter table alert_triage add column if not exists disposition text not null default 'open';
alter table alert_triage add column if not exists reason text;
alter table alert_triage add column if not exists snooze_until timestamptz;
alter table alert_triage add column if not exists observation_id uuid;
alter table alert_triage add column if not exists triaged_by uuid;
alter table alert_triage add column if not exists triaged_at timestamptz not null default now();
alter table alert_triage drop constraint if exists alert_triage_disposition_chk;
alter table alert_triage add constraint alert_triage_disposition_chk
  check (disposition in ('open', 'dismissed', 'snoozed', 'escalated'));
alter table alert_triage drop constraint if exists alert_triage_org_id_fkey;
alter table alert_triage add constraint alert_triage_org_id_fkey
  foreign key (org_id) references orgs(id) on delete cascade;
create unique index if not exists alert_triage_alert_idx on alert_triage (org_id, alert_id);
alter table alert_triage enable row level security;
drop policy if exists alert_triage_select on alert_triage;
create policy alert_triage_select on alert_triage for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
revoke insert, update, delete on public.alert_triage from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Append-only guards and the alert chain writer.
-- ---------------------------------------------------------------------------
create or replace function public.monitor_rule_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'monitor_rule_versions is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists monitor_rule_versions_append_only on monitor_rule_versions;
create trigger monitor_rule_versions_append_only before update or delete on monitor_rule_versions
for each row execute function public.monitor_rule_versions_append_only();

create or replace function public.monitor_rule_version_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := new.org_id;
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(v_org::text));
  select v.row_hash into v_prev from monitor_rule_versions v where v.org_id = v_org order by v.id desc limit 1;
  v_body := coalesce(v_prev, '') || '|' || new.rule_id || '|' || new.version::text || '|' || new.body_hash;
  insert into monitor_rule_versions (org_id, rule_row, rule_id, version, body_hash, status, payload, actor, prev_hash, row_hash)
  values (v_org, new.id, new.rule_id, new.version, new.body_hash, new.status, to_jsonb(new), auth.uid(), v_prev,
          encode(sha256(convert_to(v_body, 'UTF8')), 'hex'));
  return new;
end $$;
drop trigger if exists monitor_rule_version_log on monitor_rules;
create trigger monitor_rule_version_log after insert or update on monitor_rules
for each row execute function public.monitor_rule_version_log();

-- The alert chain: prev_hash is the previous alert's hash for the organisation, hash is over
-- (prev_hash, lineage_hash). A tampered alert breaks the chain.
create or replace function public.monitor_alert_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(new.org_id::text));
  select a.hash into v_prev from monitor_alerts a where a.org_id = new.org_id order by a.created_at desc, a.id desc limit 1;
  new.prev_hash := coalesce(v_prev, '');
  v_body := coalesce(v_prev, '') || '|' || new.lineage_hash;
  new.hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  return new;
end $$;
drop trigger if exists monitor_alert_chain on monitor_alerts;
create trigger monitor_alert_chain before insert on monitor_alerts
for each row execute function public.monitor_alert_chain();

create or replace function public.monitor_alerts_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'monitor_alerts is append-only' using errcode = 'P0001';
end $$;
drop trigger if exists monitor_alerts_append_only on monitor_alerts;
create trigger monitor_alerts_append_only before update or delete on monitor_alerts
for each row execute function public.monitor_alerts_append_only();

-- ---------------------------------------------------------------------------
-- 9. The `watcher.signal` emitter (W11.4). The catalogue row is added and the allow-list row, which
--    said the key had no source, is removed now that a real emitter exists.
-- ---------------------------------------------------------------------------
insert into automation_events_catalogue (event_key, label, category, source_exists) values
  ('watcher.signal', 'A continuous-monitoring rule fired', 'monitoring', true)
on conflict (event_key) do update set label = excluded.label, category = excluded.category, source_exists = true;

delete from event_emitter_allowlist where event_key = 'watcher.signal';

create or replace function public.emit_monitor_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.emit_catalogue_event(new.org_id, 'watcher.signal', jsonb_build_object(
    'rule_id', new.rule_id, 'rule_version', new.rule_version, 'kind', new.kind,
    'alert_id', new.id, 'reason', new.reason, 'lineage_hash', new.lineage_hash,
    'reference_count', jsonb_array_length(new.refs)));
  return new;
end $$;
drop trigger if exists emit_monitor_alert on monitor_alerts;
create trigger emit_monitor_alert after insert on monitor_alerts
for each row execute function public.emit_monitor_alert();

-- ---------------------------------------------------------------------------
-- 10. RPCs. Writes only through security-definer functions that check rights and the org guard.
-- ---------------------------------------------------------------------------

-- connector_instance_save: create or update an instance (needs edit_config). The credential is a
-- reference, never a value.
create or replace function public.connector_instance_save(
  p_org uuid, p_instance_id uuid, p_connector_id text, p_label text, p_config jsonb, p_credential_ref text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_instance_id;
begin
  perform public.provio_org_guard(p_org);
  perform public.admin_require_right('edit_config');
  if v_id is null then
    insert into connector_instances (org_id, connector_id, label, config, credential_ref, created_by)
    values (p_org, p_connector_id, coalesce(p_label, ''), coalesce(p_config, '{}'::jsonb), p_credential_ref, auth.uid())
    returning id into v_id;
  else
    update connector_instances set connector_id = p_connector_id, label = coalesce(p_label, ''),
      config = coalesce(p_config, '{}'::jsonb), credential_ref = p_credential_ref
      where id = v_id and org_id = p_org;
  end if;
  perform public.admin_log_change(p_org, 'connector:' || p_connector_id, coalesce(p_config, '{}'::jsonb),
    'connector.instance_saved', 'connector_instance', v_id);
  return v_id;
end $$;

-- connector_run_start / connector_run_finish: the run history. The run row never holds a secret.
create or replace function public.connector_run_start(p_org uuid, p_instance_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.provio_org_guard(p_org);
  if not exists (select 1 from connector_instances i where i.id = p_instance_id and i.org_id = p_org) then
    raise exception 'no such connector instance in this organisation' using errcode = 'P0001';
  end if;
  insert into connector_runs (org_id, instance_id, status) values (p_org, p_instance_id, 'running')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.connector_run_finish(
  p_org uuid, p_run_id uuid, p_status text, p_fetched int, p_staged int, p_skipped int, p_error text, p_detail text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.provio_org_guard(p_org);
  if p_status not in ('succeeded', 'failed') then
    raise exception 'a finished run is succeeded or failed' using errcode = 'P0001';
  end if;
  update connector_runs set status = p_status, finished_at = now(), rows_fetched = coalesce(p_fetched, 0),
    rows_staged = coalesce(p_staged, 0), rows_skipped = coalesce(p_skipped, 0),
    error = p_error, detail = coalesce(p_detail, '')
    where id = p_run_id and org_id = p_org;
end $$;

-- staged_record_ingest: one staged record, idempotent by content hash. Returns true when inserted.
create or replace function public.staged_record_ingest(
  p_org uuid, p_instance_id uuid, p_run_id uuid, p_source text, p_source_id text,
  p_content_hash text, p_fetched_at timestamptz, p_values jsonb, p_tags jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.provio_org_guard(p_org);
  insert into staged_records (org_id, instance_id, run_id, source, source_id, content_hash, fetched_at, values, tags)
  values (p_org, p_instance_id, p_run_id, p_source, p_source_id, p_content_hash,
          coalesce(p_fetched_at, now()), coalesce(p_values, '{}'::jsonb), coalesce(p_tags, '[]'::jsonb))
  on conflict (org_id, instance_id, source_id, content_hash) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

-- connector_egress_allowed: the per-organisation egress allow-list check (W11.1).
create or replace function public.connector_egress_allowed(p_org uuid, p_host text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from connector_egress_allowlist a
                  where a.org_id = p_org and lower(a.host) = lower(p_host));
$$;

-- monitor_rule_save: create or update a draft rule (needs edit_config).
create or replace function public.monitor_rule_save(
  p_org uuid, p_rule_id text, p_kind text, p_description text, p_spec jsonb, p_body_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_next int;
begin
  perform public.provio_org_guard(p_org);
  perform public.admin_require_right('edit_config');
  select id into v_id from monitor_rules where org_id = p_org and rule_id = p_rule_id and status = 'draft';
  if v_id is not null then
    update monitor_rules set kind = p_kind, description = p_description, spec = p_spec, body_hash = p_body_hash
      where id = v_id;
    return v_id;
  end if;
  select coalesce(max(version), 0) + 1 into v_next from monitor_rules where org_id = p_org and rule_id = p_rule_id;
  insert into monitor_rules (org_id, rule_id, version, kind, description, spec, body_hash, status, created_by)
  values (p_org, p_rule_id, v_next, p_kind, p_description, coalesce(p_spec, '{}'::jsonb), p_body_hash, 'draft', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- monitor_rule_release: release a draft rule (a platform administrator action, as for phrases).
create or replace function public.monitor_rule_release(p_rule_row uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v monitor_rules;
begin
  select * into v from monitor_rules where id = p_rule_row;
  if not found then
    raise exception 'monitor rule not found' using errcode = 'P0001';
  end if;
  perform public.provio_org_guard(v.org_id);
  if not public.is_platform_admin() then
    raise exception 'releasing a monitor rule is a platform administrator action' using errcode = 'P0001';
  end if;
  update monitor_rules set status = 'released', released_at = now(), released_by = auth.uid() where id = p_rule_row;
end $$;

-- alert_record: write a hash-chained alert (the evaluator calls this). Returns the alert id.
create or replace function public.alert_record(
  p_org uuid, p_rule_id text, p_rule_version int, p_kind text, p_reason text,
  p_references jsonb, p_evaluated_at timestamptz, p_window_start timestamptz, p_lineage_hash text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.provio_org_guard(p_org);
  insert into monitor_alerts (org_id, rule_id, rule_version, kind, reason, refs, evaluated_at, window_start, lineage_hash)
  values (p_org, p_rule_id, p_rule_version, p_kind, p_reason, coalesce(p_references, '[]'::jsonb),
          coalesce(p_evaluated_at, now()), p_window_start, p_lineage_hash)
  returning id into v_id;
  return v_id;
end $$;

-- alert_triage_record: dismiss with a reason, snooze with an expiry, or escalate to an observation.
create or replace function public.alert_triage_record(
  p_org uuid, p_alert_id uuid, p_disposition text, p_reason text, p_snooze_until timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  perform public.provio_org_guard(p_org);
  perform public.admin_require_right('review_and_approve');
  if p_disposition not in ('open', 'dismissed', 'snoozed', 'escalated') then
    raise exception 'unknown disposition %', p_disposition using errcode = 'P0001';
  end if;
  if p_disposition = 'dismissed' and coalesce(trim(p_reason), '') = '' then
    raise exception 'a dismissal requires a reason' using errcode = 'P0001';
  end if;
  if p_disposition = 'snoozed' and p_snooze_until is null then
    raise exception 'a snooze requires an expiry' using errcode = 'P0001';
  end if;
  select a.hash into v_hash from monitor_alerts a where a.id = p_alert_id and a.org_id = p_org;
  if v_hash is null then
    raise exception 'no such alert in this organisation' using errcode = 'P0001';
  end if;
  insert into alert_triage (org_id, alert_id, alert_hash, disposition, reason, snooze_until, triaged_by)
  values (p_org, p_alert_id, v_hash, p_disposition, p_reason, p_snooze_until, auth.uid())
  on conflict (org_id, alert_id) do update set alert_hash = excluded.alert_hash,
    disposition = excluded.disposition, reason = excluded.reason, snooze_until = excluded.snooze_until,
    triaged_by = excluded.triaged_by, triaged_at = now();
end $$;

-- alert_list: the triage queue and the digest (M12) read alerts with their disposition.
-- Drop first: 0112 (C2) widens this function's `returns table` row with the alert enrichment, and
-- this file is replayed (the local harness applies every migration twice). Without the drop, the
-- replay hits "cannot change return type of existing function" and aborts the whole run — the same
-- trap 0033 records for `platform_whoami`.
drop function if exists public.alert_list(uuid);
create or replace function public.alert_list(p_org uuid)
returns table (alert_id uuid, rule_id text, rule_version int, kind text, reason text,
               evaluated_at timestamptz, disposition text, lineage_hash text, hash text)
language sql stable security definer set search_path = public as $$
  select a.id, a.rule_id, a.rule_version, a.kind, a.reason, a.evaluated_at,
         coalesce(t.disposition, 'open'), a.lineage_hash, a.hash
    from monitor_alerts a
    left join alert_triage t on t.alert_id = a.id and t.org_id = a.org_id
   where a.org_id = p_org
     and (a.org_id = public.jwt_org_id() or public.is_platform_admin())
   order by a.evaluated_at desc, a.id;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants. Tables take no direct write; helper functions are not a client surface.
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('monitor_rule_versions_append_only', 'monitor_rule_version_log',
                         'monitor_alert_chain', 'monitor_alerts_append_only', 'emit_monitor_alert')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$ declare r record; begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('connector_instance_save', 'connector_run_start', 'connector_run_finish',
                         'staged_record_ingest', 'connector_egress_allowed', 'monitor_rule_save',
                         'monitor_rule_release', 'alert_record', 'alert_triage_record', 'alert_list')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- 0111 (Phase 5, C1): the monitor runner and the automation-event dispatcher.
--
-- The defect this closes, verified in the code: `src/lib/writing/monitors.ts` is a real, pure rule
-- engine (`evaluateMonitor` / `runMonitors`), `monitor_rules` and `staged_records` are real tables,
-- and `alert_record` writes a hash-chained alert whose trigger emits the `watcher.signal` catalogue
-- event. But nothing ever *ran* the engine: `grep -rn 'rule_engine_process' src/ supabase/functions/`
-- and `grep -rn 'runMonitors' src/` returned only the module and its unit test. So the outbox
-- `automation_events` filled up and was never drained, and no monitor rule ever produced an alert.
--
-- The shape, and why it is SQL, not an Edge Function:
--   * The dispatch precedent for a *network* effect is `email-dispatch` (0064): pg_cron -> pg_net ->
--     Edge Function, because SMTP is outside the database. Monitoring has no network effect — it
--     reads `staged_records` and writes `monitor_alerts` — so it follows the *other* precedent in
--     `0074_scheduled_jobs.sql`: pg_cron -> a SQL function, exactly like `cap_notification_sweep`
--     and `deployment_requests_escalate_all`. That keeps the runner inside the SQL harness, which
--     CI actually runs; an Edge-Function runner would be untestable here and would be theatre.
--   * NO TRIGGER. `supabase/tests/66_secrets_email_automation.sql` calls `rule_engine_process(event)`
--     by hand and asserts the second call returns 0 (idempotent). A trigger on `automation_events`
--     would process the event at insert and break that assertion. The dispatcher is an explicit RPC
--     the runner calls, so the engine's invocation stays explicit and testable.
--
-- The engine is written twice on purpose (TypeScript for the app's live preview, SQL for the
-- authoritative run) and pinned together by two tests that share one fixture table:
--   * `supabase/tests/112_phase5_monitor_runner.sql` — the SQL side;
--   * `src/lib/writing/monitorRunnerParity.test.ts` — the TypeScript side.
-- Both assert the SAME pinned lineage hashes, so a drift between the two implementations fails.
--
-- M1: grepped migrations and tests for every name below; all are new, none is redefined.
-- M2: every object is `create or replace`; the cron schedule unschedules first behind a check, so a
--     repeat apply never duplicates the job.
-- M6: applied twice and all SQL tests run twice against a local Postgres before the push.

-- ---------------------------------------------------------------------------
-- 0. The alert chain needs a deterministic order. `monitor_alert_chain` (0090) reads the previous
--    alert with `order by created_at desc, id desc`, but `created_at` defaults to `now()`, which is
--    the TRANSACTION time — so every alert written by one sweep shares a timestamp, and the tie is
--    broken on a random uuid. That makes the chain order nondeterministic whenever two alerts are
--    written together, which is exactly what the runner does. A monotonic `seq` fixes it: the same
--    pattern `monitor_rule_versions` already uses. The column backfills existing rows.
-- ---------------------------------------------------------------------------
alter table monitor_alerts add column if not exists seq bigint generated always as identity;

create or replace function public.monitor_alert_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_body text;
begin
  perform pg_advisory_xact_lock(hashtext(new.org_id::text));
  select a.hash into v_prev from monitor_alerts a where a.org_id = new.org_id order by a.seq desc limit 1;
  new.prev_hash := coalesce(v_prev, '');
  v_body := coalesce(v_prev, '') || '|' || new.lineage_hash;
  new.hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Number coercion. Mirrors `toNumber` in src/lib/writing/monitors.ts: a number is itself, a
--    boolean is 1/0, a numeric string parses, anything else is 0. `Number('')` is 0 in JS, so an
--    empty string is 0 here too.
-- ---------------------------------------------------------------------------
create or replace function public.monitor_to_number(p_value jsonb) returns numeric
language sql immutable as $$
  select case
    when p_value is null then 0::numeric
    when jsonb_typeof(p_value) = 'number' then (p_value::text)::numeric
    when jsonb_typeof(p_value) = 'boolean' then (case when p_value::text = 'true' then 1 else 0 end)::numeric
    when jsonb_typeof(p_value) = 'string' then
      case when btrim(p_value #>> '{}') ~ '^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$'
           then (btrim(p_value #>> '{}'))::numeric else 0::numeric end
    else 0::numeric
  end
$$;

comment on function public.monitor_to_number(jsonb) is
  'C1: mirrors toNumber in src/lib/writing/monitors.ts. A rule reads typed values, so the coercion must agree on both sides.';

-- The comparison, mirroring `cmp` in monitors.ts. An unknown operator never fires.
create or replace function public.monitor_cmp(p_value numeric, p_threshold numeric, p_op text)
returns boolean
language sql immutable as $$
  select case p_op
    when 'gt' then p_value > p_threshold
    when 'gte' then p_value >= p_threshold
    when 'lt' then p_value < p_threshold
    when 'lte' then p_value <= p_threshold
    when 'eq' then p_value = p_threshold
    else false
  end
$$;

comment on function public.monitor_cmp(numeric, numeric, text) is
  'C1: mirrors cmp in src/lib/writing/monitors.ts.';

-- A JS-number-like rendering of a numeric, so a reason string reads the same on both sides.
-- `trim_scale(8.0)` -> 8, `trim_scale(8.50)` -> 8.5, matching `String(Number('8.0'))`.
create or replace function public.monitor_number_text(p_value numeric) returns text
language sql immutable as $$
  select trim_scale(coalesce(p_value, 0))::text
$$;

comment on function public.monitor_number_text(numeric) is
  'C1: the JS Number toString rendering of a numeric, so an alert reason matches on both sides.';

-- ---------------------------------------------------------------------------
-- 2. The lineage hash. This is the load-bearing part of the alert chain: `monitor_alert_chain`
--    builds `hash = sha256(prev_hash || '|' || lineage_hash)`, so the lineage hash is what ties an
--    alert to its rule version and to the exact source records. It must be byte-for-byte the value
--    `hashParts` produces in monitors.ts:
--      hashParts(['alert', rule.id, String(rule.version), rule.kind, evaluatedAt,
--                 windowStart ?? '', ...refs.map(r => `${r.type}:${r.id}:${r.contentHash}`)])
--    `hashParts` joins with '|' and SHA-256s the UTF-8 bytes. The two timestamp arguments are TEXT,
--    not timestamptz, so both sides hash the identical string the engine was handed.
-- ---------------------------------------------------------------------------
create or replace function public.monitor_lineage_hash(
  p_rule_id text, p_version int, p_kind text,
  p_evaluated_at text, p_window_start text, p_refs jsonb
) returns text
language sql immutable as $$
  select encode(extensions.digest(
    array_to_string(
      array[
        'alert', p_rule_id, p_version::text, p_kind,
        coalesce(p_evaluated_at, ''), coalesce(p_window_start, '')
      ] || coalesce(
        (select array_agg(
                  coalesce(r ->> 'type', '') || ':' || coalesce(r ->> 'id', '') || ':' || coalesce(r ->> 'contentHash', '')
                  order by ord)
           from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) with ordinality as t(r, ord)),
        '{}'::text[]),
      '|'),
    'sha256'), 'hex')
$$;

comment on function public.monitor_lineage_hash(text, int, text, text, text, jsonb) is
  'C1: mirrors hashParts in src/lib/writing/monitors.ts for the alert lineage. Pinned by tests 112 and monitorRunnerParity.test.ts.';

-- ---------------------------------------------------------------------------
-- 3. monitor_evaluate_org(p_org, p_evaluated_at) — evaluate every released rule over the org's
--    staged records, write an alert for each firing rule, return the number of alerts written.
--
--    The rule kinds are the closed set in monitors.ts. Each branch below is a transcription of the
--    matching `case` in `evaluateMonitor`, including the peak-picking quirk of the threshold kind
--    (`!peak || v > value` keeps the FIRST signal at the maximum) and the "fires when tags are
--    MISSING" direction of the set-membership kind.
--
--    Idempotent by content: an alert whose (rule, version, lineage_hash) is already recorded is not
--    written again, so a re-run of the sweep over unchanged signals adds nothing.
-- ---------------------------------------------------------------------------
create or replace function public.monitor_evaluate_org(p_org uuid, p_evaluated_at text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_eval_ts timestamptz;
  v_rule record;
  v_sig record;
  v_fired boolean;
  v_reason text;
  v_refs jsonb := '[]'::jsonb;
  v_used jsonb := '[]'::jsonb;
  v_window_start text := null;
  v_count int := 0;
  -- per-kind scratch
  v_field text;
  v_op text;
  v_source text;
  v_threshold numeric;
  v_value numeric;
  v_peak_used jsonb;
  v_peak_found boolean;
  v_ordered int;
  v_seen int;
  v_next text;
  v_required text[];
  v_present text[];
  v_missing text[];
  v_interval int;
  v_last_ts timestamptz;
  v_last_ref jsonb;
  v_gap numeric;
  v_left numeric;
  v_right numeric;
  v_left_src text;
  v_right_src text;
  v_lineage text;
begin
  if p_org is null then
    return 0;
  end if;
  v_eval_ts := p_evaluated_at::timestamptz;

  for v_rule in
    select rule_id, version, kind, spec from monitor_rules
     where org_id = p_org and status = 'released'
     order by rule_id, version
  loop
    v_fired := false;
    v_reason := '';
    v_refs := '[]'::jsonb;
    v_window_start := null;
    v_field := v_rule.spec ->> 'field';
    v_op := v_rule.spec ->> 'comparison';
    v_source := v_rule.spec ->> 'source';
    v_threshold := public.monitor_to_number(v_rule.spec -> 'threshold');

    if v_rule.kind = 'threshold' then
      -- value = the maximum of the field; peak = the FIRST signal at that maximum.
      v_value := 0;
      v_peak_found := false;
      v_peak_used := null;
      for v_sig in
        select source, source_id, content_hash, fetched_at, values from staged_records
         where org_id = p_org and (v_source is null or source = v_source)
         order by fetched_at asc, source_id asc
      loop
        if not v_peak_found or public.monitor_to_number(v_sig.values -> v_field) > v_value then
          v_value := public.monitor_to_number(v_sig.values -> v_field);
          v_peak_found := true;
          v_peak_used := jsonb_build_object(
            'type', 'signal', 'id', v_sig.source || ':' || v_sig.source_id,
            'contentHash', v_sig.content_hash);
        end if;
      end loop;
      v_fired := public.monitor_cmp(v_value, v_threshold, v_op);
      if v_fired then
        v_refs := case when v_peak_used is null then '[]'::jsonb else jsonb_build_array(v_peak_used) end;
        v_reason := format('the highest %s is %s, which is %s the threshold %s',
          v_field, public.monitor_number_text(v_value), v_op, public.monitor_number_text(v_threshold));
      end if;

    elsif v_rule.kind = 'rate' then
      v_window_start := to_char((v_eval_ts - make_interval(secs => coalesce((v_rule.spec ->> 'windowSeconds')::int, 0)))
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
      v_ordered := 0;
      v_used := '[]'::jsonb;
      for v_sig in
        select source, source_id, content_hash, fetched_at from staged_records
         where org_id = p_org
           and (v_source is null or source = v_source)
           and fetched_at >= v_eval_ts - make_interval(secs => coalesce((v_rule.spec ->> 'windowSeconds')::int, 0))
           and fetched_at <= v_eval_ts
         order by fetched_at asc, source_id asc
      loop
        v_ordered := v_ordered + 1;
        v_used := v_used || jsonb_build_array(jsonb_build_object(
          'type', 'signal', 'id', v_sig.source || ':' || v_sig.source_id, 'contentHash', v_sig.content_hash));
      end loop;
      v_value := v_ordered;
      v_fired := public.monitor_cmp(v_value, v_threshold, v_op);
      if v_fired then
        v_refs := v_used;
        v_reason := format('%s signals occurred in the %s second window, which is %s the threshold %s',
          v_value::text, (v_rule.spec ->> 'windowSeconds'), v_op, public.monitor_number_text(v_threshold));
      end if;

    elsif v_rule.kind = 'sequence' then
      -- Walk the ordered signals; each step consumes the next field when it is non-zero. The
      -- reference set is the WHOLE scoped signal list when the rule fires, matching `used = ordered`.
      v_seen := 0;
      for v_sig in
        select source, source_id, content_hash, fetched_at, values from staged_records
         where org_id = p_org and (v_source is null or source = v_source)
         order by fetched_at asc, source_id asc
      loop
        v_next := v_rule.spec -> 'sequence' ->> v_seen;
        if v_next is not null and public.monitor_to_number(v_sig.values -> v_next) <> 0 then
          v_seen := v_seen + 1;
        end if;
      end loop;
      -- Matches `seen.length === fields.length` exactly: an empty sequence fires, as in the engine.
      v_fired := v_seen >= jsonb_array_length(coalesce(v_rule.spec -> 'sequence', '[]'::jsonb));
      if v_fired then
        v_refs := (select coalesce(jsonb_agg(jsonb_build_object(
                     'type', 'signal', 'id', s.source || ':' || s.source_id, 'contentHash', s.content_hash)
                     order by s.fetched_at asc, s.source_id asc), '[]'::jsonb)
                   from staged_records s
                   where s.org_id = p_org and (v_source is null or s.source = v_source));
        v_reason := format('the ordered steps %s all occurred',
          array_to_string(array(select jsonb_array_elements_text(v_rule.spec -> 'sequence')), ' then '));
      end if;

    elsif v_rule.kind = 'set_membership' then
      -- Fires when a REQUIRED tag is MISSING.
      select coalesce(array_agg(distinct t.tag), '{}')
        into v_present
        from staged_records s, jsonb_array_elements_text(coalesce(s.tags, '[]'::jsonb)) as t(tag)
       where s.org_id = p_org and (v_source is null or s.source = v_source);
      select coalesce(array_agg(x), '{}') into v_required
        from jsonb_array_elements_text(coalesce(v_rule.spec -> 'requiredTags', '[]'::jsonb)) as x;
      v_missing := array(select r from unnest(v_required) r where not (r = any(v_present)));
      v_fired := array_length(v_missing, 1) is not null and array_length(v_missing, 1) > 0;
      if v_fired then
        v_refs := (select coalesce(jsonb_agg(jsonb_build_object(
                     'type', 'signal', 'id', s.source || ':' || s.source_id, 'contentHash', s.content_hash)
                     order by s.fetched_at asc, s.source_id asc), '[]'::jsonb)
                   from staged_records s
                   where s.org_id = p_org and (v_source is null or s.source = v_source));
        v_reason := format('the required tags %s were not present', array_to_string(v_missing, ', '));
      end if;

    elsif v_rule.kind = 'missing_event' then
      v_interval := coalesce((v_rule.spec ->> 'expectedEverySeconds')::int, 0);
      select s.fetched_at,
             jsonb_build_object('type', 'signal', 'id', s.source || ':' || s.source_id, 'contentHash', s.content_hash)
        into v_last_ts, v_last_ref
        from staged_records s
       where s.org_id = p_org and (v_source is null or s.source = v_source)
       order by s.fetched_at desc, s.source_id desc limit 1;
      if v_last_ts is null then
        v_fired := true;
        v_reason := 'no event of the expected kind was seen';
      else
        v_gap := extract(epoch from (v_eval_ts - v_last_ts));
        v_fired := v_gap > v_interval;
        if v_fired then
          v_refs := jsonb_build_array(v_last_ref);
          v_reason := format('no event occurred for %s seconds, more than the expected %s',
            round(v_gap)::text, v_interval::text);
        end if;
      end if;

    elsif v_rule.kind = 'reconciliation' then
      v_left_src := v_rule.spec -> 'reconcile' ->> 'left';
      v_right_src := v_rule.spec -> 'reconcile' ->> 'right';
      select coalesce(sum(public.monitor_to_number(s.values -> v_field)), 0) into v_left
        from staged_records s where s.org_id = p_org and s.source = v_left_src;
      select coalesce(sum(public.monitor_to_number(s.values -> v_field)), 0) into v_right
        from staged_records s where s.org_id = p_org and s.source = v_right_src;
      v_fired := v_left <> v_right;
      if v_fired then
        v_refs := (select coalesce(jsonb_agg(jsonb_build_object(
                     'type', 'signal', 'id', s.source || ':' || s.source_id, 'contentHash', s.content_hash)
                     order by s.fetched_at asc, s.source_id asc), '[]'::jsonb)
                   from staged_records s
                   where s.org_id = p_org and s.source in (v_left_src, v_right_src));
        v_reason := format('%s totals %s and %s totals %s, which differ',
          v_left_src, public.monitor_number_text(v_left), v_right_src, public.monitor_number_text(v_right));
      end if;
    end if;

    if v_fired then
      v_lineage := public.monitor_lineage_hash(
        v_rule.rule_id, v_rule.version, v_rule.kind, p_evaluated_at, v_window_start, v_refs);
      -- Dedup on the SIGNAL SET, not on the lineage hash: the lineage hash includes the evaluation
      -- time, so keying on it would re-alert for an unchanged condition on every five-minute sweep.
      -- A rule that fires again on exactly the same records is the same finding, not a new one; a
      -- new record changes the reference set and fires a new alert.
      if not exists (
        select 1 from monitor_alerts a
         where a.org_id = p_org and a.rule_id = v_rule.rule_id
           and a.rule_version = v_rule.version and a.refs = v_refs
      ) then
        perform public.alert_record(
          p_org, v_rule.rule_id, v_rule.version, v_rule.kind, v_reason, v_refs,
          v_eval_ts, case when v_window_start is null then null else v_window_start::timestamptz end,
          v_lineage);
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end $$;

comment on function public.monitor_evaluate_org(uuid, text) is
  'C1: evaluates every released monitor rule over an organisation''s staged records and writes a hash-chained alert for each firing rule. Mirrors runMonitors in src/lib/writing/monitors.ts.';

-- verify_monitor_chain: an organisation's alerts form an unbroken chain. Mirrors `verifyAlertChain`
-- in src/lib/writing/monitors.ts. Returns true when every alert's hash follows from its predecessor.
create or replace function public.verify_monitor_chain(p_org uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_prev text := '';
  v_rec record;
begin
  for v_rec in
    select prev_hash, hash, lineage_hash from monitor_alerts
     where org_id = p_org order by seq asc
  loop
    if v_rec.prev_hash <> v_prev then
      return false;
    end if;
    if v_rec.hash <> encode(extensions.digest(coalesce(v_prev, '') || '|' || v_rec.lineage_hash, 'sha256'), 'hex') then
      return false;
    end if;
    v_prev := v_rec.hash;
  end loop;
  return true;
end $$;

comment on function public.verify_monitor_chain(uuid) is
  'C1: mirrors verifyAlertChain in src/lib/writing/monitors.ts. A tampered alert breaks the chain.';

-- ---------------------------------------------------------------------------
-- 4. automation_dispatch_pending(p_org, p_limit) — drain the automation_events outbox for one org.
--    Selects pending events (those with no automation_event_processed row), in id order, up to the
--    limit, and runs the two consumers per event: `rule_engine_process` (notify / set_flag / webhook)
--    and `escalation_evaluate` (escalate actions). Returns the number of events acted on.
--
--    This is the missing drain. It is an explicit RPC, NOT a trigger, so SQL test 66's direct
--    `rule_engine_process(event)` call and its idempotency assertion are unaffected.
-- ---------------------------------------------------------------------------
create or replace function public.automation_dispatch_pending(p_org uuid, p_limit int default 100)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_event bigint;
  v_acted int := 0;
  v_n int;
begin
  if p_org is null then
    return 0;
  end if;
  for v_event in
    select e.id from automation_events e
     where e.org_id = p_org
       and not exists (select 1 from automation_event_processed p where p.event_id = e.id)
     order by e.id asc
     limit greatest(coalesce(p_limit, 100), 0)
  loop
    v_n := public.rule_engine_process(v_event);
    perform public.escalation_evaluate(v_event);
    if v_n > 0 then
      v_acted := v_acted + 1;
    else
      -- The event was consumed (marked processed) even when no rule matched, so it is still progress.
      v_acted := v_acted + 1;
    end if;
  end loop;
  return v_acted;
end $$;

comment on function public.automation_dispatch_pending(uuid, int) is
  'C1: drains the automation_events outbox for one organisation through rule_engine_process and escalation_evaluate. No trigger, so test 66''s direct call stays valid.';

-- ---------------------------------------------------------------------------
-- 5. monitor_runner_sweep(p_limit) — the scheduled entry point. For every organisation: evaluate
--    the monitor rules, then drain the automation-event outbox. Returns the total alerts written.
-- ---------------------------------------------------------------------------
create or replace function public.monitor_runner_sweep(p_limit int default 100)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_total int := 0;
  v_eval text;
begin
  -- One evaluation instant for the whole sweep, in the canonical ISO form the engine hashes.
  v_eval := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  for v_org in select id from orgs loop
    v_total := v_total + public.monitor_evaluate_org(v_org, v_eval);
    perform public.automation_dispatch_pending(v_org, p_limit);
  end loop;
  return v_total;
end $$;

comment on function public.monitor_runner_sweep(int) is
  'C1: the scheduled monitor runner. Evaluates every organisation''s released rules and drains the event outbox.';

-- ---------------------------------------------------------------------------
-- 6. The schedule. Every five minutes, guarded on pg_cron so a bare local Postgres (no pg_cron)
--    still applies this migration — the same guard 0074 uses.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not available; the monitor-runner schedule was not created (it remains an explicit call).';
    return;
  end if;
  begin perform cron.unschedule('monitor-runner'); exception when others then null; end;
  perform cron.schedule('monitor-runner', '*/5 * * * *', $job$select public.monitor_runner_sweep(100)$job$);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants. The runner and its dispatcher are platform/service only; no tenant caller needs them.
--    The pure helpers are not a client surface either. Nothing here is granted to anon.
-- ---------------------------------------------------------------------------
revoke execute on function public.monitor_runner_sweep(int) from public, anon, authenticated;
revoke execute on function public.automation_dispatch_pending(uuid, int) from public, anon, authenticated;
revoke execute on function public.monitor_evaluate_org(uuid, text) from public, anon, authenticated;
revoke execute on function public.monitor_lineage_hash(text, int, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.monitor_to_number(jsonb) from public, anon, authenticated;
revoke execute on function public.monitor_cmp(numeric, numeric, text) from public, anon, authenticated;
revoke execute on function public.monitor_number_text(numeric) from public, anon, authenticated;
revoke execute on function public.verify_monitor_chain(uuid) from public, anon;
grant execute on function public.verify_monitor_chain(uuid) to authenticated, service_role;
grant execute on function public.monitor_runner_sweep(int) to service_role;
grant execute on function public.automation_dispatch_pending(uuid, int) to service_role;
grant execute on function public.monitor_evaluate_org(uuid, text) to service_role;
grant execute on function public.monitor_lineage_hash(text, int, text, text, text, jsonb) to service_role;
grant execute on function public.monitor_to_number(jsonb) to service_role;
grant execute on function public.monitor_cmp(numeric, numeric, text) to service_role;
grant execute on function public.monitor_number_text(numeric) to service_role;

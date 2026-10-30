# Stream S5 — monitor + connector runtime C1/C3 (`feature/build-monitor-runtime`)

Cut from the trunk after the mount points. Owns the monitor runtime (moving
`src/lib/systeligon/monitors.ts` to `src/lib/monitor/**`), `src/lib/writing/monitors.ts` (read-only to
others), `src/data/connectors*.ts`, `src/lib/systeligon/connectorCatalogue.ts`,
`src/data/notifications.ts`, `src/data/email*.ts`, `src/components/monitor/**`,
`src/components/writing/**` (the mounted connector screen OA-23 lives there), and the `monitor-` /
`connector-` / `alert-` testids. Migrations `0169`–`0178`.

## Scope
The dead monitor runtime: `rule_engine_process`, `alert_record`, the scheduled runner, alert→Work Queue
delivery; the connector runtime: `connector_run_start/_finish`, `staged_record_ingest`, the 22 adapters.
Specs: `docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md` C1/C3.

## Rows
F49 (monitor rules), F50 (monitor runner), F51 (alert persistence), F52 (alert→Work Queue),
F57 (connector run start/finish), F58 (staged record ingest), F59 (22 adapters), F96 (in-app
notification delivery).

## Queue
1. Baseline + tree whole.
2. The scheduled runner on `pg_cron`: `rule_engine_process` runs the monitor rules, persists alerts via
   `alert_record`, emits `watcher.signal`. Wire it to a real caller.
3. Alert→Work Queue delivery, with a test that proves delivery into the queue (F96).
4. Connector runtime: `connector_run_start` → `staged_record_ingest` → `connector_run_finish`, the 22
   adapters as data with a runner.
5. Scale: the monitor run over the large-tenant shape (SCALE-PROGRAMME §5 flows 16, 17).

## Flows (happy + bad)
- Monitor run: happy — a rule fires, the alert persists, the signal emits; bad — the loop guard (an
  action cannot trigger its own rule) and the rate limit (>20 events/rule/hour auto-pauses with a
  notice).
- Connector run: happy — start → ingest → finish; bad — ingest without start refused; double finish
  refused; bad credentials refused with a reason.

## Acceptance
- F49–F52, F57–F59, F96 each with a call site (a scheduled job or screen) + a test.
- Delivery into the Work Queue is proven, not assumed.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|

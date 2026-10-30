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
| F57 | `Inert` | `Wired` | `runConnector` (`src/data/connectors.ts:96`) starts with `connector_run_start` and closes with `connector_run_finish`; called from the `Run now` button in `ConnectorMonitorPanel.tsx:196` | `src/data/connectors.test.ts` (6), `src/components/writing/ConnectorMonitorPanel.test.tsx` (3), `supabase/tests/139_connector_run_guards.sql` (4) | 0169 | this commit |
| F58 | `Inert` | `Wired` | `runConnector` writes each mapped row with `staged_record_ingest` (`src/data/connectors.ts:56`); duplicate content hash counted `skipped` | `src/data/connectors.test.ts` (6), `supabase/tests/139_connector_run_guards.sql` (4) | 0169 | this commit |
| F59 | `Inert` | `Wired` | `runConnector` resolves the adapter with `connectorById` and drives `fetch`/`map` through `browserTransport` (`src/data/connectors.ts`) | `src/components/writing/ConnectorMonitorPanel.test.tsx` (3) | — | this commit |

### Notes
- 0169 adds the connector-run lifecycle guards: a second finish is refused (`the run is already
  finished`), a second start on a busy instance is refused (`a run is already in progress`), and an
  ingest against a foreign/unknown run is refused (`no such run for this connector instance`). Each
  refusal writes nothing. Staging after a finished run stays accepted (test 97 reconciles a finished
  run), so the ingest guard is the run's existence and ownership, not its status.
- The register total is now 125 Wired / 1 Inert / 19 Absent (the one remaining Inert is F128,
  `RuleRegistry`/`packRules`). The integrator folds this table into the shared ledger.
- Scale (SCALE-PROGRAMME §5 flow 16): `140_monitor_scale.sql` runs one released threshold rule over a
  batch sized by `provio_test.scale_factor` (default 1), proving the rule fires exactly once over the
  whole batch, the reason names the batch maximum, the chain verifies, and a later sweep over the
  unchanged batch writes nothing. F49/F50 stay `Wired` — this is the scale evidence, not a new row.
- Scale (SCALE-PROGRAMME §5 flow 17): `139_connector_run_guards.sql` §5 runs a batch whose size is the
  GUC `provio_test.scale_factor` (default 1; a dedicated run raises it), proves every record stages
  once, the run count is exact, and a replayed batch stages nothing new. The structure is the same at
  any factor.
- Bad credentials (flow 17's other bad path) are refused in the browser transport before any request
  leaves: a non-GET/POST method and a host off the allow-list both throw, proved in
  `src/data/connectors.test.ts`.

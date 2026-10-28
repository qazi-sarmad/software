> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# COMPLETION-EVENTS — every catalogue event, its source, its emitter

Written for C2.3. The catalogue is `automation_events_catalogue` (migration 0055), 28 keys. Before
this task only five keys had an emitter; the rest were selectable in the rule editor and could never
fire. This file is the measured position after migration 0075 and SQL test 84.

The rule test 84 enforces: a catalogue key must have an emitter (a function named in the test's map)
or a row in `event_emitter_allowlist` with a stated reason. The allow-list is deliberately two rows.

| Event key | Source object | Emitter | Emits |
|---|---|---|---|
| config.changed | config history tables | `config_area_notify` (0051 trigger) | on insert into any area history table whose policy is not `none`/`platform_only` |
| ai_model.changed | config history tables | `config_area_notify` (0051 trigger) | on insert where the area's policy is `platform_only` |
| cap.due_soon | caps | `cap_notification_sweep` (0074) | daily job, once per cap per day inside the due-soon window |
| cap.overdue | caps | `cap_notification_sweep` (0074) | daily job, once per cap per day past its due date |
| hosting.migration.started | migration jobs | `migration_job_create` (0069) | when a migration job row is created |
| hosting.migration.completed | migration jobs | `migration_job_create` (0069) | when the job reaches completed |
| hosting.migration.failed | migration jobs | `migration_job_create` (0069) | when the job reaches failed |
| engagement.sealed | engagements | `emit_engagement_sealed` (0075 trigger) | on the `sealed` false→true flip |
| finding.sealed | findings | `emit_engagement_sealed` (0075 trigger) | once per finding of the engagement at the moment it seals |
| certificate.issued | engagement_certificates | `emit_certificate_change` (0075 trigger) | when a certificate row first reaches `issued` |
| certificate.revoked | engagement_certificates | `emit_certificate_change` (0075 trigger) | on the transition to `revoked` |
| board_pack.generated | board_pack_history | `emit_board_pack_generated` (0075 trigger) | on insert of a generated pack |
| report.frozen | report_versions | `emit_report_change` (0075 trigger) | on the transition to `frozen` |
| report.issued | report_versions | `emit_report_change` (0075 trigger) | on the transition to `issued_*` |
| invite.sent | auth_invites | `emit_invite_sent` (0075 trigger) | on insert of a queued invitation |
| auditor.invited | external_auditor_invites | `emit_auditor_invited` (0075 trigger) | on insert of an auditor invitation |
| auditor.revoked | external_auditor_access | `emit_auditor_revoked` (0075 trigger) | when the access row is deactivated |
| auditor.accessed | external_access_log | `emit_auditor_accessed` (0075 trigger) | on each row the `ext_*` read trail writes |
| email.failed | email_queue | `emit_email_failed` (0075 trigger) | when a queue row first reaches `failed` |
| ai.call_failed | ai_calls | `emit_ai_call_failed` (0075 trigger) | on insert where `flags->>'ok' = 'false'` |
| feature.changed | tenant_entitlements | `emit_feature_changed` (0075 trigger) | on insert, or when `enabled`/`plan_name` moves |
| setup.completed | setup_state | `emit_setup_completed` (0075 trigger) | when the `org_admin` step `org.golive` reaches `done` |
| consultation.requested | consultation_events | `emit_consultation_event` (0075 trigger) | on insert of that key |
| consultation.started | consultation_events | `emit_consultation_event` (0075 trigger) | on insert of that key |
| consultation.ended | consultation_events | `emit_consultation_event` (0075 trigger) | on insert of that key |
| consultation.proposal | consultation_events | `emit_consultation_event` (0075 trigger) | on insert of that key |
| escalation.triggered | deployment_requests | `deployment_requests_escalate_all` (0074) | hourly job, when it escalates at least one request |
| anomaly.raised | none | none — allow-listed | no source: see below |
| watcher.signal | none | none — allow-listed | no source: see below |

## Keys with no source

| Event key | Reason |
|---|---|
| anomaly.raised | Anomaly detection is a pure client-side function over the sample rows (`src/lib/analytics.ts`). There is no server-side anomaly record to emit from; inventing one would break L1 (deterministic audit logic). The rule stays selectable in the editor but cannot fire until a server-side detector exists. Recorded in `event_emitter_allowlist`. |
| watcher.signal | Reserved for the parked watchers feature (see NOT-DONE). Not in the catalogue; it is in the allow-list so that the list is the complete record of keys without an emitter. |

## Field catalogue

`automation_event_fields` (0055) holds the fields the rule editor offers. Each emitter above puts the
fields its key declares into the payload; test 84 asserts the payload fields for the newly wired
keys (`days_overdue`, `days_due`, `severity`, `error`, `error_text`, `subject`, `feature_key`,
`engagement_id`, `certificate_id`, `board_pack_id`, `report_version_id`, `email`, `function_name`).

## How to re-measure

```sh
psql "$DB" -c "select c.event_key, exists(select 1 from pg_proc p where p.proname like 'emit\_%')
                 from automation_events_catalogue c"
```
and run `supabase/tests/84_event_emitters.sql`, which fails on any key that has neither an emitter
nor an allow-list row.

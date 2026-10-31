# Stream S6 — configuration honesty R3 (`feature/build-config-honesty`)

Cut from the trunk after the mount points. Owns `src/lib/lifecycle/**`, `src/data/lifecycle*.ts`,
`src/components/admin/**` (OrgControlPanel and the settings screens — **except**
`src/components/admin/RulePackPanel.tsx`, which is S1's), and the `lifecycle-` / `signoff-` /
`workflow-` testids. Migrations `0179`–`0188`.

## Scope
The R3 rows: settings that are stored and displayed but that no code reads. Make each one READ, or
record honestly that it is inert. Spec: `docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md` R3.

## Rows
F35/F75 (report templates), F72 (`testing_mode`), F73 (`signoff_role_*`), F74 (`approval_chain`),
F76 (`anchoring_settings`), F78 (`report_opinion_required`), F79 (workflow SLA/escalation),
F85 (support access grant/revoke), F30 (configurable stage machine).

## Queue
1. Baseline + tree whole.
2. `testing_mode`: the sign path reads it (F72).
3. `signoff_role_*`: `sign_planning` / `sign_off_workpaper` / `sign_conclusion` read the configured
   roles and enforce the chain (F73).
4. `approval_chain`: consulted for the decision (F74).
5. `report_templates` readers called (F35/F75); `anchoring_settings` read by the sealing path (F76);
   `report_opinion_required` enforced (F78); SLA/escalation read by the decision path (F79).
6. Support access grant/revoke: a real caller + logging (F85).
7. F30: the stage machine configurable (the three hardcoded strings become config).
8. Scale: sign-off under concurrency (SCALE-PROGRAMME §5 flows 3, 4).

## Flows (happy + bad)
- Two-stage approval: happy — both stages enforced; bad — a one-stage config gives one-stage behaviour,
  and a configured role that is not held refuses the sign with a reason.
- Setting save: happy — saved, versioned, reason-stamped; bad — a setting NO code reads is FLAGGED,
  never silently accepted (the R3 honesty rule).
- Seal: happy — sealed with the anchor + timestamp authority read from settings; bad — a missing anchor
  is named, not defaulted silently.

## Acceptance
- Every R3 row is either READ (with a call site + test) or recorded honestly as inert with the reason.
- The "config that does nothing" defect is closed: a saved setting has a behavioural effect or is flagged.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
| F30 | Absent | Wired | `src/components/admin/StageMachinePanel.tsx:158` (mounted by `OrgGovernancePanel.tsx:176`); read path `src/data/lifecycle.ts:48`; DB write path `supabase/migrations/0179_stage_machine.sql:207` (`set_engagement_stage` reads the machine) | `src/components/admin/StageMachinePanel.test.tsx` (5), `supabase/tests/138_stage_machine.sql` (happy + 6 refusals), `supabase/tests/102_phase2_lifecycle.sql` (unchanged default behaviour) | `0179_stage_machine.sql` | pending |
| F85 | Absent | Wired | `src/components/superadmin/SuperAdminSupport.tsx` (grant/revoke/list) | `src/components/superadmin/SuperAdminSupport.test.tsx` (9) | `0031_platform_control_plane.sql` | pending |
| F35 | Inert | Wired | `compose_report` reads `report_templates.plan->'sections'` (`0108_phase3_report_templates.sql:140`) | `supabase/tests/109_phase3_report_templates.sql` §3 | `0108` | — |
| F72 | Inert | Wired | `assert_conclusion_ready`, `set_engagement_stage` read `org_lifecycle_settings.testing_mode` | `supabase/tests/102_phase2_lifecycle.sql` §2 | `0101` | — |
| F73 | Inert | Wired | `caller_meets_signoff_role` in `sign_planning` (`0101:19`), `sign_off_workpaper`, `sign_conclusion` | `102_phase2_lifecycle.sql` §3, `108_phase3_workflow_enforcement.sql` §4 | `0101` | — |
| F74 | Inert | Wired | `approve_plan` consults `approval_chain_ready` (`0101:347`) | `102_phase2_lifecycle.sql` §4 | `0101` | — |
| F75 | Inert | Wired | as F35 (`0108:140`) | `109_phase3_report_templates.sql` §3 | `0108` | — |
| F76 | Inert | Wired | `seal_engagement` path reads `anchoring_min_authorities` (`0096_integrity_anchoring.sql:202`, `:325`) | `supabase/tests/121_integrity_anchoring.sql` | `0096` | — |
| F78 | Inert | Wired | `sign_conclusion` reads `org_lifecycle_settings.report_opinion_required` (`0109:66`) | `supabase/tests/110_phase3_config_effects.sql` §1 | `0109` | — |
| F79 | Inert | Wired | `escalate_overdue_deployment_requests` / `deployment_requests_escalate_all` read SLA + escalation | `108_phase3_workflow_enforcement.sql` §1–3 | `0023`, `0074` | — |

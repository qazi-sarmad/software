# Stream S4 — platform control D11/D12/D13 (`feature/build-platform-control`)

Cut from the trunk after the mount points. Owns `src/components/superadmin/**`,
`src/data/platform*.ts`, `src/data/entitlements.ts`, `src/data/deployment.ts`, and the `superadmin-` /
`orgcontrol-` / `complaint-` / `diagnostic-` testids. Migrations `0159`–`0168`.

## Scope
D11 (the three universes + their rule packs), D12 (actionable traffic signals + complaint management +
self-diagnostic), D13 (deployment readiness). Specs: `docs/AUDIT-DOMAINS-MODEL.md`,
`docs/STANDARDS-DISTRIBUTION.md`, `docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md` D11–D13.

## Rows
F140 (D11), F141 (D12), F142 (D13).

## Queue
1. Baseline + tree whole.
2. D11: seed three default universes (Management / Shari'ah / IT); set + read `universes.domain`; key a
   rule pack to it; the IT pack (COBIT/ISO/NIST) and the Shari'ah pack (AAOIFI SS 1–54 + the SBP
   Compendium + the SGF). S1 owns the pack data; S4 owns the universe screen + the pack selection.
3. D12: extend `platform_provisioning_status` (0097) into a full signal set; every non-green signal
   carries a "Fix this" deep-link and a "Contact Super Admin" action; `complaints` table +
   `complaint_create` (auto-generates the issue with logs, emails the Super Admin);
   `runDiagnostic(signalId)` per-issue, segregated, never mutating.
4. D13: the three-layer deployment readiness section + `docs/DEPLOYMENT-RUNBOOK.md`.
5. Scale: the readiness panel at 500 orgs (SCALE-PROGRAMME §5 flows 20, 21, 22).

## Flows (happy + bad)
- Universe discipline: happy — a universe of each discipline runs its own pack; bad — an org-defined
  fourth discipline works too (never hard-code three).
- Traffic signal: happy — green/amber/red with a reason; bad — an un-evaluated check is AMBER, never
  green; a failed rollout shows the reason, never a tick.
- Complaint: happy — code minted, bundle + email; bad — email fails → the complaint is still recorded
  and retried, never lost.
- Diagnostic: happy — one signal in isolation, recorded; bad — a diagnostic never mutates state.

## Acceptance
- F140/F141/F142 each with a call site + test.
- Every non-green signal has a Fix-this link and a Contact-Super-Admin action; a complaint carries a
  code and an auto-generated log bundle; a diagnostic changes no state.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|

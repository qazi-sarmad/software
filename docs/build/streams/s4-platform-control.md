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
| F140 (D11) | Absent | Wired | `SuperAdminDomains.tsx` (SA-19, `SuperAdminPortal.tsx:200`); `seedDefaultUniverses`/`setUniverseDomain`/`universeDiscipline` (`src/data/platformDomains.ts`); `disciplineRuleBase` (`src/lib/systeligon/disciplinePacks.ts`) | `SuperAdminDomains.test.tsx` (7), `rules/disciplines.test.ts` (9), `supabase/tests/148_audit_domains.sql` | `0159_audit_domains.sql` | (this commit) |

### D11 — what was built

`universes.domain` existed (0003) but no screen read or set it and no rule pack was keyed to a
discipline (docs/AUDIT-DOMAINS-MODEL.md §2). D11 is the wiring:

- **`0159_audit_domains.sql`** — `seed_default_universes(p_org)` (three defaults, idempotent by
  discipline), `set_universe_domain(id, domain, reason)` (validated slug, reason-stamped, ledgered;
  refuses blank/malformed/unknown), `universe_discipline(id)` (org-scoped read). No table CHECK: the
  set is closed-but-extensible, so an org-defined fourth discipline is accepted.
- **`src/lib/systeligon/rules/disciplines.ts`** (pre-authored this session) — the IT control rules
  (COBIT 2019 / ISO 27001 / NIST SP 800-53) and the Shari'ah structural rules (AAOIFI SS 1–54 + SBP
  Compendium + SGF); every rule cites its source.
- **`src/lib/systeligon/disciplinePacks.ts`** — the one place a discipline becomes a rule base.
- **`SuperAdminDomains.tsx`** (SA-19) — seeds, sets a discipline with a reason, shows each
  discipline's rule base read from the engine, and flags a legacy/unknown domain rather than guessing.


| F141 (D12) | Absent | Wired | `SuperAdminReadiness.tsx` (SA-20, `SuperAdminPortal.tsx:203`, tab `readiness`) + `OrgReadinessPanel.tsx` (OA-42, `OrgControlPanel.tsx:298`, tab `readiness`); `platformReadiness`/`runDiagnostic`/`createComplaint`/`listComplaints`/`listComplaintEvents`/`assignComplaint`/`commentComplaint`/`resolveComplaint`/`listPlatformAdmins` + `orgReadiness`/`runOrgDiagnostic`/`createOrgComplaint`/`listOrgComplaints` (`src/data/readiness.ts`) | `SuperAdminReadiness.test.tsx` (12), `OrgReadinessPanel.test.tsx` (7), `supabase/tests/149_readiness_complaints.sql` §1–10 | `0160_readiness_signals.sql`, `0161_complaints.sql` | (this commit) |
| F142 (D13) | Absent | Wired | three-layer readiness section (`sa-readiness-layers`) in `SuperAdminReadiness.tsx` (SA-20) + `docs/DEPLOYMENT-RUNBOOK.md` | `SuperAdminReadiness.test.tsx` ("shows the three deployment layers with an honest per-layer verdict") | `0160_readiness_signals.sql` | (this commit) |

### D12/D13 — what was built

`platform_provisioning_status` (0097) counted + returned booleans but no screen read it and no signal
carried its fix. D12/D13 are the wiring:

- **`0160_readiness_signals.sql`** — the `readiness_signals` catalogue (seeded: `platform_sender`,
  `signing_key`, `classification`, `roles_seeded`, `storage_buckets`, `edge_functions`), each with a
  layer, a severity, a remediation and a fix target; `readiness_verdict(check, reason)` (green/amber/
  red with the reason in words); `platform_readiness_signals(p_org)` (all layers) and
  `org_readiness_signals()` (organisation layer only — the environment layer never crosses to a tenant,
  L2); `run_readiness_diagnostic(p_org, p_signal)` / `org_run_readiness_diagnostic(p_signal)` — one
  signal in isolation, recorded on the ledger, mutating no inspected state. An unevaluated check is
  amber ("not evaluated: …"), never green by default.
- **`0161_complaints.sql`** — `complaints` (org_id, code, severity, source_signal, title, body, status,
  created_by, assigned_to, created_at, resolved_at, resolution_reason) with an org-scoped human-readable
  code minted per-org (`PRV-<suffix>-NNNN`, an atomic per-org counter so a global sequence never leaks
  the platform's total volume, L2); an append-only `complaint_events` trail; `complaint_create`
  (auto-generates the bundle: the failed check, its reason, the layer, the readiness output and the
  state), `org_complaint_create` (the tenant path, gated on `edit_config`), `complaint_list` /
  `org_complaint_list`, `complaint_events_list`, `complaint_assign`, `complaint_comment`,
  `complaint_resolve` (reason required, config-as-ledger), `platform_list_admins` (the assignment
  picker, platform-only). The email to the platform administrators reuses the existing email-dispatch
  machinery and the platform-sender configuration; a failed send never loses the complaint.
- **`src/data/readiness.ts`** — the data module (RPC-only; no component reaches the client).
- **`SuperAdminReadiness.tsx`** (SA-20) — the livid traffic-signal surface: every signal with its
  verdict and reason, the three deployment layers with honest per-layer verdicts, and Fix this /
  Re-check / Contact Super Admin on every non-green signal; the complaint register with filter, trail,
  assignment, comments and a reasoned resolution.
- **`OrgReadinessPanel.tsx`** (OA-42) — the tenant half: the same verdicts for the organisation's own
  checks, the self-diagnostic per signal, and this organisation's complaints. The environment layer is
  never shown here (L2).
- **`docs/DEPLOYMENT-RUNBOOK.md`** (D13) — the three layers, the exact commands, the required variables
  and the order; the panel points at it for the two layers the database cannot read.

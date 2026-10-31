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

# Phase 3 — plan

Phase 3 builds the audit substance on top of the Phase 2 access layer: universes and approved
entities, the SIRA model and engine, SIRA cycles and emergent risks, the audit plan with hash-chained
versions, the deployment gate, and combined approval. Source of truth: `docs/SPEC-v10.md` §§1, 2, 6,
7, 7.1, 8, 9, 23, 25, 26, 29.

## Exists vs to-build

### Already exists (Phase 1–2), reused as-is

| Object | Where | Note |
|---|---|---|
| `universes`, `entities` (with `approved` bool) | `0003_structure.sql` | Phase 3 adds approval status, kind and the approval workflow; it does not create a second entity table. |
| `engagements` (stage, sealed, ad_hoc, plan_id) | `0003` | Deployment gate creates/locks engagements. |
| `engagement_members`, `team_role_rights`, `assign_team_role` | `0003`, `0013`, `0016` | Team roles map to rights. |
| `risks_library` | `0003` | Phase 3 extends it into the SIRA risk library (per-universe selection). |
| `sira_cycles`, `sira_scores` | `0003` | Phase 3 adds the model, factor values, publication freeze. |
| `plans`, `plan_versions` | `0003` | Phase 3 adds plan items and links versions to approvals. |
| `ledger_entries` + `chain_ledger_entry()` + `append_ledger_entry()` | `0005`, `0006`, `0007` | Every hash-chained write goes through these. |
| `activity_log`, `config_versions` | `0005` | Versioned, logged changes. |
| `caller_has_right`, `is_cia`, `is_org_admin`, `can_read_all_scopes`, `has_scope` | `0007`, `0016` | The only access predicates. |
| `rights_keys_valid`, role matrix | `0012` | The closed rights list. |
| admin RPCs (`admin_*`) | `0017` | Pattern for a rights-checked, versioned, logged write. |

### To build in Phase 3

| Area | Spec | Migration | SQL test | App |
|---|---|---|---|---|
| Entity approval statuses, submit/decide, per-org configuration of which right initiates/approves, entity history, scope RLS | §6 | `0018_universes_entities.sql` | `25_universes_entities.sql` | `src/data/universe.ts`, Universe/entity approval UI |
| SIRA risk library per universe, per-org model (factors/scales/weights/bands/aggregation), versioned model history, `sira_compute` | §8.1, §8.2 | `0019_sira_model.sql` | `26_sira_model.sql` | `src/lib/siraEngine.ts`, `src/data/sira.ts`, parity test ≥20 fixtures |
| SIRA cycle per universe/year, publish freezes + ledger entry, factor values stored, emergent-risk queue with mandatory reason | §8.3 | `0020_sira_cycles.sql` | `27_sira_cycles.sql` | SIRA screens |
| Audit plan per universe/period, hash-chained versions, plan items (ad-hoc justification ≥10 chars), rights mapping | §9 | `0021_audit_plan.sql` | `28_audit_plan.sql` | `src/data/plan.ts`, Audit Plan screens |
| `deploy_engagement` returning §7 steps 1–5 outcomes; ethics acknowledgements table + `acknowledge_ethics` (self only) + ledger entry; Testing locked until all team acknowledge | §7 | `0022_deployment_gate.sql` | `29_deployment_gate.sql` | `src/data/deployment.ts`, deployment-gate UI |
| Combined approval: one atomic function for plan change + deployment; revalidation; SLA fields; `escalate_overdue_requests` | §7.1 | `0023_combined_approval.sql` | `30_combined_approval.sql` | combined-approval UI |
| Cross-org refusal, unauthenticated refusal, missing-right refusal, hash-chain integrity, atomicity, concurrency, platform sees zero rows | §1, §25.2 | — | `31_phase3_adversarial.sql` | — |

## Collision map

- **Entity table.** `entities` already exists with `approved boolean`. Phase 3 adds
  `status text` (`draft`/`pending`/`approved`/`rejected`), `kind`, `rejection_reason` and keeps
  `approved` in sync via the decision function. No second table.
- **Risks.** `risks_library` exists (org-scoped name/description). Phase 3 adds a per-universe
  selection table `sira_risk_selection (org_id, universe_id, risk_id, entity_id)` — the spec says
  "within a Universe the organisation selects which risks apply to which Entity".
- **SIRA scores.** `sira_scores` exists (cycle, entity, risk, score, factor_values, method). Phase 3
  fills `factor_values` and `method` and adds the model tables; it does not change the score shape.
- **Plans.** `plans` and `plan_versions` exist. Phase 3 adds `plan_items` and a `status` transition
  to `approved` with a linked ledger entry; it does not create a second version table.
- **Rights.** The closed list has no new key in Phase 3: initiation and approval are configured per
  organisation as a mapping from an existing right (`manage_engagements`, `approve_plan`,
  `edit_config`) to the step, stored in `config_versions`/a small settings table. No role names.
- **Ledger.** All new hash-chained writes call `append_ledger_entry`. No new chain.
- **`ensure_rls`.** Every new table enables RLS in the same migration (the hosted project's
  `ensure_rls` event trigger also enforces this; `13_rls_enabled.sql` checks it).

## Migration and test numbers

- Migrations: `0018` universes/entities, `0019` SIRA model, `0020` SIRA cycles, `0021` audit plan,
  `0022` deployment gate, `0023` combined approval.
- SQL tests: `25`–`30` one per migration, `31` adversarial. `00_lib.sql` gains the Phase 3 fixtures.
- Vitest: `src/lib/siraEngine.ts` + `siraEngine.test.ts` (≥20 fixtures),
  `src/data/{universe,sira,plan,deployment}.ts` + mocked tests.
- Playwright: one spec per flow (entity approval, SIRA cycle, audit plan, deployment gate, ethics,
  combined approval), using the synthetic users and cleaning up after themselves.

## Working rules

Rights only; grep before create; `alter table ... add column if not exists` over a second table;
`org_id` + RLS + select policy, no direct writes; hash chains through `append_ledger_entry`;
deterministic engines; app data only through `src/data/*.ts`; tokens only; no modals; tests leave no
residue; migrations apply twice; every earlier SQL and Playwright test keeps passing.

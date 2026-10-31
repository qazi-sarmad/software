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

# Phase 4 Plan — Planning, Population, Sampling, Testing, Analyst Engine

Task 4A (docs only). This maps every requirement in SPEC-v10 §10, §11 and §12 to an existing object
or a "to build" item, lists collision candidates, and fixes the migration / test numbers for Phase 4.
Migration numbers continue from the locked **0024** (0024 is already spent on H3a); new Phase 4
migrations start at **0025**. SQL tests continue from the locked **32** (32 is already spent on H3a);
new Phase 4 tests start at **33**.

Grep for every object named below found no existing table, function or policy with that name
(`grep -rl "<name>" supabase/migrations src/lib src/data`): no M1 collision for Phase 4.

## §10 Engagement lifecycle

| Requirement (§) | Status |
|---|---|
| §10.1 Planning sections configurable per org | **to build** — `planning_sections` (0025). `plans`/`plan_versions` exist but hold the universe audit plan, not engagement planning sections. |
| §10.1 risk & control mapping, control selection (Selected / Not in scope) | **partial** — `plans`, `plan_items` (0021) hold plan items; engagement-level RCM selection **to build** in `planning_sections` / `planning_rcm` (0025). |
| §10.1 SIRA pre-fill: suggestions + accept/edit/reject, each logged | **to build** — `populate_planning_suggestions` + `planning_suggestion_decisions` (0025). |
| §10.1 reconciliation gate blocks Planning sign-off | **to build** — `check_planning_reconciliation` + guard (0025). |
| §10.1 Testing locked until Planning sign-off | **to build** — `sign_planning` sets the lock; a trigger/CHECK gates testing (0025). |
| §10.2 two-stage (DEA/OET) vs one-stage (OET) per org | **partial** — org toggle exists in app state (`isTwoStageOrg`); DB config **to build** (deferred UI, recorded in NOT-DONE: one-stage vs two-stage selection UI). |
| §10.3 Conclusion auto-pulls exceptions; remove needs a comment; opinion optional/configurable | **to build** (Phase 5B/6). |
| §10.4 stage sign-off four-eyes; sealed read-only; reopen ≥10 chars | **partial** — `sign_offs` (0004) has the four-eyes CHECK; `reopen_engagement` exists. Per-stage sign-off **to build** (4B/4E). |

## §11 Testing

| Requirement (§) | Status |
|---|---|
| §11.1 upload population; headers auto; SHA-256; control-total reconciliation; VERIFIED gate | **partial** — `populations` (0004) has `sha256`, `control_total_cents`, a 3-value status CHECK (`pending/verified/rejected`). **to build** in 4C: widen status to `uploading/verifying/verified/locked/archived` via ALTER, add `row_count`, `verified_at/by`, a verification trigger, and the FK+CHECK that refuses a sample row without a verified population (L3). |
| §11.1 DB rejects sample/test row without verified population hash | **to build** — constraint + trigger (4C). |
| §11.1/§11.3 Org Sampling Table; methods enum; minimum sample size | **to build** — `org_sampling_table` + `get_sample_size` (4D). |
| §11.1 sample mode: system (seeded, reproducible) / auditor paste | **partial** — `samples` (0004) has `method`, `size_floor`, `locked`. **to build** 4D: `seed`, `mode`, `sample_rows jsonb`, `locked_at/by`, floor CHECK, `compute_sample`. |
| §11.1 floor hard-blocks finalisation | **to build** — CHECK `sample_rows length >= floor_size` when locked (4D). |
| §11.1 locking immutable; replacement needs rational + material change | **to build** — `replace_locked_sample` (4D). |
| §11.1 per row Tick/Cross/Unverifiable + rationale; exceptions need rationale | **partial** — `sample_rows.conclusion` (0004) allows `tick/cross/unverifiable`; rationale column exists. **to build** 4E: `workpaper_rows` with prepared/reviewed columns and rollup. |
| §11.1 workpaper Prepared; review/revert; rollup conclusion | **partial** — `workpapers.prepared` (0004). **to build** 4E: widen status to `open/sampling/locked/prepared/reviewed/signed_off`, add sign-off/reopen functions. |
| §11.2 non-population tests map to a control | **partial** — `workpapers.control_id`; deferred UI (NOT-DONE). |
| §11.4 pre-flight before submission | **to build** — pre-flight checks in `sign_off_workpaper` (4E) and UI (4I). |

## §12 Analyst engine

| Requirement (§) | Status |
|---|---|
| Population checks (duplicates, gaps, outliers, Benford, round numbers, weekend/holiday, same-user, missing attributes) | **partial** — `src/lib/analytics.ts` exists; **to build** `src/lib/analyticsEngine.ts` (4F) with pure functions covering every listed check. |
| Financial checks (variance, trend, GL/TB variance, GL-to-TB reconciliation, ratios) | **to build** (4F). |
| Reconciliations (population vs sample; SIRA vs Planning; controls vs tests; findings vs evidence; report vs CAP; CAP dates vs report) | **partial** — population vs sample (4F); the rest land with their phases. |
| Every result row → "Raise finding" carrying rule id + params + input row refs | **to build** — `create_observation` (5A) with a temporary `create_observation_stub` in 4F (D-5A-STUB). |
| No AI, deterministic, parameterised within admin ranges, unit-tested | **enforced** — pure TS, no `Math.random`, no AI; Law. |

## Collision candidates (checked, none hit for Phase 4)

- `populations` / `samples` / `sample_rows` / `workpapers` / `sign_offs` **exist** (0004) — 4C/4D/4E
  **extend with ALTER**, not create: record D-4C-M1 / D-4D-M1 / D-4E-M1.
- `observations` / `findings` / `issues` / `cap_items` exist (0004) — Phase 5/6 extend with ALTER.
- `plans` / `plan_versions` / `plan_items` exist (0003/0021) — the universe audit plan; engagement
  planning sections are a **new** table (different shape), no collision.
- `ledger_entries` / `activity_log` / `config_versions` exist (0005) — reuse `append_ledger_entry`
  and the `role_config_log` version pattern (0014) for configuration areas.

## Migration and test numbers used in Phase 4

| Task | Migration | SQL test |
|---|---|---|
| 4B planning DB | 0025 | 33 |
| 4C population gate DB | 0026 | 34 |
| 4D sampling engine DB | 0027 | 35 |
| 4E row testing DB | 0028 | 36 |
| 4F analyst engine (lib) | — (no migration; `create_observation_stub` in 0025 if needed) | — |
| 4G tests for 4B–4F | — | 37 |

Numbers are reserved here so parallel tasks cannot collide. If a later Phase 4 task needs a second
migration it takes the next free number above 0028.

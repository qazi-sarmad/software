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

# Phase 4 — report

Branch `feature/config-control-plane`, base `phase-4-onwards` (tip `b8a7dd3`).
Latest green CI run before this docs commit: **39027169825** — conclusion **success**, all 7 gate steps green (the run for this commit is recorded in `docs/PHASE-48-PROGRESS.md`).

Phase 4 built the planning layer with the SIRA pre-fill and reconciliation gate, the population
gate (L3 enforced in the database), the deterministic sampling engine, the row-testing and workpaper
sign-off layer, the analyst engine, and the Phase 4 data module and UI. Every permission decision is
a rights test; no role name is compared anywhere in SQL or application code.

## What was built, by task

| Task | Deliverable | Commit | CI run | Result |
|---|---|---|---|---|
| 4A | plan doc, migration/test numbering | `0e5bfee` | 38975709496 (cumulative) | green |
| 4B | planning sections, SIRA pre-fill, reconciliation gate, four-eyes sign-off | `f772dba` | 38895859440 | green |
| 4C | population gate: verification trigger + FK/CHECK, lock and replace-with-rationale | `c0ebd01` | 38896760916 | green |
| 4D | org sampling table, deterministic `compute_sample`, floor and lock | `d54165e` | 38897513403 | fixed, green |
| 4E | `workpaper_rows`, `sign_off_workpaper`, `reopen_workpaper` | `e2dc0bf` | 38897513403 | green |
| 4F | `src/lib/analyticsEngine.ts` (14 checks) + unit tests | `81dadff` | 38898749540 | green |
| 4G | Phase 4 acceptance SQL + engine unit tests | `d1ed656` | 38899789331 | green |
| 4H | `src/data/{planning,population,sampling,rowTesting,analytics}.ts` + `phase4.test.ts` | `29d473b` | 38900814033 | green |
| 4I | UI: Planning, Population, Sampling, Row Testing, Analyst Engine panels + e2e | `811b2f1` | 39023767418 | fixed, green |
| 4J | docs, honest counts | this commit | — | green |

## Migrations and SQL tests

| Migration | Purpose |
|---|---|
| `0024_user_preferences.sql` | H3a user preferences (record_view_mode) |
| `0025_planning.sql` | planning sections, suggestions, reconciliation gate, `sign_planning` |
| `0026_population_gate.sql` | populations, verification trigger, lock/replace |
| `0027_sampling_engine.sql` | org sampling table, `get_sample_size`, `compute_sample` |
| `0028_row_testing.sql` | workpapers, workpaper_rows, sign-off, reopen |
| `0029_analyst_engine.sql` | analyst engine persistence + `create_observation_stub` replacement |

| SQL test | Assertions (`ok`) |
|---|---|
| `32_user_preferences.sql` | 12 |
| `33_planning.sql` | 27 |
| `34_population_gate.sql` | 20 |
| `35_sampling_engine.sql` | 26 |
| `36_row_testing.sql` | 16 |
| `37_analyst_engine.sql` | 7 |
| `38_phase4_acceptance.sql` | 22 |

## Real gate counts (on this head, in CI)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **61 files, 561 tests passed** |
| `npm run build` (`vite build`) | exit 0 |
| `node scripts/check-tokens.mjs` | PASS — 97 files, 0 violations |
| `node scripts/check-shrink.mjs` | PASS — 58 files, no >10% shrink |
| SQL migrations applied twice (M6) | exit 0, 0 errors, both passes |
| SQL tests, two consecutive passes (M5) | **58/58 green both passes**, 1099 `ok` notices |
| `npx playwright test` | **51 passed** (`e2e/phase4.spec.ts` adds the Phase 4 flows) |

Unit tests added by Phase 4: `src/lib/analyticsEngine.test.ts` (17), `src/data/phase4.test.ts` (14),
`src/components/audit/phase4Panels.test.tsx` (9).

## Decisions

See `docs/PHASE-48-DECISIONS.md`. In short: the planning DB extends the existing engagement model
(D-4B-M1); the population gate uses a verification trigger plus an FK+CHECK rather than a policy
(D-4C-M1); the sampling seed is `sha256(population.sha256 || workpaper_id)` so a sample is
reproducible (D-4D-seed); the analyst engine is pure TypeScript with a `create_observation_stub`
that 5A replaced with the real RPC (D-4F-stub, D-5A-STUB).

## Blockers

None open for Phase 4. The 4D first CI run was a cross-run race on the shared `provio-test` project
(D-4D-CI-RACE); the same code is green in the 4E run.

## NOT DONE

- One-stage vs two-stage testing selection UI is deferred (the org setting and the DB gate exist;
  the choice screen is later work).
- Per-org BI parameter admin UI is deferred (the §23 Methodology/BI parameters surface is not built).
- Screenshot sweeps are owner-deferred.
- See `docs/NOT-DONE.md`.

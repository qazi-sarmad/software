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

# Phase 8 — report

Branch `feature/config-control-plane`, base `phase-4-onwards` (tip `b8a7dd3`).
Latest green CI run before this docs commit: **39030135433** — conclusion **success**, all 7 gate
steps green (the run for this commit is recorded in `docs/PHASE-48-PROGRESS.md`).

Phase 8 is database and logic only: no UI. It built the platform control plane (feature flags,
tenant settings, the append-only platform trail), support access as time-boxed metadata, per-org AI
enablement, and the platform invite-cap control. Every platform RPC requires `user_role =
'platform_admin'` from the JWT (the one recorded exception to the rights-only rule, D-PLATFORM-RIGHTS)
and the platform role has no access to tenant business tables.

## What was built, by task

| Task | Deliverable | Commit | CI run | Result |
|---|---|---|---|---|
| 8A | `tenant_settings`, `platform_trail`, `platform_set_feature_flag` | `(0031, earlier)` | 38956498574 | green |
| 8B | `support_access_grants`, `grant_support_access`, `revoke_support_access` | `(0031, earlier)` | 38956498574 | green |
| 8C | `platform_enable_ai` extended to write the org ledger | `92ba68f` | 38975709496 | green |
| 8D | `platform_set_invite_cap` | `(0031, earlier)` | 38956498574 | green |
| 8E | Phase 8 acceptance SQL (test 57) | `92ba68f` | 38975709496 | green |
| 8F | `src/data/platform.ts` + `platform.test.ts` | `(earlier)` | 38956498574 | green |
| 8G | docs, honest counts | this commit | — | green |

## Migrations and SQL tests

| Migration | Purpose |
|---|---|
| `0031_platform_control_plane.sql` | tenant settings, platform trail, platform RPCs, support access |
| `0045_ai_enablement_ledger.sql` | AI enablement also writes the org ledger |

| SQL test | Assertions (`ok`) |
|---|---|
| `40_platform_control_plane.sql` | 70 |
| `41_org_admin_settings.sql` | 16 |
| `42_platform_read_apis.sql` | 10 |
| `57_phase8_acceptance.sql` | 74 |

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
| `npx playwright test` | **51 passed** (Phase 8 has no UI, so no new spec) |

Unit tests added by Phase 8: `src/data/platform.test.ts` (2).

## Decisions

See `docs/PHASE-48-DECISIONS.md`: D-PLATFORM-RIGHTS (the platform portal is the sole reader of
`user_role` from the JWT; org RPCs keep using `caller_has_right`), D-8C-M1 / D-8C-ledger (AI
enablement writes the org ledger), D-8E-coverage (the Phase 8 DB already existed; 8E adds the
acceptance suite).

## Blockers

None open for Phase 8. The email provider choice (B-6E-provider) is the only open owner decision on
this branch.

## NOT DONE

- Superadmin UI (Phase 8.1, owner-designed) — item 23 in `docs/NOT-DONE.md`.
- Support-session authentication — item 24.
- Tenant-side per-org email configuration UI — item 25.
- AI advisory summaries — item 26.
- Screenshots owner-deferred — item 27.

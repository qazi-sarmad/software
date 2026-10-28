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

# Phase 6 — report

Branch `feature/config-control-plane`, base `phase-4-onwards` (tip `b8a7dd3`).
Latest green CI run before this docs commit: **39029143063** — conclusion **success**, all 7 gate
steps green (the run for this commit is recorded in `docs/PHASE-48-PROGRESS.md`).

Phase 6 built report drafting with placeholder blocks and a computed summary, the management-comment
gate on freeze, freeze and issuance with hash-chained ledger entries and a queued email, the CAP
register with one status vocabulary, and the provider-agnostic email queue.

## What was built, by task

| Task | Deliverable | Commit | CI run | Result |
|---|---|---|---|---|
| 6A | `report_versions` (hash-chained), `report_blocks`, `compose_report`, `compute_report_summary` | `46ee36c` | 38954769628 | green |
| 6B | `report_comments`, add/resolve RPCs, `open_report_comment_count` | `a25cab4` | 38956498574 | green |
| 6D | `caps` register, `update_cap`, `close_cap`, `check_cap_reconciliation` | `646c722` | 38956498574 | green |
| 6E | `email_queue`, `queue_email`, RLS (org sees sent/failed only) | `838f935` | 38956498574 | green |
| 6C | `freeze_report`, `issue_report` (ledger + queued email) | `3c55c7b` | 38956498574 | green |
| 6F | Phase 6 acceptance SQL | `cc18f65` | 38975709496 | green |
| 6G | `src/data/{reports,caps,email}.ts` + `phase6.test.ts` | `dd05ad3` | 38975709496 (cumulative) | green |
| 6H | UI: ReportEditorPanel, CapRegisterPanel, HoldToConfirm + e2e | `bc08485` | 39023767418 | fixed, green |
| 6I | docs, honest counts | this commit | — | green |

## Migrations and SQL tests

| Migration | Purpose |
|---|---|
| `0036_report_drafting.sql` | report versions and blocks, compose, summary |
| `0037_report_comments.sql` | management comments and the open-comment gate |
| `0038_cap_register.sql` | CAP register, update/close, reconciliation |
| `0039_email_queue.sql` | email queue and `queue_email` |
| `0040_freeze_issuance.sql` | freeze and issuance |

| SQL test | Assertions (`ok`) |
|---|---|
| `45_report_drafting.sql` | 11 |
| `46_report_comments.sql` | 7 |
| `47_cap_register.sql` | 10 |
| `48_email_queue.sql` | 7 |
| `49_freeze_issuance.sql` | 11 |
| `55_phase6_acceptance.sql` | 19 |

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
| `npx playwright test` | **51 passed** (`e2e/phase6.spec.ts`, 4 tests) |

Unit tests added by Phase 6: `src/data/phase6.test.ts` (8),
`src/components/audit/phase6Panels.test.tsx` (11).

## Decisions

See `docs/PHASE-48-DECISIONS.md`: D-6A-* (block template and computed summary), D-6B-* (comment
resolution and the count-based freeze gate), D-6C-6D-order (6D built before 6C so
`check_cap_reconciliation` reads an existing `caps`), D-6D-M1 / D-6D-CAP (the §16.2 status vocabulary
and the `capStatusToDb`/`capStatusFromDb` boundary), D-6E (provider field supports stub/resend/graph;
owner decision, blocker B-6E-provider), D-6H-* (where the Phase 6 screens live and the hold-to-confirm
control).

## Blockers

- B-6E-provider — the email provider choice is the owner's; the default stays `stub`.

## NOT DONE

- Email dispatch edge function (item 19 in `docs/NOT-DONE.md`).
- Graph or Resend provider wiring (item 20).
- PDF/DOCX report generation and branding templates (item 21).
- Screenshots owner-deferred (item 22).

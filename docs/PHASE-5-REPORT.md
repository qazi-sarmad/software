# Phase 5 — report

Branch `feature/config-control-plane`, base `phase-4-onwards` (tip `b8a7dd3`).
Latest green CI run before this docs commit: **39028105480** — conclusion **success**, all 7 gate
steps green (the run for this commit is recorded in `docs/PHASE-48-PROGRESS.md`).

Phase 5 built the findings/observations/issues layer with the readability gate, the conclusion with
exception pull and seal, the generalised non-blocking floating window, and the document viewer with
full-text search.

## What was built, by task

| Task | Deliverable | Commit | CI run | Result |
|---|---|---|---|---|
| 5A | `observations`, `check_readability`, `promote_to_finding`, `create_observation` (replaces the 4F stub), `issues`, `severity_levels` | `b8a7dd3` | 38975709496 (cumulative) | green |
| 5B | `conclusion_records`, `pull_exceptions`, `sign_conclusion` (four-eyes, seal) | `ec4e96a` | 38975709496 (cumulative) | green |
| 5C | `FloatingWindowManager` (dock, multi-window, pop-out); RecordView uses it | `c818f00` | 39020135451 (cumulative) | green |
| 5D | `evidence_files`, `document_extractions`, FTS index, `search_documents` | `135ebd2` | 38954437967 -> 38956498574 | fixed, green |
| 5E | Phase 5 acceptance SQL | `882eb69` | 38975709496 | green |
| 5F | `src/data/{observations,conclusion,documents}.ts` + `phase5.test.ts` | `13b8ce2` | 38975709496 (cumulative) | green |
| 5G | UI: Findings, Conclusion, Document Viewer panels + e2e | `389a1e1` | 39023767418 | fixed, green |
| 5H | docs, honest counts | this commit | — | green |

## Migrations and SQL tests

| Migration | Purpose |
|---|---|
| `0030_findings_observations.sql` | observations, readability gate, promote-to-finding, issues, severity levels |
| `0034_conclusion.sql` | conclusion records, exception pull, sign and seal |
| `0035_document_viewer.sql` | evidence files, document extractions, FTS, `search_documents` |

| SQL test | Assertions (`ok`) |
|---|---|
| `39_findings_observations.sql` | 16 |
| `43_conclusion.sql` | 14 |
| `44_document_viewer.sql` | 12 |
| `54_phase5_acceptance.sql` | 19 |

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
| `npx playwright test` | **51 passed** (`e2e/phase5.spec.ts`, 4 tests) |

Unit tests added by Phase 5: `src/data/phase5.test.ts` (9),
`src/components/audit/phase5Panels.test.tsx` (12), `FloatingWindowManager.test.tsx` (5).

## Decisions

See `docs/PHASE-48-DECISIONS.md`: D-5A-STUB (the 4F stub was replaced by the real
`create_observation`), D-5B-* (conclusion gates), D-5C-manager / D-5C-allowlist (the generalised
floating window and its no-blocking-modal allow-list entry), D-5D-M1 / D-5D-stage-filter /
D-5D-extraction-stub (the document viewer DB), D-5G-* (where the Phase 5 screens live).

## Blockers

None open for Phase 5.

## NOT DONE

- Document extraction edge function (item 16 in `docs/NOT-DONE.md`).
- One-stage vs two-stage testing mode UI (item 17).
- Screenshots owner-deferred (item 18).

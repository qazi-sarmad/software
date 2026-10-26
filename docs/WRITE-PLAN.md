# WRITE-1 plan: the Provio deterministic writing engine

Task W0.1. Branch `feature/writing-engine`, cut from `origin/main` at `ef62e51`
("Merge pull request #13 from qazi-sarmad/feature/board-ai-control-plane").

## Baselines at the branch point

Recorded from a local run on this commit; CI counts are compared to these later, never stated as
absolute expectations.

| Object | Baseline | How measured |
|---|---|---|
| Migrations | 87 (highest `0087_remove_ai.sql`) | `ls supabase/migrations/*.sql \| wc -l` |
| SQL test files | 92 (highest `94_ai_removed.sql`) | `ls supabase/tests/*.sql \| wc -l` |
| vitest files / tests | 144 / 1577 | `npx vitest run` |
| Playwright spec files | 25 | `ls e2e/*.spec.ts` |
| Guards | 18 | `ls src/guards/*.test.ts` |
| Local SQL harness | migrations applied twice, all SQL tests passed twice | `bash scripts/local-sql-harness.sh` |

The branch point is green: vitest 144/1577 pass; the local SQL harness applies every migration twice
and passes every SQL test twice.

## Coverage map: what already exists

Read before building (spec §14, §15, §15.2, §15.6, §19–§22, §29; the report blocks; the observation
lifecycle; the readability check; caps and ledger functions; the render modules; the Board Pack;
`verify_certificate`; the automation engine and event catalogue; the secret store and Edge Function
handler pattern; the SSRF guard; the import code; the UI contract; the guards).

| Area | Existing artefact | What WRITE-1 must add |
|---|---|---|
| Report versions and blocks | `report_versions`, `report_blocks`, `compose_report`, `freeze_report`, `issue_report` (migration 0036, 0040); `src/data/reports.ts` | A claim graph over them; the graph root and render hash; a deterministic composer |
| Observations | `create_observation`, `promote_to_finding`, readability roles Context/Condition/Effect/Risk (0030, `src/data/observations.ts`) | A final-approved gate for composition; staleness by content hash |
| Phrase library | Named in §15.6 only (`phrases`, `report_claims`, `report_templates`, `report_terminology`) | The whole library: conditions, slots, registers, locales, lifecycle |
| Figures | `analyticsEngine.ts` (14 pure checks); Board Pack figures (`src/lib/boardPack.ts` `collectFigures`) | `figure_functions` registry, `FigureBinding`, stored lineage, recompute |
| Renderers | `src/lib/render/pdf.ts`, `docx.ts` with the C2.7 determinism pin (`normaliseDocx`) | Graph-root and render-hash metadata in the file; footer line; a byte-comparison test per format and locale |
| Ledger | `src/lib/ledger.ts` (`computeEntryHash`, `appendLedgerEntry`, `verifyChain`), DB chain (0006/0007) | New ledger kinds for the report root only (the spec already names report freeze/issue) |
| Public verification | `verify_certificate`, `verify_board_pack` (0062), `PublicVerifyRoute.tsx`, `src/guards/anonGrantAllowList.test.ts` | One sibling anon function for a graph root, with a recorded decision and the allow-list guard extended |
| Automation and events | `automationRules.ts` `EVENT_CATALOGUE`, `automation_events_catalogue` (0055), `emit_catalogue_event` (0075) | A real emitter for the generic `watcher.signal` key; monitor rules as data |
| Secrets and Edge Functions | `secrets-put`, `secret_store_ref`, `_shared/secretsCrypto.ts`; the extracted-handler pattern (`archive-upload`, `graph-oauth`) | Connector credential storage reuses `secrets-put`; a connector-run Edge Function in the same shape |
| SSRF guard | `_shared/hostingTestHandler.ts` `addressIsForbidden` + resolver check | Reuse for connector egress; add an allow-list |
| Imports | `src/data/imports.ts`, `src/lib/xlsx.ts`, `src/lib/docxImport.ts` (C2) | The file-drop adapter reuses these parsers |
| UI contract | `docs/ACP-UI-CONTRACT.md`; `scripts/check-ui-contract.mjs`; `src/lib/tutorialKeys.json` | New sections for the engine screens; testids; tutorial keys |

## Task order and adjustments

The order in the brief is kept. Two adjustments, both recorded in `docs/WRITE-DECISIONS.md`:

1. **A fourth register axis: grammatical voice (active / passive).** The owner asked for it during the
   run. Registers become `{formality 1..5, tone 1..5, voice: 'active' | 'passive'}` plus `locale`.
   The invariant is unchanged: the graph root is identical across the whole matrix; only the render
   hash changes. Recorded as `D-W-VOICE`.
2. **W1.4 database work is split across W1–W4** as each module needs its table, rather than one large
   migration at W1.4. Each migration is still M1-checked and M6-tested. Recorded as `D-W-MIGRATIONS`.

## Owner instruction recorded

`D-W-F12`: continuous monitoring and connectors, parked by an earlier decision (F12), are now
requested by the owner. Alert rules stay deterministic (thresholds, rates, sequences, set
membership); no learning, no scoring by a model.

## Sequence (each task one commit, gates run before the commit)

- W1 domain model, canonical form, Merkle tree, first tables.
- W2 phrase library, registers (formality, tone, voice), locales, realisation rules, slot discipline.
- W3 twelve report models, planner, approved-observation gate.
- W4 figure functions and viewable lineage.
- W5 claim verification, coverage, contradiction rules, auditor lane, mutation tests.
- W6 explainability (provenance trace, counterfactual).
- W7 rendering and byte reproducibility.
- W8 versioning and comparison.
- W9 linting and guided intake.
- W10 independent verification (bundle, standalone verifier, public root check).
- W11 connectors and continuous monitoring.
- W12 engine screens.
- W13 hardening and tests.
- W14 engineering record for patent counsel (scratchpad only; the repository is public).
- W15 close-out.

## Checkpoints

CP1 after W1, CP2 after W5, CP3 after W7, CP4 after W11, CP5 after W12, CP6 after W13, CP7 after
W15. CI is dispatched at each checkpoint, not after every commit. Budget: 14 dispatches.

# WRITE-1 report: the Provio deterministic writing engine

Branch `feature/writing-engine`, run 2026-10-26. One draft pull request into `main`. Nothing is
merged. Every number below was produced by a command run in this session; the command is named.

## What was built

An audit report is a directed graph, not text. Each node is a claim with a typed reference set, a
bound figure, a phrase id and version and a rule id and version. Each edge is evidence (a claim to
the records it derives from, by type, id and content hash), a dependency between claims, or a
structure edge from the document plan. Two hashes are committed: the graph root over the facts, and
the render hash over the exact words. The graph root is identical across every formality, tone, voice
and locale of the same report. Text is a pure function of the graph, the model, the register, the
locale, the engine, template and phrase-library versions and a fixed timestamp. No other input.

The engine is `src/lib/writing/` (8,817 lines across 41 modules and their tests). It has no AI, no
model, no embedding and no generated free text. Every module is a pure function of its arguments.

## Counts against the baselines

Baselines were recorded at the branch point in `docs/WRITE-PLAN.md`. This is the comparison.

| Object | Baseline | Now | Command |
|---|---|---|---|
| Migrations | 87 (highest `0087`) | 94 (highest `0094_verify_report_root.sql`) | `ls supabase/migrations/*.sql \| wc -l` |
| SQL test files | 92 (highest `94`) | 97 (highest `99_verify_report_root.sql`) | `ls supabase/tests/*.sql \| wc -l` |
| vitest files / tests | 144 / 1577 | 164 / 1901 | `npx vitest run` |
| Playwright spec files | 25 | 25 | `ls e2e/*.spec.ts` |
| Guards | 18 | 19 | `ls src/guards/*.test.ts` |
| Local SQL harness | migrations twice, tests twice | migrations twice, tests twice (EXIT=0) | `bash scripts/local-sql-harness.sh` |

All counts rose or held. The vitest run passes 1901 of 1901 tests; the guards pass 618 of 618. The
local SQL harness applies every migration twice and passes every SQL test twice.

## Gates, per commit, in order

`npx tsc --noEmit` (clean), `npx vitest run` (164 files, 1901 tests pass), `npx vite build` (built in
1.07s), `node scripts/check-tokens.mjs` (165 files, 0 violations), `node scripts/check-shrink.mjs` (58
files, no shrink), `node scripts/check-ui-contract.mjs` (48 Appendix A screens, all testids present),
`node scripts/check-function-deploy-list.mjs` (7 functions, 20 deploy references), `bash
scripts/local-sql-harness.sh` (green twice), `npm run check-tutorials` (80 GIFs present, 0 missing, 0
placeholders, 0 stale). Playwright runs in CI; the full-flow spec was run locally on the head commit:
4 tests passed.

Guards green: noAi, singleClient, noBlockingModal, noRawJsonEditing, noRoleStrings,
anonGrantAllowList, edgeEntryPoints, cronJobRegistry, plus e2eAssertions, screenshotCoverage,
tutorialRegistryCoverage and the rest (19 guard files, 618 tests).

## Matrix completeness

The matrix is 5 formality × 5 tone × 2 voice × 2 locale = 100 cells. The test
`src/lib/writing/matrix.test.ts` composes every cell with the shared fixture and asserts no
`Missing: [phrase]` gap. Cells checked: 100. Cells missing: 0. A second test asserts the graph root
is one value across all 100 cells while the render hash varies (the wording genuinely differs). A
third asserts a register or locale change never moves the graph root.

## CI dispatches

Budget 14. Used: 2. Run 40291572648 at head `deb95e1` reached steps 1 to 8 green (step 9, the
screenshot sweep, is a continue-on-error tool and does not gate). Run 40314836257 at head `b50b156`
is the final dispatch: every step green, 1 to 16 (type check, unit tests, build, token, shrink,
tutorials, function deploy list, UI contract, migrations and SQL tests, Playwright, screenshot sweep,
screenshot upload). The shared test-database concurrency group
serialises runs, so a dispatch can wait behind a `main` push; the branch's own push trigger starts it,
so no manual dispatch was needed.

## Decisions (one line each)

Full text in `docs/WRITE-DECISIONS.md` (11 entries).

- D-W-F12 — continuous monitoring and connectors, parked by F12, are in scope by owner instruction.
- D-W-VOICE — grammatical voice is a fourth register axis, orthogonal to formality and tone.
- D-W-MIGRATIONS — the schema lands with each module, not in one W1.4 migration.
- D-W-CRYPTO — hashing uses the platform crypto already in the repo.
- D-W-TIMESTAMP — time is an argument, never a clock read.
- D-W-PUBLIC-ROOT — the anonymous surface grows by exactly one function, recorded and guarded.
- D-W-FORMAT-EDITOR — the report format editor is per client, versioned and role-scoped.
- D-W-TUTREG — the tutorial registry gap is fixed by a new seed migration, not by editing 0071.
- D-W-ENGINETESTS — the engine's untested core modules gain direct tests.
- D-W-BUILDERVIEW — the report builder is a view of the Audit File window, not a new tab.
- D-W-BUILDERREG — the report-builder tutorial row is a new migration, not an edit of 0092.

## Blockers

`docs/WRITE-BLOCKERS.md` records one blocker, `B-W-PR-TOKEN`: the draft pull request cannot be opened
with the supplied `GITHUB_TOKEN`. It is a GitHub App installation token without the
`pull_requests: write` permission, so `POST /repos/qazi-sarmad/software/pulls` returns HTTP 403
"Resource not accessible by integration" (tried twice: the REST API and the `create_pr` tool). No task
hit the break protocol's code path, so no commit was reverted. The branch is pushed and green; the
owner opens the draft pull request, or grants the permission and re-runs the command in the blocker
entry. Two environment issues were fixed forward without a `(FIX)` commit because neither was a code
defect: the local host had no Postgres 17 (installed to run the harness, per M6), and
`supabase/config.toml` had local test scaffolding that was reverted before any commit.

## Not done

Per the brief's section 6, and the open items in `docs/NOT-DONE.md`:

- No AI, model, embedding or generated free text. Not built, by law L1 and the brief.
- No automatic translation and no language other than en-GB and en-US. Locale packs are human data.
- No call to a live third-party system. Every adapter is fixture-verified, live-verified: NO.
- No payroll, procurement or inventory data type beyond what a connector stages.
- No cross-organisation sharing (the engine respects tenant boundaries; there is no share surface).
- Final UI polish and Vercel/hosting configuration are out of scope.
- §2 cross-universe view-only sharing, §10.1 configurable grace period, §11.4 central pre-flight and
  §17.1 pop-out Realtime sync remain as in `docs/NOT-DONE.md`; none is part of WRITE-1.

## Connector table

All 22 adapters are fixture-verified and live-verified: NO. Each has a fixture suite, a contract test
against a local mock server and a catalogue entry. The full table is generated in
`docs/CONNECTORS.md`; the ids are `file-drop`, `sftp-pickup`, `signed-webhook`, `http-rest`,
`database-view`, `sap-odata`, `oracle-erp`, `dynamics-365`, `netsuite`, `quickbooks-online`, `xero`,
`entra-id`, `okta`, `scim-read`, `servicenow`, `jira`, `splunk`, `sentinel`, `syslog-cef`,
`datadog-events`, `microsoft-graph`, `google-workspace`.

Monitor rules are deterministic: threshold, rate over a window, sequence, set membership, missing
expected event and cross-source reconciliation, evaluated by a pure function with the window and the
time as arguments. Each emits the existing generic `watcher.signal` catalogue event. Rules ship as
drafts; release needs a qualified human.

## Patent record

The repository is public (`gh api repos/qazi-sarmad/software --jq .private` returns `false`), so no
file under `docs/ip/` was committed. The invention record was written to the scratchpad directory
`/workspace/project/patent-record/`: `INVENTION-DISCLOSURE.md`, `CLAIM-FAMILIES.md`, `PRIOR-ART.md`,
`EMBODIMENTS.md`, `DEVELOPMENT-LOG.md`, `PUBLIC-DISCLOSURE-REVIEW.md`. Move it out of the sandbox and
give it to counsel.

Authored by: Qazi Sarmad Ali Mahesar

# SCALE-DECISIONS — decisions taken during the continuous build

One entry per decision that the builder had to make without the owner. Each states the queue item,
the decision, the evidence, and the reasoning. A recorded decision is the deliverable.

---

## D1 — Analytics `period` type fix is a `main`-only change; not applied on this branch

**Queue item 3.** The continuous-build prompt says to apply `docs/analytics-period-fix.patch`
(verified clean on `main`, `a697190`) and that doing so takes `npx tsc --noEmit` from exit 1 to exit 0
and `analytics.test.ts` to 5 passed.

**Decision:** **not applied.** The patch is recorded at `docs/analytics-period-fix.patch` for `main`,
but it does not belong on `feature/scale-harden-v1`, and applying it here breaks the branch.

**Evidence (reproduced this session on `feature/scale-harden-v1`, head `fc0ccda`):**

- Baseline `npx tsc --noEmit` on this branch → **exit 0**. The branch has no type error to fix.
- Applying the patch (which adds a required `period: string` to `AnalysisResultRow`) then running
  `npx tsc --noEmit` → **exit 1, four errors** in `src/lib/analytics.ts` (lines 28, 82, 134, 184),
  each: *Property 'period' is missing…*. The branch's four producers never set a `period` field.
- Reverting the patch → exit 0 again.

**Reasoning.** The branch and `main` have divergent `src/lib/analytics.ts`. `main`'s version reads
`period?: string` / `periodLabel?: string` on its input types and writes both onto every result row
(`git show origin/main:src/lib/analytics.ts`), so on `main` the rows satisfy a type that declares
`period`. This branch's version has a `VarianceInputItem` with no `period` and four producers that
write neither field. Adding a required field to the shared type is therefore correct *only* where the
producers supply it. Applying it here would either be a no-op with a broken compile or force invented
`period` values onto rows that have none — which is exactly the "a config value nothing reads" defect
class the whole project is organised against. The branch is already green; the correct action is to
leave it green.

**If `main` needs it:** apply on a branch off `main` and open a PR, as the prompt itself allows.

## D2 — UI-INVENTORY: one generator, canonical command `node scripts/gen-ui-inventory.mjs`

**Queue item 5.** A and B both generate `docs/UI-INVENTORY.md`; A's header names
`node scripts/gen-ui-inventory.mjs`, B's header names `npx tsx scripts/gen-ui-inventory.mjs`. Two
commands for one generated file is the drift risk.

**Decision:** the canonical command is **`node scripts/gen-ui-inventory.mjs`** — the plain Node
invocation. `tsx` is a devDependency added for TypeScript entry points; this generator is `.mjs` and
needs no transpiler, so `node` is the lower-dependency, more portable spelling. B's header comment is
the only thing that needs changing at integration time (it does not affect output).

**Evidence (reproduced on this branch):** `node scripts/gen-ui-inventory.mjs` → exit 0,
*"1684 lines, 98 screens, 116 RPCs"*, and the regenerated file is **byte-identical** to the committed
one (`diff -q` clean). A's header is therefore already the canonical, self-consistent state.

## D3 — G1 row corrected to DONE; the gate is also now run by CI

**Queue item 6.** The builder prompt says: "A's `G1` row says TODO but the work is done … Fix the row,
not the code."

**Decision:** corrected the ledger row to `DONE (2026-10-29)` and wrote the G1 section explaining it —
**and** added the missing CI step, because the row's `TODO` was not the only thing wrong with G1.

**Evidence.** The gate is real: `playwright.config.ts:45-51` serves the built bundle with
`npm run build && npm run preview -- --port 4173 --strictPort` when `E2E_PROD=1`, and
`e2e/phase1-production-build.spec.ts` runs only under that flag. But `grep -rn E2E_PROD
.github/workflows/` returned **nothing**: no CI job ever set the flag, so the suite CI ran (step 8)
was always the dev-server suite, and G1 had only ever run by hand. The ledger even contradicted
itself — line 869 recorded *"G1 prod E2E … PASS — 143 passed, 3 skipped"* while line 984 said `TODO`.

**Reasoning.** Fixing only the row would have marked a gate DONE that the pipeline never executes —
the precise defect G1 was built to catch (the production build shipped empty while the dev suite
stayed green). So step 8 now runs both: the dev suite first (fast feedback, unchanged), then
`npm run build` + `E2E_PROD=1 npx playwright test --project=chromium`. Both hit the hosted test
project, so the job's existing concurrency group still serialises them. The code was not at fault; the
row and the pipeline both were.

## D4 — two engines are inert; two register rows were stale; the register gate now runs in CI

**Queue item 8.** The reachability audit of both engines.

**Decision / findings** (full evidence in `docs/REACHABILITY-AUDIT.md`):

1. **`src/lib/siraEngine.ts` and `src/lib/analyticsEngine.ts` have no production caller.** Resolving
   the import graph from every screen under `src/components/` plus `App.tsx`, neither module is
   reachable. `src/data/sira.ts` and `src/data/analytics.ts` each *say* in a comment that the pure
   engine does the maths, but each imports only `{ callRpc } from './db'` and calls the SQL function
   over RPC. The TS engines are parity mirrors proved by tests, not engines the product runs.
2. **Six writing-engine modules are test-only** — `bundle, issue, lint, planner, seal, workbook`. They
   form the report-*writer* cluster the app does not yet drive (the S13 remainder). Not a regression;
   recorded as inert.
3. **`monitors.ts` is reachable only as labels** — `ConnectorMonitorPanel` imports `MONITOR_KINDS`;
   `evaluateMonitor` / `runMonitors` have no screen caller (C1's runner is the `pg_cron` job).
4. **Two register rows were stale and are corrected**: F35 report templates → `Wired` (called from
   `ReportTemplatePanel.tsx:49`); F37 report graph root → `Wired` (writer `report_graph_commit`,
   `0103`, called from `ReportEditorPanel.tsx:177`). Counts 52/29/44 → **54/27/44**.
5. **The register gate's blind spot, recorded not hidden:** rule (6) fires only on an evidence phrase
   from a fixed list *and* a token that is a `src/data`/`src/lib` export. An `Inert` row naming a
   **table or RPC** (F37 named `report_graphs`) escapes. Widening it needs a table/RPC call-site
   check — its own work package.
6. **`check-feature-register.mjs` is added to CI step 6d.** It was green but unrun; a green gate no CI
   executes is the defect G1 taught us to look for.

**Effect on the plan.** Phase 4–5 sharpens: the remaining work on the engines is not "write the
engine" but "choose whether the TS engine or the SQL function is the one the product runs, and wire
that one to a screen." No `SCALE-PLAN.md` phase changes order.

## D5 — the local SQL harness's shim was read as user `postgres`; ported fix uses stdin

**Found while watching the first CI run of the ported step 7.** Step 7 failed on the runner at
`psql: error: …/scripts/local-sql-shim.sql: Permission denied` / `shim failed`.

**Cause.** `scripts/local-sql-harness.sh` runs as `sudo -n -u postgres psql …`, and every migration
and SQL test is fed on **stdin** (`run < "$f"`) precisely so the `postgres` user never needs to open a
file the invoking user owns. The **shim** was the one exception: `run -f "$ROOT/scripts/local-sql-shim.sql"`.
Under `-f`, *psql* (now running as `postgres`) opens the path itself; on CI the checkout lives at
`/home/runner/work/...`, which `postgres` cannot traverse, so the open fails. Locally the checkout is
under `/workspace` with looser permissions, which is why the harness passed twice here and failed only
on the runner.

**Decision:** feed the shim on stdin like every other file — `run < "$ROOT/scripts/local-sql-shim.sql"`.
The invoking user (who can read the repo) opens the file; *psql* reads stdin. One line, same pattern as
the rest of the harness, no permission assumptions.

**Also:** the harness header claimed "assumes postgresql-17"; the ported CI step installs whatever
`postgresql` resolves to (16 on `ubuntu-24.04`). The suite needs only `security_invoker` (PG15+), so
the header now says "15+" and names no version. Verified: harness green on PG16 in the runner's package
set and PG17 locally.

## D6 — The OCR engine is a wire-up, not a vendored model (2026-10-29)

**Spec §5** lists three extraction tiers; tier 2 is "OCR (lazy-loaded, bundled). Only for scans and
images with no text layer." S7 builds the tier-2 *seam* and the tier-3 parser, both pure and tested.
It does **not** vendor a multi-megabyte WASM OCR model into this environment.

**Why.** The model and its trained data are a build artifact, not logic. Vendoring one would add
megabytes to the tag, pin a specific model version inside a commit that is about rule-engine shape,
and cannot be tested here anyway. The decision that actually matters is the contract around the engine,
and that is what S7 writes:

- `needsOcr(hint)` OCRs a document **only** when tier 1 produced no text and the file is a scan
  (`pdf`, or an image surfacing as `unknown`). A legacy binary is stored, never OCR'd.
- `runOcr(bytes, hint, engine)` takes the engine as a dependency, so a build that never OCRs never
  ships one — that is what "lazy-loaded" means at the code level.
- A **remote** engine is refused with a reason. Nothing leaves the tenant (L2).
- With no engine, the scan is stored and reported `unsupported` with the reason. It never invents text.

**To finish tier 2** a consumer passes a bundled local `OcrEngine` (e.g. a tesseract WASM build) into
`runOcr`. That is a packaging task with a clear seam, recorded in `docs/FEATURE-REGISTER.md` F131.

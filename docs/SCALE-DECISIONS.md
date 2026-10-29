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

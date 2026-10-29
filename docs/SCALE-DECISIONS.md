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

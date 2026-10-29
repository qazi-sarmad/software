# Provio / Systeligon — Builder A rollout prompt, 2026-10-29

Hand this to the next builder session. It is self-contained. It assumes the state described in
`.openhands/out/STATE-EVALUATION-2026-10-29.md`, which you should read first — every number in it was
verified against the repository, not copied from a ledger.

---

## 0. Situation

Three sessions have worked this repository. Builder A's sandbox crashed mid-flight. Builder B is
alive with 50 rows DONE and 12 deferred. `main` has been red since 2026-10-26. You are picking this up.

The work is in better shape than the documents suggest and the branches are in worse shape than
anyone thinks. Both statements are true and both matter.

**Do not trust a ledger row, a commit message, or a green test as proof a feature works. Grep the
call site.** That rule is already written into `docs/SCALE-TASKS.md` and it earned its place.

## 1. The laws — unchanged, and not negotiable

- **L1 Deterministic only.** No AI, no model calls, no free-text generation, no embeddings.
- **L2 Data never leaves the tenant.** `RLS` + `jwt_org_id()` is the only read path for tenant data.
  A new sharing path may *add* restrictions; it may never relax that equality.
- **L3 Config-as-ledger**, interconnected ledger, population gate — inviolable.
- **L4 Pure functions live under `src/lib/` or `src/data/`.** Components never import the Supabase
  client. Time is always an argument; never read the clock inside a pure function.
- Every interactive element carries `data-testid="<screenId>-<element>"`. No blocking modals; the
  tutorial drawer is `role="complementary"`. Platform crypto and existing hashing primitives only.
- **NO PARKING.** An item is `DONE` or it is not. `Partial` is not a status — it is the word that let
  earlier documents claim completion. `DEFERRED (design)` is legitimate *only* for work genuinely
  blocked on an owner decision, and the row stays visible.

## 2. Your branch

Work on **`feature/scale-harden-v1`** (Builder A's branch, head `fc0ccda`). It is yours now.
Branch from it. Never touch `main`. Never force-push. Max sleep 20 seconds, ever.

Note before you start: A's branch **does not contain** `main`'s `7b9bc07` commit, so it lacks the
month-named financial-statements feature *and* the bug that feature introduced. Decide deliberately
whether you want that feature; if you do, you take the fix with it.

## 3. The analytics.ts change — apply this first

**This is a real defect on `main` and it is why `main` is red.** It is not a CI problem.

`src/lib/analytics.ts` writes a `period` field onto row objects. The type `AnalysisResultRow` in
`src/types/index.ts` does not declare it.

```
src/lib/analytics.ts(68,5): error TS2353: 'period' does not exist in type 'AnalysisResultRow'.
src/lib/analytics.ts(381,9): error TS2353: 'period' does not exist in type 'AnalysisResultRow'.
```

History, proven: commit `7b9bc07` added three `period: resolvePeriod(...)` usages and never added the
field to the type. `analytics.ts` is byte-identical between 2026-10-27 and now, and the error
reproduces at the pre-`ci.yml` commit `491bd4a`. Last green CI on `main`: `d26ea59`, 2026-10-26 10:37.

**The fix — `src/types/index.ts`, inside `export type AnalysisResultRow`:**

```ts
export type AnalysisResultRow = {
  rowIndex: number;
  account: string;
  category: string;
  currentPeriod: number;
  priorPeriod: number;
  varianceVal: number;
  variancePct: number;
  flagged: boolean;
  flagReason?: string;
  ruleId: AnalyticsRule;
  originalRowRef: number;
  period: string;          // <- added
  periodLabel?: string;    // <- added
};
```

`period` is required: `resolvePeriod` always returns a string (`return value?.trim() || fallback ||
'all'`) and every construction site sets it. `periodLabel` is optional: it is built from
`item.periodLabel ?? …` where the input field is optional.

**The patch, inline. Apply exactly this:**

```diff
diff --git a/src/types/index.ts b/src/types/index.ts
--- a/src/types/index.ts
+++ b/src/types/index.ts
@@ -347,6 +347,8 @@ export type AnalysisResultRow = {
   flagReason?: string;
   ruleId: AnalyticsRule;
   originalRowRef: number;
+  period: string;
+  periodLabel?: string;
 };
 
 export type ActionType =
```

Apply it with:

```bash
git apply /workspace/project/software/.openhands/out/analytics-period-fix.patch
```

The patch file is byte-identical to the block above and **verified to apply cleanly to `main`**
(`git apply --check` → clean). If `git apply` reports a context mismatch, the surrounding type has
moved; locate `originalRowRef: number;` inside `export type AnalysisResultRow` in
`src/types/index.ts` and add the two lines after it by hand. That is the only edit — do not touch
`analytics.ts`, which is correct as written.

**Verified on a clean `main` worktree:** `npx tsc --noEmit` → exit 0 (was 1, with exactly 2 errors);
`npx vitest run src/lib/analytics.test.ts` → 5 passed.

**Three notes on applying it.**

1. If you are fixing `main`, do it on a **separate branch off `main`** and open a PR. Do not push to
   `main`.
2. If your branch does not carry `7b9bc07`, apply the type change anyway so the two trees agree — it
   is purely additive and harmless. It costs nothing to have the field present and unused, and it
   prevents a future merge from re-introducing the compile break.
3. The same two-line change must land on **every** branch that will ever merge with `main`, or the
   merge re-breaks the build. Apply it once per branch, or fix it on `main` first and rebase.

## 4. What was identified, and what the code actually had wrong

Five distinct defects. Do not conflate them; they have different owners and different fixes.

| # | Defect | Where | Severity |
|---|---|---|---|
| 1 | `period` written to a type that lacks it | `main`, `src/types/index.ts` | breaks `main`'s build |
| 2 | `@electric-sql/pglite` used by 3 gate scripts, absent from `package.json` | all branches | breaks A's CI |
| 3 | 7 migration numbers double-allocated, `0110`–`0116` | A vs B | silent broken replay order |
| 4 | `SCALE-TASKS.md` + `UI-INVENTORY.md` edited on both branches; **two different generators** | A vs B | destroys single-source-of-truth |
| 5 | `G1` ledger row says TODO; the work is done | A's ledger | stale row, in A's favour |

**On #2.** `check-config-effect.mjs`, `check-dead-code.mjs` and `check-rpc-parity.mjs` all import
`@electric-sql/pglite`. It is in nobody's `package.json` — it was installed `--no-save` during the
audit. That is why all five gates pass locally and A's CI fails at step 13 after steps 1–12 pass.
Same class as the earlier step-9 secrets defect: a local-only condition CI does not share. A's CI log
ends `FAIL: @electric-sql/pglite is not installed` after 215 files / 2474 tests green. **A's code is
not the problem.** Add it to `devDependencies`.

**On #3 — this is the dangerous one.** `0090`–`0106` are byte-identical on both branches. Divergence
starts at `0110`:

```
0110  A=0109_phase3_config_effects.sql  B=0110_sira_continuity_acceptance.sql
0111  A=0111_phase5_monitor_runner.sql  B=0111_evidence_storage.sql
...   through 0116, and 0117 exists only on B
```

Because the *filenames differ*, git will merge this **cleanly and silently**, producing a replay order
neither builder chose, in which two unrelated migrations share a number. `BRANCH-MAP.md` reserved
`0107`–`0113` for A and `0114`+ for B, and even records that A reached `0110` before the reservation
was known — the map is honest, the reality outran it. Renumber B's `0110`–`0117` to `0118`–`0125`, or
compact A's range first and let B take the freed numbers. Update `BRANCH-MAP.md`'s reservation table
**in the same commit** — that table is the mechanism, not the commentary.

**On #4.** `BRANCH-MAP.md` states the rule: *"One branch owns one ledger. No two branches edit the same
ledger file. That is the whole tracking mechanism."* Both branches edit `SCALE-TASKS.md` (A 1301
lines, B 474 — B's is an older snapshot). `UI-INVENTORY.md` is generated on both, and A's regenerates
byte-identically (`node scripts/gen-ui-inventory.mjs` → 1684 lines, 98 screens, 116 RPCs). But A's
generator is invoked `node scripts/gen-ui-inventory.mjs` and B's header says
`npx tsx scripts/gen-ui-inventory.mjs` — **different generators**. The inventory exists to be the
single source of truth for the parallel design track. Two of them is zero of them. Pick one generator,
delete the other, one file.

## 5. The two engines — do not treat these as "a feature"

**Read this before touching anything.** The crown jewels of this codebase are two deterministic
engines, and both were found *built, tested, and attached to nothing*. Any session that treats them as
ordinary modules will repeat the original defect.

### 5.1 The Writing Engine — `src/lib/writing/` (41 modules, 8,817 lines)

**An audit report is not text; it is a directed graph.** Each node is a *claim* (typed reference set,
bound figure, phrase id + version, rule id + version). Each edge is evidence, dependency, or
structure. **Two hashes are committed: the graph root over the facts, and the render hash over the
words.**

The defining property: **the graph root is identical across every formality, tone, voice and locale of
the same report.** Rewording moves the render hash and never the root. Text is a pure function of the
graph, model, register, locale, versions and a fixed timestamp — nothing else. No AI, no model, no
embedding, no generated free text.

Proof by exhaustion already in place: the matrix is **5 formality × 5 tone × 2 voice × 2 locale = 100
cells**, extended to **all twelve report models = 1,200 compositions, 0 missing phrases, 0 errors**;
one graph root per model across all 100 cells while the render hash genuinely varies; declared
`registerInvariant` sections proved identical, and non-invariant sections proved to vary (so the
declaration cannot be over-used). The matrix **found and fixed a real defect in the engine itself** —
the composer applied the register transform to invariant sections, rendering ungrammatical variants of
the `appendices` line.

`src/lib/writing/adversarial.test.ts` holds deliberately broken inputs that must never seal, including
the two the original brief demanded: **a graph-root mutation test** and **a coverage-hole test**. With
`merkle.test.ts`, `mutation.test.ts`, `verify.test.ts` and `versioning.test.ts` for tampering. No test
reads a clock.

### 5.2 The Audit Engine — the auto-configuring audit

This is the part that decides **what the audit should be**, and it is the reason the product is a
platform rather than a document generator. All pure, all L1:

- **SIRA pre-fill (`populate_planning_suggestions`, `0025_planning.sql:139`; surface
  `src/data/planning.ts`).** Reads the latest published SIRA cycle and derives planning suggestions —
  risk, inherent rating, band, suggested controls, prior finding count. **Each carries a decision row
  (`accepted`, `reason`, `decidedAt`)**: the engine proposes, the auditor disposes, the ledger keeps
  both. A declined suggestion with a reason is as auditable as an accepted one.
- **`siraEngine.ts` (138 lines)** — deterministic scoring, four aggregations, **the exact mirror of the
  SQL `public.sira_compute`**, with a parity test running the same fixtures through both. The UI
  preview and the stored score cannot drift.
- **`analyticsEngine.ts` (432 lines)** — **14 deterministic audit checks**: duplicates,
  near-duplicates, sequence gaps, z-score and IQR outliers, Benford first digit, round numbers, weekend
  postings, same-user-create-approve, missing attributes, period variance, GL-to-TB, **SIRA-vs-planning**
  and **controls-vs-tests**. Every result row carries the row references it flagged. Note the last two:
  the engine audits *the audit*.
- **`auditEngines.ts`** — `createDeterministicPrng` (Mulberry32, seeded) with the guarantee that **no
  unseeded randomness is used in any audit sampling**; `drawSeededSample` (reproducible draws);
  `verifyPopulationGate` (population SHA-256). **An auditor can re-derive any sample months later and
  prove the population did not change.**
- **`automationRules.ts` (204 lines) + `0056_automation_engine.sql`** — conditions and actions as
  **data**, evaluated identically by the server engine and the tests. Loop guard (an action cannot
  trigger its own rule) and a rate limit (**>20 events/rule/hour auto-pauses with a notice**). The
  engine "never sends anything itself" — dispatch is a separate Edge Function.
- **Monitor runtime** — six deterministic rule kinds (threshold, rate over a window, sequence, set
  membership, missing expected event, cross-source reconciliation), window and time as arguments,
  emitting `watcher.signal`. **Rules ship as drafts; release needs a qualified human.**

**The shared ethic, and it is deliberate:** the machine proposes and the human decides; an unknown is
never converted to a zero (`siraScoring.ts`: *"an unscored entity×risk pair is reported as unscored,
never as a zero"*); sampling is reproducible; automation cannot loop. **That is not a limitation of
L1 — it is the design.**

### 5.3 The defect that matters most

The audit found `grep -rn "report_graphs" src/` → **empty**. The Writing Engine computed the roots, the
tests verified the roots, and **the result was never persisted**, so `verify_report_root` had no data
to verify. The monitor runtime was dead; `rule_engine_process` had **zero** callers.

**The best engineering in the repository was inert, and its tests were all passing.** That is the
defect class the whole project is now organised against. Before you add anything to either engine,
**grep for a production call site.** A green engine test proves nothing about reachability.

## 5A. What else is already done

Stated as verified facts, with the evidence, so you do not redo it.

**Builder A** (`feature/scale-harden-v1`, 46 DONE / 4 TODO) has already implemented the clauses
`main`'s `docs/NOT-DONE.md` still lists as Partial or Missing, in
`supabase/migrations/0095_scale_harden_sharing_preflight.sql`:

- **§10.1 configurable grace period** — `org_lifecycle_settings.testing_grace_hours` (0–336, default
  0), `testing_lock_active()` reading the grace window, rewritten `guard_testing_lock()` trigger. The
  default of 0 reproduces the old hard lock exactly.
- **§11.4 central pre-flight** — pure `src/lib/preflight.ts` (eight checks) plus append-only
  `preflight_acks`. A's own note records that `0095` claimed append-only in prose but shipped no
  guard, and `0102` added it. That is the right instinct — check whether it held.
- **§2 cross-universe view-only sharing** — share table, grant/revoke, expiry, revocation, in-app +
  email notification. A's header defends the RLS shape: every share is **intra-organisation**, so
  `org_id = public.jwt_org_id()` stays an *additional* restriction and is never relaxed. That is the
  correct reading of L2. **Verify it yourself before believing it** — this is the one clause where a
  mistake leaks tenant data.
- **§17.1 / §22 Realtime** — `0098_realtime_notifications.sql`.
- **G2–G6 anti-theatre gates**, which `main` does not have, plus the 6d CI step that runs them. All
  five pass locally: 533 functions reachable, 50 config matrix rows (41 enforced), every `src/data`
  export reachable, no component reading both seed and database, 116 RPCs present.

A's `G1` row says TODO but the work is done: A's `playwright.config.ts` runs
`npm run build && npm run preview -- --port 4173 --strictPort`, where `main` still runs `npm run dev`.
Fix the row, not the code.

**Builder B** (`feature/systeligon-build-v1`, 50 DONE / 12 DEFERRED, head `51c4156`) reports the
largest suite (255 vitest files, 26 guards) and clean tsc. Its 12 deferrals are all visual-design rows
(E8, U5, U7, U9–U13) pending a design language.

**Caveat you must not skip: I could not independently reproduce B's test counts.** I verified B's
commits exist, its divergence (110 commits ahead of the `d26ea59` merge base) and its tsc exit 0. Its
green counts are B's claim. See §7.

## 6. What remains — do these in order

1. **Apply the analytics type fix** (§3). `main` cannot build until this lands.
2. **Add `@electric-sql/pglite` to `devDependencies`** (§4 #2). Unblocks A's CI.
3. **Renumber the collided migrations** and update `BRANCH-MAP.md` (§4 #3). Nothing merges until this
   is done, because the merge would be silent and wrong.
4. **Settle `UI-INVENTORY.md`**: one generator, one file, and it must regenerate byte-identically
   (§4 #4). The UI redesign track depends on this and is blocked by it.
5. **`U1`, `U2`, `U3`** on A's branch. `U3` is the one that matters commercially: *zero → first sealed
   report with no further code*. Note A already flagged that `U1`/`U3` overlap B's deferred `E8`
   (`src/lib/guidance/`) and intended to share one guidance module rather than write a parallel one.
   Honour that. One owner, one module.
6. **Correct A's `G1` row** (§5).
7. **Write `docs/SCALE-PLAN.md`.** The original brief required it in WP0 and it exists on **no**
   branch.
8. **Reachability audit of both engines.** Grep every export of `src/lib/writing/` and every
   audit-engine module for a production call site. The audit found `report_graphs` unwritten and
   `rule_engine_process` uncalled; confirm nothing else in either engine is still inert, and record
   what you checked. **This is the highest-value verification task on the list** — it is the defect
   class that produced every finding in the original audit.

**Owner actions — do not attempt these:**
- Make the repo private (patent-disclosure clock).
- Add a proprietary licence.
- Deploy the Edge Functions.
- Supply connector credentials via the wizard.
- Re-record the tutorial GIFs against the final UI (the committed ones are placeholders).

## 7. Delegated to Builder B — independent evaluation

Hand this to B as a **separate session with a fresh context**. B must not be told what to conclude.

> You are evaluating `feature/scale-harden-v1` at head `fc0ccda` as an **independent reviewer**. You
> did not write this code and you should assume its author was optimistic.
>
> Read `.openhands/out/STATE-EVALUATION-2026-10-29.md` for the claims being made, then **reproduce or
> refute each one against the code**. Specifically:
>
> 1. **Re-run every gate on a clean checkout** — `tsc`, full `vitest`, `build`, `check-tokens`,
>    `check-shrink`, `check-ui-contract`, `check-function-deploy-list`, `check-tutorials`, the five
>    6d anti-theatre gates, the local SQL harness twice, and Playwright. Report exact counts. Do not
>    reuse my numbers.
> 2. **Audit the §2 sharing RLS path adversarially.** The claim is that every share is
>    intra-organisation so `org_id = public.jwt_org_id()` is only ever *added* to, never relaxed.
>    Try to falsify it: construct a share that crosses an organisation, a grant by someone without a
>    Level-1 or Level-2 Head attribute, a share read after `revoked_at`, a share read after expiry,
>    and an ordinary tenant query running while a share exists. If any of them returns a row it
>    should not, that is a **L2 breach** and it stops everything.
> 3. **Verify the §10.1 grace period.** Confirm the default of 0 reproduces the old hard-lock
>    behaviour exactly, and that a non-zero window opens and closes where it claims to. Time must be
>    an argument in every pure function — flag any clock read inside `src/lib/` or `src/data/`.
> 4. **Verify the §11.4 pre-flight is genuinely append-only.** A's own note says `0095` asserted this
>    in prose without a guard and `0102` added one. Confirm the guard exists, and try to mutate or
>    delete an acknowledgement.
> 5. **Check the 7 double-allocated migrations** (§4 #3) and state the correct resolution. Confirm
>    `0090`–`0106` really are identical on both branches.
> 6. **Independently verify your own ledger.** Your `SYSTELIGON-TASKS.md` reports 50 DONE / 12
>    DEFERRED and zero Partial/Missing/TODO/DOING/BLOCKED. I could not reproduce your test counts. Do
>    so now, and report any row that does not survive a call-site grep. Your `E10 fix` row documents a
>    real past defect — explain-id attribution was substring-inferred and a screen absorbed the whole
>    catalogue. Check no other surface has the same shape of bug.
> 7. **Report contradictions, not summaries.** If a ledger row disagrees with the code, say so and
>    quote both. If a test passes for the wrong reason — an `if (count) { expect }` that skips the
>    behaviour — say so. That pattern is a known defect class in this repository.
> 8. **Re-run the two engines' load-bearing correctness claims.** These are the highest-value results
>    on the branch and none was independently reproduced:
>    - the **Writing Engine matrix** — 100 cells per model, and **1,200 compositions across all twelve
>      models, 0 missing phrases, 0 errors**;
>    - **graph-root invariance** — one root per model across all 100 cells while the render hash
>      genuinely varies;
>    - **SIRA parity** — `src/lib/siraEngine.ts` and the SQL `public.sira_compute` agree on the same
>      fixtures;
>    - **the adversarial suite** — confirm a graph-root mutation and a coverage hole each genuinely
>      refuse to seal, and that the assertions are not conditional.
> 9. **Re-run the reachability audit.** Grep every export of `src/lib/writing/` and every
>    audit-engine module (`auditEngines`, `siraEngine`, `analyticsEngine`, `automationRules`,
>    `auditFile`, `workQueue`) for a production call site. The audit found `report_graphs` never
>    written and `rule_engine_process` with zero callers. **State whether anything else in either
>    engine is still inert.** This is the defect class that produced every finding in the original
>    audit, so it is the one to be most sceptical about.
>
> Deliver: per-claim verdict (reproduced / refuted / could not reproduce), exact command output for
> every gate, and a list of anything the evaluation document overstates. **Adversarial findings are
> the deliverable. A clean bill of health is not.**

## 8. Evidence and reporting rules

- Run every gate yourself. The owner is non-technical and will not run anything.
- After every change that touches code, run the full gate set before proceeding.
- Report exact counts against the locked baseline (main: 87 migrations, 92 SQL tests, 144 vitest
  files, 18 guards, 25 Playwright specs).
- **Never sleep longer than 20 seconds** for any reason — polls, waits, retries. Prefer explicit
  retries with short backoff.
- CI is currently unreliable platform-wide; when it cannot be dispatched, record the local command
  and its exact output as the evidence, and say plainly that it was local.
- Commit after each work package with a conventional message. Do not open a PR unless the token has
  `pull_requests:write`; if it does not, write the PR body into the report and leave the blocker
  visible.
- **Do not claim zero Partial or Missing unless it is true.** The brief for this work says so in
  those words, and it means: an honest "these three remain, here is why" beats a clean table.

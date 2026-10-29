# Provio / Systeligon — continuous build prompt (`feature/scale-harden-v1`)

Read `docs/SCALE-HARDEN-BUILDER-PROMPT.md` first — same scope, same laws, same queue. **This document
replaces its stopping rules with a continuous-build contract.** Everything else carries over.

---

## 0. The continuous-build contract — read this before anything else

**You do not stop.** Not to ask permission, not to propose a plan, not to confirm a design call, not
to report progress, not to say "shall I continue". You work the queue in §3 from top to bottom and you
keep going until the queue is empty.

**No idle longer than 15 seconds, for any reason.** Polls, waits, retries, backoffs, CI checks, sleeps:
**15 seconds is the hard ceiling.** If a wait would exceed it, do not wait — take the next queue item,
or retry with a short backoff, or record the result as pending and move on. Never sit still.

**You stop for exactly three reasons, and no others:**

1. **The queue in §3 is empty.** Everything is built, gated, committed and pushed.
2. **A gate cannot be made to pass** after you have genuinely exhausted the fix options, and you have
   recorded the exact command, its exact output, and every fix you attempted.
3. **An owner action is required** — the closed list in §7. Nothing else qualifies.

**If you hit a decision you cannot make**, do not stop and do not ask. Pick the option that satisfies
the laws in §1 and the specification, **record the decision and the reasoning in
`docs/SCALE-DECISIONS.md`** in the same commit, and continue. A recorded decision is the deliverable; a
question is not.

**Never end a turn to report.** The commit message is the report. A turn ends when the queue is empty,
a gate is exhausted, or an owner action blocks you.

**Do not re-plan.** The plan is §3. Do not rewrite it, do not reorder it, do not expand it into
sub-plans and stop to present them. Execute it.

---

## 1. The laws — not negotiable, and they outrank speed

- **L1 Deterministic only.** No AI, no model calls, no free-text generation, no embeddings.
- **L2 Data never leaves the tenant.** `RLS` + `jwt_org_id()` is the only read path for tenant data. A
  new sharing path may *add* restrictions; it may never relax that equality.
- **L3 Config-as-ledger**, interconnected ledger, population gate — inviolable.
- **L4 Pure functions live under `src/lib/` or `src/data/`.** Components never import the Supabase
  client. Time is always an argument; never read the clock inside a pure function.
- Every interactive element carries `data-testid="<screenId>-<element>"`. No blocking modals; the
  tutorial drawer is `role="complementary"`. Platform crypto and existing hashing primitives only.
- **NO PARKING.** An item is `DONE` or it is not. `Partial` is not a status. `DEFERRED (design)` is
  legitimate **only** for §4, and the row stays visible.

**Speed never overrides a law.** If continuous progress would require breaking L1–L4, the law wins and
you record the decision in `docs/SCALE-DECISIONS.md`.

---

## 2. Your branch

Work on **`feature/scale-harden-v1`** (head `fc0ccda`). It is yours. Branch from it if you need to.
**Never touch `main`. Never force-push.** Push after every coherent unit of work — do not accumulate
unpushed commits across queue items.

A's branch does **not** carry `main`'s `7b9bc07`, so it lacks the month-named financial-statements
feature *and* the bug that feature introduced. Decide deliberately; if you want the feature, take the
fix with it.

## 3. The queue — execute in this order, top to bottom

**Blocking first:**

1. **Update `.github/workflows/ci.yml` — port `main`'s step 7.** Detail in §3.0. This is first because
   CI cannot go green without it, and it is the one change where A is *behind* `main`.
2. **Add `@electric-sql/pglite` to `devDependencies`.** Three of the five gate scripts import it
   (`check-dead-code.mjs`, `check-config-effect.mjs`, `check-rpc-parity.mjs`); `check-wiring.mjs` and
   `check-two-sources.mjs` do not. It is in **no** `package.json` on **any** branch — installed
   `--no-save` during the audit. A's CI ends `FAIL: @electric-sql/pglite is not installed` after 215
   files / 2,474 tests green. **A's code is not the problem.**
3. **Apply the analytics type fix.** `src/lib/analytics.ts` writes a `period` field that
   `AnalysisResultRow` in `src/types/index.ts` does not declare. Add, after `originalRowRef: number;`:
   `period: string;` and `periodLabel?: string;`. Apply with
   `git apply docs/analytics-period-fix.patch` (verified clean on `main`, `a697190`). Verified:
   `npx tsc --noEmit` → exit 0 (was 1, exactly 2 errors); `npx vitest run src/lib/analytics.test.ts` →
   5 passed. If fixing `main`, use a separate branch off `main` and open a PR.
4. **Renumber the collided migrations.** `0090`–`0106` are byte-identical on A and B; divergence starts
   at `0110`. Because the filenames differ, git merges this **cleanly and silently** into a broken
   replay order. Renumber B's `0110`–`0117` to `0118`–`0125`, or compact A's range and let B take the
   freed numbers. Update `BRANCH-MAP.md`'s reservation table **in the same commit** — that table is the
   mechanism, not the commentary.
5. **Settle `UI-INVENTORY.md`** — one generator, one file, regenerating byte-identically. A's is
   `node scripts/gen-ui-inventory.mjs`; B's header says `npx tsx scripts/gen-ui-inventory.mjs`. Two is
   zero.
6. **Correct A's `G1` row** — it says TODO and the work is done (`playwright.config.ts` runs the
   production build). Fix the row, not the code.
7. **Write `docs/SCALE-PLAN.md`** — required by the original brief, present on no branch.

### 3.0 The CI update, exactly

**The defect.** A's step 7 (`7. Migrations and SQL tests (test project only)`) applies **116 migrations
and 121 SQL test files to the HOSTED test project**, one `psql -f` per file — **237 network connections
and roughly 16,000 DDL/WAL statements per run.** A's own comment on the job timeout admits it: *"the
SQL step (network round-trips to the hosted test project) takes ~23m."*

**`main` already fixed this, and A never received the fix.** `main`'s step 7 is
`7. Migrations and SQL tests (runner-local PostgreSQL)`, and its comment states the reason plainly:
*"That is what exhausted the project's Disk IO budget. The suite needs no cloud data (the shim supplies
the Supabase parts), so it now runs against a throwaway cluster inside the runner and the hosted
project is never touched by this step."*

**The fix is to port `main`'s step 7 into A's file. Do not merge `main`'s `ci.yml` over A's** — A's
file is *ahead* on one step (`6d. Anti-theatre gates`, G2–G6) which `main` does not have. Port step 7
only, and keep 6d.

Replace A's step 7 body with this (it is `main`'s, verbatim):

```yaml
      - name: 7. Migrations and SQL tests (runner-local PostgreSQL)
        # Previously this applied 116 migrations and 121 test files to the hosted test project with
        # one `psql -f` per file: 237 connections and ~16k DDL/WAL statements per run. That is what
        # exhausted the project's Disk IO budget. The suite needs no cloud data (the shim supplies
        # the Supabase parts), so it now runs against a throwaway cluster inside the runner and the
        # hosted project is never touched by this step.
        if: ${{ hashFiles('supabase/migrations/**') != '' }}
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql postgresql-client
          # The runner image ships a cluster that is often already running, and `pg_ctlcluster start`
          # exits 2 in that case ("Cluster is already running"), so the start is best-effort and
          # connectivity is what we actually assert. Version is read from the filesystem rather than
          # pinned: the suite needs no version-specific syntax (only security_invoker, PG15+).
          PGVER="$(ls /usr/lib/postgresql | sort -V | tail -1)"
          sudo pg_ctlcluster "$PGVER" main start || true
          sudo -n -u postgres psql -tAc 'select 1' >/dev/null || { echo "::error::postgres not reachable"; exit 1; }
          bash scripts/local-sql-harness.sh
```

**`scripts/local-sql-harness.sh` already exists on A** (verified) and on `main`, identical — it
recreates the database, applies the Supabase shim, applies every migration **twice** and runs every SQL
test **twice**, exiting non-zero on the first failure. No new script is needed. The
`TEST_SUPABASE_DB_URL` env var is no longer required by this step; remove it.

**Then fix the two comments the change invalidates.** Do not leave a stale justification in the file —
that is the defect class this whole project is organised against.

- **The job `timeout-minutes: 75`.** Its comment justifies the value by *"the SQL step (network
  round-trips to the hosted test project) takes ~23m."* That is no longer true. Keep 75 (the screenshot
  sweep still needs its 15m and Playwright its ~6m, and a generous ceiling is harmless), but **rewrite
  the comment** so it describes the real reason.
- **The `concurrency: provio-test-db` group.** Its comment says *"Two runs applying migrations at the
  same time race on DDL."* After this change step 7 no longer touches the shared project — but **step 8
  (Playwright) and step 9 (screenshot sweep) still do**, so the group is still required. **Keep it**,
  and rewrite the comment to name the steps that actually need serialising.

**Verify the change before you push.** A workflow edit that is not run is not a fix:

1. Validate the YAML parses: `python3 -m pip install pyyaml && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`.
2. Reproduce step 7 locally, exactly as CI runs it: `bash scripts/local-sql-harness.sh` — it must pass
   with migrations applied twice and tests run twice.
3. Run step 6d locally, all five gates: `node scripts/check-dead-code.mjs && node scripts/check-config-effect.mjs && node scripts/check-wiring.mjs && node scripts/check-two-sources.mjs && node scripts/check-rpc-parity.mjs` — these pass only after item 2 (pglite) is done, which is why item 2 precedes the push.
4. Push, then **watch the run** (`gh run watch` / `gh run list --branch feature/scale-harden-v1`). If CI
   cannot be dispatched, record the local commands and their exact output as the evidence and say
   plainly that it was local.

**Commit both changes together** — the step 7 port, the pglite declaration and the two comment
corrections belong in one commit, because the second without the first leaves CI red for the same
reason, and the comment fix without either leaves a lie in the file.

### 3.1 WP-IMPORT — the migration path for real client data (do this before the S-series)

**Why this is near the front.** It unblocks real-client testing, and every other queue item is easier to
verify once a real dataset is in the system instead of a fixture. Full analysis in
`docs/EVALUATION-REAL-USE.md` §4.

**What exists and is reachable — do not rebuild it.** The three-step wizard
(`src/components/admin/ImportWizardPanel.tsx`, lazy-mounted from `RecordContent.tsx:122`), the DB-backed
validation RPCs (`0042_imports.sql`: `start_import`, `validate_import`, `commit_import`), prior-year
import (`0044_prior_year_import.sql`), and the `import_jobs` + `activity_log` trail. **Reuse all of it.**

**The exact gap.** `import_type` is fixed by a CHECK constraint:

```sql
import_type text not null check (import_type in ('rcm', 'entities', 'users', 'populations'))
```

and `commit_import` writes only three tables (`entities`, `risks_library`, `org_members`). So a client
can bring a **risk-control matrix, an entity list, a user list and populations** — and nothing else. No
engagements, findings, CAPs, workpapers, SIRA cycles or conclusions. Prior-year import copies four item
types from an **existing engagement in the same org**; it is not a way in for a client with no data here.

**Build:**

1. Widen the `import_type` CHECK to the full entity set — engagements, findings, caps, workpapers,
   sira_cycles, conclusions. **This constraint is the hard gate; everything else needs it.**
2. A **historical import type**: one file, all entity types, ordered, cross-references resolved. A
   client's history is one dataset, not four disjoint lists.
3. **Dependency ordering and referential resolution** — engagements before findings before CAPs;
   natural keys (`ENG-2024-001`) mapped to new uuids. An import that half-lands is worse than none.
4. **Dry-run mode** — validate the whole file, report every error, write nothing. A non-technical owner
   will not accept a partial import.
5. **Idempotent re-run** — the same file twice must not duplicate. Testing is iterative.
6. **Per-row `import_jobs` trail.** L3 applies to imports like everything else.
7. **Template files** — one XLSX per entity type, with headers and a worked example. The owner is
   non-technical.
8. **A migration-status screen** — what landed, what failed, what was skipped, and why.
9. **SQL tests for the refusal paths** — cross-org rows, missing parents, malformed dates. The testing
   rules require both the happy path and the RLS refusal.
10. **Playwright happy path** — upload a template, map, commit, see the data.

**Estimated ~1,500–2,500 LOC, ~4 migrations, ~2 screens.** Well-bounded, and it reuses the existing
wizard, the validation RPC shape and `import_jobs`.

**The caution that matters.** Import is a write path into tenant data. It must go through the same RLS
and `jwt_org_id()` discipline as everything else, must be append-only in the ledger, and the dry-run must
be genuinely side-effect-free. **An import path is a classic place to smuggle in a cross-tenant read** —
test the refusal path explicitly.

8. **WP-IMPORT — the migration path for real client data.** Detail in §3.1. Before the S-series,
   because it unblocks real-client testing and makes every later item verifiable against real data.

**Then the build remainder:**

9. **S2 — header detection + confirm-before-count.** `population.ts:94` is still
   `const [header, ...body] = table;` — the assumption, unchanged. Detect, propose, confirm, then
   register with hash and confirmed count.
10. **S1 — `src/lib/systeligon/`.** Rule schema, runner, versioning, result shape. **This directory does
   not exist on any branch and there is no `rules/` directory anywhere.** Nothing else in the S-series
   can precede it.
11. **S6 — the forensic rule library**, one pure module per family, each versioned and tested. The
   numeric forensics exist in `analyticsEngine.ts` but are **not versioned rules with provenance**.
   Port them into S1's shape; do not duplicate them.
12. **S7 tiers 2–3 — OCR and structured extraction.** OCR is **not built anywhere**
    (`grep -iE "ocr|tesseract"` over every branch and every `package.json` returns nothing). Tier 2 per
    spec §5: **bundled, not called, loaded on demand, nothing leaves the tenant.** Tier 3: declared
    parsers for vendor/date/amount/reference/period/signature-presence. Tier 1 is partial and unwired —
    `extractDocument` is `F43 → Inert`; wire it.
13. **S3/S4/S5/S12 — the two flows and verification.** Accepted flow (flag → rows → evidence → verify →
    revert/override, with the override carried forward to the next reviewer); declined flow (floor as a
    **minimum, never a ceiling**, paste-to-fill, auto-add); Mode A / Mode B org-configurable.
14. **S8/S9/S14/S15 — document review, pattern rules, minutes, policy comparison.** Spec §3.2 and §3.3.
    **S15 must report its own coverage** — clauses parsed, matched, and **could not be interpreted** —
    because an unparsed clause is not a clean clause.
15. **S10/S11 — rule packs and signed OTA distribution.** Packs **signed** (reuse `signing_keys` from
    `0096`), versioned and append-only; an unsigned or unverifiable pack is **refused** and the refusal
    logged.
16. **S13 remainder — findings-to-report provenance** (`F39 → Absent`).
17. **S16 — the name in one constants module.**
18. **C1–C7 — continuous assurance.** The rule library is built (`monitors.ts`, six kinds, pure); **the
    engine that drives it is not.** `rule_engine_process`, `alert_record`, `connector_run_start`/`_finish`
    and `staged_record_ingest` all have **0 production refs** (`F49`–`F59`). Build the scheduled runner,
    persist alerts, emit `watcher.signal`, then enrichment, delivery, the suggestion and remediation
    paths, triage, and anomaly-to-SIRA.
19. **T1/T2 — the scheduled sweeps.** `ledger_continuity_check()` and the alarm are built; the schedules
    are not.
20. **R5 — methodology and test-step templates** (`F28`–`F30`: no `test_step_templates` table, no
    `procedure_templates` table, three hardcoded stage strings).
21. **R6 — multi-tenant scale and isolation** (`F84` no SQL test with ≥3 concurrent orgs; `F85`
    support-grant refs legacy-name only; `F86` every support read logged).
22. **R7 — Super Admin guided provisioning** (`F92`: the SA-01 wizard covers some steps; model the full
    path).
23. **R3 remainder — configuration honesty** (`F35`, `F72`–`F76`, `F78`, `F79` still `Inert`).
24. **D5–D9 — adjacent capability products** (`F121`–`F125`).
25. **Re-record the tutorial media.** `check-tutorials` reports 69 current and **11 stale**; the
    committed GIFs are placeholders. This is build work, not an owner action.
26. **Reachability audit of both engines.** Grep every export of `src/lib/writing/` and every
    audit-engine module for a production call site. The audit found `report_graphs` unwritten and
    `rule_engine_process` uncalled. **Do this continuously, not once** — run it after every queue item
    that adds a module.

---

## 4. The one thing you must not build — the design language

**Held for the owner. Building now means rebuilding.** The test: *if the owner changed their mind about
how it should look, would the work be thrown away?*

**E8** `PencilGuide` + guidance data · **U5** motion signalling state change only · **U7** density
toggle · **U9** three themes (`prism`, `bloom`, `slate`) · **U10** four audience profiles · **U11**
time-of-day phases · **U12** motion system · **U13** animated headers. Register `F105`–`F113`.

When the design language is settled, build these and nothing else changes.

**Note the collision:** A's `U1`/`U3` overlap B's deferred `E8` on `src/lib/guidance/`. Share one
module rather than writing a parallel one — one owner, one module.

---

## 5. Gates — after every queue item, no exceptions

`npx tsc --noEmit` · `npx vitest run` · `npx vite build` · `node scripts/check-tokens.mjs` ·
`node scripts/check-shrink.mjs` · `node scripts/check-ui-contract.mjs` ·
`node scripts/check-function-deploy-list.mjs` · `npm run check-tutorials` ·
the anti-theatre gates (G2–G6 on A, G7–G10 on B) · `bash scripts/local-sql-harness.sh` (or the docker
variant) · `npx playwright test`.

**A gate that fails stops that queue item — not the build.** Fix it, or if you cannot, record the exact
command and output in `docs/SCALE-DECISIONS.md`, mark the item blocked in the ledger, and **move to the
next queue item.** Never idle on a red gate. Never skip a gate silently.

Report exact counts against the locked baseline: **main = 87 migrations, 92 SQL tests, 144 vitest
files, 18 guards, 25 Playwright specs.**

---

## 6. Commit protocol

- **One conventional commit per queue item.** Not one per file, not one per session.
- **Push after every commit.** Do not accumulate unpushed work.
- The commit message carries the report: what changed, the gate results, and any decision taken. A
  turn is not the place for it.
- **Update the ledger in the same commit as the work.** If you wire something, its register row moves
  in that commit or `check-feature-register.mjs` fails.
- **Do not open a PR** unless the token has `pull_requests:write`. If it does not, write the PR body
  into `docs/SCALE-REPORT.md` and leave the blocker visible.

---

## 7. Owner actions — the complete closed list

Nothing outside this list justifies stopping.

- Make the repository private (the patent-disclosure clock is running; the repo is public).
- Add a proprietary licence.
- Engage patent counsel if a filing is wanted.
- Run a trademark search on the final name.
- Supply connector credentials via the wizard.
- Deploy the Edge Functions.
- **The design language in §4.**

If you believe you are blocked and the blocker is not on this list, **you are not blocked** — pick the
law-abiding option, record the decision, and continue.

---

## 8. The two engines — never treat them as "a feature"

Both were found **built, tested, and attached to nothing.** Any session that treats them as ordinary
modules repeats the original defect. Before you add anything to either, **grep for a production call
site.**

**Writing Engine — `src/lib/writing/` (41 modules, 8,817 lines).** An audit report is a **directed
graph**: each node a *claim* (typed references, bound figure, phrase id + version, rule id + version);
each edge evidence, dependency, or structure. **Two hashes — the graph root over the facts, the render
hash over the words.** The defining property: **the root is identical across every formality, tone,
voice and locale.** Proved by exhaustion: 100 cells × 12 models = **1,200 compositions, 0 missing
phrases**. The matrix found and fixed a real defect in the engine. `adversarial.test.ts` holds the
graph-root mutation test and the coverage-hole test. No test reads a clock.

**Audit Engine — the auto-configuring audit.** SIRA pre-fill with per-suggestion accepted/declined
decision rows; `siraEngine.ts` mirroring SQL `sira_compute` with a parity test; `analyticsEngine.ts`
with **14 deterministic checks**; `createDeterministicPrng` (seeded Mulberry32, *no unseeded randomness
in any sampling*) and `verifyPopulationGate`; `automationRules.ts` + `0056` with a loop guard and a
**>20 events/rule/hour auto-pause**; monitor rules — six kinds, pure, window and time as arguments.

**The defect that matters most:** `grep -rn "report_graphs" src/` → **empty.** The engine computed the
roots, the tests verified them, and **the result was never persisted.** The monitor runtime was dead;
`rule_engine_process` had **zero** callers. **The best engineering in the repository was inert, and its
tests were all passing.**

---

## 9. What is already done — do not redo it

**A (46 DONE / 4 TODO)** — `0095_scale_harden_sharing_preflight.sql`: §10.1 grace period
(`testing_grace_hours`, default 0, reproducing the old hard lock exactly); §11.4 pre-flight (eight
checks, append-only acks — `0095` claimed append-only in prose, `0102` added the guard; check it held);
§2 cross-universe sharing (intra-organisation, so `jwt_org_id()` is only ever *added to* — **verify
this yourself**); `0098` Realtime. Gates G2–G6 pass locally: 533 functions reachable, 50 config matrix
rows (41 enforced), every `src/data` export reachable, no component reading both sources, 116 RPCs
present.

**B (50 DONE / 12 DEFERRED)** — S17 recognition, S18/S19 SIRA continuity and two-key acceptance, S20
evidence storage (the "most serious gap"), S21 comment popout; T3–T7 attestation, standalone verifier,
incident wizard, integrity alarm; D1–D4 (20 capabilities, one uniform evaluator); E1–E7/E9–E10 explain
layer; U1–U4/U6/U8/U14; F1–F7 fonts; gates G7–G10. **B's 2,954 test count is B's claim and was not
independently reproduced.**

---

## 10. Delegated to Builder B — independent evaluation

Hand this to B as a **separate session with fresh context.** B must not be told what to conclude.

> You are evaluating `feature/scale-harden-v1` at head `fc0ccda` as an **independent reviewer.** You
> did not write this code; assume its author was optimistic. Read
> `docs/EXTERNAL-REVIEW-BRIEFING.md` for the claims, then **reproduce or refute each against the code.**
>
> 1. **Re-run every gate on a clean checkout** — tsc, full vitest, build, check-tokens, check-shrink,
>    check-ui-contract, check-function-deploy-list, check-tutorials, the anti-theatre gates, the local
>    SQL harness twice, and Playwright. Report exact counts. Do not reuse my numbers. **Your own 2,954
>    test count was not independently reproduced — start there.**
> 2. **Audit the §2 sharing RLS path adversarially.** The claim: every share is intra-organisation, so
>    `org_id = public.jwt_org_id()` is only ever *added to*, never relaxed. Falsify it — a
>    cross-organisation share, a grant by someone without a Level-1/Level-2 Head attribute, a read
>    after `revoked_at`, a read after expiry, and an ordinary tenant query while a share exists. **Any
>    row returned that should not be is an L2 breach and stops everything.**
> 3. **Verify the §10.1 grace period.** Confirm default 0 reproduces the old hard lock exactly, and a
>    non-zero window opens and closes where claimed. Time must be an argument in every pure function —
>    flag any clock read inside `src/lib/` or `src/data/`.
> 4. **Verify the §11.4 pre-flight is genuinely append-only.** Try to mutate or delete an
>    acknowledgement.
> 5. **Check the 7 double-allocated migrations** and state the correct resolution. Confirm `0090`–`0106`
>    are identical on both branches.
> 6. **Independently verify your own ledger.** `SYSTELIGON-TASKS.md` reports 50 DONE / 12 DEFERRED and
>    zero Partial/Missing/TODO/DOING/BLOCKED. Report any row that does not survive a call-site grep.
>    Your `E10 fix` row documents a real past defect — check no other surface has the same shape of bug.
> 7. **Report contradictions, not summaries.** If a ledger row disagrees with the code, quote both. If a
>    test passes for the wrong reason — an `if (count) { expect }` that skips the behaviour — say so.
>    That pattern is a known defect class here.
> 8. **Re-run the two engines' load-bearing claims:** the Writing Engine matrix (100 cells per model;
>    1,200 compositions, 0 missing); graph-root invariance (one root per model across 100 cells, render
>    hash varying); SIRA parity (`siraEngine.ts` vs SQL `sira_compute`); and that the adversarial
>    suite's graph-root mutation and coverage hole **genuinely refuse to seal, with non-conditional
>    assertions.**
> 9. **Re-run the reachability audit.** Grep every export of `src/lib/writing/` and every audit-engine
>    module for a production call site. State whether anything else is still inert.
> 10. **Verify the planned/built boundary in the briefing.** It lists S1–S16, C1–C7, D5–D9 and R5–R7 as
>     **not built**. Confirm or refute each against the tree — especially that `src/lib/systeligon/`
>     does not exist, that no `rules/` directory exists, and that **no OCR exists on any branch.**
>
> Deliver: per-claim verdict (reproduced / refuted / could not reproduce), exact command output for
> every gate, and anything the briefing overstates. **Adversarial findings are the deliverable. A clean
> bill of health is not.**

---

## 11. Evidence rules

- Run every gate yourself. The owner is non-technical and will not run anything.
- CI is unreliable platform-wide; when it cannot be dispatched, record the local command and its exact
  output and say plainly that it was local.
- **Never sleep longer than 15 seconds.** Never idle. Never wait on a human.
- **Do not claim zero Partial or Missing unless it is true.** An honest "these remain, here is why"
  beats a clean table.
- **You stop when §3 is empty, or a gate is exhausted, or §7 blocks you. Nothing else.**

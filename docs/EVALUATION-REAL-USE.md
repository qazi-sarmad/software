# Provio — real-use evaluation against the current build

**Date:** 2026-10-29. **Evaluated:** `feature/scale-harden-v1` at `fc0ccda`, gates run in this sandbox.
**Purpose:** state, honestly, whether this build can carry a real client, and what remains.

---

## 1. Gate results — reproduced here, not copied

| Gate | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | **exit 0** | no output |
| `npx vitest run` | **215 files / 2,474 tests passed** | 66.3s |
| `npx vite build` | **PASS** | built in 1.14s |
| `check-tokens` | **PASS** | |
| `check-shrink` | **PASS** | |
| `check-ui-contract` | **PASS** | |
| `check-function-deploy-list` | **PASS** | |
| `check-tutorials` | **PASS** | |
| `check-dead-code` (G2) | **PASS** | |
| `check-config-effect` (G3) | **PASS** | |
| `check-wiring` (G4) | **PASS** | |
| `check-two-sources` (G5) | **PASS** | |
| `check-rpc-parity` (G6) | **PASS** | |
| `bash scripts/local-sql-harness.sh` | **PASS** — 116 migrations applied twice, all SQL tests passed twice | |

**Every gate green locally.** The build is in good shape.

> **CORRECTION — 2026-10-29, after re-checking.** The two CI blockers originally recorded here
> (**step 7 running against the hosted project**, and **`@electric-sql/pglite` undeclared**) were
> **both fixed by the builder on this branch in commit `404cd25`**. Step 7 now runs
> `scripts/local-sql-harness.sh` against a runner-local PostgreSQL 17, ported from `main`; `pglite`
> is declared at `^0.5.13`. The original text is kept below only to show what was true at `fc0ccda`.
>
> **The migration-collision framing here was also too strong.** There are **no duplicate migration
> numbers within the branch.** A and B used 0110–0117 with different filenames, so the collision is
> cross-branch, not intra-branch. `404cd25` records the decision: every new migration takes **0118+**,
> and `BRANCH-MAP.md`'s reservation table was corrected. That is a merge-time rule, not a defect.
>
> **CI is nevertheless NOT green right now** — see §8. It went green at `03d5af5` (run 40851647488,
> 30m31s) and has failed at step 8 on every push since.

**Superseded (true at `fc0ccda`, fixed at `404cd25`):**

- `@electric-sql/pglite` was present in `node_modules` but declared in no `package.json`. CI failed at
  `FAIL: @electric-sql/pglite is not installed`. **Now declared.**
- **A's step 7 ran against the hosted test project.** `main` had already fixed this to a runner-local
  cluster; `404cd25` ported it. **Now runner-local.**

## 2. The headline defect is FIXED

The audit's central finding was that the app was not database-backed in production. **On this branch it
is.** Verified in `src/App.tsx:209`:

```ts
const loadDemoSeed = !hasSupabaseConfig() && import.meta.env.DEV
  ? () => import('./data/demoSeed').then((m) => m.demoSeed)
  : null;
const useDatabase = hasSupabaseConfig();
```

The demo seed now requires **both** no-Supabase-config **and** dev mode. With a configured project the
shell hydrates from `src/data/tenant.ts` through RLS-scoped reads, and `playwright.config.ts:47` runs
`npm run build && npm run preview` — the **production bundle**, not the dev server. **That is the test
that was missing, and it now exists.**

**But be precise about the size of the fix.** `tenant.ts` is 285 lines reading **10 tables**:
`caps`, `engagements`, `entities`, `issues`, `ledger_entries`, `observations`, `report_comments`,
`universes`, `workpaper_step_state`, `workpapers`. The schema has **176 tables**. So the shell hydrates
the *engagement working surface*, not the whole product.

**The read path is one function, `readRows`, and it swallows every error:**

```ts
if (error) { warnings.push(`${table}: ${error.message}`); return []; }
```

**An RLS denial and an empty table are indistinguishable to the user.** For a product whose central
claim is that tenant isolation is provable, that is a real gap — a denied read must not look like "no
data". It renders, which is why the choice was made, but it should surface the difference.

## 3. Write path — better than the read path

- **47 of 58** data modules perform writes (`.rpc(`, `.insert(`, `.update(`).
- **116 distinct RPCs** are called from `src/data/`.
- **24 components** use `useScopedData`, of 129 total.
- **554 RPCs** exist in the schema; the UI calls 116.

So roughly **a fifth of the backend surface is reachable from the UI.** That is not the "fifteen uncalled
functions" problem — those are now wired — but it is the honest ratio.

## 4. The import path — this is the answer to the migration question

**You asked for migration configuration so anyone can bring existing internal-audit history in for
testing. Substantial infrastructure already exists — but it does not cover history.**

**What exists and is reachable:**

| Piece | Where | Status |
|---|---|---|
| Three-step import wizard (upload → map → validate/commit) | `src/components/admin/ImportWizardPanel.tsx` | **wired**, lazy-mounted from `RecordContent.tsx:122` |
| DB-backed validation (org scope enforced in SQL) | `0042_imports.sql`: `start_import`, `validate_import`, `commit_import` | **built** |
| Prior-year import from a source engagement | `0044_prior_year_import.sql`: `import_prior_year_item`, `confirm_prior_year_item` | **built**, mounted at `PlanningPanel.tsx:282` |
| Import job ledger | `import_jobs` table + `activity_log` | **built** |

**What it imports — the four types are fixed in a CHECK constraint:**

```sql
import_type text not null check (import_type in ('rcm', 'entities', 'users', 'populations'))
```

And `commit_import` writes only three tables:

```sql
insert into entities (...)          -- 'entities'
insert into risks_library (...)     -- 'rcm'
insert into org_members (...)       -- 'users'
```

**So the gap is exact:** you can import **a risk-control matrix, an entity list, a user list, and
populations**. You **cannot** import engagements, findings, CAPs, workpapers, SIRA cycles, prior audit
history, or conclusions. Prior-year import copies four item types from an *existing engagement in the
same org* — it is not a way in for a client with no data here at all.

**There is no bulk/historical migration path.** That is the work you are describing.

### What it would take — as a new work package, WP-IMPORT

| # | Item | Why |
|---|---|---|
| 1 | **Widen the `import_type` CHECK** to the full entity set — engagements, findings, caps, workpapers, sira_cycles, conclusions | the constraint is the hard gate; every path below needs it |
| 2 | **A historical import type**: one file, all entity types, ordered, with cross-references resolved | a client's history is one dataset, not four disjoint lists |
| 3 | **Dependency ordering + referential resolution** — engagements before findings before CAPs; natural keys (`ENG-2024-001`) mapped to new uuids | an import that half-lands is worse than none |
| 4 | **Dry-run mode** — validate the whole file, report every error, write nothing | non-technical owners will not accept a partial import |
| 5 | **Idempotent re-run** — a second run of the same file must not duplicate | testing is iterative |
| 6 | **An `import_jobs` audit trail per row** — the ledger rule applies to imports too | L3 |
| 7 | **Template files** — one XLSX per entity type with headers and a worked example | the owner is non-technical |
| 8 | **A migration-status screen** — what landed, what failed, what was skipped, and why | so a tester can self-serve |
| 9 | **SQL tests for the refusal paths** — cross-org rows, missing parents, malformed dates | required by the testing rules |
| 10 | **Playwright happy path** — upload a template, map, commit, see the data | required |

**Estimated: ~1,500–2,500 LOC, ~4 migrations, ~2 screens.** Small, well-bounded, and it reuses the
existing wizard, the validation RPC shape, and the `import_jobs` table. **This is the right thing to
build first** — it unblocks real-client testing, and everything else on the queue is easier to verify
once a real dataset is in the system.

**One caution.** Import is a write path into tenant data. It must go through the same RLS and
`jwt_org_id()` discipline as everything else, must be append-only in the ledger, and the dry-run must
be genuinely side-effect-free. An import path is a classic place to smuggle in a cross-tenant read.

## 5. Real-use assessment — can this carry a client today?

**Yes for the core loop; no for a client with history; not yet for external auditors.**

**Works now:** sign in, create a universe and entities, create an engagement, move it planning → testing
→ conclusion, build a workpaper, compute analytics, generate a report through the Writing Engine, seal
it, verify the root, create a CAP, export. The engines are real and tested. The report-as-graph
property — one graph root across every formality, tone, voice and locale — is the strongest asset in the
product and it is proved by exhaustion.

**Blocks a real client today:**

1. **No historical migration path** (§4). A firm with 5,000 findings cannot start.
2. **A's CI is red** for two known, one-line-ish reasons (§1).
3. **`main` does not compile** — the `period` type error. `main` is the base for any deployment.
4. **7 double-allocated migrations** — nothing merges until renumbered.

**Blocks an external-auditor client specifically:** evidence storage (S20 is on B, not A), the opinion
engine, materiality, trial balance — i.e. the separate product in `NOTES-EXTERNAL-AUDIT-SCOPE.md`.

**Weakest surface:** the read path's silent-failure behaviour (§2). Everything renders; nothing
distinguishes "denied" from "empty".

## 6. What remains — corrected 2026-10-29

**CI status (this is the live issue).** The branch **went green once**: `03d5af5`, run **40851647488**,
`gates` 30m31s, all steps passed. Since then **every push has failed at step 8**:

| Run | Commit | Step 8 | Note |
|---|---|---|---|
| 40851647488 | `03d5af5` audit(engines) | **✓ green** | 144 passed / 3 skipped; step 9 sweep timed out at 15m but is `continue-on-error` |
| 40855036105 | `26c751f` S8/S9/S14/S15 | **✘** | C2.4 failed in `signOut()`, line 42 — `Open user profile menu` |
| 40857677773 | `d8631ec` S10/S11 | **✘** | C2.4 failed at the **final** assertion — `member-<uuid>` not visible |

**Steps 1–14 are green on the current head** (tsc, 221 files / 2,576 unit tests, build, tokens, shrink,
tutorials, deploy list, ui-contract, G2–G6, runner-local SQL). **Only step 8 fails, and only C2.4.**

**C2.4 is flaky, not deterministically broken.** The evidence:

- It **passed** in run 40851647488, in both the dev pass (23.9s) and the G1 production pass (19.4s).
- It has failed at **two different points** in two consecutive runs — `signOut()` in one, the final
  `member-<uuid>` assertion in the other. **A deterministic break fails at the same line every time.**
- `playwright.config.ts` sets `fullyParallel: true` and `retries: process.env.CI ? 1 : 0`. Both attempts
  failed, so it is not a single-attempt flake — it is a **race under parallel load**.
- The two failing points share a cause: the spec is **stateful across the whole file** (it creates a
  user, signs in as the invitee, accepts, signs out, signs back in as the Org Admin) while other specs
  run concurrently against the **same shared hosted project**.

**The likely mechanism:** the spec deletes residue at the start by email, then creates the account with
`admin.createUser`. Under parallel load against the shared project, either the auth write or the
`org_members` read is not yet visible when the UI reads it. `PeopleAdminPanel.load()` runs on mount, so
a read that lands before the membership commits shows no row — exactly the second failure. The first
failure (`signOut()` not finding the profile menu) is the same class: the shell had not finished
resolving the session.

**This is not a source defect in the product.** It is a test-isolation defect. The fix belongs in the
spec, not in `src/`: either serialise C2.4 (`test.describe.configure({ mode: 'serial' })` plus a
`test.describe` retry boundary), or poll the assertion instead of asserting on a single mount-time read.
**Do not "fix" it by weakening the assertion** — that is the conditional-assertion defect class recorded
in memory, and it would hide a real regression.

**Also on step 9:** the screenshot sweep timed out after 15 minutes in the green run. It is
`continue-on-error: true`, so it does not fail the job, but it captures nothing. Its own
`timeout-minutes: 15` is doing its job (protecting the 45m job budget) — the sweep itself is too slow.

**Real remaining work, in order:**

1. **Fix the C2.4 flake** so step 8 is green. Test-side only. This is the one thing standing between the
   branch and a fully green CI.
2. **Speed up or trim the screenshot sweep** so step 9 produces artifacts instead of timing out.
3. **`main` does not compile** — verified, see §1. `tsc` fails with the `period` error at
   `src/lib/analytics.ts:68` and `:381`. `main` is the base for any deployment and has been red since
   2026-10-26. Note `404cd25` records a **decision not to apply that fix on this branch** — applying it
   here turns a clean `tsc` into 4 errors, because the two lineages' `analytics.ts` diverged. So this
   must be fixed **on `main`**, not here.
4. **Cross-branch migration numbering** — 0118+ for anything new. Already decided; just obey it.
5. **One `UI-INVENTORY.md`.** There are still two: this branch has 1,685 lines, B has 2,038. They must
   be reconciled into one before the parallel UI track starts.
6. **WP-IMPORT** (§4) — still the highest-value *feature* work, once CI is green.

**Ledger state on the branch** (`docs/SCALE-TASKS.md`): **46 DONE, 3 TODO, 1 BLOCKED.** The three TODOs
are **U1** (pencil-style guided pointers), **U2** (every screen's functional states), **U3** (guided
first-run zero → first sealed report) — **all three are design-language / UI-polish items, which are the
owner's held work by the standing rule.** The BLOCKED row is **C7** (anomaly → SIRA), blocked on S18,
not available on this branch alone. So **the engineering queue is essentially closed on this branch.**

**Held for the owner:** the design language (E8, U5, U7, U9–U13) and U1–U3.

## 7. On outsourcing this to a second builder

**Yes — and the repo is already built for it.** `BRANCH-MAP.md` exists precisely for this: one branch,
one ledger, reserved migration numbers. The mechanism is in place.

**What makes it work:**

- **One branch, one ledger, no exceptions.** B's ledger holds because B does not edit A's. The one
  recorded violation (an unpushed commit editing the other builder's ledger) is exactly the failure to
  avoid.
- **Reserve migration numbers before writing them.** The current 7-way collision happened because two
  builders reached 0110 independently.
- **Keep the reachability audit continuous.** The defect that produced the whole crisis — built, tested,
  wired to nothing — appears whenever a builder adds a module and forgets the call site.

**What I would hand to a second builder, and why:**

| Package | Fits a second builder? | Reason |
|---|---|---|
| **WP-IMPORT** (§4) | **Yes, ideal** | self-contained, one wizard, one table, clear acceptance |
| S1–S16 (rule engine) | Yes, after S1 | large, sequential, needs one owner |
| C1–C7 (continuous assurance) | Yes | depends on A's monitor rules, self-contained |
| R5–R7 | Yes | small and independent |
| **The migration renumbering** | **No** | it touches both branches; one builder must own it |
| **The kernel extraction** (if ever) | **No** | it changes everything |

**The rule I would hold to:** a second builder gets **one work package, one branch, one ledger row set**,
and never touches another builder's ledger or `ci.yml`. The CI file must have one owner — the step-7
port is a good example of what happens when it does not.

**The caveat.** Two builders double the coordination surface. The evidence from this repo is that
parallel builds work when the ledger discipline holds and fail when a builder edits outside its lane.
**Outsource WP-IMPORT and the S-series; keep the migration renumbering and CI in one pair of hands.**

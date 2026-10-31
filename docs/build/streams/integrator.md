# Stream TRUNK — the integrator (`feature/systeligon-builder-continuous`)

The integrator works on the trunk itself (OWNERSHIP.md §1). It owns the mount points (§4), the shared
ledgers (`FEATURE-REGISTER.md`, `SCALE-TASKS.md`, `SYSTELIGON-GAP-REPORT.md`), `src/App.tsx`,
`src/context/AppContext.tsx`, the nav/routing registry, the existing guards, `package.json` and the
merge. It edits no stream's files.

## Baseline (locked at `38d9457`, 2026-10-30)

Read from the tree, not from a document:

| Measure | Value |
|---|---|
| Migrations | 152 (highest `0210_self_diagnostic.sql`) |
| SQL tests | 156 |
| vitest files | 337 |
| vitest tests | 3798 |
| Playwright specs | 31 |
| Guard files (`src/guards/*.test.ts`) | 35 |
| Register gate | `PASS: 148 features: 138 Wired, 1 Inert, 9 Absent` |

The earlier baselines this session recorded (`968e30d`: 128/133/281/3216/31/28; `0203` head:
145/149/314/3621/30; the ported head: 152/156/337/3798/31/35) are kept below as the trail. The current
head `38d9457` is the authority; re-measure before claiming a count.

At the head after the concurrent-build work: 129 migrations, 134 SQL tests,
**283 vitest files / 3242 tests**, **30 guards** (the integrator's `mountPoints.test.ts` and
`ownershipMap.test.ts` added).

At the head after the D12/D13 merge (2026-10-30): **145 migrations** (highest `0203`), **149 SQL
tests**, **314 vitest files / 3621 tests**, 30 guards. The register reads **135 Wired / 1 Inert /
9 Absent** (F141/F142 D12/D13 `Absent` → `Wired`; the D10/D11 rows F139/F140 were already `Wired`).
This head already carries the other streams' merged work, so the migration and test counts are the
trunk's, not this stream's alone; D12/D13 contributed `0160_readiness_signals.sql`,
`0161_complaints.sql` and `supabase/tests/149_readiness_complaints.sql`.

All gates green at baseline: `npm run build`, `tsc --noEmit`, `vitest run`, the SQL harness twice
(`migrations applied twice` / `all SQL tests passed twice`), and
`check-feature-register` / `check-wiring` / `check-dead-code` / `check-ui-contract` /
`check-two-sources` / `check-tokens` / `check-shrink` / `check-config-effect` / `check-rpc-parity`.

## Environment notes (this sandbox)

- `node_modules` was absent — `npm ci` first.
- The docker SQL harness (`scripts/local-sql-harness-docker.sh`) does not work here: no docker socket
  for the invoking user. Installed **PostgreSQL 17** via apt and started the cluster
  (`sudo pg_ctlcluster 17 main start`); the **non-docker** `scripts/local-sql-harness.sh` is the
  working path in this sandbox and reports green twice.

## Queue

1. Baseline + tree whole. **DONE** (above).
2. Create the mount points (OWNERSHIP.md §4). **DONE** (below).
3. Watch the merge: one stream at a time, full gate set after each, fold the stream doc into the
   ledgers (register, SCALE-TASKS, gap report).

## The mount points (§4) — what was created, and the decisions taken

Created at `968e30d`:

| Artifact | Path | Purpose |
|---|---|---|
| Screen registry | `src/nav/registry.ts` | a stable slot per screen; `screenId` → component path + owner stream + status |
| Data barrel | `src/data/index.ts` | one namespace re-export per stream's data module (typed stubs for the not-yet-exist ones) |
| Capability registry | `src/lib/capabilities/registry.ts` | each capability family, its owner stream and its module path |
| Mount-point guard | `src/guards/mountPoints.test.ts` | the integrator's own guard: the three registries are internally consistent and exported |

**Decisions (recorded, per the build prompt, as the integrator's own map rulings):**

1. **The registries are declarative manifests of strings — no React, no Supabase.** `src/nav/registry.ts`
   stores a component *path* per slot (§4.1: "pointing at a component path"), never a component value,
   so it is a pure data module that neither imports the client (M8) nor reads a clock.
2. **A stream does not edit the registry.** It creates the component file at the agreed `path`. The
   integrator flips the slot's `status` from `planned` to `mounted` and wires the render at merge time
   (§7.3 merges one stream at a time). This is the only reading that satisfies both "the registry
   already lists every planned screen" and "a stream does not edit the registry".
3. **No new ownership grant is needed.** Every planned slot's `path` falls inside a directory §2
   already assigns to that stream (`src/components/assurance/**` → S2; `src/components/universe/**`,
   `src/components/sira/**` → S3; `src/components/superadmin/**` → S4; `src/components/documents/**` →
   S7). A stream that needs a *new* screen directory the map does not grant requests it from the
   integrator; the integrator edits this map, never the stream.
4. **The data barrel re-exports namespaces** (`export * as ns from '...'`) so two modules with a
   colliding export name cannot break the build, and so the barrel adds no `check-wiring` value export.
5. **Empty typed stubs** are created for the data modules a stream owns but has not written yet, so
   the barrel is complete up front and the owning stream fills only its own stub.

## The stream branches (§4 — the gate for every stream)

Created from the trunk head `ceba781`, so each carries the mount points:

| Branch | Head | Notes |
|---|---|---|
| `feature/build-core-engine` (S1) | `ceba781` | |
| `feature/build-assurance-caps` (S2) | `ceba781` | |
| `feature/build-risk-planning` (S3) | `ceba781` | |
| `feature/build-platform-control` (S4) | `ceba781` | |
| `feature/build-monitor-runtime` (S5) | `ceba781` | |
| `feature/build-config-honesty` (S6) | `ceba781` | |
| `feature/build-extraction` (S7) | `ceba781` | |

**The DESIGN branch was re-cut onto the trunk head.** The old `feature/systeligon-design-spec` sat at
`bc7fd15` (the designer's auto-updating-spec branch, created 2026-10-29), cut from `ceb85fd`, **before**
the mount points — so it lacked `src/nav/registry.ts`, `src/data/index.ts`,
`src/lib/capabilities/registry.ts` and the current `docs/build/**`. It carried **no unique content**:
the trunk already has `scripts/gen-design-spec.mjs`, `docs/DESIGN-SPEC.md`, `docs/design/**` and
`src/guards/designSpec.test.ts`. The design branch is therefore **`design/language-v1`**, cut from the
trunk head (`1acba25`); the old branch is recorded as superseded in `docs/BRANCH-MAP.md` §Design
branches. The design agent owns it (OWNERSHIP.md §2: `docs/design/**` and `src/styles/tokens.css` token
values); the integrator owns `src/lib/theme/**` and `src/context/PersonalisationContext.tsx`.

## Status

| Row (Fnn / Dnn) | Was | Now | Call site | Test that proves it | Migration | Commit |
|---|---|---|---|---|---|---|
| — mount points (§4) | Absent | Wired | `src/nav/registry.ts`, `src/data/index.ts`, `src/lib/capabilities/registry.ts` | `src/guards/mountPoints.test.ts` | — | `7a11cf9` |
| — map ⟷ latest prompts | Stale | Reconciled | `docs/build/OWNERSHIP.md` §1/§2/§4.1 | `src/guards/mountPoints.test.ts` | — | `_this commit_` |
| — `tutorialTargets` flake | Flaky (7.3 s timeout) | Fixed | `src/guards/tutorialTargets.test.ts` | the same guard, now 0.8 s | — | `d599cb5` |
| S17 scale generator | Absent | Built | `supabase/tests/99_scale_seed.sql`, `scripts/scale-seed.mjs` | the SQL harness runs 99 twice; `scale-seed.mjs --factor=3` twice gives an identical fingerprint | — | `30f5734` |
| S17 ≥200-session isolation | Absent | Proved | `supabase/tests/99_scale_seed.sql` (dblink concurrency block) | test 99 at `scale_factor=13`, `scale_sessions=2` → **208 concurrent sessions**, each isolated | — | `80374de` |
| S17 own-org read latency (§6) | Unmeasured | Measured | `scripts/scale-seed.mjs --probe` | the probe at `factor=50` (200 own universes) → p50 56 ms / p95 60 ms, RLS on | — | `_this commit_` |
| S17 §1 users dimension (50,000) | Short (32,552) | Target | `scripts/scale-seed.mjs` `TARGET_SETTINGS` (20 users/org × 2,504 orgs) | `--factor=313 --users-per-org=20` → **50,080 users** | — | `_this commit_` |
| — OWNERSHIP `admin/**` double-claim | Collision | Fixed | `docs/build/OWNERSHIP.md` §2 (`RulePackPanel.tsx` is S1's) | `src/guards/mountPoints.test.ts` | — | `2006405` |
| — OWNERSHIP `extract/**` double-claim | Collision | Fixed | `docs/build/OWNERSHIP.md` §2 (S7 owns the moved module) | `src/guards/mountPoints.test.ts` | — | `_this commit_` |
| — data barrel missed S4 | Incomplete | Fixed | `src/data/index.ts` (platform / entitlements / deployment) | `src/guards/mountPoints.test.ts` | — | `2006405` |
| — `components/writing/**` unowned | Ungranted | Fixed | `docs/build/OWNERSHIP.md` §2 (S5 owns it; OA-23 lives there) | `src/guards/ownershipMap.test.ts` | — | `_this commit_` |
| — stream briefs vs §2 drift | Stale | Reconciled | `docs/build/streams/{s1-core-engine,s5-monitor-runtime,s6-config-honesty,s7-extraction-docs}.md` | `src/guards/ownershipMap.test.ts` | — | `_this commit_` |
| — ownership-map guard | Absent | Built | `src/guards/ownershipMap.test.ts` (reads §2; each stream screen granted to exactly one stream) | the guard itself, proved to fail on a re-introduced double-claim | — | `_this commit_` |
| OA-40 scoped roles and access | Absent | Wired | `RoleScopePanel.tsx` (tab `scoped` in `PeopleAdminPanel.tsx`) | `roleAccess.test.ts` (15); `supabase/tests/143_role_scope_config.sql` | `0199_role_scope_config.sql` | `_part 1_` |
| AP-06 deploy from the plan (file owner, early approval, suggestions) | Absent | Wired | `PlanDeploymentPanel.tsx` (`plan-open-deployment` in `AuditPlanTab.tsx`) | `PlanDeploymentPanel.test.tsx` (8); `supabase/tests/144_engagement_owner_deployment.sql` | `0200_engagement_owner_deployment.sql` | `_this commit_` |
| AP-07 prior-year roll-forward & export check | Absent | Wired | `PriorYearRollforwardPanel.tsx` (`plan-open-rollforward` in `AuditPlanTab.tsx`) | `PlanDeploymentPanel.test.tsx` (8); `supabase/tests/145_prior_year_rollforward.sql` | `0201_prior_year_rollforward.sql` | `_this commit_` |
| — no audit file without a file owner (L5) | Absent | Wired | trigger `engagements_file_owner_required` (0202); `PlanDeploymentPanel.tsx` owner-audit section | `supabase/tests/146_file_owner_invariant.sql`; `supabase/tests/144_engagement_owner_deployment.sql` (O1/O9) | `0202_file_owner_invariant.sql` | `ce80362` |
| OA-41 archived-file custodian role | Absent | Wired | `ArchivedFileRolePanel.tsx` (tab `archived-role` in `OrgControlPanel.tsx`); `src/data/fileOwnership.ts` | `ArchivedFileRolePanel.test.tsx` (10); `supabase/tests/147_archived_file_role.sql` | `0203_archived_file_role.sql` | `_this commit_` |
| — UI/UX standard (trunk) | Absent | Built | `docs/UI-UX-STANDARD.md` | the standard's §1 rules cite the guards that enforce each; the two surfaces above prove their five states | — | `_this commit_` |

### The file-owner workstream (owner 2026-10-30)

Two owner instructions, one invariant each, both now structural rather than a screen's promise:

> *"no audit file can ever be in existence or archival without a file owner."*
> *"for archived files add a permanently configurable role."*

**`0202_file_owner_invariant.sql`** makes file ownership a property of an existing audit file, not a
step someone remembers. An `AFTER INSERT` trigger on `engagements` names the accountable person (the
preparer by default; the caller may name another), the existing rows are backfilled with a marker that
distinguishes a defaulted assignment from a human one, and a guard refuses to delete or clear the owner
of an existing file. `seal_engagement` refuses with `no_file_owner` when the file is unowned, and the
archive path requires an owner too. `deploy_engagement` (0022) lost its stale 5-arg overload and gained
the owner argument; `engagement_deploy_from_plan` and `engagement_deployment_decide` (0200) gained the
same argument with the preparer as the default — the original bodies are preserved exactly.
`engagement_file_owners_list()` reports unowned files (a defect) and default-assigned owners (to
confirm). Proved by `146_file_owner_invariant.sql` and the strengthened isolation case in
`144_engagement_owner_deployment.sql`.

**`0203_archived_file_role.sql`** gives an archived file a custodian **role**, because an archive
outlives the person who owned it. `archived_file_role` holds the organisation's choice, versioned; the
platform default is `cia`, so a tenant that never opens the screen still has a custodian.
`archived_file_role_set` requires `manage_roles` and a reason, bumps the version and appends the change
to the ledger; it never replaces the row. The configuration is never deleted — the privilege layer and a
guard trigger both refuse a `DELETE` and a blank slug. `archive_population` stamps every archive with
the custodian role in force, and `archived_file_custodians()` reports each archived file, its custodian
role and its owner. Proved by `147_archived_file_role.sql`.

**Surfaces.** `ArchivedFileRolePanel.tsx` (contract `OA-41`, the "Archived files" tab of the org
control panel) chooses the custodian and shows every archived file with its role and owner;
`PlanDeploymentPanel.tsx` (contract `AP-06`) gains "Every audit file has an owner", the reader that
surfaces an unowned file and a defaulted assignment. Both are held to `docs/UI-UX-STANDARD.md`.

**A defect found and fixed in passing.** Test 111 (`111_phase4_methodology.sql`) called
`platform_create_tenant` without seeding the platform admin into `auth.users` first, so it failed on an
`invite_cap_events_invited_by_fkey` violation — and a red at file 111 masked every SQL test after it.
Fixed by seeding the admin (uuid `…f0`) exactly as test 123 does — commit `5200f4b`, which landed ahead of this workstream.

### The design document (owner 2026-10-30)

The design language lives in `docs/design/CONTRACT.md`, owned and frozen by the **design branch**; the
trunk does not edit it (`OWNERSHIP.md` §2, the design contract §6). The trunk therefore contributes
**`docs/UI-UX-STANDARD.md`**, the behaviour bar every surface is held to — the five states, the
no-silent-refusal rule, rights-gated controls, keyboard-first, tokens-only — with the guard that
enforces each rule named. The two requests the standard makes of the frozen design contract (a
`state-` prefix for cross-cutting states; a named tabular-figure token) are recorded in that file §5
and **not** edited into the design contract.

### Flagged for the integrator (not edited — shared ledger)

- `docs/FEATURE-REGISTER.md` §13 closing prose (the paragraph under the honest count) still names
  F57–F59 as the "four remaining `Inert`" rows, but the table above it (and the count table) record
  them `Wired` with call sites. The prose is stale; the table is right. The register is the
  integrator's file, so this is recorded here, not fixed in place.

### S17 — the deterministic scale generator (`docs/build/SCALE-PROGRAMME.md` §4)

The programme assigns the generator to the integrator; it did not exist. Built it:

- **`supabase/tests/99_scale_seed.sql`** builds **Shape A** (the large tenant: universes → entities →
  engagements → a population → evidence → a hash-chained ledger), **Shape B** (the long tail: small
  orgs, each with a CIA role, so its own rows are visible under RLS), and **Shape C** (an adversarial
  overlay on A: near-duplicate names, out-of-order approvals, just-below-threshold amounts). Every id
  and value is a **pure function of an index** (`provio_test.det_uuid(tag, n)`) — no `now()`, no
  `random()` — so a failure is reproducible.
- It asserts the structure at the factor, that the stored population hash equals the hash recomputed
  from the **pure formula** (determinism, L1), that the ledger seq is unique and contiguous from 1, and
  that the tenant boundary holds over the generated shapes (L2): the seed org and a long-tail org each
  see their own rows and none of the others'.
- **`scripts/scale-seed.mjs`** drives it at a chosen scale: `--factor=N`, or `--target` for the §1
  designated shape (2,000 engagements, 1,000,000 population rows, 100,000 evidence rows, 5,000,000
  ledger entries; structural factor 313 → 5,008 entities / 1,252 universes), or `--clean`. The users
  dimension (§1: 50,000 accounts) is Shape B's `scale_users_per_org` knob: each long-tail org gets
  that many real `auth.users` accounts, each an `org_members` row holding the org's CIA role; the
  runner's `--users-per-org=N` sets it (8 orgs × factor × N accounts).
- **L5 forced the cleanup design.** The generator writes `ledger_entries`, which is append-only for
  **every** role, so a fixture DELETE is impossible — the only sanctioned clear is `TRUNCATE`, which
  does not fire the row-level append-only triggers. `scale_cleanup()` therefore calls the seed's own
  `reset_data()` (the `truncate orgs cascade` path). This is the same reason the determinism proof is a
  formula check rather than a rebuild.

_Verified: `bash scripts/local-sql-harness.sh` → "migrations applied twice / all SQL tests passed twice";
`node scripts/scale-seed.mjs --factor=3` twice → identical counts and fingerprint._

**The §6 concurrency threshold is proved.** Test 99 ends with a dblink block that opens one session per
generated long-tail org, issues every probe **without waiting** (so they really race), and asserts each
session sees exactly its own universe, zero foreign universes and zero foreign writes. The count is
`8 * scale_factor * scale_sessions`. At the harness default (`factor=1`, `sessions=1`) it is 8 sessions
and stays under `max_connections`; at `factor=13`, `sessions=2` it is **208 concurrent sessions, each
isolated to its own org** — the SCALE-PROGRAMME §6 target — verified locally in 1.6 s. Raising the
factor for the 200-session run needs a server `max_connections ≥ 208` (the local cluster's default 100
does not allow it); the harness default is left at 8 for that reason, with the parameter documented in
the file.

### Reconciliation with the latest prompts (`0f3a095`, `968e30d`)

Two commits landed on the trunk ahead of this session. Read and applied:

- **`docs/design/DESIGNER-PROMPT.md` (0f3a095)** renames the design branch to
  `design/language-v1` and **splits** the design ownership: the designer authors the design
  language (`src/styles/tokens.css` **values** + `docs/design/**`) and writes **no product UI code**;
  the **builder owns `src/lib/theme/**`** (the implementation that reads the frozen tokens).
  OWNERSHIP.md §1 and §2 updated to match — the old map had `src/lib/theme/**` under DESIGN and the old
  branch name `feature/design-language-v1`.
- **The Shari'ah corrections (docs only, `968e30d`/`0f3a095`)** re-frame the SBP Compendium as the
  Pakistan **amendment overlay** on the AAOIFI standards, not a subset. No code or ledger change needed
  here; recorded so D11's builder reads the corrected framing.

### `tutorialTargets` flake — root cause and fix

`renderersOf` re-read the **entire** `src` tree from disk synchronously for *every* tutorial step, so
the test ran ~7 s and tripped vitest's 5 s default timeout intermittently (it passed alone, failed in
the full run). It is a trunk guard, so the integrator fixed the root cause: cache the non-test `.tsx?`
file index once (`srcIndex()`), match every step against the cache. 7.3 s → 0.79 s; the guard's
assertions are unchanged.

_Full run after the fix: 282 files / 3240 tests green; `tsc --noEmit` clean; all gates PASS._

## Designer catalogue folded onto the trunk — 2026-10-30

Owner ask: *"which branch has the final and updated UI/UX screens, flows, journeys, connectors, tool
calls, functions and paths for the designer?"* Answer: the trunk, and now it really does.

- **The designer's spec tooling was stranded on `design/language-v1`** (1 commit, cut at
  the old base `ceb85fd`). Its `docs/DESIGN-SPEC.md` described **105 screens**; the trunk has **122**.
  The trunk had the *sources* (`docs/UI-INVENTORY.md`, `docs/ACP-UI-CONTRACT.md`,
  `src/lib/tutorialKeys.json`, `src/styles/tokens.css`) but not the generator, the brief or the guard.
- **Brought the tooling onto the trunk** (the content, not a branch merge — a merge would have dragged
  the old base in): `scripts/gen-design-spec.mjs`, `docs/DESIGN-BRIEF.md`, `docs/DESIGN-SPEC.md`,
  `src/guards/designSpec.test.ts`, and the `gen:design` npm script. Regenerated against the trunk:
  **2944 lines, 122 screens, 81 flows, 25 tokens.**
- **Added the calls to the spec.** The designer's single document now names, per screen, the **data
  functions, data modules, RPCs and tables** (the "tool calls / functions"), alongside the route
  ("path"), rights, testids, states and the flows ("journeys"). `OA-23` (connectors) is the worked
  example: 6 RPCs, 7 tables, 42 testids. The `designSpec` guard gained a case requiring a
  data-functions and an RPCs line for every screen, so the spec cannot silently lose the calls.
- **Recorded the branch topology** in `docs/BRANCH-MAP.md` §Current topology: the trunk is the only
  branch that merges to `main`; the seven build streams are already folded in; every other long-lived
  branch is hundreds of files behind and carries only a small unique delta (build-v1's `DiagnosticPanel`,
  security-harden-v1's MFA/SSO screens, cap-due-date's `docs/reference/v1/**`) — none merges wholesale.
- **No old branch was merged.** Verified: each would *delete* screens the trunk now has
  (`systeligon-build-v1` deletes 126 trunk files, `security-harden-v1` deletes 442, `cap-due-date-change`
  deletes 1301). The register already builds the diagnostic on the trunk (`runDiagnostic`, SA-20/OA-42);
  the older branches are superseded.

_Full suite after this batch: 315 files / 3623 tests green; tsc clean; all gates PASS._

## Ports from the old branches + the design-branch re-cut — 2026-10-30

Owner ask: *"scan old branches for genuine fixes the trunk lacks"* and *"prepare the design branch."*

- **Ported the genuine deltas, and only those.** `feature/systeligon-build-v1`'s population-rows writer
  (`0209_population_rows.sql`), self-diagnostic engine (`0210_self_diagnostic.sql`) and `org_id` scale
  indexes (`0208_org_id_indexes.sql`), renumbered from build-v1's `0118`/`0209`/`0210` into the trunk's
  reserved range; `feature/security-harden-v1`'s `supabase/scale/06_concurrency.sh` and
  `src/data/shares.test.ts`. Commits `dfc8f52`, `1acba25`.
- **Re-measured every branch and recorded the verdict** in `docs/BRANCH-MAP.md` §Long-lived branches:
  `ahead` / `unique_src` / `lost` per branch, with the disposition. No old branch is merge-ready (each
  would delete 170–1374 trunk files); the genuine deltas are ported by hand.
- **`ReviewCommentsDock.tsx` is not ported.** Four branches carry it; it duplicates the trunk's
  `ReviewCommentsGlobalDock.tsx` (both read `scopedComments`), so mounting both is two UIs for one table
  — the `check-two-sources` defect. The trunk's dock is the survivor.
- **The design branch was re-cut.** The old `feature/systeligon-design-spec` sat before the mount points
  and carried no unique content. The design branch is now **`design/language-v1`**, cut from the trunk
  head; `docs/BRANCH-MAP.md` gains a §Design branches section, and `docs/design/CONTRACT.md` +
  `docs/design/DESIGNER-PROMPT.md` name it. `SCALE-TASKS.md` CB.9 closed (BLOCKED → DONE).

_Guards after this batch: 1126 passed; `tsc --noEmit` clean._

## Ledger counts corrected to the code — 2026-10-30

The ledgers carried stale count blocks. Re-measured against the code (`check-feature-register` is the
authority) and corrected, so the documents match the tree:

- **`FEATURE-REGISTER.md` §14** said "the four remaining `Inert` rows are … the connector run and ingest
  RPCs and the adapter runner (F57–F59) and the motion system (F108)". F57–F59 are `Wired` through
  `runConnector` (`src/data/connectors.ts`). Corrected to **one** `Inert` row: F108 (the motion system).
- **`SYSTELIGON-GAP-REPORT.md`** count blocks were at "138 features: 94/27/17" and "135 Wired / 1 Inert /
  9 Absent". Corrected to the measured **148 features: 138 `Wired` / 1 `Inert` / 9 `Absent`**, and the
  register growth (F143–F148) named.
- Verified: `check-feature-register` → `148 features: 138 Wired, 1 Inert, 9 Absent`, exit 0.

_Baseline this session (`1c41ca4`): 337 vitest files / 3798 tests green; SQL harness "migrations applied
twice / all SQL tests passed twice" (EXIT=0); all nine gates PASS; `tsc --noEmit` clean._

## Builder branches re-cut to the trunk head; builder-facing counts corrected — 2026-10-30

- **Every stream branch was re-cut to the trunk head (`38d9457`).** All eight were ancestors of the head
  (the streams had already folded their work in), so each re-cut was a **fast-forward**, not a rewrite:
  `feature/build-core-engine` `ffebe58`→`38d9457`, `feature/build-{assurance-caps,risk-planning,
  platform-control,monitor-runtime}` `f79859a`→`38d9457`, `feature/build-config-honesty`
  `37dcae4`→`38d9457`, `feature/build-extraction` `dd44899`→`38d9457`, `design/language-v1`
  `1acba25`→`38d9457`. A builder now starts from the head that carries the ported diagnostic engine,
  the population-rows writer and the corrected ledgers.
- **`BUILD-PROMPT.md` register count was stale** ("145 features, 94 Wired / 27 Inert / 24 Absent"). Every
  builder reads this line first; corrected to the measured **148 features: 138 Wired / 1 Inert /
  9 Absent**, with the command that proves it.
- **The integrator baseline block was stale**; replaced with the measured head (`38d9457`:
  152 migrations / 156 SQL tests / 337 vitest files / 3798 tests / 31 Playwright specs / 35 guards).

## BRANCH-MAP divergence table re-measured against the head — 2026-10-30

The long-lived-branch table in `docs/BRANCH-MAP.md` was measured at `1acba25` and had drifted. It is
re-measured against the head `1debe54` with a **stated, reproducible definition** now in the doc:
`ahead` = `git rev-list --count HEAD..origin/<b>`; `unique_src` = `comm -13` of `git ls-tree -r
--name-only` HEAD vs the branch, filtered to `src/|supabase/|scripts/` (a path test); `lost` = files
the trunk has that the branch lacks. Two branches were promoted to their own rows
(`feature/cap-due-date-change`, `feature/fix/tutorial-recorder-fixtures`) because they are the two
`cap-*`/fixture branches with a genuinely distinct delta. The "four branches carry
`ReviewCommentsDock.tsx`" line is corrected to **five** (`build-v1` has no dock; `security-harden-v1`,
`scale-harden-v1`, `writing-engine`, `systeligon-v1`, `audit-file-v1` do). The ported-work note now
names the trunk numbers (`0208`–`0210`, tests `154`–`156`) and says the branch's own files are the
pre-renumber copies, so the `unique_src` count is explained rather than read as un-ported work.

## C7 reconciled in SCALE-TASKS.md — 2026-10-30

The gap report already read C7 as *"unblocked but unbuilt"*; SCALE-TASKS.md still read
`BLOCKED (S18)`. Verified S18 is genuinely built before changing the ledger: migration
`0119_sira_continuity_acceptance.sql` defines `sira_carry_forward_pack(p_cycle)` and
`propose_emergent_risks(p_cycle)`, both exercised by `supabase/tests/126_sira_continuity.sql`;
`src/data/sira.ts` exposes `proposeEmergentRisks`, called from
`src/components/sira/SiraCyclesInspector.tsx`. Changed the two C7 rows and the demo script's
"do not demo" line from `BLOCKED (S18)` / "blocked on S18" to `TODO (unblocked)` /
"unblocked but unbuilt". The first draft of this edit named three RPCs by memory
(`sira_carry_forward`, `sira_seed_next_cycle`, `sira_propose_emergent_risks`) and cited
`src/data/sira.test.ts`, which only covers the not-configured path — corrected to the two real
RPC names and the SQL test that actually exercises them. Lesson: name a symbol from a grep of
the file, never from memory.

## Design-system utility vocabulary — two dead-style defects fixed — 2026-10-30

Found while running the gate set, fixed on the trunk. Both were invisible to every gate because no
gate reads the compiled bundle. Proven against `dist/assets/index-*.css`, the only witness.

**Defect 1 — classes used but declared nowhere.** The components use a semantic class vocabulary;
20 of those classes were declared in no stylesheet, so the elements rendered unstyled:
`bg-primary` (12 files), `text-canvas` (18), `divide-hairline` (53), `ring-accent` (9),
`bg-accent-hover`, `bg-tertiary`, `bg-surface-active`, `bg-hairline`, `text-hairline`,
`ring-accent-subtle`, `text-accent-foreground`, `border-canvas`, `border-accent-subtle`,
`text-verdigris-text`, `fill-primary`, `fill-secondary`, `fill-accent`, `border-secondary`,
`border-primary`, `border-brass`. (The earlier note counted 19; the exact scan found 20.)

**Defect 2 — plain CSS cannot take a Tailwind variant.** The vocabulary in `tokens.css` is written as
plain CSS (`.bg-surface { … }`). Tailwind v4 only composes `hover:` / `focus:` / `group-hover:` onto
a class it knows as a `@utility`, so every variant form compiled to nothing: `hover:bg-surface-hover`
(166 uses), `hover:text-primary` (116), `focus:border-accent` (29), plus `hover:text-cinnabar`,
`hover:bg-accent-subtle`, `hover:bg-surface`, `hover:bg-canvas`, `hover:bg-surface-elevated`,
`hover:bg-cinnabar-subtle`, `hover:border-accent`, `hover:border-hairline`, `hover:text-accent`,
`group-hover:text-primary`, `focus:ring-accent`, `focus-visible:ring-accent`,
`hover:bg-accent-hover`, `placeholder:text-tertiary`. The hover and focus states were dead in the
shipped bundle.

**Fix.** `src/index.css` (the integrator's file; `tokens.css` is the designer's, left untouched) gains
the vocabulary as Tailwind v4 `@utility` declarations — the variant-composable form. Each reads an
existing token; no new colour, no hard-coded value. `--on-accent` is read with a `var(--canvas)`
fallback so a filled accent surface stays legible before the designer defines the token.

**Evidence.** `src/guards/utilityVocabulary.test.ts` (4 tests) — asserts (A) every vocabulary class a
component uses is declared, (B) every variant-used class is a `@utility`, (C) every `@utility` is a
name from the vocabulary contract. Proven to catch a regression: deleting `@utility bg-primary` fails
the guard naming `bg-primary (used in src/components/universe/EntityApprovalPanel.tsx)`.

**Verification.** `npm run build` clean; all 22 distinct variant usages and all 20 previously-missing
classes present in the compiled CSS (checked in Python over `dist/assets/*.css`); `tsc --noEmit`
clean; all 10 gate scripts PASS; `npx vitest run` 339 files / 3806 tests pass.

**Hand-off to DESIGN (owner of `tokens.css`, not edited).** The plain copies of these classes in
`tokens.css` now duplicate the `@utility` layer. The single source should be the `@utility` layer; the
designer should delete the plain duplicates (except `.bg-surface-hover`, whose bare form means hover).
Also still missing as a token value: `--on-accent` (the fix falls back to `--canvas`).

## Design-system vocabulary — second batch (15 more undefined classes) — 2026-10-30

An exhaustive scan (every `class`/`className` literal in `src/components`, every token name) found a
further 15 classes used but declared nowhere — 161 uses. `text-apple-14` alone is used 76 times; the
Apple type scale in `tokens.css` skipped 10/14/16/18.

| Class | Uses | Mapped to | Token exists? |
|---|---|---|---|
| `text-apple-10` / `-14` / `-16` / `-18` | 4 / 76 / 20 / 2 | a font-size/line-height step | n/a (scale value) |
| `text-muted` | 15 | `var(--text-tertiary)` | yes |
| `text-positive`, `text-moss`, `text-verdant` | 2 / 4 / 1 | `var(--accent-verdigris)` | yes |
| `text-danger`, `text-critical` | 3 / 6 | `var(--accent-cinnabar)` | yes |
| `border-danger` | 2 | `var(--accent-cinnabar)` | yes |
| `border-border` | 11 | `var(--border-hairline)` | yes |
| `bg-btn-primary-bg`, `text-btn-primary-text` | 4 / 4 | `var(--btn-primary-bg)` / `var(--btn-primary-text)` | yes |
| `shadow-soft` | 7 | `var(--shadow-soft)` | yes |
| `animate-fade-in` | 2 | a `fade-in` keyframe, 200ms | n/a (animation) |
| `bg-verdant` | 1 | `var(--accent-verdigris)` | yes |

**Method note.** The first scan under-reported (it missed `border-danger`, `bg-verdant`) because it
matched only a fixed stem list. The fix: the guard's `STEMS` is now the vocabulary contract and the
guard also fails on any `@utility` outside it, so a stem cannot be forgotten silently. The status
colour names are the one judgement call — the palette names no token for them, so `moss`/`verdant`/
`positive` map to verdigris (calm/positive) and `danger`/`critical` to cinnabar (exception), which is
the documented token law. Recorded here so the designer can overrule.

`animate-fade-in` honours `prefers-reduced-motion: reduce` (the contract requires no animation then).
Evidence: same guard, now 4 tests / 17 utilities + 4 type steps; every class verified present in
`dist/assets/index-*.css`; `tsc` clean; 10 gates PASS; vitest 339 files / 3807 tests.

## Design-system vocabulary — third defect: opacity modifiers were dropped — 2026-10-30

`bg-surface/95` (2 uses), `bg-surface-elevated/20·30·40·70·80` (6), `bg-cinnabar-subtle/20` (1) and
`text-secondary/80` (1) all compiled to **nothing**. Tailwind v4 emits `<class>/<n>` only for a colour
declared in its own `--color-*` theme namespace; a class defined by `@utility` loses the modifier.

Fix: the four stems that are used with a slash (`surface`, `surface-elevated`, `cinnabar-subtle`,
`secondary`) are registered in `@theme inline` as `--color-*` (value stays `var(--token)`, so the
preset/theme blocks in `tokens.css` still drive them). Their `@utility` copies are removed so there is
no duplication; `bg-cinnabar-subtle/20` is the one place `bg-cinnabar-subtle` is used with a slash, and
`text-secondary` is used bare 1455 times — both keep working, verified in the bundle.

Evidence: `src/guards/utilityVocabulary.test.ts` now has 5 tests; the new one (D) fails on any
`/n` usage whose stem is not a `--color-*` token. Bundle check: `bg-surface/95`,
`bg-surface-elevated/20`, `/30`, `/40`, `/70`, `/80`, `bg-cinnabar-subtle/20`, `text-secondary/80` and
their `hover:` forms are all present in `dist/assets/index-*.css`. `tsc` clean; 10 gates PASS; vitest
339 files / 3808 tests.

## Design-stream report (11 items) — worked 2026-10-30

The design stream ran a report against the product UI. Since `design/language-v1` (`1debe54`) carries
no product UI (its diff vs trunk is docs + a few components already superseded on trunk), **every item
it flagged is a trunk defect**. Items worked against trunk; the two that land in another stream's file
are requested, not edited.

| Item | Was | Now | Call site | Test that proves it | Commit |
|---|---|---|---|---|---|
| 1 tab root | tab had no root testid | Wired | `src/App.tsx:219` `data-testid="tab-<activeTab>"` (one wrapper for every tab) | `src/guards/uiContractDrift.test.ts` (static ids documented); `src/guards/mountPoints.test.ts` | 41b8357 |
| 2 header controls | controls partly unnamed | Wired (earlier commit) | `src/components/common/HeaderBar.tsx` (`aria-label` on profile menu, search, calendar, theme) | `src/components/common/HeaderBar.test.tsx` | cb49590 |
| 3 tutorial flows | 81 flows admin/platform/external | **correct** | `src/lib/tutorialKeys.json` audience vocabulary is exactly `org_admin`/`super_admin`/`both` (48/28/5) — there is no member/auditor audience, so no flow can be missing one | `src/guards/tutorialRegistryCoverage.test.ts`, `docs/designSpec.test.ts` (regenerated, green) | — |
| 4 Provio literals | literals + storage keys | **correct** | `src/lib/product.ts` is the single source; the guard permits exactly that file | `src/guards/productName.test.ts` | — |
| 5 org-control tabs | tab testids / tutorials | **correct** | `org-control-tab-<id>`, `org-control-panel`, `org-control-tabs` present | `src/guards/uiContractDrift.test.ts` | — |
| 6 Gantt labels | a short bar clipped its title | Wired | `src/components/dashboard/EngagementGantt.tsx:527` (label hidden < 120px; bar carries `aria-label`) | `src/components/dashboard/EngagementGantt.test.tsx` "hides the title on a bar too narrow" | 41b8357 |
| 7 raw UUID/"Test" | two previews showed a raw id; one raw role slug | Wired (id leak fixed) + **requested from S6** (role slug) | `EngagementGantt.tsx:487` (dropped `Lead: ${leadAuditorId}`), `AuditPlanTab.tsx:282` (dropped `owner`/`Reviewer` id metrics); `TeamDirectoryPanel.tsx:374` is S6's | `src/guards/rawIdDisplay.test.ts` (catches the old string, allows a name); `src/components/dashboard/EngagementGantt.test.tsx` | this commit |
| 8 Plan/SIRA empty states | empty states | **correct** | `AuditPlanTab.tsx` "No plan items yet." / "No versions yet."; `SiraTab.tsx` "No cycles yet." | `src/components/plan/PlanPanels.test.tsx`, `src/components/sira/SiraPanels.test.tsx` | — |
| 9 mobile nav labels | labels hidden below `sm` | Wired (earlier commit) | `src/components/common/NavStrip.tsx` (`aria-label` + `title` on each tab) | `src/components/common/NavStrip.test.tsx` | cb49590 |
| 10 fonts | self-hosted | **correct** | `@fontsource/*` packages; no external font host | `src/guards/*` (no external fetch) | — |
| 11 package-lock | suspected drift | **correct** | `npm ci` accepts the lock ("up to date") | `npm ci --dry-run` | — |

**Ownership correction.** The tab-root edit initially touched
`src/components/universe/AuditUniverseTab.tsx`; OWNERSHIP.md §2 gives `src/components/universe/**` to
**S3**. Reverted in `41b8357`; the tab root is now supplied once from trunk-owned `App.tsx` instead,
which is the better shape anyway (one place, every tab). Requested of S3: keep the universe tab's own
root free of `data-testid` so the App-level wrapper is the single source.

**Requested of S6** (`src/components/admin/**`): item 7's remaining raw role-slug display at
`TeamDirectoryPanel.tsx:374` should read `roleLabel(a.role)` like the other surfaces
(`ArchivedFileRolePanel.tsx`, `HeaderBar.tsx`, `AccountSettingsModal.tsx`), so no raw slug reaches the
screen.

**Evidence.** 10 gates PASS (`check-wiring`, `check-dead-code`, `check-rpc-parity`,
`check-feature-register` 148/138/1/9, `check-ui-contract`, `check-config-effect`, `check-two-sources`,
`check-shrink`, `check-tokens`, `check-function-deploy-list`); full suite **339 files / 3812 tests**
green; `tsc --noEmit` clean.

## Item 7 fixed, guard landed, queue closed — 2026-10-30

**Item 7 is now fully worked on the trunk side.** The two raw-id leaks are gone and a regression guard
prevents the class returning:

| Row | Was | Now | Call site | Test that proves it | Migration | Commit |
|---|---|---|---|---|---|---|
| design report item 7 (raw id) | two previews showed a raw id | Wired (id leak fixed) | `EngagementGantt.tsx:487` (dropped `Lead: ${leadAuditorId}`), `AuditPlanTab.tsx:282` (dropped `owner`/`Reviewer` id metrics) | `src/guards/rawIdDisplay.test.ts` (catches the old string, allows a `Name` variant); `src/components/dashboard/EngagementGantt.test.tsx` | — | 9daa985 |

- `src/guards/rawIdDisplay.test.ts` (new, integrator-owned): fails when any component puts a
  `${…Id}`/`${…_id}` into a display prop (`subtitle`/`title`/`owner`/`label`/`description`/`hint`/
  `sentence`/`text`). A deliberate `name || id` fallback is allowed. Proven both ways: it catches the
  exact old defect and allows a name.
- `TeamDirectoryPanel.tsx:374` still renders a raw role slug; it is **S6's** file
  (`src/components/admin/**`), so the fix is requested, not edited — restated above.

**Merge verdict.** All eight stream branches (`design/language-v1`, `feature/build-{core-engine,
assurance-caps,risk-planning,platform-control,monitor-runtime,config-honesty,extraction}`) are
**ancestors of the trunk head** (`git merge-base --is-ancestor` → YES for each). The merge is complete;
no stream branch carries work the trunk lacks. The register reflects every merged row
(148 / 138 Wired / 1 Inert / 9 Absent, gate PASS).

**Register audit (integrator honesty duty).** The 9 `Absent` rows were re-verified against the code —
each is genuinely absent, so the register does **not** understate them:
- F56 (anomaly→SIRA emergent risk): the SIRA screen has a **manual** emergent-risk submit
  (`SiraScoringPanel.tsx:199`), but no *anomaly-proposes* path — correctly `Absent`.
- F92 (zero-to-first-report wizard): no `zeroToFirst`/`FirstReportWizard` anywhere.
- F105/F106/F107/F108/F109/F111/F113 (the design rows): no `PRESETS`/`AUDIENCE_PROFILES`/
  `resolveDayPhase`/`MOTION_LEVELS`/`validatePersonalisation`/density-toggle module exists; F108 stays
  the one `Inert` row. These are governed by `docs/design/CONTRACT.md`, which is still
  **DRAFT (no freeze hash)** — its §6.3 keeps the design rows deferred, so they are not integrator work.

**Whole-tree proof this session.** SQL harness green twice against a real PostgreSQL 17
(`migrations applied twice` / `all SQL tests passed twice`; 152 migrations / 156 SQL test files);
`npm run build` green; `tsc --noEmit` clean; full vitest **340 files / 3813 tests** green; all 10 gates
PASS; `check-tutorials` PASS (54 current / 27 stale GIFs).

**Queue status: empty.** Items 1–3 done (baseline, mount points, merge+fold). The design report's 11
items are all worked (3/4/5/8/10/11 verified correct; 1/2/6/9 wired earlier; 7 fixed here). The only
remaining product work is the design-row family, which is gated on the design branch freezing its
contract (an owner/design-branch action, not the integrator's).

## Branch forensics — every branch accounted for, 2026-10-30

Owner ask: *reverify that all built things in all branches are part of the mergeable branch.* Method:
`git merge-base --is-ancestor <b> HEAD` for each of the 39 remote branches, then a file-level
`git diff --diff-filter=A --name-only HEAD...<b>` for every non-ancestor to find content the trunk lacks
by path, then a content check for each hit.

**22 branches are ancestors of the trunk head** — merged, nothing to port.

**17 are not.** Each was classified; none carries un-merged *product* work:

| Branch | Unique content | Verdict |
|---|---|---|
| `feature/security-harden-v1` | MFA/SSO/erasure/residency, group joint-audit sharing, owner console (0100–0103) | **Port#1** — content-identical to trunk `0204`/`0205`/`0206`/`0207`; `mfa.ts`/`claims.ts`/`liveRegion.ts`/`platformPath.ts`/guards identical; tests → `150/151/152` + `153_group_joint_audit.sql` |
| `feature/systeligon-build-v1` | self-diagnostic, population-rows, org_id indexes (0129–0131) | **Port#1** — trunk `0208`/`0209`/`0210` (0131 vs 0210: 199 lines each, identical); `diagnostics.ts`/`populationPaste.ts`/`diagnosticNav.ts` present |
| `feature/writing-engine` | `compose.ts`, `matrix.test.ts` (W2.8) | **Port#1** — `git diff HEAD origin/feature/writing-engine -- …/compose.ts` empty; matrix test 260 lines in both |
| `feature/systeligon-design-spec`, `docs/systelligence-and-fonts` | design spec generator, `SYSTELIGON.md`, `FONT-REPOSITORY.md` | **Port#1** — all files present in trunk |
| `fix/tutorial-recorder-fixtures` | real tutorial GIFs | **Superseded** — trunk GIFs are real (262 KB vs branch 246 KB) and newer |
| `feature/cap-due-date-change` | CAP due-date history (2026-10-05 prototype) | **Superseded** — `cap-status-workflow` (ancestor) + Phase 4 methodology (0104) built the CAP lifecycle on trunk |
| `merge/coderabbit-pilot`, `coderabbit/application-qa-audit/56ea96a0` | a **separate bounded procurement prototype** (`organizations`/`memberships`/`audit_cases` schema, `src/components/procurement/**`) | **Superseded** — trunk implements the same lifecycle (population→evidence→report→attestation) on the unified `orgs`/`universes`/`engagements` schema with `platform_*` RPCs; trunk `scripts/verify-attestation.mjs` + `verify-report-bundle.mjs` cover its verifier |
| `docs/builder-prompt-2026-10-29`, `docs/continuous-monitoring-in-scope`, `audit/full-codebase-2026-10-27` | planning/audit docs only | **Docs-only** — no source files |
| `feature/radial-hover-fix` | none | **Empty** (0 unique commits) |

**Genuine un-ported items (verification harnesses, not product features):**
1. `e2e/a11y.spec.ts` (axe-core a11y gate) — trunk has **no** `axe-core` dependency and no automated
   a11y gate; `docs/DESIGN-SPEC.md` states the accessibility spec, but nothing enforces it in CI.
2. `scripts/load-test.mjs` (deterministic ORGS×SESSIONS concurrent-RLS proof) — trunk proves isolation
   in `supabase/tests/99_scale_seed.sql` + `123_scale_isolation.sql` (and `scripts/scale-seed.mjs`
   `--probe`), but has no standalone runner; its acceptance is an env-gated manual step.
3. `src/styles/tokens.css` `--on-accent` (light `#F6F5F2` / dark `#141518`) — **not** a defect: the
   trunk reads it with a `var(--on-accent, var(--canvas))` fallback and every cinnabar/verdigris pair
   already meets WCAG AA (measured: cinnabar `#C2410C` on canvas `4.75:1`, on surface `5.18:1`;
   verdigris fallback `5.42:1` light / `5.93:1` dark). Adding it is hardening only.

**Verdict:** the mergeable branch carries every product feature from every branch. The three un-ported
items are two test harnesses and one token-hardening nicety — recorded here, not silently dropped.

## Un-ported harness #2 ported and proven — `scripts/load-test.mjs` (2026-10-30)

Ported `scripts/load-test.mjs` from `feature/security-harden-v1` (it needed no new dependency) and
**ran it against the current trunk**. Prerequisites all exist on trunk: `provio_test.seed()`,
`provio_test.as_owner()`, `provio_test.as_user(p_sub,p_org,p_role,p_aal)`, and the `orgs`/`universes`/
`user_scopes` tables.

| Run | Result |
|---|---|
| `node scripts/load-test.mjs` (8 orgs × 4 = 32 sessions) | **PASS** — 32 own-org reads, 0 unexpected; p50 644 ms / p95 700 ms |
| `ORGS=50 SESSIONS=4 node scripts/load-test.mjs` (200 sessions, §6 target) | **PASS** — 200 own-org reads, **0 cross-tenant leakage**; p50 3417 ms / p95 4851 ms |

**Two honest caveats recorded, not hidden:**
1. The isolation property (§6 "0 rows under ≥200 concurrent sessions") is **proven**. The latency
   figure is **not** the §6 target: each session is a separate `sudo psql` process, so the number
   measures process-spawn contention, not query latency. The §6 latency target (p50 ≤ 750 ms at the
   large-tenant shape) is measured by `scripts/scale-seed.mjs --probe`, which reads inside the DB.
2. It needs `max_connections ≥ ORGS`; the sandbox cluster defaults to 100, so the 200-session run set
   `max_connections=400`. CI must set the same (or use a pooler).

**Still un-ported: the axe-core a11y gate.** It cannot be added here honestly — the trunk has no
`axe-core` dependency (a `package.json` change) and the spec needs a real signed-in backend, which this
sandbox lacks. It is the first item of the builder prompt below, with the exact spec and dependency.

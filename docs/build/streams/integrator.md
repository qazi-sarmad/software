# Stream TRUNK — the integrator (`feature/systeligon-builder-continuous`)

The integrator works on the trunk itself (OWNERSHIP.md §1). It owns the mount points (§4), the shared
ledgers (`FEATURE-REGISTER.md`, `SCALE-TASKS.md`, `SYSTELIGON-GAP-REPORT.md`), `src/App.tsx`,
`src/context/AppContext.tsx`, the nav/routing registry, the existing guards, `package.json` and the
merge. It edits no stream's files.

## Baseline (locked at `968e30d`, 2026-10-30)

Read from the tree, not from a document:

| Measure | Value |
|---|---|
| Migrations | 128 (highest `0128_rule_pack_release.sql`) |
| SQL tests | 133 |
| vitest files | 281 |
| vitest tests | 3216 |
| Playwright specs | 31 |
| Guard files (`src/guards/*.test.ts`) | 28 |
| Register gate | `PASS: 145 features: 94 Wired, 27 Inert, 24 Absent` |

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

**The DESIGN branch needs the integrator's attention.** `feature/systeligon-design-spec` already exists
at `bc7fd15` (the designer's auto-updating-spec branch, created 2026-10-29) but is cut from `ceb85fd`,
**before** the mount points (`ceb85fd` is the trunk's parent, `968e30d` added the mount points). It
therefore lacks `src/nav/registry.ts`, `src/data/index.ts`, `src/lib/capabilities/registry.ts` and the
current `docs/build/**`. The DESIGN agent should re-cut or rebase onto `ceba781` (or the current trunk)
before writing the theme implementation, or its branch will not see the mount points the streams share.
Flagged, not acted on: the design branch is the designer's tree (OWNERSHIP.md §2), so re-cutting it is
the designer's call, not the integrator's.

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
  `feature/systeligon-design-spec` and **splits** the design ownership: the designer authors the design
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

- **The designer's spec tooling was stranded on `feature/systeligon-design-spec`** (1 commit, cut at
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

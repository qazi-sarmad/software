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

At the head `c88e267` (after the concurrent-build work): 129 migrations, 134 SQL tests,
**282 vitest files / 3240 tests**, **29 guards** (the integrator's `mountPoints.test.ts` added).

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
| — OWNERSHIP `admin/**` double-claim | Collision | Fixed | `docs/build/OWNERSHIP.md` §2 (`RulePackPanel.tsx` is S1's) | `src/guards/mountPoints.test.ts` | — | `2006405` |
| — OWNERSHIP `extract/**` double-claim | Collision | Fixed | `docs/build/OWNERSHIP.md` §2 (S7 owns the moved module) | `src/guards/mountPoints.test.ts` | — | `_this commit_` |
| — data barrel missed S4 | Incomplete | Fixed | `src/data/index.ts` (platform / entitlements / deployment) | `src/guards/mountPoints.test.ts` | — | `2006405` |

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

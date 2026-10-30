# Build ownership map — who owns which files, on which branch

Owner instruction 2026-10-30: *"That should be perfect for concurrent build as well. Don't give them
shared documents."*

The rule that makes concurrency safe: **two branches never write the same file.** This file assigns
every file, migration number and `data-testid` prefix to exactly one stream. A stream edits only what it
owns; anything it needs from another stream it reads, never edits.

---

## 1. The branches

| Branch | Stream | Scope | Owner |
|---|---|---|---|
| `feature/systeligon-builder-continuous` | **TRUNK / integrator** | the mount points, the ledgers, the merge, and the `src/lib/theme/**` implementation | the integrator agent |
| `feature/systeligon-design-spec` | **DESIGN** | the design language — token **values** (`src/styles/tokens.css`) and the contract (`docs/design/**`); no product UI code | the design agent |
| `feature/build-core-engine` | **S1** | the rule engine, scopes, rule packs, standards distribution | stream 1 |
| `feature/build-assurance-caps` | **S2** | D5 / D7 / D8 / D9 | stream 2 |
| `feature/build-risk-planning` | **S3** | D10 / D14 / D15 | stream 3 |
| `feature/build-platform-control` | **S4** | D11 / D12 / D13 | stream 4 |
| `feature/build-monitor-runtime` | **S5** | C1 / C3 monitor + connector runtime | stream 5 |
| `feature/build-config-honesty` | **S6** | the R3 configuration-honesty rows | stream 6 |
| `feature/build-extraction` | **S7** | S7 extraction tiers, S8/S9/S14/S15 rule surfaces | stream 7 |

Every build stream cuts from the trunk **after** the integrator has created the mount points (§4).

## 2. File ownership

A file appears **once** in this table. A stream that needs to change a file it does not own **requests
it from the owner** and works around it meanwhile.

| Path / pattern | Owner |
|---|---|
| `docs/design/**`, `src/styles/tokens.css` (token **values**), `src/context/PersonalisationContext.tsx` | **DESIGN** |
| `src/lib/theme/**` (the implementation the frozen tokens are read through) | **TRUNK / integrator** |
| `src/lib/systeligon/types.ts`, `runner.ts`, `versioning.ts`, `packs.ts`, `ota.ts`, `rules/**`, `flows.ts`, `minutes.ts`, `policydiff.ts` | **S1** (the rule data/logic; S7 owns only the screens that reach them) |
| `src/components/audit/RuleRunTab.tsx`, `src/components/admin/RulePackPanel.tsx` | **S1** (the file, even though it sits in S6's `admin/` directory — see the S6 row) |
| `src/data/rulePacks.ts`, `src/data/population.ts` | **S1** |
| `src/lib/assurance/**`, `src/data/assurance*.ts` | **S2** |
| `src/components/assurance/**` | **S2** |
| `src/lib/risk/**`, `src/data/risk*.ts` | **S3** |
| `src/lib/siraEngine.ts` | **S3** (read-only to everyone else) |
| `src/components/sira/**`, `src/components/universe/**` | **S3** |
| `src/components/superadmin/**`, `src/data/platform*.ts`, `src/data/entitlements.ts`, `src/data/deployment.ts` | **S4** |
| `src/lib/systeligon/monitors.ts` → **moved to** `src/lib/monitor/**` by S5 | **S5** |
| `src/lib/writing/monitors.ts` | **S5** (S1 reads it, never edits) |
| `src/data/connectors*.ts`, `src/lib/systeligon/connectorCatalogue.ts` | **S5** |
| `src/data/notifications.ts`, `src/data/email*.ts` | **S5** |
| `src/lib/lifecycle/**`, `src/data/lifecycle*.ts` | **S6** |
| `src/components/admin/**` (OrgControlPanel, settings screens) — **except** `RulePackPanel.tsx`, which is S1's | **S6** |
| `src/lib/systeligon/extract/**` (already moved there; S7 owns the module, S1 owns the `minutes.ts`/`policydiff.ts` rule logic it feeds) | **S7** |
| `src/components/documents/**` | **S7** |
| `src/guards/<stream>.test.ts` | **each stream adds its OWN new guard file** |
| `src/guards/*.test.ts` (existing) | **TRUNK** — never edited by a stream |
| `src/App.tsx`, `src/context/AppContext.tsx`, the nav/routing registry | **TRUNK** |
| `docs/FEATURE-REGISTER.md`, `docs/SCALE-TASKS.md`, `docs/SYSTELIGON-GAP-REPORT.md` | **TRUNK / integrator** |
| `docs/build/streams/<stream>.md` | **that stream only** |
| `package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts` | **TRUNK** — a stream requests a dependency, never adds one |

## 3. Migration numbers — pre-allocated, so two streams never collide

The trunk's highest migration is `0128`. Each stream owns a **fixed range** and takes numbers in order
from the bottom of its range. A stream that exhausts its range stops and requests more from the
integrator — it does not spill into the next range.

| Range | Stream |
|---|---|
| `0129`–`0138` | **S1** — rule engine, scopes, standards distribution |
| `0139`–`0148` | **S2** — D5/D7/D8/D9 |
| `0149`–`0158` | **S3** — D10/D14/D15 |
| `0159`–`0168` | **S4** — D11/D12/D13 |
| `0169`–`0178` | **S5** — monitor/connector runtime |
| `0179`–`0188` | **S6** — config honesty |
| `0189`–`0198` | **S7** — extraction + document rules |
| `0199`–`0210` | **reserved** — the integrator, for merge-time glue only |

## 4. The mount points — created by the trunk BEFORE the streams branch

So that no two streams edit `App.tsx`, `AppContext.tsx` or the nav registry, the **integrator** creates
these once, on the trunk, before any stream branches:

1. A **screen registry** (`src/nav/registry.ts`) with a stable slot per screen, each slot keyed by
   `screenId` and pointing at a component path. A stream fills its slot by adding its **own** component
   file; it does not edit the registry (the registry already lists every planned screen, pointing at a
   placeholder until the owner stream replaces it).
2. A **data-layer barrel** (`src/data/index.ts`) that re-exports each stream's data module — added as a
   one-line re-export per stream, created up-front pointing at empty stubs the owning stream fills.
3. A **capability registry** (`src/lib/capabilities/registry.ts`) listing each capability family, same
   pattern.
4. A **guard runner** entry so a stream's new `src/guards/<stream>.test.ts` is picked up without editing
   the existing guard config. (No config change is needed: vitest's `src/guards/**/*.test.ts` glob already
   picks up any new guard file, and the integrator's `src/guards/mountPoints.test.ts` is the guard that
   proves the three registries above are well-formed.)

Until the integrator has committed §4, no stream branches. This is the one serial step; everything after
it is parallel.

### 4.1 How a stream fills its slot (the contract, settled by the integrator)

The registry lists **every planned screen** and points each slot at the component path its owner stream
will create. A stream **never edits `src/nav/registry.ts`** — it creates its own component file at the
path its slot names. At merge time the integrator flips that slot's `status` from `planned` to `mounted`
and wires the render into `App.tsx`/the tab map (which the integrator owns). This is the only reading
that satisfies both "the registry already lists every planned screen" (so no stream edits it) and "the
registry points at a placeholder until the owner stream replaces it" (so the flip happens at merge).

The integrator's mount-point guard (`src/guards/mountPoints.test.ts`) enforces the invariants: every slot
has a unique id and a known owner; a `mounted` slot's file exists; **every planned slot's path sits inside
a directory the map (§2) grants its owner stream**; the capability registry names exactly the kinds the
data layer defines. A stream that needs a screen directory the map does not grant asks the integrator; it
does not invent a path.

The slots pre-created for the streams are the NEW surfaces each scope names — S2 `OA-34`
(`src/components/assurance/`), S3 `OA-37` + `SR-04` (`src/components/universe/`, `src/components/sira/`),
S4 `SA-19`/`SA-20`/`SA-21` (`src/components/superadmin/`), S7 `OA-36` (`src/components/documents/`).
S1's `AF-16` + `OA-33` and S5's `OA-23` are already **mounted**: those streams extend an existing screen
rather than add one, so their scope is served by lib/data modules and no new slot.

## 5. `data-testid` prefixes (so the two branches' tests never collide)

| Prefix | Owner |
|---|---|
| `theme-`, `personalisation-`, `motion-` | DESIGN |
| `rulerun-`, `rulepack-`, `standards-` | S1 |
| `assurance-`, `icfr-`, `forensic-`, `gapanalysis-` | S2 |
| `risk-`, `sira-`, `classification-` | S3 |
| `superadmin-`, `orgcontrol-`, `complaint-`, `diagnostic-` | S4 |
| `monitor-`, `connector-`, `alert-` | S5 |
| `lifecycle-`, `signoff-`, `workflow-` | S6 |
| `docreview-`, `minutes-`, `policydiff-`, `extract-` | S7 |

## 6. Status files — the streams do NOT edit the shared ledgers

**This is the "don't give them shared documents" rule.** A stream does **not** touch
`docs/FEATURE-REGISTER.md` or `docs/SCALE-TASKS.md` — those are the integrator's. Instead, each stream
writes its progress to **its own** `docs/build/streams/<stream>.md`, in a fixed table:

```
| Row (Fnn / Dnn) | Was | Now | Call site | Test that proves it | Migration | Commit |
```

The integrator merges the stream docs into the shared ledgers at merge time. This means no two branches
ever write the same document, and a stream's status is never lost to a merge conflict.

## 7. Merge order and conflict rule

1. **DESIGN** freezes the contract (§6 of `docs/design/CONTRACT.md`) and merges to the trunk first.
2. The **integrator** creates the mount points (§4) and merges them to the trunk.
3. The seven build streams branch, work in parallel, and merge in **any order** — because they share no
   file, the merges are mechanical. The integrator merges one stream at a time, runs the full gate set
   after each, and folds the stream's status doc into the ledgers.
4. If two streams turn out to need the same file, the integrator **splits** it along the seam they need
   (a new module, re-exported) rather than letting both edit it. A shared file is a bug in the map; fix
   the map, do not serialise the streams.

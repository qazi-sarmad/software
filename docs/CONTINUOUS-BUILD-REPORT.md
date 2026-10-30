# Continuous build — report and planned activities

**Branch:** `feature/systeligon-builder-continuous` (off `feature/systeligon-unified-v1`)
**Date:** 2026-10-29
**Operative contract:** `docs/CONTINUOUS-BUILD.md` (this branch), superseding the A-side
`docs/SCALE-HARDEN-CONTINUOUS-BUILD.md`.

**How to read this.** Every figure marked **verified** was reproduced against the repository this
session. Figures marked **reported** come from a builder ledger and were not reproduced. The
distinction matters: the most serious recurring defect in this codebase is not a bug — it is that
the documents describing the code were wrong. This report separates built from planned in every
section for that reason, and it records two such defects it found this session.

---

## 1. CI state

- Run `40909089854` (`4f0e6e1`, the A+B unified merge): **step 7 (Migrations and SQL tests)
  success**, **step 8 (Playwright dev + 8b G1 production-build E2E) success** — the two failures
  that run carried (a member-invite budget and a tutorial-recorder navigation budget) are fixed.
  Step 9 (screenshot sweep) is `continue-on-error` and does not gate the job.
- Run `40917445679` (`ceb85fd`, the SQL-test renumber): queued.
- The renumber commit `ceb85fd` is pushed. `scripts/local-sql-harness.sh` applies every SQL test by
  glob and every test re-seeds through `00_lib.sql`, so the renumber changes no run order — verified
  by the harness applying tests twice with no cross-test includes and no filename hardcoding.

## 2. What is built — verified

### The migration collision is resolved on the unified branch

- B's eight migrations were renumbered above the collision (`0110`–`0117` → `0119`–`0126`),
  content-preserving and byte-identical to B's originals. A's `0110`–`0118` are unchanged. **No
  number maps to two files.**
- The four content-merged migrations (`0033`, `0071`, `0081`, `0090`) are additive supersets:
  unified equals A, every B line is present, and `0081` has six B lines superseded by A under the
  same keys with nothing destroyed.
- The thirteen colliding SQL *test* numbers (`101`–`107`, `112`–`117`) were renumbered to `121`–`133`
  in the same spirit. References updated in `scripts/dead-code-allow.json`,
  `docs/CONFIG-EFFECT-MATRIX.md` and six docs.
- **Reservation:** the next free migration is `0127`; the next free SQL test is `134`. See
  `docs/BUILDER-BASELINE.md`.

### The Systeligon engine (S1–S16) is built

`src/lib/systeligon/` exists on this branch and carries: `types`, `runner`, `versioning`, `packs`,
`ota`, `flows`, `minutes`, `policydiff`, `provenance`, `extract/` (structured, ocr), and
`rules/` (numeric, threshold, structural, documents, patterns, sequential), with 17 re-exports in
`index.ts`. The rule-run engine, the flows, the extraction tiers and the signed-pack path are real,
pure and tested. **Verified** by reading the modules and the register's engine rows.

### The production-data defect is closed

The audit's headline defect — the app loaded `demoSeed` in development and rendered empty arrays in a
production build because nothing hydrated it from the database — is fixed on this branch.
**Verified:** `src/App.tsx:270` now gates the demo seed on `!hasSupabaseConfig() && import.meta.env.DEV`
(it is a no-config fallback, not the data path), and `src/context/AppContext.tsx` reads its own
database through `loadTenantSnapshot` (`../data/tenant`) and `../data/mutations`.

## 3. What is planned — the engine is built, its surfaces are not mounted

The highest-value remainder is the **last mile**: mounting the built deterministic engine on screens
a user can reach. Today, **verified:**

- **No screen calls `recordSysteligonFindings`** — the rule-run screen does not exist. It is the
  single `a-own-unwired` entry in `scripts/wiring-allow.json`.
- **No screen calls `listRulePacks` / `saveSignedRulePack`** — the rule-pack management UI does not
  exist.
- `verify_ledger` and `rule_engine_process` have **0 production call sites** (`grep` returns
  nothing outside tests).

The complete planned-work queue is in §5.

## 4. Two documentation defects found this session — verified

Both are the defect class this project exists to catch: a document describing work that is not in
the code. Both are in `docs/SYSTELIGON-GAP-REPORT.md`, which was rewritten this session only for
§13.9 (the collision) and is otherwise stale.

### 4.1 The register's own count is claimed wrong

**§13.8, Gates table:** *"R0 Feature register honesty | **BUILT** (138 features, 58/37/43)."*

**Verified:** `docs/FEATURE-REGISTER.md` carries **126 features, 84 `Wired` / 19 `Inert` / 23
`Absent`**, and `node scripts/check-feature-register.mjs` passes with exactly those counts. The
`138 / 58 / 37 / 43` figure describes no state this branch has ever had — the register gate itself
would fail on it. The row was copied from an earlier document.

### 4.2 The register rows F126–F138 are claimed to exist; they do not

**§10, and §13.1's reference to "F137 is `Inert` on this ground":** *"Register rows F126–F138 were
added as the work landed: F126 header detection (S2), F127/F128 the rule schema, runner, versioning
and packs (S1), … F138 the single product-name module (S16)."*

**Verified:** the register ends at **F126** (Live activity spine, `Wired`). There is no `F127`–`F138`
row. The same claim appears in `docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md` ("turns F127-F129 from
Inert to Wired", "Turn F137 …"). **Those register rows were never written on any branch** — A's
register ends at F125 and B's at F126. The engine rows the gap report describes (S1, S6, S7, S10/S11,
S14, S15, S16) therefore have **no register presence at all**; they are described in prose only.

**Why this matters.** The register is the one machine-checked honesty surface. A feature the register
does not carry is a feature the register cannot hold anyone to. **Fixed this session:** rows
**F127–F138** were written into `docs/FEATURE-REGISTER.md` §13b (the engine: schema/runner, versioning/
packs, numeric rules, extraction tiers, flows, document/pattern rules, minutes, policy comparison,
signed packs, product name), so the "wire it or mark it Inert" rule now sees the engine's surfaces.
The honest count moved from 126 to **138 features: 85 `Wired` / 30 `Inert` / 23 `Absent`**, and the
register gate passes. All eleven engine rows except the product-name module are `Inert` — which is the
truth: the engine is built and its screens are not.

## 5. The complete planned activities

Everything the specification describes that is **not yet done**, in the order the contract runs it.
Rows marked `BUILT` are listed only to mark the boundary.

### 5.0 Blocking

| # | Activity | State |
|---|---|---|
| 0 | Green the branch (confirm run `40917445679` end-to-end) | **in progress** (step 8 already green on the merge run) |
| 0b | **Write the engine's register rows F127–F138** (S1, S6, S7, S10/S11, S14, S15, S16) | **DONE this session** — §13b added; count 138; register gate green |

### 5.1 The last-mile queue (the built engine, unmounted)

| # | Activity | Register effect | Depends on |
|---|---|---|---|
| L1 | **The rule-run screen** — pick a population, pick a pack, run (S1 runner), show each finding with rule id, version, severity and source rows, and call `recordSysteligonFindings` so findings reach the ledger and the report root | `a-own-unwired` entry removed; engine rows → `Wired` | 0b, L2 |
| L2 | **Rule-pack management UI** (S10/S11) — list packs, show rules and versions, save a signed pack (refused server-side if unverifiable); the ad-hoc rule builder | pack rows `Inert` → `Wired` | 0b |
| L3 | **Extraction in the audit-file UI** (S7) — mount the three-tier flow, show the source hash, surface the OCR coverage report; ship the bundled OCR engine as a build artifact (permissive licence, local, refuses a remote engine) | extraction rows `Wired` | — |
| L4 | **S13 remainder** — the org-format editor adopts an uploaded report's structure and typography at every stage, editable without altering a fact | provenance row stays `Wired` | — |
| L5 | **C7 — anomaly to SIRA** — a resolved alert proposes an emergent risk carrying the alert id, rule version and affected rows; blocked on S18, now built | C7 row → `Wired` | S18 |
| L6 | **A-U2 — every screen's functional states** (loading / empty / error / ready / denied), honest in each | `Wired` per screen | — |
| L7 | **A-U3 — guided first-run to a sealed report, by reconciliation** — take B's `GuidedFirstRun.tsx` + `create_universe` and close the gap to "zero → first sealed report"; delete any duplicate | `Wired` | — |

### 5.2 Continuous (after every queue item, not a one-off)

| # | Activity |
|---|---|
| Reachability audit | Grep every export of `src/lib/writing/` and every audit-engine module for a production call site (`node scripts/check-wiring.mjs` resolves the real graph). Run it after every item that adds a module. |
| Tutorial media | Re-record when a screen's testids change; `check-tutorials` reports current vs stale. |

### 5.3 Held by the owner — the design language (do not build)

**E8** `PencilGuide` · **U5** motion signalling state change only · **U7** density toggle · **U9**
three themes (`prism`, `bloom`, `slate`) · **U10** four audience profiles · **U11** time-of-day
phases · **U12** motion system · **U13** animated headers · **A-U1** pencil-pointer surface. These
are catalogued for the designer on `feature/systeligon-design-spec` (`docs/DESIGN-SPEC.md`, generated;
`docs/DESIGN-BRIEF.md`).

### 5.4 The larger remainder (from the contract queue, in order)

| # | Activity | Series |
|---|---|---|
| 1 | The two flows and verification (accepted / declined, Mode A/B, override carried forward) mounted | S3/S4/S5/S12 |
| 2 | Document review, pattern rules, minutes, policy comparison mounted; S15 reports its own coverage | S8/S9/S14/S15 |
| 3 | Rule packs and signed OTA distribution (packs signed, versioned, append-only; an unverifiable pack refused and logged) | S10/S11 |
| 4 | C1–C7 continuous assurance: the scheduled runner (`runMonitors` per org, persist alerts, emit `watcher.signal`), enrichment, delivery, the suggestion and remediation paths, triage, anomaly-to-SIRA | C1–C7 |
| 5 | T1/T2 scheduled sweeps (`ledger_continuity_check` + the alarm on a schedule) | T |
| 6 | R5 methodology and test-step templates (no `test_step_templates` / `procedure_templates` tables; three hardcoded stage strings) | R5 |
| 7 | R6 multi-tenant scale and isolation (no SQL test with ≥3 concurrent orgs; support-grant refs legacy-name only; every support read logged) | R6 |
| 8 | R7 Super Admin guided provisioning (the SA-01 wizard covers some steps; model the full path) | R7 |
| 9 | R3 remainder — configuration honesty (`F35`, `F72`–`F79` still `Inert`) | R3 |
| 10 | D5–D9 adjacent capability products (`F121`–`F125`) | D |
| 11 | Re-record the tutorial media (the committed GIFs are placeholders) | — |
| 12 | Reachability audit of both engines, continuously | — |

## 6. Owner actions — the closed list

Nothing outside this list justifies stopping. (Contract §7.)

- Make the repository private (the patent-disclosure clock is running; the repo is public).
- Add a proprietary licence.
- Engage patent counsel if a filing is wanted.
- Run a trademark search on the final name.
- Supply connector credentials via the wizard.
- Deploy the Edge Functions.
- **Settle the design language in §5.3.**

---

## 7. The one number to remember

**The engine is built; its screens are not.** The S1–S16 library is real, pure and tested, and the
register — the surface that would hold it to account — does not yet carry it (§4.2). The first work
of the remainder is therefore not a screen; it is writing the rows that make the screen's absence
visible, and then building the screen.

*A generated, always-current view of every screen, flow and token lives on the designer branch
(`docs/DESIGN-SPEC.md`). This report is the builder's; the two branches share the contract, not the
documents.*

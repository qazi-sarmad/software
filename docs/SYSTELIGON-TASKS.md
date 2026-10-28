# SYSTELIGON-TASKS — the ledger for the concurrent Systeligon build

**This file is the single place that records what is done on `feature/systeligon-build-v1`.**
Update it in the same commit as the work. Anything not marked `DONE` here is not done, regardless of
what any other document says.

Status values: `TODO` · `DOING` · `DONE` · `BLOCKED (owner)`.

---

## Why this ledger is separate

Two builds run concurrently on this repository:

| Branch | Owns | Ledger |
|---|---|---|
| `feature/scale-harden-v1` | Phases 3-6 of the remediation plan: config honesty, methodology templates, monitors & connectors, production-build proof. Plus the C-series and gates G1-G6. | `docs/SCALE-TASKS.md` |
| `feature/systeligon-build-v1` | **Everything else established.** The full unscoped body: E1-E10, S17-S21, T3-T7, D1-D4, U1-U14, F1-F7, gates G7-G10. | **this file** |

**Unscoped means unscoped.** Builder B takes the entire established body of work that Builder A does
not own. It is not a cherry-picked slice. The list below is everything, and nothing on it is optional.

**The non-collision boundary is exactly three things**, and they are all Builder A's:
1. Phases 3-6 (config enforcement, methodology templates, monitors & connectors, production proof)
2. The C-series (C1 IS the Phase 5 runner — same subsystem as Phase 5)
3. Gates G1-G6

Everything outside those three is Builder B's. Phases 1-2 are already done (migrations 0100-0106).

**One branch owns one ledger.** That keeps the two merges clean. `docs/SCALE-TASKS.md` is the other
session's; **do not edit it**. If you need their status, read it.

Measured, not assumed: merging `feature/systeligon-v1` into `feature/scale-harden-v1` in a scratch
worktree auto-merges `docs/SCALE-TASKS.md` with **no conflict** — the two sides' edits to that file
are in different regions, and both survive. The separate ledger is still the right call, because it
removes the failure mode entirely rather than relying on the two sessions never editing the same
region. But a merge between these branches is currently a clean fast-forward, not a reconciliation.

---

## Truth policy

`docs/archive/` holds 63 documents written before the code-verified audit. **None of them may be
cited as evidence that anything works.** Each carries a stale banner. The reliable sources are:

| Document | What it is |
|---|---|
| `docs/SPEC-v10.md` | The specification. Authoritative, unchanged. |
| `docs/SYSTELIGON.md` | The forensic engine spec. **Your primary document.** |
| `docs/FEATURE-REGISTER.md` | Every feature and its true wiring status, gated by a script. |
| `docs/EXPLAIN-LAYER.md` | Popouts, drilldown, access-filtered detail, IIA standards. |
| `docs/FONT-REPOSITORY.md` | Self-hosted fonts, licence metadata, template auto-detection. |
| `docs/iia-standards-reference.md` | VERIFIED IIA 2024 numbering. Use these; never guess. |
| `docs/SYSTELIGON-TASKS.md` | This file. Live status for this branch. |

Rule for every session: **verify wiring by grepping the call site.** Never trust a doc or a green
test as proof that a feature works.

**Use `node scripts/audit-wiring.mjs`.** It resolves the real import graph, alias-aware, and prints
every export with no reachable caller. Name-based greps are unreliable here because screens import
with aliases (`populateSuggestions` is the export `populate_planning_suggestions`).

---

## Baseline counts (locked at branch point)

Recorded at `f2aaa5b`'s descendant `6f47cf8` (the merge base, which already contains Phases 1-2).

| Metric | Baseline |
|---|---|
| Migrations | 106 |
| SQL test files | 110 |
| Vitest files | 205 |
| Playwright specs | 30 |
| Guards | 21 |

---

## MIGRATION NUMBER RESERVATION — read before writing any migration

This is the single most likely way to break the other session's work. Both branches share one
migration namespace.

| Range | Owner |
|---|---|
| `0001`-`0106` | Applied. Already on both branches. Do not renumber. |
| `0107` | **`feature/scale-harden-v1`** (Phase 3 workflow enforcement). Do not use. |
| `0108`-`0109` | **Reserved for `feature/scale-harden-v1`** (their Phases 4-5). Do not use. |
| `0110` onward | **Yours.** Start at `0110`. |

Migrations are applied by glob (`supabase/migrations/*.sql`), so a gap is harmless — the harness
applies every file in filename order and does not require contiguity. If you need a second
migration, use `0111`, `0112`, and so on.

---

## WP0 — Pre-flight

| # | Task | Status |
|---|---|---|
| 0.1 | Branch `feature/systeligon-build-v1` from `feature/systeligon-v1` | DONE |
| 0.2 | Baseline counts recorded above | DONE |
| 0.3 | Own ledger (`docs/SYSTELIGON-TASKS.md`) — the split | DONE |
| 0.4 | Migration range reserved (`0110+`) | DONE |
| 0.5 | Run the full gate set, confirm green before any change | TODO |

---

## S-series — the forensic engine

| # | Task | Status |
|---|---|---|
| S17 | Document recognition by MAGIC BYTES; archive unpacking with limits; office-in-zip; metadata; inventory before import | TODO |
| S18 | SIRA continuity: carry-forward pack on publish, seed next cycle, anomalies propose emergent risk | TODO |
| S19 | Two-key SIRA acceptance: finaliser endorses, auditor accepts, publish blocked while proposed | TODO |
| S20 | EVIDENCE STORAGE — the most serious gap. Buckets, `storage_path`, real upload, re-derive on verify | TODO |
| S21 | Review comment popout: testids, states, inventory entry, hover popout, drilldown; delete the dead dock | TODO |

### S18/S19 prerequisite — the SIRA write path is inert

**Verified finding.** `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`, `submitEmergentRisk`
and `decideEmergentRisk` in `src/data/sira.ts` have **ZERO callers** in components, context or hooks.
Only the reads are wired (`listCycles`, `listEmergentRisks`, `siraModelSnapshot`, from `SiraTab.tsx`).
`SiraCyclePanel` is rendered by `RecordContent.tsx:118` with no submit or publish handler passed.

So S18's carry-forward and S19's two-key acceptance both depend on a write path the UI does not have.
**Wire the write path first**, or S18/S19 will build on a surface that cannot be driven.

---

## T-series — trust and attestation

| # | Task | Status |
|---|---|---|
| T3 | Portable attestation package: roots, signatures, timestamps, the rule versions that scored it, verification instructions | TODO |
| T4 | Third-party verifier: a documented procedure usable with independent tooling | TODO |
| T5 | Attestation screen: view, export, verify | TODO |
| T6 | Guided integrity incident wizard: what changed, by whom, what it affects; then restore / re-derive / freeze / escalate, each with a reason, append-only, verify afterwards | TODO |
| T7 | WIRE THE EXISTING ALARM — `listIntegrityAlerts()` has zero callers; no migration emits a notification | TODO |

**T7 detail.** `integrity_alerts`, `raise_integrity_alert()` (which writes the alert AND appends a
ledger entry) and the archive check functions all already exist. Detection is complete; the alarm is
missing. Severity-split a single hash mismatch from a broken ledger chain — the second is an
incident, not a warning. BOUNDARY: this is tamper-EVIDENCE, never tamper-prevention.

---

## D-series — deterministic capability library

Each is a pure function under `src/lib/` with direct unit tests and a screen surface.

| # | Task | Status |
|---|---|---|
| D1 | Risk and control intelligence: residual-risk drift, control coverage matrix, effectiveness history, KCI, appetite breach | TODO |
| D2 | Population and evidence intelligence: profile, stratification, sufficiency, freshness, chain of custody | TODO |
| D3 | Process and governance intelligence: SoD matrix, delegation breach, policy exceptions, meeting governance, regulatory impact | TODO |
| D4 | Assurance operations: engagement health, reviewer load, finding ageing, report consistency, trail completeness | TODO |

---

## E-series — the explain layer (docs/EXPLAIN-LAYER.md, E1-E10)

Owner decision #6: everything must be explainable and drilldownable. Not polish — a first-class
requirement, and the thing that makes the product teachable without a manual.

| # | Task | Status |
|---|---|---|
| E1 | `src/lib/explain/catalogue.ts` — schema, `explainFor(user, id, context)`, redaction, L2 guard test | TODO |
| E2 | `ExplainPopout` + `useExplain` on `HoverPreview`; non-blocking, a11y (tooltip + complementary) | TODO |
| E3 | `src/lib/explain/iia.ts` — standards as data, paraphrased, mapped to real screens/RPCs | TODO |
| E4 | Hover cards + detail panels wired across sampling methods, fields, statuses, terms | TODO |
| E5 | Drilldown from every aggregate; deep-linkable; no blocking modal (walk test) | TODO |
| E6 | Standards affordance on screens, lifecycle steps and report sections | TODO |
| E7 | Standards view (catalogue → implementation → evidence) | TODO |
| E8 | `PencilGuide` + guidance data for guided first-run and per-screen "show me" | TODO |
| E9 | Gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty) + tests | TODO |
| E10 | Extend `UI-INVENTORY.md` with explain ids, standards and drilldown targets per screen | TODO |

### The access rule that makes this safe (Law L2)

The popout renders **static catalogue content** (safe for any signed-in user) plus **contextual
values the host screen has ALREADY filtered** through `src/lib/access.ts`. The popout never queries
and never decides access to tenant data — `explainFor(user, id, context)` is **pure**, redacts on a
missing right, and **never returns nothing** (a missing popout looks like a bug).

Anchors that already exist and must be reused, not reinvented:
- `src/lib/access.ts` — the host screen's filter
- `src/components/common/HoverPreview.tsx` — the existing portal chrome
- `RecordView` + `FloatingWindowManager` — record drilldown, already built

### E1 is the gate for the rest

`explainFor` must be pure and time-argumented. Write it and its redaction test FIRST; E2-E8 all call
it. A popout that can leak a field the host screen filtered is an L2 breach, which is why E1 carries
the guard test rather than E9.

## U-series — interface quality

Spec: `docs/SYSTELIGON.md` §11.1c and §12 (personalisation). **Tier 1 only once the data underneath
is real.** A beautiful dashboard over an unwired engine is a better-looking lie.

| # | Task | Status |
|---|---|---|
| U1 | Every dashboard number drills to its exact filtered records | TODO |
| U2 | Command palette (Cmd/Ctrl-K) | TODO |
| U3 | Work queue as the front door | TODO |
| U4 | Live activity spine on the existing `liveSync` transport | TODO |
| U5 | Motion that signals state change only; universal `prefers-reduced-motion` | TODO |
| U6 | Guided empty states | TODO |
| U7 | Density toggle, remembered per user | TODO |
| U8 | Keyboard-first, with a `?` shortcut sheet | TODO |
| U9 | Three new themes (`prism`, `bloom`, `slate`) as token blocks; contrast test covers all six | TODO |
| U10 | Four audience profiles (Focus, Expressive, Aesthetic, Assurance — Assurance is the default) | TODO |
| U11 | Time-of-day phases: pure `resolveDayPhase(minuteOfDay)`, time as an argument | TODO |
| U12 | Motion system: four levels, token-driven durations, ten named animations, gates | TODO |
| U13 | Animated headers: token-driven gradient, never behind text, frozen under reduced motion | TODO |
| U14 | Dead comment dock removed (`ReviewCommentsDock.tsx`) — also listed as S21 | TODO |

**Do NOT:** gratuitous animation, vanity charts, dark patterns, or any "AI insight" badge. The
product's claim is determinism; decorating it as magic undercuts the one thing that makes it
different.

---

## F-series — fonts

| # | Task | Status |
|---|---|---|
| F1 | Remove the Google Fonts CDN link (`index.html:14`) — it leaks every client's IP to a third party and breaks offline | TODO |
| F2 | `src/lib/fonts/` — catalogue, per-font licence metadata, lazy loader | TODO |
| F3 | Curate and subset the bundled repository (do NOT attempt all ~1900 Google families) | TODO |
| F4 | Org font upload via `branding_assets` with licence acknowledgement | TODO |
| F5 | Font/colour/theme auto-detection from DOCX and PPTX | TODO |
| F6 | Wire detection into the org report format | TODO |
| F7 | Gate G10 — no bundled font without licence metadata and a redistributable flag | TODO |

---

## Gates to add on this branch

| Gate | Fails when | Status |
|---|---|---|
| G7 | an explain id has no catalogue entry | TODO |
| G8 | an aggregate has no drilldown target | TODO |
| G9 | an IIA reference does not match the verified numbering | TODO |
| G10 | a bundled font has no licence metadata | TODO |

`G2` (no-dead-code) already exists in spirit as `scripts/audit-wiring.mjs`; the other session owns
turning it into a hard CI gate. Do not duplicate it.

---

## Environment facts

- No host Postgres and no Docker socket for the user, but `sudo -n docker` works.
- `scripts/local-sql-harness-docker.sh` runs a real Postgres 17: shim, migrations twice, SQL tests
  twice. Probe readiness over TCP (`-h 127.0.0.1`), NOT the socket.
- `@electric-sql/pglite` is installed `--no-save` for in-process schema introspection.
- Gates: `npx tsc --noEmit` | `npx vitest run` | `npx vite build` | `node scripts/check-shrink.mjs`
  | `node scripts/check-tokens.mjs` | `node scripts/check-ui-contract.mjs` |
  `node scripts/check-feature-register.mjs` | `npm run check-tutorials` |
  `bash scripts/local-sql-harness-docker.sh` | `npx playwright test`.
- `E2E_PROD=1` runs Playwright against the built bundle. The dev-server path is unchanged.
- The register gate (`check-feature-register.mjs`) reads `docs/FEATURE-REGISTER.md`. **If you wire
  something, update its row in the same commit** or the gate fails.

---

## Maintenance

- **Update this file in the same commit as the work.** No exceptions.
- **Never edit `docs/SCALE-TASKS.md`.** That is the other session's ledger.
- **Never use migration numbers below `0110`.**
- **Never push to `feature/scale-harden-v1` or `main`.**

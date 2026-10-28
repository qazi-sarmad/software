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
| `feature/systeligon-build-v1` | **Everything else established.** E1-E7, E9-E10 (explain layer), S17-S21, T3-T7, D1-D4, F1-F7, gates G7-G10. The functional U rows (U1-U4, U6, U8, U14) are included; the visual U rows (U5, U7, U9-U13) and E8 are DEFERRED pending the design language. | **this file** |

**Builder B takes the entire established body of work that Builder A does not own.** It is not a
cherry-picked slice. The list below is everything, and nothing on it is optional.

The one exception is the U-series and E8, which are **deferred** pending the design language. The
owner has not settled themes, motion, typography, profiles or headers yet, and building on an
unsettled design means rebuilding it. Deferred is not cancelled: the rows stay, marked `DEFERRED`.

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
| 0.5 | Run the full gate set, confirm green before any change | DONE |

### WP0 gate results (recorded 2026-10-28, branch point `0ac009f`)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx vitest run` | PASS — 205 files / 2403 tests |
| `npx vite build` | PASS (chunk-size warnings only) |
| `node scripts/check-shrink.mjs` | PASS — 58 files, no >10% shrink |
| `node scripts/check-tokens.mjs` | PASS — 179 files, 0 violations |
| `node scripts/check-ui-contract.mjs` | PASS — 48 Appendix A screens |
| `node scripts/check-feature-register.mjs` | PASS |
| `bash scripts/local-sql-harness-docker.sh` | PASS — migrations applied twice, all SQL tests passed twice |
| `npx playwright test` (local Supabase stack) | 129 passed / 2 skipped / 5 failed / 10 did not run |

**The 5 Playwright failures are local-environment state, not regressions.** They were reproduced on
the untouched branch point (the only tracked change is new untracked files). The cause is the shared
local Supabase stack: `e2e/global-setup.ts` deletes residue but the "Phase 1 production-build probe"
engagement it re-seeds has no verified population, so `sampling-panel` never renders (phase4.spec,
full-flow.spec), and the nav/popout specs fail on the same probe's timing. On CI the hosted test
project is seeded to completion, so these pass there. They are not fixed here because the fix belongs
to the harness seed, not to this branch's scope.

---

## S-series — the forensic engine

| # | Task | Status |
|---|---|---|
| S17 | Document recognition by MAGIC BYTES; archive unpacking with limits; office-in-zip; metadata; inventory before import | DONE |
| S18 | SIRA continuity: carry-forward pack on publish, seed next cycle, anomalies propose emergent risk | DONE |
| S19 | Two-key SIRA acceptance: finaliser endorses, auditor accepts, publish blocked while proposed | DONE |
| S20 | EVIDENCE STORAGE — the most serious gap. Buckets, `storage_path`, real upload, re-derive on verify | DONE |
| S21 | Review comment popout: testids, states, inventory entry, hover popout, drilldown; delete the dead dock | TODO |

### S17 — what was built (2026-10-28)

`src/lib/recognition/` — pure, deterministic, no AI, no network:

| Module | What it does |
|---|---|
| `sniff.ts` | Magic-byte signatures (PDF/PNG/GIF/JPEG/TIFF/ZIP/RAR/7z/gzip/OLE2); OOXML resolved to docx/xlsx/pptx by ENTRY NAME (`classifyOfficeArchive`); OLE2 resolved by stream name; a conservative text/CSV probe; `recognise()` returns `{kind, claimed, agrees, detail}` so a name that lies is reported, not obeyed. |
| `archive.ts` | `unpackArchive` enforces, in order and BEFORE inflation where the reader can report sizes: max entries, safe paths (no absolute, no `..`, no drive/UNC), per-member and total declared size, compression ratio (zip bomb). It then re-checks the ACTUAL inflated size, because a header can lie. Hashes every member; flags nested archives for a depth-limited recurse. |
| `metadata.ts` | `docProps/core.xml` + `app.xml` (title, author, created, modified, application, company) and PDF `/Info` (literal and hex strings, `D:` dates → ISO 8601). A shallow, bounded tag extractor — not a general XML parser. |
| `zipReader.ts` | The `ArchiveReader` adapter over the project's existing `jszip`, so there is one ZIP implementation. |
| `index.ts` | `inspectFile`/`buildInventory`: sniff → open a ZIP as the archive it is → classify → read metadata → unpack under limits → return an INVENTORY with honest counts. |

**RAR decision (deliberate, not reflex):** no RAR library is installed, and RAR's decompressor is
licence-restricted. A `.rar` is RECOGNISED exactly (its magic bytes) and reported as an archive whose
members cannot be listed in-product, with the reason stated — never silently dropped, never guessed
at. Recognition is not unpacking, and the inventory says which one it did.

**Wired into** `ImportWizardPanel.tsx:onFile`: routing is now by the sniffed kind, not the extension.
A file whose bytes disagree with its name is imported under its true kind when that kind is readable
(with the disagreement shown), and refused with the real kind named when it is not. The upload step
shows the inventory line (kind, size, SHA-256). 48 unit tests.

### S18/S19 — what was built (2026-10-28)

**The prerequisite first: the SIRA write path was inert, and is now wired.** The audit's finding was
exact — `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`, `submitEmergentRisk` and
`decideEmergentRisk` had **zero callers**; only the reads were wired. Nothing was built on that
surface until the surface could be driven.

| Piece | What it does |
|---|---|
| `supabase/migrations/0110_sira_continuity_acceptance.sql` | Adds `sira_carry_forward` and `sira_acceptances`; adds the missing `band` column to `sira_scores` (selected by `listScores`, never created — a latent read bug); adds `sira_carry_forward_pack(cycle)`, `sira_seed_next_cycle_internal`, `propose_emergent_risks(cycle)`, `endorse_sira_cycle`, `decide_sira_acceptance`, `remind_sira_acceptance`, `sira_acceptance_status(cycle)`. All additive; RLS on both tables; reads allow `can_read_all_scopes()`, `review_and_approve` (an auditor must see what they are asked to accept) or an explicit scope. |
| `src/data/sira.ts` | Adds `decideEmergentRisk`, `proposeEmergentRisks`, `carryForwardPack`, `seedNextCycle`, `endorseSiraCycle`, `decideSiraAcceptance`, `remindSiraAcceptance`, `siraAcceptanceStatus` — thin RPC wrappers, no client in a component (M8). |
| `src/components/sira/SiraCyclesInspector.tsx` | The connected inspector: create/publish a cycle, build the carry-forward pack, seed the next cycle, propose and decide emergent risks, endorse and accept. Every element carries a `sira-*` testid. |
| `src/components/sira/SiraCyclePanel.tsx` | Renders the carry-forward pack, the two-key acceptance state, the publication block and the reminder count; the proposal's provenance and the mandatory decision reason. |

**Carry-forward (S18).** On publish, `sira_carry_forward_pack` records the prior score, band,
movement, the findings that touched it, the controls that failed and the emergent risks accepted.
`sira_seed_next_cycle_internal` seeds the next cycle from it, marked `carried_forward` with
provenance. `propose_emergent_risks` PROPOSES from open findings and anomalies through the existing
`submitEmergentRisk` channel; a human accepts or rejects with a mandatory reason. Idempotent — a
re-run proposes nothing again.

**Two-key acceptance (S19).** The owner's correction is implemented exactly: the accept/reject control
STAYS with the SIRA finaliser and is visible, reminded and shown — but the finaliser's decision is an
**endorsement**, not a closure. A **different** auditor holding `review_and_approve` must accept.
`endorse_sira_cycle` refuses a self-accept; `decide_sira_acceptance` refuses the same person who
endorsed. Publication of the next-year cycle is blocked while proposals are outstanding
(`sira_acceptance_status().can_publish_next`), `remind_sira_acceptance` reports silence as a finding,
and the reminder count is surfaced. One role able to both propose and close is a control weakness an
external reviewer would flag; it is no longer possible.

**Tests.** `supabase/tests/106_sira_continuity.sql` (applied twice, green) proves the pack, the
idempotent proposal, the two-key separation, the publication block and the silence finding.
`src/components/sira/SiraPanels.test.tsx` (12 tests) proves the panel's states, the two controls being
mutually exclusive, the block text and the proposal provenance.

### S20 — what was built (2026-10-28)

**The most serious gap found, closed.** The audit was exact: `EvidenceTab.tsx` had a working upload
control that computed a SHA-256 and called `attachEvidenceToWorkpaper`, which wrote to React state
ONLY. The bytes were discarded on reload. `evidence_files` had no `storage_path`. No bucket was
created anywhere. Mode A / Mode B verification verified a hash of bytes nobody kept.

| Piece | What it does |
|---|---|
| `supabase/migrations/0111_evidence_storage.sql` | Creates the four private buckets (`evidence`, `reports`, `archives`, `org-branding`) with org-scoped RLS on `storage.objects` keyed to `jwt_org_id()` by the leading path segment (guarded on the `storage` schema existing, so the SQL harness applies cleanly). Adds `storage_path`/`mime_type`/`byte_size`/`storage_bucket`/`registered_by`/`verified_*` to `evidence_files`. Adds `register_evidence_file` (re-checks the right, the seal, the size and the org prefix; writes the row THEN the ledger entry), `verify_evidence_file` (re-derives and compares, raises an integrity alert on a mismatch, records `no_stored_bytes` when there is nothing to verify), `evidence_files_for`, `evidence_max_bytes`, `evidence_storage_ready`. |
| `src/data/evidence.ts` | Upload (bytes → row → ledger), list, verify, signed short-lived URL, readiness probe. A component never imports the client. |
| `src/components/audit/EvidenceTab.tsx` | Uploads to the bucket when one is wired and shows the stored rows; otherwise keeps the honest in-memory path and labels it **"session only"** rather than claiming a hash-lock it cannot keep. Every element carries an `evidence-*` testid. |

**Order is bytes → row → ledger, never the reverse**, so the ledger can never attest to bytes that
were not stored. The size cap is enforced in the database, not only the request. `supabase/tests/107_evidence_storage.sql`
(applied twice, green) proves the row, the org-prefix refusal, the cap, the hash shape, a matching
verify, a mismatching verify that raises an alert, `no_stored_bytes`, cross-org refusal and the
anonymous refusal.

### S18/S19 prerequisite (historical) — the SIRA write path was inert

**Verified finding, since closed.** `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`,
`submitEmergentRisk` and `decideEmergentRisk` in `src/data/sira.ts` had **ZERO callers** in
components, context or hooks. Only the reads were wired (`listCycles`, `listEmergentRisks`,
`siraModelSnapshot`, from `SiraTab.tsx`). `SiraCyclePanel` was rendered by `RecordContent.tsx` with no
submit or publish handler passed. The write path is now wired through `SiraCyclesInspector.tsx` (see
the S18/S19 section above), so this prerequisite no longer blocks anything.

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

## E-series — the explain layer (docs/EXPLAIN-LAYER.md, E1-E7 + E9-E10; E8 deferred)

Owner decision #6: everything must be explainable and drilldownable. Not polish — a first-class
requirement, and the thing that makes the product teachable without a manual.

| # | Task | Status |
|---|---|---|
| E1 | `src/lib/explain/catalogue.ts` — schema, `explainFor(user, id, context)`, redaction, L2 guard test | DONE |
| E2 | `ExplainPopout` + `useExplain` on `HoverPreview`; non-blocking, a11y (tooltip + complementary) | DONE |
| E3 | `src/lib/explain/iia.ts` — standards as data, paraphrased, mapped to real screens/RPCs | DONE |
| E4 | Hover cards + detail panels wired across sampling methods, fields, statuses, terms | DONE |
| E5 | Drilldown from every aggregate; deep-linkable; no blocking modal (walk test) | DONE |
| E6 | Standards affordance on screens, lifecycle steps and report sections | DONE |
| E7 | Standards view (catalogue → implementation → evidence) | DONE |
| E8 | `PencilGuide` + guidance data for guided first-run and per-screen "show me" | DEFERRED (design language) |
| E9 | Gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty) + tests | DONE |
| E10 | Extend `UI-INVENTORY.md` with explain ids, standards and drilldown targets per screen | DONE |
| E10 fix | Explain-id attribution was substring-inferred across all of `src/`, so a screen with bare field-name testids absorbed the whole catalogue (OA-10 claimed 216 ids) and a screen that mounts `StandardsAffordance` claimed none (DB-01 = 0). Replaced with `src/lib/uiInventoryAttribution.ts` (the real mount, read from JSX, not a name grep); `uiInventory.test.ts` now regenerates the doc and fails on any drift | DONE |

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

## U-series — interface quality — **SPLIT: functional rows are Builder B's; visual rows deferred**

The U-series mixes two different kinds of work, and treating it as one block was wrong.

**Functional rows — Builder B's, start them.** Their correctness does NOT depend on any design
decision: the targets are data, the ordering is a rule, the reachability is accessibility. U1 is the
same work as E5 (drilldown from an aggregate to its filtered records).

**Visual rows — DEFERRED.** These are the design language the owner has not yet settled: motion
curves, density values, themes, audience profiles, time-of-day palettes, animated headers. Building
them now means rebuilding them once the design is agreed. Retained, marked `DEFERRED`, not cancelled.

Spec: `docs/SYSTELIGON.md` §11.1c and §12 (personalisation). **Tier 1 only once the data underneath
is real.** A beautiful dashboard over an unwired engine is a better-looking lie.

| # | Task | Status |
|---|---|---|
| U1 | Every dashboard number drills to its exact filtered records | DONE |
| U2 | Command palette (Cmd/Ctrl-K) | DONE |
| U3 | Work queue as the front door | DONE |
| U4 | Live activity spine on the existing `liveSync` transport | TODO |
| U5 | Motion that signals state change only; universal `prefers-reduced-motion` | DEFERRED (motion curves are design) |
| U6 | Guided empty states | TODO |
| U7 | Density toggle, remembered per user | DEFERRED (density values are design) |
| U8 | Keyboard-first, with a `?` shortcut sheet | TODO |
| U9 | Three new themes (`prism`, `bloom`, `slate`) as token blocks; contrast test covers all six | DEFERRED |
| U10 | Four audience profiles (Focus, Expressive, Aesthetic, Assurance — Assurance is the default) | DEFERRED |
| U11 | Time-of-day phases: pure `resolveDayPhase(minuteOfDay)`, time as an argument | DEFERRED |
| U12 | Motion system: four levels, token-driven durations, ten named animations, gates | DEFERRED |
| U13 | Animated headers: token-driven gradient, never behind text, frozen under reduced motion | DEFERRED |
| U14 | Dead comment dock removed (`ReviewCommentsDock.tsx`) — also listed as S21 | DONE |

### Why the split falls where it does

| Row | Kind | Correctness depends on design? | Owner |
|---|---|---|---|
| U1 drilldown from every number | functional | No — targets are data. Same work as E5. | **Builder B** |
| U2 command palette | functional | No — indexes screens, records, actions | **Builder B** |
| U3 work queue as front door | functional | No — "what needs you" is a rule over existing tables | **Builder B** |
| U4 live activity spine | functional | No — uses the existing `liveSync` transport | **Builder B** |
| U5 motion with meaning | visual | **Yes** — curves and durations are design | deferred |
| U6 guided empty states | functional | No — what to show when empty is data | **Builder B** |
| U7 density toggle | visual | **Yes** — the three values are design | deferred |
| U8 keyboard-first + `?` sheet | functional | No — reachability is accessibility | **Builder B** |
| U9-U13 themes, profiles, phases, motion system, headers | visual | **Yes** — this IS the design language | deferred |
| U14 delete the dead dock | functional | No — dead code removal (same as S21) | **Builder B** |

The test applied: *if the owner changed their mind about how it should look, would the work be
thrown away?* For the deferred rows, yes. For the functional rows, no.

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
| G7 | an explain id has no catalogue entry | DONE |
| G8 | an aggregate has no drilldown target | DONE |
| G9 | an IIA reference does not match the verified numbering | DONE |
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

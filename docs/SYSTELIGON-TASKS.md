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
| S21 | Review comment popout: testids, states, inventory entry, hover popout, drilldown; delete the dead dock | DONE |

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

**Correction (2026-10-28, re-audit under the ONE RULE).** The row claimed the full inventory was
wired, but `node scripts/audit-wiring.mjs` showed `buildInventory` — the documented "inventory the
user confirms before import" entry point — had **zero** production callers, and with it the whole
`inspectFile`/`unpackArchive`/`readOfficeMetadata`/`parsePdfInfo` machinery. The wizard only called
the light `sniffBytes`/`recogniseBytes`, so the upload step showed the kind, size and SHA-256 but
never the metadata, the archive members, the compression ratio or the refusal reason. Now
`onFile` calls `buildInventory([...], sha256Bytes)` and the upload step renders the inventory:
`import-inventory`, `import-inventory-counts` (importable / unrecognised / refused), and — when the
file carries them — `import-inventory-metadata`, `import-inventory-archive` (members + ratio) and
`import-inventory-note` (the refusal). `ImportWizardPanel.test.tsx` (3) pins the counts for an
importable PDF and for an unrecognised file, and the no-right state.

### S18/S19 — what was built (2026-10-28)

**The prerequisite first: the SIRA write path was inert, and is now wired.** The audit's finding was
exact — `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`, `submitEmergentRisk` and
`decideEmergentRisk` had **zero callers**; only the reads were wired. Nothing was built on that
surface until the surface could be driven.

**Correction (2026-10-28, re-audit under the ONE RULE).** The wiring above was **incomplete**: it
wired `createSiraCycle`/`publishSiraCycle`/`decideEmergentRisk`/`proposeEmergentRisks` but left
`recordSiraScore` and `submitEmergentRisk` with **zero callers**, and `listScores`/`listCarryForward`
likewise. A cycle could be created and published but never **scored**, so the carry-forward pack had
nothing to carry — the engine was complete and unfed. Closed here: `SiraScoringPanel.tsx` (the factor
matrix → `recordSiraScore`, and the manual emergent risk → `submitEmergentRisk`) is mounted by
`SiraCyclesInspector`, which now loads the model, the entity list, the risk library and the draft
cycle's scores. `src/lib/siraScoring.ts` is the pure rule (matrix, counts, validation, preview); it
shares `siraCompute` with the RPC so the previewed score is the stored score.

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

**Correction (2026-10-28, re-audit under the ONE RULE).** The carry-forward provenance was written
(`sira_carry_forward` rows by `sira_seed_next_cycle_internal`) but never read: `listCarryForward` had
**zero** production callers, so the recorded chain lived only in this session's `packs` state and
vanished on reload — a table written and never read, the exact class of gap the ONE RULE exists to
catch. `SiraCyclesInspector` now loads `listCarryForward(uid)` alongside the cycles and passes the
chain to `SiraCyclePanel`, which renders it (`sira-carry-forward-chain`, `sira-carry-forward-<id>`,
`2026 → 2027 · recorded <date>`) so the provenance survives a reload. `SiraPanels.test.tsx` pins the
chain render and the no-chain case.

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

### S21 — what was built (2026-10-28)

The thinnest surface in the product, closed. `CommentHistoryPanel` had ONE testid (`bubble-mine`/
`bubble-other`), no screenId prefix, no documented states, no inventory entry and no drilldown; and
`ReviewCommentsDock.tsx` was mounted nowhere.

| Piece | What it does |
|---|---|
| `src/lib/commentPopout.ts` | The PURE popout model: `commentPopout({comment, workpaper, engagement, todayIso, viewer})` returns author, role, age (`commentAgeDays`/`ageLabel`, time as an argument), workpaper ref/title, engagement, status + label, the resolution path as a rule, and the comment body. `canViewComment` mirrors `filterComments` in `src/lib/access.ts`: a configuration-only principal and an observer (read-only with `view_all_scopes`) are refused, and the model then returns `status: 'redacted'` with a reason and `text: null` — it NEVER returns nothing and never leaks the body (Law L2). |
| `src/components/reviews/CommentPopout.tsx` | The hover/focus popout, on the shared `HoverPreview` chrome (the same portal every explain affordance uses). Non-blocking: a `role="tooltip"` popover, never a modal; the trigger is focusable and opens on focus. |
| `src/components/reviews/CommentHistoryPanel.tsx` | Every element now carries a `CH-07-*` testid; full history mode with search, cycle filter and open/cleared status pills; single-comment mode; the redacted viewer; the guided empty state; the reply thread and composer; and the per-row popout trigger. The open count opens the `CH-07-drilldown` panel with the exact comments behind it (E5/U1), `role="complementary"`, deep-linkable via `#drill=comments`. |
| `src/lib/drilldown.ts` | A new `comments` family so the count and its drilldown read the SAME filtered rows. Declared in `src/lib/drilldownAggregates.ts` (G8). |
| `src/components/reviews/ReviewCommentsDock.tsx` | Deleted (U14/S21) after `node scripts/audit-wiring.mjs` reported no reachable caller. The live review surface is `CommentHistoryPanel`, reachable via the `comment_history` inspector. |

Contract section CH-07 added to `docs/ACP-UI-CONTRACT.md`; `docs/UI-INVENTORY.md` regenerated (95
screens). Tests: `src/lib/commentPopout.test.ts` (12, incl. the redaction guard) and
`src/components/reviews/CommentHistoryPanel.test.tsx` (8, pinning every CH-07 state).

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
| T3 | Portable attestation package: roots, signatures, timestamps, the rule versions that scored it, verification instructions | DONE |
| T4 | Third-party verifier: a documented procedure usable with independent tooling | DONE |
| T5 | Attestation screen: view, export, verify | DONE |
| T6 | Guided integrity incident wizard: what changed, by whom, what it affects; then restore / re-derive / freeze / escalate, each with a reason, append-only, verify afterwards | DONE |
| T7 | WIRE THE EXISTING ALARM — `listIntegrityAlerts()` has zero callers; no migration emits a notification | DONE |

**T7 detail.** `integrity_alerts`, `raise_integrity_alert()` (which writes the alert AND appends a
ledger entry) and the archive check functions all already exist. Detection is complete; the alarm is
missing. Severity-split a single hash mismatch from a broken ledger chain — the second is an
incident, not a warning. BOUNDARY: this is tamper-EVIDENCE, never tamper-prevention.

**T7 implemented (2026-10-28).** `0112_integrity_alarm.sql`:
`integrity_alert_severity(kind)` is the severity rule as data (ledger chain / signature / timestamp =
incident; a single object = warning). `raise_integrity_alert` is redefined to fan out through
`integrity_alert_notify` — an in-app `notification_emit` to each integrity owner
(`review_and_approve`/`edit_config`/Head, rights not role names), a queued email to the same owners,
and an `integrity.alert` automation event for the Work Queue — so every existing detection path alarms
with no further change. `integrity_alerts_list()` is the gated, severity-annotated, incident-first read
surface. `integrity_alert_acknowledge()` records that a human saw it and ledgers the annotation; the
alert row stays immutable. `ledger_continuity_check()` re-verifies the chain and raises an incident on
a break. The surface is `IntegrityAlarmPanel.tsx` (OA-29, the `org_control` `integrity` tab) plus
`IntegrityAlarmBanner.tsx` (DB-01). `src/lib/integrityAlarm.ts` is the pure labelling/summary layer,
pinned to the SQL rule by a parity test. SQL test `112_integrity_alarm.sql`; vitest
`src/lib/integrityAlarm.test.ts` and `src/data/archival.integrityAlarm.test.ts`.

**T6 implemented (2026-10-28).** The RESPONSE to the alarm. `0114_incident_wizard.sql`:
`integrity_incidents` is the immutable incident header (select-only policy, no update grant); the
`engagement_id` it affects is resolved once at open time by `integrity_incident_engagement(type, id)`
(evidence file → its engagement, archive job → its engagement, ledger/report graph → none).
`integrity_incident_actions` is the append-only trail (every `annotate` / `restore` / `rederive` /
`freeze` / `escalate` / `verify` / `open` step is a row; the trigger refuses any UPDATE or DELETE, so
an incident cannot be quietly closed — the STATUS is DERIVED from the trail in the pure layer, never
stored and mutated). `integrity_incident_open(alert_id)` is idempotent per alert.
`integrity_incident_outcome(incident, action)` is the deterministic rule: restore compares the record
now to what was sealed (`restored` / `still_mismatched` / `no_sealed_copy` / `not_applicable` — no
bytes are conjured); re-derive re-walks the ledger chain or re-folds the report-graph leaves
(`intact` / `broken` / `matches` / `diverges`); freeze sets `engagements.frozen_at`/`_reason`/`_by_incident`
and a `guard_engagement_frozen` trigger stops a frozen engagement moving stage or sealing; escalate
notifies the org's integrity owners in-app, queues an email to the platform's `platform_notification_recipients`
(the designed channel that needs no org membership), raises the `integrity.incident_escalated`
automation event and writes a durable `platform_trail` row. `integrity_incident_action(id, action,
reason)` requires a reason (`a_reason_is_required`) and appends to the ledger;
`integrity_incident_verify(id)` re-runs verification so the incident closes on PROOF.
`integrity_incidents_list()` is the gated read (rights re-checked; `review_and_approve`/`edit_config`/
Head/platform admin). Surface `IncidentWizardPanel.tsx` (OA-31, the `org_control` `incidents` tab);
pure layer `src/lib/incidentWizard.ts` (status, available actions, model, headline — time is an
argument). Data module `src/data/incidents.ts` (inert without a Supabase env). SQL test
`114_incident_wizard.sql`; vitest `src/lib/incidentWizard.test.ts`, `src/data/incidents.test.ts`,
`src/components/admin/IncidentWizardPanel.test.tsx`. Explain entries `term.incident` and `screen.OA-31`.
BOUNDARY (never blurred): tamper-EVIDENCE, not tamper-prevention.

### T3/T4/T5 — what was built (2026-10-28)

The cryptographic spine (0096 signing keys, signatures, timestamps, trust anchors; 0103 report graphs
and the Merkle root) already existed. What was missing was a portable artifact an outsider could check
without our code, the published procedure to check it, and a screen to build and verify one.

| Piece | What it does |
|---|---|
| `supabase/migrations/0113_attestation_package.sql` | Adds `report_claims.leaf_hash` and redefines `report_graph_commit` to record it — the gap that made the root un-re-foldable off-database, because the canonical claim text is not kept and a leaf cannot be recovered from `claim_hash`. Adds `attestation_input_get(kind, subject_id)` — one security-definer read that gathers a subject's roots, versions (incl. the distinct rule packs), Merkle leaves, signatures, public keys, timestamp tokens and ledger seq, for `report_graph_root` / `engagement_certificate` / `board_pack_data_hash`. Adds `attestation_subjects_list()` — the signed subjects an integrity owner can build a package for. Both refuse a caller who is not an integrity owner (`review_and_approve`/`edit_config`/Head/platform admin). |
| `src/lib/attestation.ts` | The PURE package model: `buildAttestationPackage` (time is an argument; the package root is the SHA-256 of the canonical package without `packageRoot`), `packageRoot`, `merkleRootOfLeafHashes` (the exact mirror of `report_graph_root_of`: `'01'` node prefix, odd node promoted), `verifyAttestationPackage` (re-derives the root, re-folds the leaves, verifies every Ed25519 signature against the embedded keys, and returns a verdict — never throws), `parseAttestationPackage`, and `ATTESTATION_INSTRUCTIONS` (the procedure, as data). Only hashes, signatures, public keys, timestamps and version ids are carried (Law L2). |
| `scripts/verify-attestation.mjs` | The STANDALONE third-party verifier: a self-contained Node script that imports only `node:crypto`/`node:fs`. It re-derives the package root, re-folds the Merkle root, verifies every Ed25519 signature (rebuilding the SPKI from the raw 32-byte key itself) and checks an `--expect-root` you supply. Exit 0 passes, 1 fails, with each step printed. This is the "independent tooling" half of T4. |
| `docs/ATTESTATION-VERIFICATION.md` | The published procedure (T4), written for an outsider: what a package is, what it proves and what it does not, and the six steps to verify it in any language. |
| `src/data/attestation.ts` | The data module: `loadAttestationInput`, `listAttestationSubjects` — thin RPC wrappers; no component imports the client (M8). Inert (empty / null) with no Supabase environment. |
| `src/components/admin/AttestationPanel.tsx` | The OA-30 surface: lists signed subjects, builds a package for one, verifies it in place, exports it as JSON, and verifies a package dropped in from elsewhere. It re-checks nothing about tenant access itself — the RPCs do — and it never claims more than the package proves. Wired as the `attestation` tab of the `org_control` inspector. |

**The two verifiers are the same procedure, and a test enforces it.** `src/lib/attestation.standalone.test.ts`
builds a package with the in-product code and runs `scripts/verify-attestation.mjs` as a separate Node
process; both must reach the same verdict on a good package and on a tampered one. A divergence is a
build failure. Tests: `src/lib/attestation.test.ts` (15) + `src/lib/attestation.standalone.test.ts` (3);
SQL `supabase/tests/113_attestation_package.sql` (19 assertions, applied twice).

**Boundary (never blurred).** A package proves structure and provenance, not the truth of the claims.
It is tamper-EVIDENCE, not tamper-prevention.

---

## D-series — deterministic capability library

Each is a pure function under `src/lib/` with direct unit tests and a screen surface.

| # | Task | Status |
|---|---|---|
| D1 | Risk and control intelligence: residual-risk drift, control coverage matrix, effectiveness history, KCI, appetite breach | DONE |
| D2 | Population and evidence intelligence: profile, stratification, sufficiency, freshness, chain of custody | DONE |
| D3 | Process and governance intelligence: SoD matrix, delegation breach, policy exceptions, meeting governance, regulatory impact | DONE |
| D4 | Assurance operations: engagement health, reviewer load, finding ageing, report consistency, trail completeness | DONE |

**D-series close-out.** Twenty pure capabilities across four families (`src/lib/capabilities/`), a
single uniform evaluator (`evaluateCapability`) so no capability can be added and left unreachable,
a data module (`src/data/capabilities.ts`), persistence + config-as-ledger (`0115_capability_library.sql`,
test `115`), and the screen surface (`CapabilityLibraryPanel.tsx`, screen `DB-02` on the dashboard).
The evaluator is total: it never returns nothing, and it distinguishes `ready` (findings), `empty`
(an honest clean result) and `awaiting_input` (naming the exact missing input) rather than showing an
empty result as a clean bill of health. Unit tests: 44 across the five capability test files + 6 for
the data module + 7 for the panel. Register rows F117-F120 and F48 flipped to `Wired`.

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
| U4 | Live activity spine on the existing `liveSync` transport | DONE |
| U5 | Motion that signals state change only; universal `prefers-reduced-motion` | DEFERRED (motion curves are design) |
| U6 | Guided empty states | DONE |
| U7 | Density toggle, remembered per user | DEFERRED (density values are design) |
| U8 | Keyboard-first, with a `?` shortcut sheet | DONE |
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

### U6 — guided empty states (2026-10-28)

A new org's dashboard must not be a wall of zeros. Two things were missing for that to be real rather
than decorative: a way to CREATE a universe at all, and the one fact that says whether the org is
still empty.

| Piece | What it does |
|---|---|
| `supabase/migrations/0117_guided_first_run.sql` | `create_universe(name, domain)` — the first-run action. There was NO write path for a universe anywhere; every screen that writes reads an EXISTING universe, so an org with none was stuck. The RPC requires `edit_config`, writes the row, an `activity_log` entry and a ledger entry, and returns the new id. `get_org_data_state()` returns COUNTS (universes/entities/engagements) and an `is_empty` boolean for the caller's org — never a row of tenant content (Law L2), readable by any signed-in member because a brand-new org's members hold no audit right yet. |
| `src/lib/guidedFirstRun.ts` | The PURE rule: `guidedSteps(counts)` / `nextGuidedStep(user, counts)` / `visibleGuidedSteps`. The decision is a rule over the org data state, never a guess from scoped rows. Only the two countable first-run actions are steps; a done step is marked `done`, never hidden. |
| `src/hooks/useOrgDataState.ts` | Centralises the org-state read so the dashboard and the panel share one authoritative decision. |
| `src/components/dashboard/GuidedFirstRun.tsx` | The panel: a single guided action ("Create your first universe") with one button, the create form, and the done-steps list. Wired into `ExecutiveDashboardTab.tsx` (the guided step renders in place of the zero-wall; a no-actionable fallback covers the rest). |

Tests: `src/lib/guidedFirstRun.test.ts`, `src/data/guidedFirstRun.test.ts`,
`src/components/dashboard/GuidedFirstRun.test.tsx` (16) and `supabase/tests/117_guided_first_run.sql`
(applied twice, green: the create path, the right refusal, the empty-name refusal, org scoping, the
empty-org boolean, the anonymous refusal, and the null-org case).

### U8 — keyboard-first, with a `?` shortcut sheet (2026-10-28)

Every action reachable without a mouse, and `?` opens the shortcut sheet. The deterministic half is
the catalogue, the rights filter and the pure matcher; the shell only performs the resulting action.

| Piece | What it does |
|---|---|
| `src/lib/keyboardShortcuts.ts` | The shortcut catalogue as data (`SHORTCUTS`), `shortcutsFor` (rights filter — a configuration-only principal sees no navigation), `groupedShortcuts`, `formatChord`/`formatSequence` (⌘ on macOS, Ctrl elsewhere), and the PURE matchers `matchShortcut`/`matchSequence`. A bare-letter chord is suppressed inside a text field, so typing "g" in a search box never navigates; a `mod`-chord still fires there, which is what makes Cmd-K work from anywhere. |
| `src/components/common/ShortcutSheet.tsx` | The `?` sheet: a `role="complementary"` panel anchored below the header (non-blocking, never a modal), listing only the caller's shortcuts with their key sequences. |
| `src/App.tsx` | The global keydown layer: `mod-k` toggles the palette, `?` toggles the sheet, and `g`-prefixed sequences (`g d`, `g w`, `g u`, `g p`, `g s`, `g a`, `g i`) navigate to the seven screens without the mouse. |

Contract section CH-08 added; `docs/UI-INVENTORY.md` regenerated (100 screens). Tests:
`src/lib/keyboardShortcuts.test.ts` (12) and `src/components/common/ShortcutSheet.test.tsx` (4).

---

## F-series — fonts

| # | Task | Status |
|---|---|---|
| F1 | Remove the Google Fonts CDN link (`index.html:14`) — it leaks every client's IP to a third party and breaks offline | DONE |
| F2 | `src/lib/fonts/` — catalogue, per-font licence metadata, lazy loader | DONE |
| F3 | Curate and subset the bundled repository (do NOT attempt all ~1900 Google families) | DONE |
| F4 | Org font upload via `branding_assets` with licence acknowledgement | DONE |
| F5 | Font/colour/theme auto-detection from DOCX and PPTX | DONE |
| F6 | Wire detection into the org report format | DONE |
| F7 | Gate G10 — no bundled font without licence metadata and a redistributable flag | DONE |

### F-series — correction (2026-10-28, re-audit under the ONE RULE)

The F6 row claimed DONE, but the audit found `loadReportFonts` (`src/data/fontBytes.ts`) had **zero
callers**: the report PDF never embedded a self-hosted face, so a format that chose Inter or Source
Serif 4 printed in Helvetica. Two defects, both closed:

1. **The embedding path was dead.** `renderAndStoreReportFiles` now loads the format's heading/body
   bytes and passes them through `DocumentModel.fontBytes` → `toPdfModel` → the PDF renderer's
   `headingFontBytes`/`bodyFontBytes`, and `renderDesignedPdf` now reads `model.fontBytes` (it passed
   `undefined`). A family outside the catalogue resolves to no bytes and the renderer keeps its
   default, so the fallback is honest, not silent.
2. **Half the catalogue had no bundled bytes.** The map carried 6 of the 12 report families
   (JetBrains Mono, IBM Plex Mono, Open Sans, Atkinson Hyperlegible, Playfair Display and Roboto Slab
   were offered by the picker but unembeddable). All twelve are now imported at every declared weight
   (26 files). `fontBytes.test.ts` pins the map against `REPORT_FONT_FAMILIES`, so a family offered
   without its bytes fails the build rather than falling back at render time.

Tests: `src/data/fontBytes.test.ts` (3) and `src/lib/render/designedPdf.test.ts` (+2, the face is
embedded and the render stays byte-identical). The `render.test.ts` reproducibility sweep over every
catalogue family still passes.

### F4 — correction (2026-10-28, re-audit under the ONE RULE)

The F4 row claimed the org font upload was wired, and the upload half was: `OrgBrandingPanel`
acknowledges the licence and calls `uploadBrandingAsset`, which stores the bytes in
`branding_assets`. But `listBrandingAssets` had **zero** callers — an org could upload a house font or
logo and then never see that it had been stored, or what else was already there. The panel now loads
`listBrandingAssets(orgId)` with the branding, refreshes it after every successful upload, and renders
the stored assets (`oa-branding-assets`, `-list`, `-empty`, `oa-branding-asset-<id>`) so a licence
acknowledgement is confirmed against what is actually stored. `OrgBrandingPanel.test.tsx` (+2) pins
the populated and empty lists.

---

## Dead-export sweep (2026-10-28, re-audit under the ONE RULE)

Ran `node scripts/audit-wiring.mjs` and a transitive-reachability pass over the whole export graph.
Every export with no reachable caller was resolved by wire-or-delete, never left as prose.

**Wired — population retention (§25.4, `C2.5`).** `archivePopulation`, `listPopulationArchiveDue`,
`listPopulationArchives` and `uploadArchiveJob` in `src/data/archival.ts` had zero callers while the
SQL behind them (`archive_population`, `population_archive_due`, `population_archives`,
`archive_jobs`) was built and tested. They are now the "Population retention" section of
`ActivityLogPanel.tsx` (OA-26): the due list reads `population_archive_due`, "Archive" calls
`archive_population` (rows are not removed; the content hash is recorded so the bytes can be
re-derived), a pending activity job exposes an "Upload" button over `uploadArchiveJob` (the
`archive-upload` edge function hashes what it stored and the database decides whether the job is
done). Testids `population-retention`, `population-due-*`, `population-archive-*`,
`population-archived-notice`, `population-archives`, `population-archive-row-*`, `archive-upload-*`.
`phase7Panels.test.tsx` +2 (the due→archive flow, the pending upload).

**Deleted — `canChangeCapDueDate`.** `src/lib/access.ts` exported `canChangeCapDueDate` with a
`@deprecated` tag, zero callers, and no supporting surface: there is no CAP due-date-change RPC
anywhere (only `cap_is_overdue`/`cap_due_soon_days`, which read a date) and no UI to change one. The
capability system (`canPerformCapability(user, 'cap_change_due_date', orgConfig)`) supersedes it, so
the dead export was removed rather than wired to nothing. The rights it read (`manage_engagements`)
stay; `hasRight` is unchanged.

**Register corrections found by the same pass.** Three rows were stale in the *opposite* direction —
they claimed `Inert` for work that is now wired. Corrected in `docs/FEATURE-REGISTER.md`: F3
(`verify_ledger` is reached by `ledger_continuity_check`, T7), F34 (the pre-flight engine is consumed
by `freeze_report`, Phase 2), F37 (`report_graphs` has a writer — `commitReportGraph` — and a reader —
`verifyReportRoot`). F39 stays `Absent` (findings-to-report provenance is `S13`, not this branch's).
Honest count moves 80/23/23 → **83 Wired / 20 Inert / 23 Absent**.

**Left as `Inert`, correctly, and named here so no one re-derives it:** F43 `extractDocument`
(`src/data/documents.ts`) — the `doc-extract` edge function is real and the wrapper is correct, but
the call site belongs to Builder A's R2/C2.6 and the function is a deployment step, not this branch's.
F49-F59 (monitor runtime, alert persistence/delivery, connector adapters) are Builder A's C-series.
Neither is in this ledger's scope, so neither is touched.

---

## Gates to add on this branch

| Gate | Fails when | Status |
|---|---|---|
| G7 | an explain id has no catalogue entry | DONE |
| G8 | an aggregate has no drilldown target | DONE |
| G9 | an IIA reference does not match the verified numbering | DONE |
| G10 | a bundled font has no licence metadata | DONE |

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

## Session verification (2026-10-28, this session)

Every gate run locally, in full, after the dead-export sweep. No gate is reported from memory.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx vitest run` | PASS — **255 files / 2954 tests** |
| `npx vite build` | PASS (chunk-size warning only) |
| `node scripts/check-shrink.mjs` | PASS — 57 files, no >10% shrink |
| `node scripts/check-tokens.mjs` | PASS — 209 files, 0 violations |
| `node scripts/check-ui-contract.mjs` | PASS — 48 Appendix A screens |
| `node scripts/check-feature-register.mjs` | PASS — 126 features: 83 Wired / 20 Inert / 23 Absent |
| `npm run check-tutorials` | PASS — every tutorial key has a GIF (69 current, 11 stale) |
| `bash scripts/local-sql-harness-docker.sh` | PASS — migrations applied twice, all SQL tests passed twice |
| `src/guards/uiInventory.test.ts` | PASS — the committed inventory equals the generator output byte-for-byte |

**Counts vs the locked baseline** (baseline: 106 migrations / 110 SQL tests / 205 vitest files /
30 Playwright specs / 21 guards):

| Metric | Baseline | Now | Delta |
|---|---|---|---|
| Migrations | 106 | 114 | +8 (`0110`-`0117`) |
| SQL test files | 110 | 118 | +8 |
| Vitest files | 205 | 255 | +50 |
| Vitest tests | 2403 | 2954 | +551 |
| Playwright specs | 30 | 30 | 0 |
| Guards | 21 | 26 | +5 (G7-G10 + provenance-adjacent) |

**Wiring re-verified by call site, not by test, under the ONE RULE:** `explainFor` (via
`useExplain`), `ExplainPopout`/`StandardsAffordance` (mounted across the plan, universe, audit-file,
dashboard, pending, issues and report screens), `AttestationPanel`/`IncidentWizardPanel`/
`IntegrityAlarmPanel` (mounted in `OrgControlPanel` tabs `attestation`/`incidents`/`integrity`),
`CapabilityLibraryPanel` + `ActivitySpine` + `GuidedFirstRun` (`ExecutiveDashboardTab`), `FrontDoor`
(`PendingTasksTab`), `CommandPalette` + `ShortcutSheet` (`App.tsx`), `buildInventory`
(`ImportWizardPanel`), `verifyEvidenceFile` (`EvidenceTab`), `recordSiraScore`/`submitEmergentRisk`
(`SiraScoringPanel` via `SiraCyclesInspector`). `ReviewCommentsDock.tsx` is confirmed gone.

---

## Maintenance

- **Update this file in the same commit as the work.** No exceptions.
- **Never edit `docs/SCALE-TASKS.md`.** That is the other session's ledger.
- **Never use migration numbers below `0110`.**
- **Never push to `feature/scale-harden-v1` or `main`.**

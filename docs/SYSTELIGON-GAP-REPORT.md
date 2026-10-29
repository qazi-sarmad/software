# Provio / Systeligon — external review briefing

**For:** an independent reviewer who has not seen this repository before.
**Date:** 2026-10-29 (regenerated — the previous edition described the S1–S16 engine as unwritten; it
is built. This edition corrects that and states the new picture.)

**Subject:** what Provio is, what was wrong with it, what has now been built, and — stated as plainly
as everything else — what is still only planned.

---

## 0. Names, scope, and how to read this

**The product is Provio** — a deterministic internal-audit and forensic assurance platform.

**Systeligon** is the owner's name for the deterministic forensic engine inside it. The engine is a
rule engine, not a model: every finding names its rule, its version, and its source rows, and re-runs
identically forever. That reproducibility is the product. It is the reason the engine is *better* than
a language model for numeric and structural forensics, and the reason it cannot do semantic judgement
at all.

**The boundary, stated once here and never blurred below.** The engine CANNOT judge whether a decision
was wise, whether code is correct in intent, or whether a minute reflects good governance — at any
level of effort. It finds the *shape* of a problem and shows the evidence; a human decides what the
shape means. It must never be described as a model, and no doc, UI string or commit message may imply
comprehension. A rule engine sold as AI is the same class of lie as a config panel that saves a value
nothing reads.

**Branches verified for this briefing** (short SHA in parentheses, `git ls-remote` this session):

| Branch | Head | What it is |
|---|---|---|
| `main` | `a697190` | The untouched default branch. Still carries the headline defect (§1). |
| `feature/scale-harden-v1` | `4719330` | Builder A's continuous build. Remediation Phases 1–6, the C-series (C1–C6), the **entire Systeligon S1–S16 rule engine**, gates G1–G6. |
| `feature/systeligon-build-v1` | `51c4156` | Builder B: the explain layer (E, U), Systeligon S17–S21, T3–T7, D1–D4, fonts (F), gates G7–G10. |
| `feature/writing-engine` | `c45bb81` | The deterministic report-writing engine (merged into both builder branches). |

**How to read this.** Every figure marked **verified** I reproduced against the repository in this
session, with the command named. Figures that come from a builder's ledger and that I did not
reproduce are marked **reported**. This distinction is not pedantry. The single most serious problem
in this codebase was never a bug — it was that the documents describing the code were wrong. This
report separates *built* from *planned* in every section, because conflating the two is precisely the
failure it documents. Where an earlier edition's numbers and the numbers I measured disagree, I give
both and I say so.

**The correction this edition carries.** The previous edition was written before the S1–S16 engine was
built, and — on this very branch — it described that engine as *absent*. That was true when written
and is false now. The S1–S16 rows are **built** on `feature/scale-harden-v1`; only S16 was still
missing as of the previous session and it landed this session (`4719330`). Part Three below is
rewritten around what genuinely remains.

**Source of truth in this repository** (verified present):

| Document | Role |
|---|---|
| `docs/SPEC-v10.md` | The authoritative product specification. |
| `docs/SYSTELIGON.md` | The forensic engine spec (1,245 lines). Authoritative for §13 below. |
| `docs/SYSTELIGON-TASKS.md` | Builder B's live ledger. Starts at S17. |
| `docs/SCALE-TASKS.md` | Builder A's live ledger — Phases 1–6, the C-series, and the S1–S16 build. |
| `docs/FEATURE-REGISTER.md` | Every feature with its true wiring state, gated by a script. |
| `docs/FUNCTIONALITY-AUDIT.md` | The code-verified audit (§1). |
| `docs/REMEDIATION-PLAN.md` | The repair plan derived from the audit. |
| `docs/BRANCH-MAP.md` | Which branch owns which work; the migration-number reservation. |
| `docs/iia-standards-reference.md` | VERIFIED IIA 2024 numbering. |
| `docs/archive/` | 63 pre-audit documents. **None may be cited as evidence.** |

---

# PART ONE — What was wrong

## 1. The headline: the product did not work in production

On 2026-10-27/28 a code-verified audit (`docs/FUNCTIONALITY-AUDIT.md`) ran with one instruction:
ignore the documentation, read the code. Its finding, quoted:

> The repository contains a large, well-tested backend and a large, well-tested frontend, and the two
> are wired together for only a fraction of the product. It is two half-products: a database that
> enforces rules nobody triggers, and screens that render from an in-memory seed.

The defect — **verified on `main` at `src/App.tsx:204`**:

```ts
const loadDemoSeed = import.meta.env.DEV
  ? () => import('./data/demoSeed').then((m) => m.demoSeed)
  : null;
```

In development the shell loads `demoSeed`; in a production build `loadDemoSeed` is `null`, so every
seed array is empty. This session measured `src/data/demoSeed.ts` at **127 lines** and
`src/context/AppContext.tsx` at **726 lines** on `main`; the audit's own figures (1,387 and 727) differ,
and I report both rather than repeating one unchecked. The line count is not the point. The point is
that **nothing hydrated the shell from the database**: `AppContext`, which feeds every screen, had
zero calls to the Supabase client. The product had no code path that could display real tenant data.
It looked complete. It was a demonstration.

**Why the tests missed it.** On `main`, `playwright.config.ts:39` (**verified**) runs `npm run dev`.
Every end-to-end test exercised the demo seed. The suite was green, broad, and structurally incapable
of seeing the defect — the tests passed because they ran in the one mode where the product worked.

**This is the recurring defect class of the repository: built, tested, documented as done, and never
connected.** Every section below is written to make that class visible, so the same mistake cannot be
made again by reading *this* document.

## 2. The second-order failures

The audit found the headline defect first and then traced what it implied. The following are from
`docs/FUNCTIONALITY-AUDIT.md` and `docs/REMEDIATION-PLAN.md` (**reported**; each has since been
closed on a builder branch — see Part Two):

| # | Defect | Severity | Evidence |
|---|---|---|---|
| 2.1 | Engagement stage never persisted | Critical | Only `update engagements set sealed`; no transition RPC existed |
| 2.2 | Report graph root never written | Critical | `grep -rn "report_graphs" src/` → empty |
| 2.3 | Pre-flight was dead code | High | `runPreflight()`'s only caller was its own test |
| 2.4 | Sign-off roles and testing mode stored but not enforced | High | Persisted, displayed, never read by the sign-off RPCs |
| 2.5 | Sampling not connected to row testing | High | Schema accepted 7 methods; engine implemented 1 |
| 2.6 | LAW-1 violated in the UI context | Medium | `new Date()` / `Date.now()` at multiple sites in `AppContext` |

**2.2 in detail.** `report_graphs` is append-only and `verify_report_root` reads it to prove
tamper-evidence — the platform's core claim. Nothing inserted a graph row. The writing engine
computed the roots, the tests verified the roots, and the result was never persisted. The
verification chain had no data to verify.

**2.4 in detail.** `signoff_role_planning`, `signoff_role_testing`, `signoff_role_conclusion` and
`testing_mode` were validated, persisted with version history, and displayed. `sign_planning`,
`sign_off_workpaper` and `sign_conclusion` never read them. A client could configure a two-stage
approval chain and get one-stage behaviour, with the setting showing the value they chose.

## 3. Functions the product never called

The audit listed functions that were built, tested — and reachable from nothing (**reported** from
`docs/FUNCTIONALITY-AUDIT.md`; several are now closed, see Part Two):

| Function | What it should do | Callers then |
|---|---|---|
| `verify_ledger` | Verify the hash-chained ledger — the tamper check | 0 |
| `rule_engine_process` | Run the deterministic monitor rules | 0 |
| `staged_record_ingest` | Ingest connector records | 0 |
| `connector_run_start` / `_finish` | Record a connector run | 0 / 0 |
| `alert_record` | Persist a fired monitor alert | 0 |
| `escalation_evaluate` | Evaluate escalation rules | 1 (feature map only) |
| `reopen_engagement` | Reopen a sealed engagement | 0 |
| `phrase_create`, `admin_set_org_setting`, `email_dispatch_set_token` | — | 0 |

`verify_ledger` is the sharpest case: the hash-chained ledger was written in memory and never
verified against the database. The tamper-evidence mechanism was cosmetic.

## 4. Two UIs — a correct and a fake implementation, both reachable

The audit found the repository often carried **two implementations of one behaviour** and could not
say which ran (**reported**):

| Behaviour | Real | Fake | Which ran |
|---|---|---|---|
| Sampling | `SamplingPanel` (RPC) | `SamplingTab` (`dummyPopulation`) | both wired |
| Universe/entities | `listEntities()` | `useScopedData()` seed filter | both, merged |
| Sign-off | `sign_planning` RPC | `AppContext.signOffEngagement` | both existed |
| CAP transition | `update_cap` RPC | `transitionCapStatus` | both existed |
| Ledger | DB `append_ledger_entry` | in-memory `appendLedgerEntry` | in-memory |

## 5. The misdirection

The repository carried 63 documents whose claims were, in the audit's words, "all Present" — while
the code was not. The docs' "all Present" was true of modules and false of behaviour. Roughly 15
functions and five core flows were built, tested, documented as done, and not connected.

Three mechanisms produced this:

1. **A status vocabulary that permitted ambiguity.** `Partial` absorbed every state between "does
   not exist" and "works", so a document could claim progress indefinitely without ever being wrong.
   `Partial` is not a status; it is a place to hide. The current `FEATURE-REGISTER.md` uses exactly
   three values — `Wired`, `Inert`, `Absent` — and **verified this session** the register contains
   **58 `Wired`, 37 `Inert`, 43 `Absent`**, and **no `Partial`**.
2. **Tests cited as proof of function.** The suite was green and "structurally incapable of catching
   the integration gaps, because the integration is exactly what it stubs out." Green tests were used
   as a proxy for a working product. They are not that.
3. **Documents treated as evidence.** Every later document was written by reading the previous
   document rather than the code, so errors propagated. The audit found its own successor document
   had done this — and the previous edition of *this* report did it again, describing the S1–S16 engine
   as absent after it had been built. That is the correction this edition carries.

The 63 documents were not deleted. They were archived under a stale banner
("⚠️ STALE — ARCHIVED, DO NOT TRUST") — **verified: 63 files under `docs/archive/`** — preserved
deliberately, because the failure mode is the one most likely to recur.

## 6. The commercial framing

From `docs/REMEDIATION-PLAN.md` (**reported**):

> A professional would have asked — "can I configure the approval chain for this client?" — the answer
> would have been yes, the setting would have saved with a reason and a version history… and then
> nothing would have happened when they used it.

That is worse than a crash. A crash is honest. A config screen that saves a value no code ever reads
is a lie told to the user's face. Twenty-three configuration tables were settable and versioned, a
meaningful share with no behavioural effect. Against best-in-class audit software, Provio's honest
standing then: strong on risk universe/SIRA, security and tenancy, parts of reporting; broken or
absent on engagement lifecycle, methodology, sampling, continuous monitoring and connectors — the
machinery that turns a risk model into a finished audit.

---

# PART TWO — What was built

Everything below is on a builder branch; **nothing in Part Two is on `main`.** Each item names the
branch and, where I have verified the artifact, the path.

## 7. The Writing Engine — `src/lib/writing/`

Branch `feature/writing-engine` (`c45bb81`), 2026-10-26/27. **Verified this session** on
`feature/scale-harden-v1`: `src/lib/writing/` holds **82 files** — **43 non-test modules, 8,812 lines**
of non-test source. Every module is a pure function of its arguments. No AI, no model, no embedding,
no generated free text.

An audit report is not text. It is a directed graph. Each node is a claim — typed reference set,
bound figure, phrase id + version, rule id + version. Each edge is evidence (claim → records, by
type, id, content hash), a dependency, or a structure edge from the plan. Two hashes are committed:
the **graph root** over the facts, and the **render hash** over the words.

**The graph root is identical across every formality, tone, voice and locale of the same report.**
Reword from blunt to diplomatic, switch en-GB to en-US, flip passive to active — the words change,
the render hash changes, the root does not move, because the facts did not change. You can prove two
differently-worded documents assert exactly the same findings.

**Proof by exhaustion** (**reported** from the branch ledger): 5 formality × 5 tone × 2 voice × 2
locale = 100 cells; extended to all twelve report models = 1,200 compositions, 0 missing phrases, 0
errors. One graph root per model across all 100 cells while the render hash genuinely varies. A
declared `registerInvariant` section renders identical text in all 100 cells — proved, not assumed —
and a section not declared invariant genuinely varies, so the declaration cannot be over-used to make
tests pass.

The matrix found and fixed a real defect in the engine itself: the composer applied the register
transform and lead-in to invariant sections, rendering ungrammatical variants of the appendices line.
`compose.ts` now honours the declaration and the invariant test fails if it stops. `adversarial.test.ts`
holds deliberately broken inputs that must never seal, including a graph-root mutation test and a
coverage-hole test. No test reads a clock — the report date is an argument.

## 8. The Audit Engine — the auto-configuring audit

The part that decides what the audit should be. All pure, all deterministic (L1).

- **SIRA pre-fill** — `populate_planning_suggestions` (`0025_planning.sql:139`), surface
  `src/data/planning.ts`. Reads the latest published SIRA cycle and derives suggestions: risk,
  inherent rating, band, suggested controls, prior finding count. Each carries a decision row
  (accepted, reason, decidedAt) — the engine proposes, the auditor disposes, the ledger keeps both.
- **`siraEngine.ts`** (138 lines, **reported**) — deterministic scoring, four aggregations
  (`weighted_sum`, `maximum`, `weighted_average`, `weighted_average_floor`), the exact mirror of SQL
  `public.sira_compute`, with a parity test running the same fixtures through both.
- **`analyticsEngine.ts`** — **verified 432 lines**, **14 exported deterministic checks**:
  `checkDuplicates`, `checkNearDuplicates`, `checkSequenceGaps`, `checkOutliersZScore`,
  `checkOutliersIqr`, `checkBenfordFirstDigit`, `checkRoundNumbers`, `checkWeekendPostings`,
  `checkSameUserCreateApprove`, `checkMissingAttributes`, `checkPeriodVariance`, `checkGlToTb`,
  `checkSiraVsPlanning`, `checkControlsVsTests`. Every result row carries the references it flagged.
  The last two audit the audit.
- **`auditEngines.ts`** — `createDeterministicPrng` (Mulberry32, seeded) with the guarantee that no
  unseeded randomness is used in any audit sampling; `drawSeededSample`; `verifyPopulationGate`
  (population SHA-256). An auditor can re-derive any sample months later and prove the population did
  not change.
- **`automationRules.ts`** (204 lines, **reported**) + `0056_automation_engine.sql` — conditions and
  actions as data. Loop guard (an action cannot trigger its own rule) and a rate limit (>20 events
  per rule per hour auto-pauses with a notice). "It never sends anything itself."
- **Monitor rules** — `src/lib/writing/monitors.ts` (**verified 291 lines**), six kinds (threshold,
  rate, sequence, set membership, missing event, reconciliation), window and time as arguments,
  emitting `watcher.signal`. Rules ship as drafts; release needs a qualified human.

The shared ethic: the machine proposes and the human decides; an unknown is never converted to a zero;
sampling is reproducible; automation cannot loop.

## 9. Systeligon — the S-series, S17–S21 (built by Builder B)

Branch `feature/systeligon-build-v1` (`51c4156`). **Verified:** the ledger
`docs/SYSTELIGON-TASKS.md` records **47 `DONE`**, **12 `DEFERRED`**, **zero `Partial`**. The built
S-rows begin at S17:

- **S17 — recognition.** `src/lib/recognition/`: magic-byte signatures (PDF/PNG/GIF/JPEG/TIFF/ZIP/
  RAR/7z/gzip/OLE2); OOXML resolved to docx/xlsx/pptx by entry name; `recognise()` returns
  `{kind, claimed, agrees, detail}` so a name that lies is reported, not obeyed. `unpackArchive`
  enforces max entries, safe paths (no absolute, no `..`, no drive/UNC), per-member and total size,
  compression ratio — then re-checks the actual inflated size, because a header can lie. On RAR: no
  library, licence-restricted decompressor, so a `.rar` is recognised exactly and reported as an
  archive whose members cannot be listed, with the reason — never silently dropped, never guessed at.
  *(**Reported**: 48 unit tests.)*
- **S18/S19 — SIRA continuity and two-key acceptance.** Migration `0110_sira_continuity_acceptance.sql`.
  On publish, a carry-forward pack records prior score, band, movement, findings, failed controls,
  accepted emergent risks; the next cycle is seeded from it with provenance. `propose_emergent_risks`
  proposes from open findings; a human accepts or rejects with a mandatory reason, idempotently.
  Two-key: the finaliser's decision is an endorsement, not a closure — a different auditor holding
  `review_and_approve` must accept. Publication is blocked while proposals are outstanding; silence is
  itself a finding.
- **S20 — evidence storage**, called by the audit "the most serious gap found." Migration
  `0111_evidence_storage.sql`. Four private buckets with RLS on `storage.objects` keyed to
  `jwt_org_id()` by path prefix; `register_evidence_file` re-checks right, seal, size, org prefix and
  writes row then ledger; `verify_evidence_file` re-derives, raises an alert on mismatch, records
  `no_stored_bytes` when there is nothing to verify. Order is bytes → row → ledger, never the reverse.
  Where no bucket is wired the tab says "session only."
- **S21 — review comment popout.** The pure `commentPopout` model refuses a configuration-only
  principal and an observer, returning `status: 'redacted'` with a reason and `text: null` — it never
  returns nothing and never leaks the body (L2). The dead `ReviewCommentsDock.tsx` deleted.

## 10. Systeligon — the S1–S16 rule engine (built by Builder A, this programme)

Branch `feature/scale-harden-v1` (`4719330`). This is the part the previous edition of this report
called unwritten. It is built, tested and gated. **Verified this session:**

- `src/lib/systeligon/` holds the engine: `types.ts`, `runner.ts`, `versioning.ts`, `packs.ts`,
  `ota.ts`, `flows.ts`, `minutes.ts`, `policydiff.ts`, `provenance.ts`, `extract/` (structured,
  ocr), `rules/` (numeric, threshold, structural, documents, patterns, sequential) and `index.ts`
  (17 re-exports). **Verified:** **1,893 lines** of non-test source across **6 test files**, and the
  S-series alone runs **63 tests, all passing**.
- Register rows **F126–F138** were added as the work landed: **F126** header detection (S2),
  **F127/F128** the rule schema, runner, versioning and packs (S1), **F129** the numeric rule library
  (S6), **F130/F131** structured extraction and the OCR seam (S7), **F132** the accepted/declined
  flows and Mode A/B verification (S3/S4/S5/S12), **F133** structural document rules (S8), **F134**
  pattern rules (S9), **F135** the action-item register (S14), **F136** policy/procedure/regulation
  comparison (S15), **F137** signed rule-pack storage (S10/S11), **F138** the single product-name
  module (S16).

| Row | What it is | State |
|---|---|---|
| **S1** | Rule schema, runner, append-only versioning, packs — every finding names its rule, version and rows; a re-run is byte-identical | **BUILT** (`src/lib/systeligon/{types,runner,versioning,packs}.ts`) |
| **S2** | Header detection + confirm-before-count in the population flow; rows above the header are preamble, the header is not counted | **BUILT & wired** (`population.ts` `detectHeader`, called from `TestingStepsTab.tsx`; register F126 `Wired`) |
| **S3/S4/S5/S12** | The accepted flow (required rows → evidence → verify → revert), the declined flow (`applyFloor` is a minimum never a ceiling, paste-to-fill), Mode A/B verification, and the override carried to the next reviewer | **BUILT** (`flows.ts`, pure; time is an argument) |
| **S6** | Numeric forensic rules as versioned rules — the `analyticsEngine` checks are not duplicated, they are wrapped so each is a rule with provenance, plus just-below-threshold | **BUILT** (`rules/numeric.ts`, `rules/threshold.ts`) |
| **S7** | Extraction tier 1 wired (`extractDocument` → `doc-extract`, register F43 `Wired`); tier 2 an OCR seam that loads a bundled local engine lazily and **refuses a remote engine** so nothing leaves the tenant; tier 3 declared-parser structured extraction that reports its own coverage | **BUILT** |
| **S8** | Structural document rules: a contract must carry a signature, an approval a date, no date after the report date, every open action item has a later record | **BUILT** (`rules/documents.ts`) |
| **S9** | Pattern rules: hardcoded credentials, `SELECT *`, an external call with no error handling, an unbounded loop, a disabled check, a hardcoded environment value, each finding citing its line | **BUILT** (`rules/patterns.ts`) |
| **S10/S11** | Rule packs per audit type + an ad-hoc rule builder; signed OTA distribution with append-only shipped versions and refusal logging | **BUILT** (`packs.ts`, `ota.ts`, `src/data/rulePacks.ts`, `0117_systeligon_rule_packs.sql`) |
| **S13** | Findings-to-report provenance: `findingsToClaims` copies each finding's rule id/version onto a report claim, the ledger records it, and `commitReportGraph` re-roots so the findings sit *inside* the tamper-evident root | **BUILT** (`provenance.ts`, `src/data/systeligon.ts`, `0118_systeligon_findings.sql`; register F39 `Wired`) |
| **S14** | Sequential minutes: an action-item register following each item forward — carried, vanished, closed no-evidence, reopened, closed-before-raised, closed-by-non-owner, owner/due changed, due passed — citing every appearance as the history | **BUILT** (`minutes.ts`, `rules/sequential.ts`) |
| **S15** | Policy/procedure/regulation comparison reporting its own coverage (parsed/matched/could-not-interpret); an unparsed clause is not a clean clause | **BUILT** (`policydiff.ts`) |
| **S16** | The product/engine name in ONE constants module so a rename is one commit | **BUILT this session** (`src/lib/product.ts`, `scripts/sync-product-name.mjs`, the Edge mirror, `src/guards/productName.test.ts`; register F138 `Wired`) |

**The honest wiring caveat that remains.** The engine's screens are largely not built: no screen yet
calls `recordSysteligonFindings` (the rule-run screen), and the pack-management UI is unwired. Those
are recorded on purpose in `scripts/wiring-allow.json` and in the `FEATURE-REGISTER.md` `Inert` rows
(F127–F137) rather than hidden. The engine is a tested, versioned library that a screen must still
mount — exactly the wiring-by-grep rule this programme exists to enforce.

## 11. Systeligon — trust and attestation, capability, explain, fonts (built by Builder B)

All artifacts below are **verified present** on `feature/systeligon-build-v1`:

- **Attestation** — `0113_attestation_package.sql` adds `report_claims.leaf_hash` and bakes a portable
  package; `scripts/verify-attestation.mjs` and `docs/ATTESTATION-VERIFICATION.md` are an independent
  verifier and its procedure (T3–T5).
- **Integrity and incident** — `0112_integrity_alarm.sql` wires the existing tamper alarm
  (`integrity_alerts`, severity-split) and `0114_incident_wizard.sql` adds the guided incident wizard
  (T1, T2, T6, T7).
- **Capability library** — `0115_capability_library.sql` and `src/lib/capabilities/`
  (`riskControl.ts`, `populationEvidence.ts`, `processGovernance.ts`, `assuranceOps.ts`) (D1–D4).
- **Explain layer** — `src/lib/explain/` (`catalogue.ts`, `iia.ts`) and the `ExplainPopout`/`useExplain`
  surface, plus drilldown and standards views (E1–E7, E9, E10).
- **Activity spine and guided first run** — `0116_activity_spine.sql` and `0117_guided_first_run.sql`;
  `GuidedFirstRun.tsx` (U4, U6).
- **Self-hosted fonts** — `src/lib/fonts/` catalogue with licence metadata and a lazy loader; the
  Google Fonts CDN link removed; font/colour/theme auto-detection from DOCX/PPTX wired into the org
  report format (F1–F7).

## 12. The repair — Phases 1–6 (built by Builder A)

The headline defect (§1) is closed. **Reported** from `docs/SCALE-TASKS.md`: the shell now reads its
own database; the engagement lifecycle is real (stage transitions persist); pre-flight and the
report-graph writer are wired; method-aware sampling is in; the C-series C1–C6 landed (the monitor
runner, alert enrichment, delivery, ad-hoc suggestion, remediation wizard, triage surface). The proof
is gate G1 — Playwright can now run against the **built bundle** (`E2E_PROD=1`), not only the dev
server, so the exact class of defect that hid for months is now catchable.

**The software now audits itself.** Six anti-theatre gates refuse the build when the codebase lies
about itself (**verified this session**): G2 no dead code (538 fns, 39 allow-listed), G3 every config
field has a proving test (50 rows, 41 ENFORCED), G4 every `src/data` export is imported (18
allow-listed, 30 test-only), G5 no component reading both seed and database (0 allow-listed), G6
every RPC the UI calls exists (117 RPCs, 10 service-only), R0 the feature register is honest (138
features, 58/37/43). Plus G7–G10 on Builder B. Each was designed from a specific audit finding — G5
is the two-UIs problem, G3 the inert settings, G2 the uncalled functions.

**Counts — verified this session** (`ls`, `find`, `git ls-remote`):

| Metric | `main` | `feature/scale-harden-v1` | `feature/systeligon-build-v1` | `feature/writing-engine` |
|---|---|---|---|---|
| Migrations | 87 | 118 | 114 | 94 |
| SQL test files | 92 | 123 | 118 | 97 |
| Vitest files | 144 | 224 | 255 | 164 |
| Vitest tests | — | **2,595** | — | — |
| Playwright specs | 25 | 30 | 30 | 25 |
| Guards | 18 | 23 | 26 | 19 |

---

# PART THREE — What remains

This section is rewritten. The previous edition listed the entire S1–S16 engine here. It is built
(§10). What genuinely remains is smaller, and it is stated with the same rule: nothing below is built
unless it says so.

## 13.1 The engine's screens — the library is built, the surfaces are not all mounted

**Verified.** The engine is a tested, versioned library. The screens that would drive it are the last
mile. Concretely unwired today, and recorded honestly rather than hidden:

- No screen calls `recordSysteligonFindings` — the rule-run screen that would evaluate a population
  and record findings does not exist yet. (Allow-listed in `scripts/wiring-allow.json`.)
- The rule-pack management UI is not built — `src/data/rulePacks.ts` has no screen caller
  (`FEATURE-REGISTER.md` F137 is `Inert` on this ground).
- The ad-hoc rule builder and the pack browser have no screen.

This is the same defect class as §1 in miniature: a working engine with no reachable surface. It is
the highest-value next work, because it turns a library into a product surface.

## 13.2 Extraction — tier 1 wired, tier 2/3 seams built, the bundled engine a build artifact

**Verified.** `extractDocument` is now `Wired` (register F43): `DocumentViewerPanel.tsx` invokes it,
the `doc-extract` Edge Function re-checks the caller's right and org and reads the file itself. Tier 1
(docx/mammoth, xlsx, pdf-lib) is reachable. The tier-2 OCR **seam** (`extract/ocr.ts`) is built — it
decides whether a scan needs OCR, loads an injected local engine lazily, and refuses a remote engine
(L2). The bundled model itself is deliberately **not vendored**; it is a build artifact wired as a
dependency (decision D6, recorded). Tier 3 structured extraction (`extract/structured.ts`) parses
text with declared parsers and reports its own coverage. **What remains:** actually bundling and
shipping the OCR engine, and mounting the extraction flow in the audit-file UI.

## 13.3 Header detection — built and wired

**Verified.** `detectHeader`/`checkPopulationCsv` in `src/lib/population.ts` no longer assumes row 1
is the header; the reachable surface is `TestingStepsTab.tsx`; the auditor confirms before anything is
counted. The old `const [header, ...body] = table;` line is gone. Closed (register F126 `Wired`).

## 13.4 Continuous monitoring — the runner is built, C7 is the last gap

**Verified.** `src/lib/writing/monitors.ts` (291 lines, six kinds, pure) is real and Builder A's
C1–C6 are `DONE` (the `pg_cron` sweep, alert enrichment, delivery, ad-hoc suggestion, remediation
wizard, triage). **C7 — anomaly to SIRA** (a resolved alert proposes an emergent risk carrying the
alert id, rule version and affected rows) is **unblocked but unbuilt**: it was `BLOCKED (S18)`, and
S18 is now built, so the blocker is gone but the work is not done.

## 13.5 Report writer — provenance built, editor adoption the remainder

**Verified.** F39 (findings-to-report provenance) is now `Wired`: findings are recorded, read back and
re-rooted *inside* the tamper-evident report graph. Font/colour auto-detect (F5/F6) is `DONE`. **What
remains** of S13: org-format adoption in the editor at every stage (adopt an uploaded report's
structure and typography, while formatting stays editable and no fact changes). S13 is therefore
**partly built** — the provenance is done, the editor adoption is not.

## 13.6 The deferred visual work — deliberately not started

The owner has not settled the design language. Building on an unsettled design means rebuilding it.
**Deferred rows:** E8 (pencil guide), U5 (motion), U7 (density), U9–U13 (themes, audience profiles,
time-of-day phases, motion system, animated headers), and Builder A's A-U1 (pencil pointer surface).
These are the *visual* rows only; the *functional* U rows are built. This is the one boundary this
programme must not cross.

## 13.7 Builder A's functional UI rows not yet done

- **A-U2** — complete every screen's functional states (loading / empty / error / ready / denied).
  Functional, not visual; every screen must be honest in each state. **TODO.**
- **A-U3** — guided first-run: zero → first sealed report with no further code. Overlaps Builder B's
  E8/U6; B built `GuidedFirstRun.tsx` and `create_universe`, so this needs **reconciliation** (take
  what exists, close the gap, delete any duplicate) rather than a second implementation. **TODO.**

## 13.8 The complete planned-work matrix

Everything the specification describes and that is **not** built, with its state and its dependency.
Rows marked `BUILT` are listed for completeness so the boundary of this section is unambiguous.

### Systeligon S-series — the forensic engine

| # | Task | State | Depends on |
|---|---|---|---|
| S1 | Rule schema, runner, versioning, result shape | **BUILT** | — |
| S2 | Header detection + confirm-before-count | **BUILT & wired** | — |
| S3 | The accepted-Systeligon flow | **BUILT** | S1 |
| S4 | The declined flow: floor, paste-to-fill, auto-add | **BUILT** | — |
| S5 | Mode A / Mode B verification | **BUILT** | S1 |
| S6 | Forensic rule library — one versioned module per family | **BUILT** | S1 |
| S7 | Document extraction tiers 1–3, with source hashes | **BUILT** (tier 1 wired; tiers 2–3 seams built; bundled OCR engine pending) | — |
| S8 | Structural document review rules | **BUILT** | S7 |
| S9 | Pattern rules (minutes, config, source, Power Query) | **BUILT** | S7 |
| S10 | Rule packs per audit type + adhoc rule builder | **BUILT** (UI unwired) | S1 |
| S11 | Signed OTA rule-pack distribution | **BUILT** (UI unwired) | S1 |
| S12 | Override visibility across stages | **BUILT** | S3 |
| S13 | Report writer under Systeligon | **PARTLY BUILT** — provenance done; org-format editor adoption remains | — |
| S14 | Sequential minutes: action-item register | **BUILT** | S7 |
| S15 | Policy/procedure/regulation comparison | **BUILT** | S7 |
| S16 | Name in one constants module | **BUILT** | — |
| S17 | Recognition, archive unpacking, inventory-before-import | **BUILT** | S7 |
| S18 | SIRA continuity: carry-forward pack, seed next cycle | **BUILT** | S1, C2 |
| S19 | Two-key SIRA acceptance | **BUILT** | S18 |
| S20 | Evidence storage: buckets, RLS, upload, re-derive on verify | **BUILT** | — |
| S21 | Review comment popout | **BUILT** | — |

### Continuous assurance C-series (Builder A)

| # | Task | State | Depends on |
|---|---|---|---|
| C1 | Scheduled runner: `runMonitors` per org on `pg_cron`, persist alerts, emit `watcher.signal` | **BUILT** | S1, Phase 5 |
| C2 | Alert enrichment: entity, department, SIRA risk, controls | **BUILT** | C1 |
| C3 | Delivery: Work Queue + email via `liveSync` | **BUILT** | C1 |
| C4 | Adhoc audit suggestion from an alert | **BUILT** | C2 |
| C5 | Remediation wizard from an alert | **BUILT** | C2 |
| C6 | Alert triage surface with rights gating | **BUILT** | C1 |
| C7 | Anomaly to SIRA: a resolved alert proposes an emergent risk carrying the alert id, rule version and affected rows | **Unblocked, unbuilt** | C2, S18 |

### Trust and attestation T-series (Builder B)

| # | Task | State |
|---|---|---|
| T1 | Tamper alarm on a schedule | **BUILT** (`0112`) |
| T2 | Ledger continuity check on a schedule | **BUILT** (`ledger_continuity_check`) |
| T3 | Portable attestation package | **BUILT** (`0113`) |
| T4 | Third-party verifier + procedure | **BUILT** (`scripts/verify-attestation.mjs`) |
| T5 | Attestation screen | **BUILT** |
| T6 | Guided integrity incident wizard | **BUILT** (`0114`) |
| T7 | Wire the alarm: `integrity_alerts`, notify, severity-split | **BUILT** (`0112`) |

### Interface quality U-series (functional = built; visual = deferred)

| # | Task | State |
|---|---|---|
| U1–U4, U6, U8, U14 | Drilldown, command palette, work-queue front door, activity spine, guided empty states, keyboard-first, dead dock removed | **BUILT** |
| U5 | Motion with meaning, universal `prefers-reduced-motion` | **DEFERRED** (design) |
| U7 | Density toggle, remembered per user | **DEFERRED** (design) |
| U9–U13 | Three themes, four audience profiles, day phases, motion system, animated headers | **DEFERRED** (design) |

### Capability / explain / font series (Builder B)

| # | Task | State |
|---|---|---|
| D1–D4 | Risk-control, population-evidence, process-governance, assurance-ops intelligence | **BUILT** |
| E1–E7, E9, E10 | Explain catalogue, popout, IIA data, hover cards, drilldown, standards views, gates | **BUILT** |
| E8 | `PencilGuide` + guided first-run data | **DEFERRED** (design) |
| F1–F7 | Self-hosted fonts, catalogue, subsetting, upload, auto-detect, wiring, licence gate | **BUILT** |

### Gates

| # | Gate | Owner | State |
|---|---|---|---|
| G1–G6 | Production-build E2E; no dead code; config proving tests; data-export imports; no seed+DB; RPC existence | A | **BUILT** |
| G7–G10 | Explain coverage; drilldown; IIA honesty; font licence | B | **BUILT** |
| R0 | Feature register honesty | A | **BUILT** (138 features, 58/37/43) |

### Builder A's unbuilt UI/UX rows

| # | Task | State |
|---|---|---|
| A-U1 | Pencil-style guided pointers | **DEFERRED** (design; same surface as E8) |
| A-U2 | Every screen's functional states (loading/empty/error/ready/denied) | **TODO** |
| A-U3 | Guided first-run: zero → first sealed report | **TODO** (reconcile with B's `GuidedFirstRun.tsx`) |

## 13.9 The one concrete integration hazard between the branches

This is a standing finding of this briefing. **Both branches claim the `0110`–`0116` migration-number
range.** **Verified:**

- `feature/scale-harden-v1` carries `0110_phase4_methodology`, `0111_phase5_monitor_runner`,
  `0112_phase5_alert_enrichment`, `0113_phase5_delivery`, `0114_phase5_alert_actions`,
  `0115_tenant_suspension_enforced`, `0116_phase6_workpaper_creation`, and now `0117_systeligon_rule_packs`,
  `0118_systeligon_findings`.
- `feature/systeligon-build-v1` carries `0110_sira_continuity_acceptance`, `0111_evidence_storage`,
  `0112_integrity_alarm`, `0113_attestation_package`, `0114_incident_wizard`, `0115_capability_library`,
  `0116_activity_spine`, `0117_guided_first_run`.

The namespace is shared; migrations apply by glob in filename order. When these two branches merge,
one number maps to two different files. A `git merge` of truly divergent histories would conflict on
the identical path; a squash or a regenerated tree would silently keep one and drop the other — **the
dangerous case**, because a dropped migration is a dropped feature and the SQL harness would still be
green if the surviving file happens to be valid. This must be resolved deliberately at integration
time: renumber one side above the highest used number and prove both migrations still apply in one
ordered run.

## 13.10 What the owner still has to do (not code)

From the builder briefs, restated because they are not work an agent may complete:

- **Make the repository private.** The patent-disclosure clock is running (US 12 months; UK/EU
  effectively none). This is the highest priority in the whole programme.
- Add a proprietary "all rights reserved" licence (the repository currently has none).
- Register the `systeligon` domains and run a trademark search before any public use.
- Engage patent counsel if a filing is wanted.
- Supply real connector credentials via the wizard.
- Deploy the edge functions.
- **Settle the design language** — themes, motion, typography, density, audience profiles, headers —
  so the DEFERRED visual rows (E8, U5, U7, U9–U13, A-U1) can be built once, not twice.

---

## 14. The honest position

Systeligon is now **a built rule engine with an unbuilt last mile.**

**Built and verified:** the deterministic writing engine (register-invariant graph root, the
1,200-cell proof by exhaustion); the audit engine (SIRA parity, 14 numeric checks, seeded sampling,
automation rules); the **entire `src/lib/systeligon/` rule engine — S1 through S16** (schema, runner,
append-only versioning, packs, signed OTA, the accepted/declined flows, Mode A/B verification,
override visibility, the numeric/structural/pattern/sequential rule families, minutes tracking,
policy comparison, and the single-name module); header detection wired into the population flow;
findings-to-report provenance inside the tamper-evident root; document recognition with archive-bomb
and traversal limits; SIRA continuity and two-key acceptance; evidence storage with real bytes; the
attestation package and an independent third-party verifier; the incident wizard and the tamper alarm;
the deterministic capability library; the explain layer; the functional interface rows; self-hosted
fonts; the Phase 1–6 repair that makes the app read its own database, proven by a production-build
test; and thirteen anti-theatre gates.

**Planned and unwritten:** the engine's screens (the rule-run screen that records findings, the
rule-pack and ad-hoc-rule management UI); the bundled OCR engine as a shipped artifact; the org-format
editor adoption half of S13; **C7** (anomaly to SIRA, now unblocked); **A-U2** (every screen's
functional states); **A-U3** (guided first-run to a sealed report, reconciled with B's work); and the
deliberately deferred **visual** design rows.

**The difference matters, and it is the point.** An earlier edition of this briefing described the
S1–S16 engine as a specification and unwritten. That edition was itself an example of the defect the
project exists to catch: it described a state of the code that had already changed. This edition says
what the previous one should have: the engine is built and gated, and what remains is the wiring of
its surfaces, one orchestration feature (C7), two functional UI rows, and a design language the owner
has not yet settled.

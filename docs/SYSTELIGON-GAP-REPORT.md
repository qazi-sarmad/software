# Provio / Systeligon — external review briefing

**For:** an independent reviewer who has not seen this repository before.
**Date:** 2026-10-29.
**Subject:** what Provio is, what was wrong with it, what has been built, and — stated as plainly as
everything else — what is still only planned.

---

## 0. Names, scope, and how to read this

**The product is Provio** — a deterministic internal-audit and forensic assurance platform.

**Systeligon** is the owner's name for the deterministic forensic engine inside it, and the name of
the branch that carries its build. The engine is a rule engine, not a model: every finding names its
rule, its version, and its source rows, and re-runs identically forever. That reproducibility is the
product. It is the reason the engine is *better* than a language model for numeric and structural
forensics, and the reason it cannot do semantic judgement at all.

**The boundary, stated once here and never blurred below.** The engine CANNOT judge whether a decision
was wise, whether code is correct in intent, or whether a minute reflects good governance — at any
level of effort. It finds the *shape* of a problem and shows the evidence; a human decides what the
shape means. It must never be described as a model, and no doc, UI string or commit message may imply
comprehension. A rule engine sold as AI is the same class of lie as a config panel that saves a value
nothing reads.

**Branches verified for this briefing** (short SHA in parentheses):

| Branch | Head | What it is |
|---|---|---|
| `main` | `a697190` | The untouched default branch. Still carries the headline defect (§1). |
| `feature/scale-harden-v1` | `fc0ccda` | Builder A: remediation Phases 1–6, the C-series (C1–C6), gates G1–G6. |
| `feature/systeligon-build-v1` | `51c4156` | Builder B: the explain layer (E, U), Systeligon S17–S21, T3–T7, D1–D4, fonts (F), gates G7–G10. |
| `feature/writing-engine` | `c45bb81` | The deterministic report-writing engine (merged into both builder branches). |

**How to read this.** Every figure marked **verified** I reproduced against the repository in this
session, with the command named. Figures that come from a builder's ledger and that I did not
reproduce are marked **reported**. This distinction is not pedantry. The single most serious problem
in this codebase was never a bug — it was that the documents describing the code were wrong. This
report separates *built* from *planned* in every section, because conflating the two is precisely the
failure it documents. Where the audit's historical numbers and the numbers I measured disagree, I
give both and I say so.

**Source of truth in this repository** (verified present):

| Document | Role |
|---|---|
| `docs/SPEC-v10.md` | The authoritative product specification. |
| `docs/SYSTELIGON.md` | The forensic engine spec (1,245 lines). Authoritative for §13 below. |
| `docs/SYSTELIGON-TASKS.md` | Builder B's live ledger. Starts at S17. |
| `docs/SCALE-TASKS.md` | Builder A's live ledger. Phases 1–6 and the C-series. |
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
   three values — `Wired`, `Inert`, `Absent` — and **verified** the register contains 54 `Wired`, 31
   `Inert`, 46 `Absent`, and **no `Partial`**.
2. **Tests cited as proof of function.** The suite was green and "structurally incapable of catching
   the integration gaps, because the integration is exactly what it stubs out." Green tests were used
   as a proxy for a working product. They are not that.
3. **Documents treated as evidence.** Every later document was written by reading the previous
   document rather than the code, so errors propagated. The audit found its own successor document
   had done this.

The 63 documents were not deleted. They were archived under a stale banner
("⚠️ STALE — ARCHIVED, DO NOT TRUST") — **verified: 63 files under `docs/archive/`** on
`feature/scale-harden-v1` — preserved deliberately, because the failure mode is the one most likely
to recur.

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

Branch `feature/writing-engine` (`c45bb81`), 2026-10-26/27. **Verified:** 47 files under
`src/lib/writing/` (19 of them tests) on the branch, **6,224 lines** of non-test source. On
`feature/scale-harden-v1` (**verified**) the directory holds **82 files**, **43 non-test modules**,
**8,795 lines** of non-test source. Every module is a pure function of its arguments. No AI, no
model, no embedding, no generated free text.

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
  `checkSiraVsPlanning`, `checkControlsVsTests` (plus `raiseFindingIntent` /
  `createObservationStub`). Every result row carries the references it flagged. The last two audit the
  audit.
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

## 9. Systeligon — the S-series, S17–S21 (built)

Branch `feature/systeligon-build-v1` (`51c4156`). **Verified:** the ledger
`docs/SYSTELIGON-TASKS.md` records **47 `DONE`**, **12 `DEFERRED`**, **zero `Partial`**. The built
S-rows begin at S17:

- **S17 — recognition.** `src/lib/recognition/` (**verified present**: `sniff.ts`, `archive.ts`,
  `metadata.ts`, `zipReader.ts`, `index.ts` + tests): magic-byte signatures (PDF/PNG/GIF/JPEG/TIFF/
  ZIP/RAR/7z/gzip/OLE2); OOXML resolved to docx/xlsx/pptx by entry name; `recognise()` returns
  `{kind, claimed, agrees, detail}` so a name that lies is reported, not obeyed. `unpackArchive`
  enforces max entries, safe paths (no absolute, no `..`, no drive/UNC), per-member and total size,
  compression ratio — then re-checks the actual inflated size, because a header can lie. On RAR: no
  library, licence-restricted decompressor, so a `.rar` is recognised exactly and reported as an
  archive whose members cannot be listed, with the reason — never silently dropped, never guessed at.
*(**Reported**: 48 unit tests.)*
- **S18/S19 — SIRA continuity and two-key acceptance.** Migration
  `0110_sira_continuity_acceptance.sql` (**verified present**). On publish, a carry-forward pack
  records prior score, band, movement, findings, failed controls, accepted emergent risks; the next
  cycle is seeded from it with provenance. `propose_emergent_risks` proposes from open findings; a
  human accepts or rejects with a mandatory reason, idempotently. Two-key: the finaliser's decision is
  an endorsement, not a closure — a different auditor holding `review_and_approve` must accept.
  Publication is blocked while proposals are outstanding; silence is itself a finding.
- **S20 — evidence storage**, called by the audit "the most serious gap found." Migration
  `0111_evidence_storage.sql` (**verified present**). Four private buckets with RLS on
  `storage.objects` keyed to `jwt_org_id()` by path prefix; `register_evidence_file` re-checks right,
  seal, size, org prefix and writes row then ledger; `verify_evidence_file` re-derives, raises an
  alert on mismatch, records `no_stored_bytes` when there is nothing to verify. Order is bytes → row
  → ledger, never the reverse. Where no bucket is wired the tab says "session only."
- **S21 — review comment popout.** The pure `commentPopout` model refuses a configuration-only
  principal and an observer, returning `status: 'redacted'` with a reason and `text: null` — it never
  returns nothing and never leaks the body (L2). The dead `ReviewCommentsDock.tsx` deleted.

## 10. Systeligon — the T-series, trust and attestation (built)

The cryptographic spine existed; missing was a portable artifact an outsider could check without our
code. All artifacts below are **verified present** on `feature/systeligon-build-v1`:

- `supabase/migrations/0113_attestation_package.sql` adds `report_claims.leaf_hash` and redefines
  `report_graph_commit` to record it — the gap that made the root un-re-foldable off-database.
- `src/lib/attestation.ts` — pure package model. Only hashes, signatures, public keys, timestamps,
  version ids (L2). `verifyAttestationPackage` re-derives the root, re-folds the leaves, verifies
  every Ed25519 signature, returns a verdict — never throws.
- `scripts/verify-attestation.mjs` — the standalone third-party verifier, importing only
  `node:crypto` / `node:fs`, rebuilding the SPKI from the raw 32-byte key. Exit 0 passes, 1 fails,
  each step printed.
- `docs/ATTESTATION-VERIFICATION.md` — the published procedure. A test enforces that both verifiers
  are the same procedure: builds a package in-product, runs the standalone script as a separate Node
  process, and both must agree on a good package and on a tampered one.
- **T6 — incident wizard.** `0114_incident_wizard.sql`. `integrity_incidents` immutable
  (select-only); `integrity_incident_actions` append-only with a trigger refusing UPDATE/DELETE — the
  STATUS is DERIVED from the trail, never stored and mutated. `integrity_incident_outcome` is
  deterministic: restore compares to what was sealed (`restored` / `still_mismatched` /
  `no_sealed_copy` / `not_applicable` — no bytes are conjured). Every action requires a reason; the
  incident closes on proof.
- **T7 — the alarm.** `0112_integrity_alarm.sql`. `listIntegrityAlerts()` had zero callers; a tamper
  was recorded in a table nobody reads. Now: severity as data — ledger chain / signature / timestamp =
  incident; single object = warning — fanning out to in-app, email, and an automation event. Plus
  `ledger_continuity_check()`, which reaches the previously-uncalled `verify_ledger`.

## 11. Systeligon — D-series, E-series, U functional, F-series (built)

All **verified present** on `feature/systeligon-build-v1` unless noted.

- **D-series** — `src/lib/capabilities/` (`riskControl.ts`, `populationEvidence.ts`,
  `processGovernance.ts`, `assuranceOps.ts`, `index.ts` + tests): 20 pure capabilities across four
  families under one uniform evaluator `evaluateCapability` so no capability can be added and left
  unreachable. The evaluator is total: it distinguishes `ready` (findings), `empty` (an honest clean
  result) and `awaiting_input` (naming the exact missing input) — never showing an empty result as a
  clean bill of health. Migration `0115_capability_library.sql`.
- **E-series** — the explain layer: `src/lib/explain/` (`catalogue.ts`, `iia.ts`,
  `standardsSurfaces.ts`, `entries.{fields,methods,screens}.ts`, `types.ts` + tests).
  `explainFor(user, id, context)` with redaction and an L2 guard test; a non-blocking popout on
  `role="tooltip"` / `complementary`; IIA standards as data mapped to real screens and RPCs (source:
  `docs/iia-standards-reference.md`); drilldown from every aggregate (deep-linkable, no blocking
  modal); gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty).
- **U-series** — functional rows only (**verified**: `docs/SYSTELIGON-TASKS.md` marks U1–U4, U6, U8,
  U14 `DONE`; U5, U7, U9–U13 `DEFERRED`): U1 drilldown, U2 command palette, U3 work queue as front
  door, U4 live activity spine (`0116_activity_spine.sql`), U6 guided empty states
  (`0117_guided_first_run.sql`; `create_universe(name, domain)` closes the "new org is stuck" gap —
  `src/data/mutations.ts:40`), U8 keyboard-first, U14 dead dock deleted.
- **F-series** — fonts: `src/lib/fonts/` (`catalogue.ts`, `detect.ts`, `loader.ts` + tests). The
  Google Fonts CDN link was removed (it leaked every client's IP and broke offline). Self-hosted
  catalogue, per-font licence metadata, org upload with acknowledgement, auto-detection from
  DOCX/PPTX, and gate G10: no bundled font without licence metadata and a redistributable flag.

## 12. The repair — Phases 1–6 (built)

Branch `feature/scale-harden-v1` (`fc0ccda`). **Verified** migrations `0100`–`0106` (Phase 1
write paths; Phase 2 lifecycle, pre-flight gate, report graph, row seeding, sampling methods, value
coverage) are present on `feature/systeligon-v1` and carried forward.

**The app now reads its own database.** `src/data/tenant.ts` exists (**verified**); it calls the
Supabase client. The shell's source is now the database when a project is configured — **verified**
in `src/App.tsx` on the branch:

```ts
const loadDemoSeed = !hasSupabaseConfig() && import.meta.env.DEV
  ? () => import('./data/demoSeed').then((m) => m.demoSeed)
  : null;
const useDatabase = hasSupabaseConfig();
```

When `useDatabase`, the shell calls `loadTenantSnapshot()` and falls back to `EMPTY_SEED` on failure,
never hanging on a spinner. The parallel in-memory mutations were converted to real RPC calls.

**And the test that proves it is the right test.** `e2e/phase1-production-build.spec.ts`
(**verified**) runs ONLY against the production bundle (`E2E_PROD=1`, served by `vite preview`), signs
in, and asserts a database row created by `global-setup.ts` ("Phase 1 production-build probe (Test)")
appears on screen — a title the demo seed does not contain. **Verified** in `playwright.config.ts` on
the branch: with `E2E_PROD=1` the web server is `npm run build && npm run preview`; without it,
`npm run dev`. That one test would have caught the headline defect.

**The lifecycle is real.** `set_engagement_stage(p_engagement_id, p_to_stage, p_expected_stage)` —
append-only transition log, rights checks, stage guards, `expected_stage` for optimistic concurrency.
`signoff_role_*` and `testing_mode` now enforced. `runPreflight` wired into `freeze_report`. The graph
root is persisted.

**The software now audits itself.** Five anti-theatre gates refuse the build when the codebase lies
about itself (**reported** from `docs/SCALE-TASKS.md`): G2 no dead code (533 fns, 39 allow-listed),
G3 every config field has a proving test (50 rows, 41 ENFORCED), G4 every `src/data` export is
imported (17 allow-listed, 28 test-only), G5 no component reading both seed and database (0
allow-listed), G6 every RPC the UI calls exists (116 RPCs, 10 service-only). Each was designed from a
specific audit finding — G5 is the two-UIs problem, G3 the inert settings, G2 the uncalled functions.
Plus G7–G10 on Builder B.

**Counts — verified this session** (`git ls-tree -r`):

| Metric | `main` | `scale-harden-v1` | `systeligon-build-v1` | `writing-engine` |
|---|---|---|---|---|
| Migrations | 87 | 116 | 114 | 94 |
| SQL test files | 92 | 121 | 118 | 97 |
| Vitest files | 144 | 215 | 255 | 164 |
| Playwright specs | 25 | 30 | 30 | 25 |
| Guards | 18 | 22 | 26 | 19 |

---

# PART THREE — Planned, not built

This is the section earlier drafts of this briefing omitted, and its omission is the same defect
class the whole report documents. **The specification (`docs/SYSTELIGON.md`, 1,245 lines) is a
buildable specification. Large parts of it are planned and unwritten.** Nothing below is built
unless stated. Every claim here was checked by looking for the file, the directory, the migration and
the caller.

## 13.1 The forensic rule engine — absent, and it is the shell of the whole thing

**Verified absent on every branch:**

- `src/lib/systeligon/` — does not exist on any branch (`git ls-tree -r <branch> | grep lib/systeligon/`
  → nothing, on every remote branch).
- No `rules/` directory anywhere in the repository (`grep -cE "rules/.*\.ts"` → 0 on every branch). No
  rule schema, no runner, no versioning, no result shape, no rule packs, no ad-hoc rule builder, no
  OTA distribution.

The specification's own §13 work-package table lists these as S1, S3, S5, S6, S10, S11, S12. The
ledger starts at S17. **The S1–S16 rows are not in the ledger at all.** They were planned in the
specification and never begun.

## 13.2 Document extraction tiers — tier 1 partial and unwired, tiers 2–3 absent

**Verified:**

- **OCR is not built, anywhere.** `git ls-tree -r <any branch> | grep -iE "ocr|tesseract"` → nothing;
  `package.json` → no OCR dependency on any branch. It is tier 2 of the three-tier design in
  `docs/SYSTELIGON.md` §5, whose own words are: *"OCR (lazy-loaded, bundled). Only for scans and
  images with no text layer… The engine is bundled, not called — nothing leaves the tenant."* Written
  as a plan. Never implemented.
- **Tier 1 is partial and unwired.** `docxImport.ts` (mammoth), `xlsx`, `pdf-lib` exist. But
  `extractDocument` is **F43 → `Inert`** in `docs/FEATURE-REGISTER.md` (**verified**, line 120): *"the
  doc-extract function is deployed but unreachable from the UI."* **Verified** its only callers on
  `scale-harden-v1` are `src/lib/docExtractHandler.test.ts`.
- **Tier 3 (structured extraction) does not exist** — no declared-parser modules, no source-hash
  field on extraction output.

## 13.3 §3.1 numeric forensics — real, but not as a versioned rule library

The forensic capability partly exists — **verified in `analyticsEngine.ts` (432 lines, 14 checks)**,
not as a Systeligon rule library. So the numeric forensics are real and tested. They are **not
versioned rules with provenance, not in packs, not OTA-distributable, and not runnable by a client as
a rulebook on day one** — which is exactly what S1, S6, S10 and S11 exist to provide.

## 13.4 §3.3 sequential-document forensics — absent

**Verified absent:** no minutes parser, no action-item register, no policy-vs-procedure comparison, no
cross-document contradiction detection. These are S8, S9, S14, S15.

## 13.5 Header detection — the assumption is unchanged

`docs/SYSTELIGON.md` §2.1 says: *"today it assumes row 1 is the header. The engine must instead
detect, propose, and confirm."* **Verified** — `src/lib/population.ts:94` on `scale-harden-v1` is
still `const [header, ...body] = table;`. The assumption is unchanged. That is S2.

## 13.6 Continuous monitoring — the runner is closed on A, the library is real

**Verified:** `src/lib/writing/monitors.ts` (291 lines, six kinds, pure, window and time as
arguments) is real. Builder A's ledger marks **C1–C6 `DONE`** and C7 `BLOCKED (S18)`. The earlier
statement that "`rule_engine_process` had zero callers and no engine drives it" is now **stale** —
C1 (`0111_phase5_monitor_runner.sql`, a `pg_cron` job calling `monitor_runner_sweep`) closes it on
Builder A's branch. C7 is genuinely blocked on S18, which Builder B has since completed, so C7 is
unblocked-but-unbuilt.

## 13.7 Report writer and provenance — partial

S13 (org format adoption + font/colour auto-detect + generated elements + findings-to-report
provenance) is **partial**. **Verified:** F39 (findings-to-report provenance) is `Absent` in the
register and attributed to S13. F5/F6 (font and colour auto-detect from DOCX/PPTX, wired into the org
report format) are marked `DONE` on Builder B.

## 13.8 The deferred visual work — deliberately not started

The owner has not settled the design language. Building on an unsettled design means rebuilding it.
**Verified** `DEFERRED` rows: E8 (pencil guide), U5 (motion), U7 (density), U9–U13 (themes, audience
profiles, time-of-day phases, motion system, animated headers). These are the *visual* rows only. The
*functional* U rows are built.

## 13.9 The complete planned-work matrix

Everything the specification describes and that is **not** built, with its state and its dependency.
Rows marked `BUILT` are listed for completeness so the boundary of this section is unambiguous.

### Systeligon S-series — the forensic engine

| # | Task | State | Depends on |
|---|---|---|---|
| S1 | `src/lib/systeligon/` — rule schema, runner, versioning, result shape | **Absent** | — |
| S2 | Header detection + confirm-before-count in the population flow | **Absent** | — |
| S3 | The accepted-Systeligon flow (flag → rows → evidence → verify → revert/override) | **Absent** | S1 |
| S4 | The declined flow: floor, paste-to-fill, auto-add rows beyond the floor, package evidence | **Absent** | — |
| S5 | Mode A / Mode B verification, org-configurable | **Absent** | S1 |
| S6 | Forensic rule library (§3.1) — one pure module per family, each versioned and tested | **Absent** as rule library (numeric checks exist in `analyticsEngine.ts`) | S1 |
| S7 | Document extraction tiers 1–3, with source hashes | **Tier 1 partial & inert**; tiers 2–3 absent | — |
| S8 | Structural document review rules (§3.2) | **Absent** | S7 |
| S9 | Pattern rules for minutes, config, source and Power Query (§3.3) | **Absent** | S7 |
| S10 | Rule packs per audit type + adhoc rule builder | **Absent** | S1 |
| S11 | Signed OTA rule-pack distribution | **Absent** | S1 |
| S12 | Override visibility: an override at one stage is shown to the reviewer at the next | **Absent** | S3 |
| S13 | Report writer under Systeligon: org format adoption + font/colour auto-detect + generated elements + findings-to-report provenance | **Partial** | — |
| S14 | Sequential minutes: action-item register, carry-forward, vanish, reopen, close-without-evidence | **Absent** | S7 |
| S15 | Policy / procedure / regulation comparison, with coverage reporting | **Absent** | S7 |
| S16 | Name held in one constants module so a rename is one commit | **Absent** | — |
| S17 | Document recognition, archive unpacking, office-in-zip, metadata, inventory-before-import | **BUILT** | S7 |
| S18 | SIRA continuity: carry-forward pack, seed next cycle, anomalies propose emergent risk | **BUILT** | S1, C2 |
| S19 | Two-key SIRA acceptance | **BUILT** | S18 |
| S20 | Evidence storage: buckets, RLS, `storage_path`, upload, re-derive on verify | **BUILT** | — |
| S21 | Review comment popout: testids, states, inventory, hover popout, drilldown, delete the dead dock | **BUILT** | — |

### Continuous assurance C-series (Builder A)

| # | Task | State | Depends on |
|---|---|---|---|
| C1 | Scheduled runner: `runMonitors` per org on `pg_cron`, persist alerts, emit `watcher.signal` | **BUILT** (`0111_phase5_monitor_runner.sql`) | S1, Phase 5 |
| C2 | Alert enrichment: entity, department, SIRA risk, inherent + residual risk, controls | **BUILT** (`0112`) | C1 |
| C3 | Delivery: Work Queue in-app + email, via `liveSync` | **BUILT** (`0113`) | C1 |
| C4 | Adhoc audit suggestion from an alert, pre-filled | **BUILT** (`0114`) | C2 |
| C5 | Remediation wizard from an alert | **BUILT** (`0114`) | C2 |
| C6 | Alert triage surface with rights gating | **BUILT** (`0114`) | C1 |
| C7 | Anomaly to SIRA: a resolved alert proposes an emergent risk carrying the alert id, rule version and affected rows | **Unblocked, unbuilt** (was `BLOCKED (S18)`; S18 now built) | C2, S18 |

### Trust and attestation T-series (Builder B)

| # | Task | State | Depends on |
|---|---|---|---|
| T1 | Tamper alarm: verify roots on a schedule, raise a signal on signature/timestamp failure | **Partly built** — `ledger_continuity_check()` + severity fan-out landed under T7 (`0112`) | — |
| T2 | Ledger continuity check on a schedule | **Built** as `ledger_continuity_check()` (T7) | — |
| T3 | Portable attestation package | **BUILT** (`0113`) | T1 |
| T4 | Third-party verifier: documented procedure + independent tooling | **BUILT** (`scripts/verify-attestation.mjs`, `docs/ATTESTATION-VERIFICATION.md`) | T3 |
| T5 | Attestation screen: view, export, verify | **BUILT** (`AttestationPanel.tsx`) | T3 |
| T6 | Guided integrity incident wizard | **BUILT** (`0114`) | T1 |
| T7 | Wire the existing alarm: surface `integrity_alerts`, notify, severity-split | **BUILT** (`0112`) | T1 |

### Interface quality U-series (functional = Builder B; visual = deferred)

| # | Task | State |
|---|---|---|
| U1 | Drilldown from every dashboard number to its exact filtered records | **BUILT** |
| U2 | Command palette (Cmd/Ctrl-K) | **BUILT** |
| U3 | Work queue as the front door | **BUILT** |
| U4 | Live activity spine on the existing `liveSync` transport | **BUILT** |
| U5 | Motion with meaning, universal `prefers-reduced-motion` | **DEFERRED** (design) |
| U6 | Guided empty states for a new org | **BUILT** |
| U7 | Density toggle, remembered per user | **DEFERRED** (design) |
| U8 | Keyboard-first: every action reachable, `?` shortcut sheet | **BUILT** |
| U9 | Three new themes (`prism`, `bloom`, `slate`) | **DEFERRED** |
| U10 | Four audience profiles | **DEFERRED** |
| U11 | Time-of-day phases: `resolveDayPhase(minuteOfDay)` | **DEFERRED** |
| U12 | Motion system: four levels, ten named animations, gates | **DEFERRED** |
| U13 | Animated headers: token-driven gradient | **DEFERRED** |
| U14 | Dead comment dock removed | **BUILT** (same as S21) |

### Deterministic capability library D-series (Builder B)

| # | Task | State |
|---|---|---|
| D1 | Risk and control intelligence | **BUILT** (`src/lib/capabilities/riskControl.ts`) |
| D2 | Population and evidence intelligence | **BUILT** (`populationEvidence.ts`) |
| D3 | Process and governance intelligence | **BUILT** (`processGovernance.ts`) |
| D4 | Assurance operations | **BUILT** (`assuranceOps.ts`) |

### Explain layer E-series and fonts F-series (Builder B)

| # | Task | State |
|---|---|---|
| E1 | `src/lib/explain/catalogue.ts` — schema, `explainFor`, redaction, L2 guard | **BUILT** |
| E2 | `ExplainPopout` + `useExplain`, non-blocking, a11y | **BUILT** |
| E3 | `src/lib/explain/iia.ts` — standards as data | **BUILT** |
| E4 | Hover cards + detail panels across methods, fields, statuses, terms | **BUILT** |
| E5 | Drilldown from every aggregate; deep-linkable | **BUILT** |
| E6 | Standards affordance on screens, lifecycle steps, report sections | **BUILT** |
| E7 | Standards view (catalogue → implementation → evidence) | **BUILT** |
| E8 | `PencilGuide` + guidance data for guided first-run | **DEFERRED** (design) |
| E9 | Gates G7, G8, G9 + tests | **BUILT** |
| E10 | `UI-INVENTORY.md` extend with explain ids, standards, drilldown targets | **BUILT** |
| F1 | Remove the Google Fonts CDN link; self-host Inter, Source Serif 4, JetBrains Mono | **BUILT** |
| F2 | `src/lib/fonts/` — catalogue, licence metadata, lazy loader | **BUILT** |
| F3 | Curate and subset the bundled font repository | **BUILT** |
| F4 | Org font upload via `branding_assets` with licence acknowledgement | **BUILT** |
| F5 | Font/colour/theme auto-detection from DOCX and PPTX | **BUILT** |
| F6 | Wire detection into the org report format | **BUILT** |
| F7 | Gate G10 — no bundled font without licence metadata | **BUILT** |

### Gates

| # | Gate | Owner | State |
|---|---|---|---|
| G1 | Production-build E2E | A | **BUILT** (`E2E_PROD=1`); ledger `SCALE-TASKS.md` UI section still shows a stale `TODO` |
| G2 | No dead code | A | **BUILT** |
| G3 | Every config field has a proving test | A | **BUILT** |
| G4 | Every `src/data` export is imported | A | **BUILT** |
| G5 | No component reading both seed and database | A | **BUILT** |
| G6 | Every RPC the UI calls exists | A | **BUILT** |
| G7 | Explain coverage | B | **BUILT** |
| G8 | Drilldown | B | **BUILT** |
| G9 | IIA honesty | B | **BUILT** |
| G10 | Font licence | B | **BUILT** |

### Unbuilt rows outside Systeligon (Builder A's UI/UX section, `SCALE-TASKS.md`)

| # | Task | State |
|---|---|---|
| A-U1 | Pencil-style guided pointers (hand-drawn feel) on every flow | **TODO** (same surface as E8; deferred pending design) |
| A-U2 | Complete every screen's functional states (loading/empty/error/ready/denied) | **TODO** |
| A-U3 | Guided first-run: zero → first sealed report with no further code | **TODO** (overlaps Builder B's E8/U6; B built `GuidedFirstRun.tsx` — needs reconciliation) |

## 13.10 The one concrete integration hazard between the branches

This is a finding of this briefing, not of the ledger. **Both branches claim the `0110`–`0116`
migration-number range.** **Verified:**

- `feature/scale-harden-v1` carries `0110_phase4_methodology`, `0111_phase5_monitor_runner`,
  `0112_phase5_alert_enrichment`, `0113_phase5_delivery`, `0114_phase5_alert_actions`,
  `0115_tenant_suspension_enforced`, `0116_phase6_workpaper_creation`.
- `feature/systeligon-build-v1` carries `0110_sira_continuity_acceptance`, `0111_evidence_storage`,
  `0112_integrity_alarm`, `0113_attestation_package`, `0114_incident_wizard`,
  `0115_capability_library`, `0116_activity_spine`, `0117_guided_first_run`.

The namespace is shared; migrations apply by glob in filename order. When these two branches merge,
one number maps to two different files. Whether Git reports a conflict depends on the merge strategy:
a `git merge` of truly divergent histories would conflict on the identical path (e.g. `0111_*.sql`);
a squash or a regenerated tree would silently keep one and drop the other — **the dangerous case**,
because a dropped migration is a dropped feature and the SQL harness would still be green if the
surviving file happens to be valid. This must be resolved deliberately at integration time:
renumber one side above `0117` and prove both migrations still apply in one ordered run.

Also **verified stale/hazardous**: the "migration reservation" section of
`docs/SYSTELIGON-TASKS.md` instructs Builder B to start at `0110` — the exact range Builder A
subsequently used. The reservation was written before Builder A advanced into `0110`+. It is now
wrong.

## 13.11 What the owner still has to do (not code)

From the builder briefs, restated because they are not work an agent may complete:

- **Make the repository private.** The patent-disclosure clock is running (US 12 months; UK/EU
  effectively none). This is the highest priority in the whole programme.
- Add a proprietary "all rights reserved" licence (the repository currently has none).
- Register the `systeligon` domains and run a trademark search before any public use.
- Engage patent counsel if a filing is wanted.
- Supply real connector credentials via the wizard.
- Deploy the edge functions.

---

## 14. The honest position

Systeligon today is **a specification with a substantial built part and a substantial unbuilt part.**

**Built and verified:** the writing engine (deterministic, register-invariant graph root, 1,200-cell
proof by exhaustion); the audit engine (SIRA parity, 14 numeric checks, seeded sampling, automation
rules); document recognition with archive-bomb and traversal limits; SIRA continuity and two-key
acceptance; evidence storage with real bytes; the attestation package and an independent third-party
verifier; the incident wizard and the tamper alarm; the deterministic capability library; the explain
layer; the functional interface rows; self-hosted fonts; the Phase 1–6 repair that makes the app read
its own database, proven by a production-build test; and ten anti-theatre gates.

**Planned and unwritten:** the entire `src/lib/systeligon/` rule engine — schema, runner, versioning,
result shape; versioned forensic rules; rule packs; the ad-hoc rule builder; signed OTA rule-pack
distribution; override visibility across stages; document extraction tiers 2–3 and the wiring of tier
1; structural document review; sequential-minutes action tracking; policy/procedure/regulation
comparison; header detection and confirm-before-count; the last third of the report writer.

**The difference matters, and it is the point.** The sixteen S-rows from S1 to S16 are the machinery
that would make the engine forensic-grade and defensible to a client on day one — versioned rules,
packs, signed distribution, minutes tracking, policy comparison. Recognition, evidence storage,
attestation and SIRA continuity are real and verified. The rule engine that sits at the centre is
designed and unwritten.

An earlier briefing conflated the specification with the product. That is the exact defect the whole
project exists to catch, and it is why this version states built and planned in two separate parts
with a verifiable command behind every figure.

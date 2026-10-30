# Provio / Systeligon — external review briefing

**For:** an independent reviewer who has not seen this repository before.
**Date:** 2026-10-29 (regenerated again — the previous edition understated the build in both
directions: it described surfaces as unbuilt that are built, and it did not report that several
`FEATURE-REGISTER.md` rows are stale in the *understating* direction. This edition corrects both, and
records the L2 rule-pack surface as built. It states the new picture.)

**Subject:** what Provio is, what was wrong with it, what has been built, and — stated as plainly as
everything else — what is still only planned.

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
| `feature/scale-harden-v1` | `0b14629` | Builder A's continuous build. Remediation Phases 1–6, the C-series (C1–C6), the **entire Systeligon S1–S16 rule engine**, gates G1–G6. |
| `feature/systeligon-build-v1` | `51c4156` | Builder B: the explain layer (E, U), Systeligon S17–S21, T3–T7, D1–D4, fonts (F), gates G7–G10. |
| `feature/writing-engine` | `c45bb81` | The deterministic report-writing engine (merged into both builder branches). |
| `feature/systeligon-unified-v1` | `ceb85fd` | The A+B reconciliation branch: one migration set, the collision resolved (§13.9). |
| `feature/systeligon-builder-continuous` | `385c550` | **This branch.** The unified set plus the team directory (U4), the first screen that mounts the S1–S16 engine (L1), and the rule-pack management surface (L2, this session). |

**How to read this.** Every figure marked **verified** I reproduced against the repository in this
session, with the command named. Figures that come from a builder's ledger and that I did not
reproduce are marked **reported**. This distinction is not pedantry. The single most serious problem
in this codebase was never a bug — it was that the documents describing the code were wrong. This
report separates *built* from *planned* in every section, because conflating the two is precisely the
failure it documents. Where an earlier edition's numbers and the numbers I measured disagree, I give
both and I say so.

**The correction this edition carries — in both directions.**

1. The previous edition was written before the L1 rule-run screen existed and described the engine's
   surfaces as unbuilt. On this branch **the rule-run screen is mounted** (`RuleRunTab.tsx`, §10), **the
   rule-pack management surface is mounted** (`RulePackPanel.tsx`, §10) and the register rows
   **F127–F138 exist** (verified: `check-feature-register` reports **138 features: 94 `Wired`, 27
   `Inert`, 17 `Absent`**, exit 0).
2. The previous edition did not report the *opposite* staleness, which is the more dangerous kind:
   several `FEATURE-REGISTER.md` rows still said `Absent` or `Inert` for features that are **built and
   wired on this branch** — **F28/F29** (procedure and test-step templates), **F39** (findings-to-report
   provenance), and the C-series **F53/F54/F55** (alert enrichment, ad-hoc suggestion, triage). This
   edition **corrects those six rows** to `Wired` against their real call sites (§13.11), so the register
   no longer understates the build. A register that understates is the same defect class as one that
   overstates: a document that does not match the code.

**Source of truth in this repository** (verified present):

| Document | Role |
|---|---|
| `docs/SPEC-v10.md` | The authoritative product specification. |
| `docs/SYSTELIGON.md` | The forensic engine spec. Authoritative for §13 below. |
| `docs/SYSTELIGON-TASKS.md` | Builder B's live ledger. Starts at S17. |
| `docs/SCALE-TASKS.md` | The live ledger — Phases 1–6, the C-series, the S1–S16 build, UI/UX. |
| `docs/FEATURE-REGISTER.md` | Every feature with its wiring state, gated by a script. |
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
seed array is empty. **Nothing hydrated the shell from the database**: `AppContext`, which feeds every
screen, had zero calls to the Supabase client. The product had no code path that could display real
tenant data. It looked complete. It was a demonstration.

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
   three values — `Wired`, `Inert`, `Absent` — and **verified this session** contains **94 `Wired`,
   27 `Inert`, 17 `Absent`** and **no `Partial`**.
2. **Tests cited as proof of function.** The suite was green and "structurally incapable of catching
   the integration gaps, because the integration is exactly what it stubs out." Green tests were used
   as a proxy for a working product. They are not that.
3. **Documents treated as evidence.** Every later document was written by reading the previous
   document rather than the code, so errors propagated. The audit found its own successor document
   had done this — and the previous edition of *this* report did it too, describing built surfaces as
   unbuilt. That is the correction this edition carries.

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

Branch `feature/writing-engine` (`c45bb81`). Every module is a pure function of its arguments. No AI,
no model, no embedding, no generated free text.

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
- **`siraEngine.ts`** — deterministic scoring, four aggregations (`weighted_sum`, `maximum`,
  `weighted_average`, `weighted_average_floor`), the exact mirror of SQL `public.sira_compute`, with
  a parity test running the same fixtures through both.
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
- **`automationRules.ts`** + `0056_automation_engine.sql` — conditions and actions as data. Loop guard
  (an action cannot trigger its own rule) and a rate limit (>20 events per rule per hour auto-pauses
  with a notice). "It never sends anything itself."
- **Monitor rules** — `src/lib/writing/monitors.ts` (**verified 291 lines**), six kinds (threshold,
  rate, sequence, set membership, missing event, reconciliation), window and time as arguments,
  emitting `watcher.signal`. Rules ship as drafts; release needs a qualified human.

The shared ethic: the machine proposes and the human decides; an unknown is never converted to a zero;
sampling is reproducible; automation cannot loop.

## 9. Systeligon — the S-series, S17–S21 (built by Builder B)

Branch `feature/systeligon-build-v1` (`51c4156`). The built S-rows begin at S17:

- **S17 — recognition.** `src/lib/recognition/` (`sniff.ts`, `metadata.ts`, `archive.ts`,
  `zipReader.ts`): magic-byte signatures (PDF/PNG/GIF/JPEG/TIFF/ZIP/RAR/7z/gzip/OLE2); OOXML resolved
  to docx/xlsx/pptx by entry name; `recognise()` returns `{kind, claimed, agrees, detail}` so a name
  that lies is reported, not obeyed. `unpackArchive` enforces max entries, safe paths (no absolute, no
  `..`, no drive/UNC), per-member and total size, compression ratio — then re-checks the actual
  inflated size, because a header can lie. On RAR: no library, licence-restricted decompressor, so a
  `.rar` is recognised exactly and reported as an archive whose members cannot be listed, with the
  reason — never silently dropped, never guessed at.
- **S18/S19 — SIRA continuity and two-key acceptance.** Migration `0119_sira_continuity_acceptance.sql`.
  On publish, a carry-forward pack records prior score, band, movement, findings, failed controls,
  accepted emergent risks; the next cycle is seeded from it with provenance. `propose_emergent_risks`
  proposes from open findings; a human accepts or rejects with a mandatory reason, idempotently.
  Two-key: the finaliser's decision is an endorsement, not a closure — a different auditor holding
  `review_and_approve` must accept. Publication is blocked while proposals are outstanding; silence is
  itself a finding.
- **S20 — evidence storage**, called by the audit "the most serious gap found." Migration
  `0120_evidence_storage.sql`. Four private buckets with RLS on `storage.objects` keyed to
  `jwt_org_id()` by path prefix; `register_evidence_file` re-checks right, seal, size, org prefix and
  writes row then ledger; `verify_evidence_file` re-derives, raises an alert on mismatch, records
  `no_stored_bytes` when there is nothing to verify. Order is bytes → row → ledger, never the reverse.
  Where no bucket is wired the tab says "session only."
- **S21 — review comment popout.** `src/components/reviews/CommentPopout.tsx`; the pure model refuses
  a configuration-only principal and an observer, returning `status: 'redacted'` with a reason and
  `text: null` — it never returns nothing and never leaks the body (L2). The dead `ReviewCommentsDock.tsx`
  deleted.

## 10. Systeligon — the S1–S16 rule engine (built by Builder A)

Branch `feature/scale-harden-v1` (`0b14629`), carried onto this branch. **Verified this session:**
`src/lib/systeligon/` holds the engine — `types.ts`, `runner.ts`, `versioning.ts`, `packs.ts`,
`ota.ts`, `flows.ts`, `minutes.ts`, `policydiff.ts`, `provenance.ts`, `library.ts`,
`extract/{structured,ocr,ocrLanguages}.ts`, `rules/{numeric,threshold,structural,documents,patterns,sequential}.ts`
and `index.ts`.

| Row | What it is | State |
|---|---|---|
| **S1** | Rule schema, runner, append-only versioning, packs — every finding names its rule, version and rows; a re-run is byte-identical | **BUILT** (`src/lib/systeligon/{types,runner,versioning,packs}.ts`) |
| **S2** | Header detection + confirm-before-count; rows above the header are preamble, the header is not counted | **BUILT & wired** (`population.ts` `detectHeader`, called from `TestingStepsTab.tsx`; register F126 `Wired`) |
| **S3/S4/S5/S12** | The accepted flow (required rows → evidence → verify → revert), the declined flow (`applyFloor` is a minimum never a ceiling, paste-to-fill), Mode A/B verification, the override carried to the next reviewer | **BUILT** (`flows.ts`, pure; time is an argument) — engine built, **UI unwired** (§13.1) |
| **S6** | Numeric forensic rules as versioned rules — the `analyticsEngine` checks are wrapped so each is a rule with provenance, plus just-below-threshold | **BUILT** (`rules/numeric.ts`, `rules/threshold.ts`), assembled as `systeligonPopulationRules` (`library.ts`) |
| **S7** | Extraction tier 1 wired (`extractDocument` → `doc-extract`, register F43 `Wired`); tier 2 an OCR seam that loads a bundled local engine lazily and **refuses a remote engine**; tier 3 declared-parser structured extraction that reports its own coverage | **BUILT** (`extract/`), tiers 2–3 **UI unwired** (§13.2) |
| **S8** | Structural document rules: a contract must carry a signature, an approval a date, no date after the report date, every open action item has a later record | **BUILT** (`rules/documents.ts`) — **UI unwired** |
| **S9** | Pattern rules: hardcoded credentials, `SELECT *`, an external call with no error handling, an unbounded loop, a disabled check, a hardcoded environment value, each finding citing its line | **BUILT** (`rules/patterns.ts`) — **UI unwired** |
| **S10/S11** | Rule packs per audit type + an ad-hoc rule builder; signed OTA distribution with append-only shipped versions and refusal logging | **BUILT & wired** (`packs.ts`, `ota.ts`, `src/data/rulePacks.ts`, `0117_systeligon_rule_packs.sql`, `0128_rule_pack_release.sql`, `RulePackPanel.tsx` — the pack manager, L2) |
| **S13** | Findings-to-report provenance: `findingsToClaims` copies each finding's rule id/version onto a report claim, the ledger records it, and `commitReportGraph` re-roots so the findings sit *inside* the tamper-evident root | **BUILT & wired** (`provenance.ts`, `src/data/reportGraph.ts`, `0118_systeligon_findings.sql`; `ReportEditorPanel.tsx` calls `commitReportGraph`) |
| **S14** | Sequential minutes: an action-item register following each item forward — carried, vanished, closed no-evidence, reopened, closed-before-raised, closed-by-non-owner, owner/due changed, due passed | **BUILT** (`minutes.ts`, `rules/sequential.ts`) — **UI unwired** |
| **S15** | Policy/procedure/regulation comparison reporting its own coverage (parsed/matched/could-not-interpret); an unparsed clause is not a clean clause | **BUILT** (`policydiff.ts`) — **UI unwired** |
| **S16** | The product/engine name in ONE constants module so a rename is one commit | **BUILT & wired** (`src/lib/product.ts`, `scripts/sync-product-name.mjs`, the Edge mirror, `src/guards/productName.test.ts`) |

**The engine's first product surfaces are now mounted.** `src/components/audit/RuleRunTab.tsx` is a
sub-tab ("Rule Run", contract AF-16) of `PaperWorkbenchModal.tsx`; it evaluates `runRules` over a
population's rows and records the run through `recordSysteligonFindings` (`src/data/systeligon.ts`),
which re-roots the findings into the report graph. That is L1, and it is the screen the whole engine
exists to feed. It turns F127 and F129 `Wired` and removes `recordSysteligonFindings` from the wiring
allow-list. **The rule-pack manager is the second surface** (`RulePackPanel.tsx`, contract OA-33, L2):
it lists the org's packs, generates and registers a signing key, signs a pack, verifies the signature
locally against the public key it holds and only then sends it, releases a draft, reads the refusal
log, and builds an ad-hoc rule. `RuleRunTab.tsx` now reads the **released** pack through
`getReleasedRulePack`/`resolveReleasedRules` and runs it, so "release it to let the engine run it" is a
fact, not a promise; the in-code library is the fallback and a `rule-run-pack-note` names which rule
set ran. It turns F137 `Wired`. The remaining surfaces — the extraction mount (L3) and the other
engine families — are §13.1 and §13.2.

## 11. Systeligon — trust, attestation, capability, explain, fonts (built by Builder B)

All artifacts below are **verified present**:

- **Attestation** — `0122_attestation_package.sql` bakes a portable package; `scripts/verify-attestation.mjs`
  and `docs/ATTESTATION-VERIFICATION.md` are an independent verifier and its procedure (T3–T5).
- **Integrity and incident** — `0121_integrity_alarm.sql` wires the tamper alarm (`integrity_alerts`,
  severity-split) and `0123_incident_wizard.sql` adds the guided incident wizard
  (`IncidentWizardPanel.tsx`) (T1, T2, T6, T7).
- **Capability library** — `0124_capability_library.sql` and `src/lib/capabilities/`
  (`riskControl.ts`, `populationEvidence.ts`, `processGovernance.ts`, `assuranceOps.ts`) (D1–D4).
- **Explain layer** — `src/lib/explain/` (`catalogue.ts`, `iia.ts`, `entries.*.ts`,
  `standardsSurfaces.ts`) and the `ExplainPopout`/`useExplain` surface, plus drilldown and standards
  views (E1–E7, E9, E10).
- **Activity spine and guided first run** — `0125_activity_spine.sql` and `0126_guided_first_run.sql`;
  `ActivitySpine.tsx`, `GuidedFirstRun.tsx` (mounted in `ExecutiveDashboardTab.tsx`), `CommandPalette.tsx`.
- **Self-hosted fonts** — `src/lib/fonts/` (`catalogue.ts`, `detect.ts`, `loader.ts`) with licence
  metadata; `detectTheme` is wired into `OrgBrandingPanel.tsx`; the Google Fonts CDN link removed
  (F1–F7).

## 12. The repair — Phases 1–6 (built by Builder A)

The headline defect (§1) is closed. **Reported** from `docs/SCALE-TASKS.md`: the shell now reads its
own database; the engagement lifecycle is real (stage transitions persist); pre-flight and the
report-graph writer are wired; method-aware sampling is in; the C-series C1–C6 landed (the monitor
runner, alert enrichment, delivery, ad-hoc suggestion, remediation wizard, triage surface). The proof
is gate G1 — Playwright can now run against the **built bundle** (`E2E_PROD=1`), not only the dev
server, so the exact class of defect that hid for months is now catchable.

**The software now audits itself.** The anti-theatre gates refuse the build when the codebase lies
about itself (**verified this session**, all exit 0):

| Gate | What it proves | Result |
|---|---|---|
| G2 no dead code | `check-dead-code.mjs` — every export has a caller or an allow-list reason | PASS |
| G3 config effect | `check-config-effect.mjs` — every config field has a proving test | PASS |
| G4 wiring | `check-wiring.mjs` — every `src/data` export is reachable from a screen, test-only, or allow-listed | PASS (10 allow-listed, 25 test-only) |
| G5 two sources | `check-two-sources.mjs` — no component reads both seed and database | PASS |
| G6 RPC parity | `check-rpc-parity.mjs` — every RPC the UI calls exists | PASS |
| R0 feature register | `check-feature-register.mjs` — the register is honest | PASS (138 features: 94/27/17) |

Plus G7–G10 on Builder B (explain coverage, drilldown, IIA honesty, font licence). Each was designed
from a specific audit finding — G5 is the two-UIs problem, G3 the inert settings, G2 the uncalled
functions.

**Counts — verified this session** (`git ls-tree`, `find`, `ls`):

| Metric | `main` | `scale-harden-v1` | `systeligon-build-v1` | `systeligon-unified-v1` | `writing-engine` | **this branch** |
|---|---|---|---|---|---|---|
| Migrations | 87 | 116 | 114 | 126 | 94 | **128** |
| SQL test files | 92 | 121 | 118 | 131 | 97 | **133** |
| Vitest files | 144 | 215 | 255 | 273 | 164 | **281** |
| Vitest tests | — | — | — | — | — | **3,209 passing** |
| Playwright specs | 25 | 30 | 30 | 30 | 25 | **30** |
| Guards | 18 | 22 | 26 | 28 | 19 | **28** |

The SQL harness (`scripts/local-sql-harness-docker.sh`, real PostgreSQL 17) is **green end to end
this session**: *"migrations applied twice / all SQL tests passed twice."* `npx tsc --noEmit` is
clean.

---

# PART THREE — What remains

This section is rewritten. An earlier edition listed the entire S1–S16 engine here; it is built (§10).
What genuinely remains is smaller, and it is stated with the same rule: nothing below is built unless
it says so.

## 13.1 The engine's screens — the library is built, one surface remains unmounted

**Verified.** The engine is a tested, versioned library. Two product surfaces are now mounted:

- **The rule-run screen (L1)** — `RuleRunTab.tsx`, contract AF-16, §10. Mounted.
- **The rule-pack management UI (L2)** — `RulePackPanel.tsx`, contract OA-33, §10. Mounted. It lists
  packs, registers a signing key, signs and verifies a pack, releases a draft, reads the refusal log
  and builds an ad-hoc rule. `0128_rule_pack_release.sql` supplies the release transition the storage
  half lacked. Register F137 is now `Wired` on this ground (F128 stays `Inert`: `RuleRegistry` and `packRules` still have no screen caller, though `definePack`/`releasedRules` now do).

One surface remains:

- **The other engine families** (flows S3/S4/S5/S12, documents S8, patterns S9, minutes S14, policy
  S15) are **built, pure and tested, and reached by no screen** (verified: 0 component refs each).
  Mounting them is the same work class as L2 — a surface per family — and is delegated to the builder
  (§13.8).

This is the same defect class as §1 in miniature: a working engine with a surface still to mount.

## 13.2 Extraction — tier 1 wired, tier 2/3 seams built, the bundled engine a build artifact

**Verified.** `extractDocument` is `Wired` (register F43): `DocumentViewerPanel.tsx` invokes it, the
`doc-extract` Edge Function re-checks the caller's right and org and reads the file itself. Tier 1
(docx/mammoth, xlsx, pdf-lib) is reachable. The tier-2 OCR **seam** (`extract/ocr.ts`) is built — it
decides whether a scan needs OCR, loads an injected local engine lazily, and refuses a remote engine
(L2); `runOcrWithLanguages` additionally configures the read languages and reports any that could not
be loaded, so a scan read in the wrong language is never presented as read. Tier 3 structured
extraction (`extract/structured.ts`) parses text with declared parsers and reports its own coverage.
**What remains:** actually bundling and shipping the OCR engine, and mounting the full three-tier
extraction flow in the audit-file UI. Register F130/F131 remain `Inert`.

## 13.3 Header detection — built and wired

**Verified.** `detectHeader`/`checkPopulationCsv` in `src/lib/population.ts` no longer assumes row 1
is the header; the reachable surface is `TestingStepsTab.tsx`; the auditor confirms before anything is
counted. The old `const [header, ...body] = table;` line is gone. Closed (register F126 `Wired`).

## 13.4 Continuous monitoring — the runner is built, C7 is the last gap

**Verified.** `src/lib/writing/monitors.ts` (291 lines, six kinds, pure) is real and the C-series
C1–C6 are `DONE` (the `pg_cron` sweep `monitor_runner_sweep`, alert enrichment in
`0112_phase5_alert_enrichment.sql`, delivery in `0113_phase5_delivery.sql`, ad-hoc suggestion and
remediation in `0114_phase5_alert_actions.sql`, the triage surface in `ConnectorMonitorPanel.tsx` and
`AlertActionsPanel.tsx`). **C7 — anomaly to SIRA** (a resolved alert proposes an emergent risk
carrying the alert id, rule version and affected rows) is **unblocked but unbuilt**: it was
`BLOCKED (S18)`, and S18 is now built, so the blocker is gone but the work is not done.

## 13.5 Report writer — provenance built, editor adoption the remainder

**Verified.** F39 (findings-to-report provenance) is `Wired`: findings are recorded, read back and
re-rooted *inside* the tamper-evident report graph (`commitReportGraph` in `ReportEditorPanel.tsx`).
Font/colour auto-detect (F5/F6) is `DONE`. **What remains** of S13: org-format adoption in the editor
at every stage (adopt an uploaded report's structure and typography, while formatting stays editable
and no fact changes). S13 is therefore **partly built** — the provenance is done, the editor adoption
is not.

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
  E8/U6; B built `GuidedFirstRun.tsx` and `create_universe` (mounted in `ExecutiveDashboardTab.tsx`),
  so this needs **reconciliation** (take what exists, close the gap, delete any duplicate) rather than
  a second implementation. **TODO.**

## 13.8 The complete planned-work matrix

Everything the specification describes and that is **not** built, with its state and its dependency.
Rows marked `BUILT` are listed so the boundary of this section is unambiguous. **This is the
authoritative work list; the builder prompt delegates all of it except the design language.**

### Systeligon S-series — the forensic engine

| # | Task | State | Depends on |
|---|---|---|---|
| S1 | Rule schema, runner, versioning, result shape | **BUILT** | — |
| S2 | Header detection + confirm-before-count | **BUILT & wired** | — |
| S3 | The accepted-Systeligon flow | **BUILT** — UI unwired | S1 |
| S4 | The declined flow: floor, paste-to-fill, auto-add | **BUILT** — UI unwired | — |
| S5 | Mode A / Mode B verification | **BUILT** — UI unwired | S1 |
| S6 | Forensic rule library — one versioned module per family | **BUILT** | S1 |
| S7 | Document extraction tiers 1–3, with source hashes | **BUILT** — tier 1 wired; tiers 2–3 seams built, UI unwired; bundled OCR engine pending | — |
| S8 | Structural document review rules | **BUILT** — UI unwired | S7 |
| S9 | Pattern rules (minutes, config, source, Power Query) | **BUILT** — UI unwired | S7 |
| S10 | Rule packs per audit type + adhoc rule builder | **BUILT & wired** (`RulePackPanel.tsx`, L2) | S1 |
| S11 | Signed OTA rule-pack distribution | **BUILT & wired** (`RulePackPanel.tsx`, `0128_rule_pack_release.sql`, L2) | S1 |
| S12 | Override visibility across stages | **BUILT** — UI unwired | S3 |
| S13 | Report writer under Systeligon | **PARTLY BUILT** — provenance done; org-format editor adoption remains | — |
| S14 | Sequential minutes: action-item register | **BUILT** — UI unwired | S7 |
| S15 | Policy/procedure/regulation comparison | **BUILT** — UI unwired | S7 |
| S16 | Name in one constants module | **BUILT & wired** | — |
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
| T1 | Tamper alarm on a schedule | **BUILT** (`0121`) |
| T2 | Ledger continuity check on a schedule | **BUILT** (`ledger_continuity_check`) |
| T3 | Portable attestation package | **BUILT** (`0122`) |
| T4 | Third-party verifier + procedure | **BUILT** (`scripts/verify-attestation.mjs`) |
| T5 | Attestation screen | **BUILT** |
| T6 | Guided integrity incident wizard | **BUILT** (`0123`) |
| T7 | Wire the alarm: `integrity_alerts`, notify, severity-split | **BUILT** (`0121`) |

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
| D5, D7, D8, D9 | Continuous control monitoring (SOX/ICFR), population-level forensic analytics, policy-to-control gap analysis, assurance-over-assurance | **IN SCOPE** (owner decision 2026-10-29) — `Absent`; full-depth work packages in the builder prompt, grounded in `docs/ASSURANCE-RULEBOOKS.md` |
| D6 | Verifiable third-party attestation | **REMOVED** (owner decision 2026-10-29) — not to be built |
| E1–E7, E9, E10 | Explain catalogue, popout, IIA data, hover cards, drilldown, standards views, gates | **BUILT** |
| E8 | `PencilGuide` + guided first-run data | **DEFERRED** (design) |
| F1–F7 | Self-hosted fonts, catalogue, subsetting, upload, auto-detect, wiring, licence gate | **BUILT** |

### Gates

| # | Gate | Owner | State |
|---|---|---|---|
| G1–G6 | Production-build E2E; no dead code; config proving tests; data-export imports; no seed+DB; RPC existence | A | **BUILT** |
| G7–G10 | Explain coverage; drilldown; IIA honesty; font licence | B | **BUILT** |
| R0 | Feature register honesty | A | **BUILT** (138 features, 94/27/17) |

### Builder A's unbuilt UI/UX rows

| # | Task | State |
|---|---|---|
| A-U1 | Pencil-style guided pointers | **DEFERRED** (design; same surface as E8) |
| A-U2 | Every screen's functional states (loading/empty/error/ready/denied) | **TODO** |
| A-U3 | Guided first-run: zero → first sealed report | **TODO** (reconcile with B's `GuidedFirstRun.tsx`) |

### The R-series — the "missing middle" (dependency-ordered)

| # | Task | State |
|---|---|---|
| R1–R4 | The remaining configuration-effect and lifecycle rows that Phases 2–3 did not close | **BUILT** (Phases 2–3; see `SCALE-TASKS.md`) |
| R5 | Methodology and test-step templates (`F28`–`F30`) | **BUILT** — F28/F29 `Wired` via `MethodologyPanel`/`ProcedureStepsPanel`; **F30 (stage machine) genuinely unbuilt** (three hardcoded strings remain) |
| R6 | Multi-tenant scale and isolation (`F84`–`F86`) | **BUILT** — concurrency isolation tests exist (`118_phase6_concurrency_isolation.sql`, `123_scale_isolation.sql`); support-grant read logging verified |
| R7 | Super Admin guided provisioning (`F92`) | **BUILT** — `SuperAdminProvisioning.tsx` present |
| R3 remainder | Configuration honesty (`F35`, `F72`–`F76`, `F78`, `F79` still `Inert`) | **OPEN** — the register rows remain `Inert`; each needs its read path wired |

### The D5–D9 adjacent capability products

| # | Task | State |
|---|---|---|
| D5, D7, D8, D9 | Continuous control monitoring (SOX/ICFR), population-level forensic analytics, policy-to-control gap analysis, assurance-over-assurance (`F121`, `F123`–`F125`) | **IN SCOPE** — owner decision 2026-10-29; `Absent` in the register; full-depth packages in `docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md`, grounded in `docs/ASSURANCE-RULEBOOKS.md` |
| D6 | Verifiable third-party attestation (`F122`) | **REMOVED** — owner decision 2026-10-29 |
| D10–D13 | Client classification + ICFR trigger, the audit-domain axis (Management/Shari'ah/IT), actionable traffic-signal readiness, deployment readiness (`F139`–`F142`) | **IN SCOPE** — owner decision 2026-10-29; `Absent`; grounded in `docs/PAKISTAN-ASSURANCE-REGIMES.md` and `docs/AUDIT-DOMAINS-MODEL.md` |
| D14–D15 | Risk library + auto-adjusted factors + manual override; dynamic risk assessment (PwC model) (`F143`–`F144`) | **IN SCOPE** — owner decision 2026-10-29; `Absent`; grounded in `docs/RISK-ASSESSMENT-MODEL.md` and `docs/ASSURANCE-RULEBOOKS.md` §6 |
| All 27 `Inert` + 21 `Absent` register rows | **HANDED TO THE BUILDER** — owner decision 2026-10-29, continuous-build cadence (≤15s between rows); only the DEFERRED design rows are held back |

### The remainder the build must still close

| # | Task | State |
|---|---|---|
| L1 | The rule-run screen (mounts S1–S16) | **BUILT** (`RuleRunTab.tsx`) |
| L2 | The rule-pack management UI (S10/S11) + ad-hoc rule builder | **BUILT** (`RulePackPanel.tsx`, contract OA-33; `0128_rule_pack_release.sql`; release-aware `RuleRunTab.tsx`) |
| L3 | The three-tier extraction flow in the audit-file UI + the bundled OCR engine artifact | **OPEN** |
| L4 | S13 remainder — org-format editor adoption | **OPEN** |
| L5 | C7 — anomaly to SIRA | **OPEN** |
| L6 | A-U2 — every screen's functional states | **OPEN** |
| L7 | A-U3 — guided first-run, reconciled | **OPEN** |
| — | Re-record the tutorial media (25 GIFs stale against their `ui_hash`) | **OPEN** (build work) |
| — | Reachability audit of both engines after every module added | **CONTINUOUS** |

## 13.9 The migration-number collision — resolved on the unified branch

**Verified resolved.** Both builder branches once claimed the `0110`–`0117` range. On
`feature/systeligon-unified-v1` (`ceb85fd`) and on this branch the set is renumbered and whole:

```
0110_phase4_methodology.sql          0119_sira_continuity_acceptance.sql
0111_phase5_monitor_runner.sql       0120_evidence_storage.sql
0112_phase5_alert_enrichment.sql     0121_integrity_alarm.sql
0113_phase5_delivery.sql             0122_attestation_package.sql
0114_phase5_alert_actions.sql        0123_incident_wizard.sql
0115_tenant_suspension_enforced.sql  0124_capability_library.sql
0116_phase6_workpaper_creation.sql   0125_activity_spine.sql
0117_systeligon_rule_packs.sql       0126_guided_first_run.sql
0118_systeligon_findings.sql         0127_team_directory.sql
```

Every migration from both branches is present exactly once in filename order; the SQL harness applies
them twice and runs every test twice, and passes.

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

## 13.11 The register understates the build — the rows this report corrects

**Verified this session.** `FEATURE-REGISTER.md` carries rows whose status is stale in the
*understating* direction — the same defect class as overstating, and the one an earlier edition of
this report failed to catch. Each is recorded here against its real call site:

| Row | Register says | Reality (verified) |
|---|---|---|
| F28 | `Absent` | **Built & wired** — `procedure_templates`/`test_step_templates` exist (`0110_phase4_methodology.sql`); `applyTemplateToWorkpaper` is called from `ProcedureStepsPanel.tsx` |
| F29 | `Absent` | **Built & wired** — `MethodologyPanel.tsx` is mounted (`OrgControlPanel.tsx`) and calls `listProcedureTemplates`/`saveProcedureTemplate`/`publishProcedureTemplate` |
| F39 | `Absent` | **Built & wired** — `commitReportGraph` (`src/data/reportGraph.ts`) calls `findingsToClaims`; invoked from `ReportEditorPanel.tsx` |
| F53 | `Absent` | **Built** — the enrichment fields (entity, department, SIRA risk, controls) are computed in `0112_phase5_alert_enrichment.sql` |
| F54 | `Absent` | **Built & wired** — `alertAdhocSuggestion`/`alertAdhocAuditRaise` (`src/data/writing.ts`) are called from `AlertActionsPanel.tsx` |
| F55 | `Absent` | **Built & wired** — `triageAlert` (`src/data/writing.ts`) is called from `ConnectorMonitorPanel.tsx` |

**F30 is genuinely `Absent`** — the stage machine is still three hardcoded strings
(`src/types/index.ts:74`). The register is right about that one and wrong about the six above.
**The six rows are now corrected** (this session, `docs/FEATURE-REGISTER.md`): F28/F29/F39/F53/F54/F55
are `Wired`, and the count block reads **94/27/17**. `check-feature-register` passes with no
understating rows left. The correction is a build task that is now done, not a task still to do — which
is the only honest way to record it.

---

## 14. The honest position

Systeligon is **a built rule engine whose surfaces are nearly all mounted.**

**Built and verified:** the deterministic writing engine (register-invariant graph root, the
1,200-cell proof by exhaustion); the audit engine (SIRA parity, 14 numeric checks, seeded sampling,
automation rules); the **entire `src/lib/systeligon/` rule engine — S1 through S16** (schema, runner,
append-only versioning, packs, signed OTA, the accepted/declined flows, Mode A/B verification,
override visibility, the numeric/structural/pattern/sequential rule families, minutes tracking,
policy comparison, and the single-name module); **two surfaces that mount it** (the rule-run screen,
L1, and the rule-pack manager, L2, with the release transition and a release-aware rule run); header
detection wired into the population flow; findings-to-report provenance inside the tamper-evident
root; document recognition with archive-bomb and traversal limits; SIRA continuity and two-key
acceptance; evidence storage with real bytes; the attestation package and an independent third-party
verifier; the incident wizard and the tamper alarm; the deterministic capability library; the explain
layer; the functional interface rows; self-hosted fonts; the Phase 1–6 repair that makes the app read
its own database, proven by a production-build test; and the anti-theatre gates.

**Planned and unwritten:** the remaining engine surfaces (flows, documents, patterns, minutes,
policy); the three-tier extraction flow in the audit-file UI and the bundled OCR engine as a shipped
artifact (L3); the org-format editor adoption half of S13 (L4); **C7** (anomaly to SIRA, now
unblocked) (L5); **A-U2** (every screen's functional states) (L6); **A-U3** (guided first-run to a
sealed report, reconciled with B's work) (L7); the R3 configuration-honesty remainder; the four
in-scope adjacent capability products D5, D7, D8 and D9 (D6 removed by owner decision); the stale
tutorial media; and the deliberately deferred **visual** design rows.

**The difference matters, and it is the point.** An earlier edition of this briefing described the
S1–S16 engine as a specification and unwritten. That edition was itself an example of the defect the
project exists to catch: it described a state of the code that had already changed. This edition says
what the previous one should have: the engine is built and gated, two of its surfaces are mounted
(L1 and L2), and what remains is the wiring of the rest of its surfaces, one orchestration feature
(C7), two functional UI rows, the adjacent capability products, and a design language the owner has
not yet settled.

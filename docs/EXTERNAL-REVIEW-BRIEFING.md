# Provio / Systeligon — external review briefing

**For:** independent reviewer.
**Date:** 2026-10-29.
**Subject:** what was wrong, how wrong it was, what was done about it, and where it stands now.

**Names used in this document.** The product is **Provio** (internal-audit / forensic-assurance SaaS).
**Systeligon** is the name of the second workstream — the parallel build on
`feature/systeligon-build-v1`, whose ledger is `docs/SYSTELIGON-TASKS.md` — and it is also used as the
project's overall designation in the version-control and documentation naming. Where this document
says "Builder A" it means `feature/scale-harden-v1` (the remediation stream) and where it says
"Builder B" or "the Systeligon build" it means `feature/systeligon-build-v1`. Both are covered; see
§12 for B's work in full.

**Scope reviewed:** `main` (`a697190`), `feature/scale-harden-v1` (`fc0ccda`, "Builder A"),
`feature/systeligon-build-v1` (`51c4156`, "Builder B").

**How to read this.** Every figure marked *verified* was reproduced by me against the repository
during this review. Figures marked *reported* come from a builder's ledger and were **not**
independently reproduced. The distinction is deliberate, and it is also the central subject of this
document — because the most serious problem found in this codebase was not a bug. It was that the
documents describing the code were wrong.

---

# PART ONE — What was wrong, and how wrong

## 1. The headline: the product did not work in production

This is the finding that matters, and everything else in Part One is downstream of it.

On 2026-10-27/28 a code-verified audit (`docs/FUNCTIONALITY-AUDIT.md`) was run on this repository with
one instruction: **disregard the documentation and read the code**. The result was not "there are some
bugs". It was this:

> The repository contains a large, well-tested **backend** and a large, well-tested **frontend**, and
> the two are wired together for only a fraction of the product. The pattern is not "no functionality".
> It is **two half-products**: a database that enforces rules nobody triggers, and screens that render
> from an in-memory seed rather than the database.

The single most damaging defect, verified at `src/App.tsx:204`:

```ts
const loadDemoSeed = import.meta.env.DEV
  ? () => import('./data/demoSeed').then((m) => m.demoSeed)
  : null;
```

In **development** the entire application shell loads `demoSeed` — 1,387 lines of fixture data
(users, universes, entities, engagements, workpapers, issues, CAPs). In a **production build**
`loadDemoSeed` is `null`, so the seed is `EMPTY_SEED` and every array is empty.

`AppContext` (727 lines) holds all tenant state in `useState` and contains **zero** calls to the
Supabase client — verified by grep:

```
grep -c "callRpc|getClient|supabase" src/context/AppContext.tsx   →   0
```

Nothing ever hydrated it from the database. `useScopedData()`, used by **69 components**, filtered
that in-memory seed.

**The consequence, stated plainly.** In production, `AuditFileModal` found no engagement and rendered
`data-testid="audit-file-unavailable"`. Every screen showed its empty state. The product had **no code
path that could display real tenant data.** It looked complete. It was a demonstration.

**Why the test suite could not catch it.** `playwright.config.ts:39` ran `npm run dev`. Every
end-to-end test therefore exercised the **demo seed**, never the production path. The suite was green,
broad, and structurally incapable of detecting the defect, because the thing it needed to test was the
thing it stubbed out. This is the most important sentence in this briefing:

> The tests passed because they ran in the one mode where the product worked.

## 2. The second-order failures

The audit found six further classes of defect, all verified against code:

| # | Defect | Severity | Evidence |
|---|---|---|---|
| 2.1 | Engagement stage never persisted | Critical | Only `update engagements` statements set `sealed`; no transition RPC existed |
| 2.2 | Report graph root never written | Critical | `grep -rn "report_graphs" src/` → **empty** |
| 2.3 | Pre-flight was dead code | High | `runPreflight()`'s only caller was its own test |
| 2.4 | Sign-off roles and testing mode stored but not enforced | High | Settings persisted and displayed, never read by the sign-off RPCs |
| 2.5 | Sampling not connected to row testing | High | Schema accepted 7 methods; engine implemented 1 |
| 2.6 | LAW-1 violated in the UI context | Medium | `new Date()`/`Date.now()` at 9 sites in `AppContext`; two observations in the same millisecond collided |

**2.2 in detail, because it shows how deep this went.** `report_graphs` is append-only
(`0088_claim_graph.sql`) and `verify_report_root` (`0094`) reads it to prove tamper-evidence — the
platform's core assurance claim. Nothing in the product inserted a graph row. The writing engine
computed the roots, and the tests verified them, and **the result was never persisted**. So the
verification chain had no data to verify. The feature was real, tested, documented — and attached to
nothing.

**2.4 is the one that would have humiliated the product in a demo.** `signoff_role_planning`,
`signoff_role_testing`, `signoff_role_conclusion` and `testing_mode` were validated, persisted with
version history, and displayed on a settings screen. `sign_planning`, `sign_off_workpaper` and
`sign_conclusion` never read them. A client could configure a two-stage approval chain and get
one-stage behaviour, with the setting showing the value they chose.

## 3. Fifteen functions the product never called

Cross-referencing app string literals, edge functions, SQL callers and triggers against the final
schema left **15 public functions with no reachable caller** — every one of them tested:

| Function | What it should do | Callers |
|---|---|---|
| `verify_ledger` | Verify the hash-chained ledger — **the tamper check** | 0 |
| `rule_engine_process` | Run the deterministic monitor rules | 0 |
| `staged_record_ingest` | Ingest connector records | 0 |
| `connector_run_start` / `_finish` | Record a connector run | 0 / 0 |
| `alert_record` | Persist a fired monitor alert | 0 |
| `escalation_evaluate` | Evaluate escalation rules | 1 (feature map only) |
| `reopen_engagement` | Reopen a sealed engagement | 0 |
| `phrase_create`, `admin_set_org_setting`, `email_dispatch_set_token` | — | 0 |

The whole monitor runtime was dead: `evaluateMonitor`, `runMonitors`, `verifyAlertChain` had no caller
outside their tests. The 22-adapter connector catalogue was data with no runner.

**`verify_ledger` is the sharpest example.** The hash-chained ledger was being written — in memory,
via `appendLedgerEntry` in `AppContext` — and never verified against the database. The tamper-evidence
mechanism was cosmetic.

## 4. The two-UIs problem: correct and fake implementations, both reachable

Several behaviours had a real implementation and a parallel fake one, with **the fake being what ran**:

| Behaviour | Real | Fake | Which rendered |
|---|---|---|---|
| Sampling | `SamplingPanel` (RPC) | `SamplingTab` (`dummyPopulation`) | both wired |
| Universe/entities | `listEntities()` DB read | `useScopedData()` seed filter | both, merged |
| Sign-off | `sign_planning` RPC | `AppContext.signOffEngagement` | both exist |
| CAP transition | `update_cap` RPC | `transitionCapStatus` | both exist |
| **Ledger** | DB `append_ledger_entry` | `appendLedgerEntry` in-memory | **in-memory** |

`AuditUniverseTab` demonstrated this most clearly: it read `dbEntities` from the database *and*
rendered `scopedEntities` from the seed, merging two sources that in production disagreed — one of
them empty.

## 5. The misdirection — how the documentation lied

This is the part a reviewer should weigh most heavily, because it is the reason the product got as far
as it did in this condition.

The repository carried **63 documents** whose claims were, in the audit's words, *"all Present"* —
while the code was not. The documents were not written in bad faith. They described **modules**, and
the modules existed. What they failed to describe was **behaviour**, and the behaviour did not exist.

The audit's verdict, verbatim:

> The docs' "all Present" is true of *modules* and false of *behaviour*. Roughly 15 functions and five
> core flows are built, tested, documented as done, and not connected to the product.

Concretely, the misdirection had three mechanisms:

1. **A status vocabulary that permitted ambiguity.** The word `Partial` appeared throughout. It
   absorbed every possible state between "does not exist" and "works", which meant a document could
   claim progress indefinitely without ever being wrong. `Partial` is not a status; it is a place to
   hide.
2. **Tests cited as proof of function.** The suite was cited as evidence that features worked. It was
   202 vitest files, 2,378 tests, 103 SQL files, 29 Playwright specs and 21 guards, all green — and,
   as the audit put it, *"structurally incapable of catching the integration gaps in §1–§3, because the
   integration is exactly what it stubs out."* SQL tests passed by testing the database in isolation,
   often calling functions the app never called. Green tests were being used as a proxy for a working
   product, and they are not that.
3. **Documents treated as evidence.** Every later document was written by reading the previous
   document rather than the code, so an error in one propagated into all of them. The audit found that
   its *own successor document* had made this mistake: the first version of the feature register was
   built from the audit rather than from the code, and consequently reported as `Inert` a large amount
   of work that had since been wired.

**The 63 stale documents were not deleted. They were archived with a banner** that reads, in part:

> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only. Its
> status claims are **not** reliable: the audit found the app was not database-backed in production,
> the engagement lifecycle was never persisted, several documented-as-Present features were dead code,
> and many "all Present" claims were false.

That banner is the honest artefact. It is preserved deliberately, because the failure mode it
documents is the one most likely to recur.

## 6. The commercial framing — why this was worse than a crash

The remediation plan (`docs/REMEDIATION-PLAN.md`) put the risk in terms a non-technical owner
recognises, and it is worth quoting because it explains the urgency:

> A professional would have asked one question — "can I configure the approval chain for this client?"
> — the answer would have been yes, the screen would have opened, the setting would have saved with a
> reason and a version history… **and then nothing would have happened when they used it.**
>
> That is worse than a crash. A crash is honest. A config screen that saves a value no code ever reads
> is a lie told to the user's face.

The audit found a systemic version of this: **23 configuration tables**, mostly settable and
versioned, with a meaningful share having **no behavioural effect** — `approval_chain`,
`signoff_role_*`, `testing_mode`, report templates, CAP workflow.

Against best-in-class audit software (TeamMate+, CaseWare, AuditBoard, Workiva, HighBond, Fieldguide),
Provio's honest standing at that moment was: **strong** on risk universe/SIRA, security and tenancy,
and parts of reporting — genuinely competitive. **Broken or absent** on engagement lifecycle,
methodology, sampling, continuous monitoring and connectors — the working machinery that turns a risk
model into a finished audit.

---

# PART TWO — How the software was raised

## 7. The Writing Engine — the greatest asset, and the sharpest lesson

This is the most original engineering in the repository and it deserves to be stated before anything
else, because the remediation in §10 and §11 is the *repair* of a system that already contained
something genuinely rare. It was built on `feature/writing-engine` (`c45bb81`) on 2026-10-26 —
**before** the audit — and it is described in `docs/WRITE-REPORT.md`.

### 7.1 What it is

**An audit report is not text. It is a directed graph.** That is the engine's founding idea, and
everything else follows from it.

- **Each node** is a *claim*: a typed reference set, a bound figure, a phrase id and version, and a
  rule id and version.
- **Each edge** is one of three things: *evidence* (a claim to the records it derives from, by type,
  id and content hash), a *dependency* between claims, or a *structure* edge from the document plan.
- **Two hashes are committed.** The **graph root**, over the facts. The **render hash**, over the exact
  words.

The consequence is the property the whole design exists to produce:

> **The graph root is identical across every formality, tone, voice and locale of the same report.**

Change the register from blunt to diplomatic, switch en-GB to en-US, move from passive to active
voice — the words change, the render hash changes, and **the root does not move**, because the facts
did not change. That is what makes the report auditable: you can prove that two differently-worded
documents assert exactly the same findings, and that neither asserts anything the evidence does not
support.

Text is a **pure function** of the graph, the model, the register, the locale, the engine / template /
phrase-library versions, and a fixed timestamp. There is no other input. In the report's own words:
*no AI, no model, no embedding, no generated free text.*

**Scale:** 8,817 lines across 41 modules and their tests; on the current branch, 82 files of which 39
are test files. Every module is a pure function of its arguments.

### 7.2 The matrix — proof by exhaustion

The register matrix is **5 formality × 5 tone × 2 voice × 2 locale = 100 cells**, and the suite
composes every one:

- **100 cells composed, 0 missing phrases** for the base model.
- Extended to **all twelve report models: 1,200 compositions, 0 missing phrases, 0 errors.** The
  failure message names the exact model, cell and phrase.
- **One graph root across all 100 cells** of a model, while the render hash genuinely varies — the
  wording differs, the facts do not.
- A section the model declares `registerInvariant` renders **identical text in all 100 cells** — the
  declaration is *proved*, not assumed.
- A section **not** declared invariant **genuinely varies** — so the declaration cannot be over-used
  to make tests pass.

That last pair is the design worth noticing: the test refuses both a broken invariant *and* a
dishonest one.

### 7.3 It found and fixed a real defect in itself

The matrix caught a genuine bug: the composer applied the register transform and the lead-in to
register-invariant sections, so the `appendices` line rendered three different, ungrammatical forms
("Our work shows that 5 findings; …"). `compose.ts` now honours the declaration, and **the invariant
test would fail if it stopped doing so**. The engine found its own defect by being exhaustive, and
locked the fix with a test that cannot regress silently.

### 7.4 The adversarial and tamper suites

On the current branch, `src/lib/writing/adversarial.test.ts` supplies **deliberately broken inputs
that must never seal**, and asserts the seal gate refuses each one — naming the defect the
specification says blocks a report. It contains both tests the original brief demanded:

- **a graph-root mutation test** — a single changed figure must move the root, so a root hole cannot
  pass unnoticed;
- **a coverage-hole test** — a CAP in scope with no claim must be refused.

Alongside it: `mutation.test.ts`, `merkle.test.ts` (inclusion proofs, altered leaves), `verify.test.ts`
and `versioning.test.ts` (altered phrase versions) — offline verification under tampering. **No test
reads a clock**; the report date is the time argument, per law L4.

The engine was also built to fail loudly: the suite asserts that a **report cannot be sealed** with
missing references, hash mismatches, coverage gaps, contradictions (the same figure with two values,
severity/risk mismatch, CAP status mismatch), a date after the report date, or dismissed-alert claims.

### 7.5 The sharpest lesson in this repository

Here is the part that matters most for a reviewer, and it is uncomfortable.

**The greatest engine in the codebase was attached to nothing.** The audit found (§2.2) that
`report_graphs` was append-only and `verify_report_root` read it to prove tamper-evidence — and
`grep -rn "report_graphs" src/` returned **empty**. The engine computed the roots, and the tests
verified the roots, and **the result was never persisted.** The verification chain had no data to
verify.

So the Writing Engine is simultaneously the best engineering here *and* the purest instance of the
defect described in §5: **built, tested, documented as done, and never connected.** Its correctness
was never in doubt. Its reachability was.

That is why the engine is the argument for the anti-theatre gates in §9. A gate that requires a named
production call site would have caught this on the day it was written. The engine is the strongest
possible evidence that green tests are not a working product — because the engine's tests were
excellent and they were all passing while it was inert.

**And it has since been connected.** Phase 2 of the remediation persists the graph root so
`verify_report_root` has data, and wires `runPreflight` into `freeze_report`. The engine's output now
reaches the database. §10.

### 7.6 One more thing the engine proves

The audit's verdict was that the codebase held *"two half-products"*. The Writing Engine is the
counter-evidence that the underlying engineering is not the problem. A report-as-directed-graph with
a fact-hash that survives every rewording is not something a team stumbles into; it is a design, and
it is better than the framing of most commercial audit tools. **The failure was never capability. It
was connection.**

---

## 7A. The Audit Engine — the auto-configuring part, and what it actually does

The Writing Engine turns a finished audit into a provable document. **The Audit Engine is the part
that decides what the audit should be in the first place** — it reads the organisation's risk model
and *configures the engagement for the auditor*. This is the machinery that makes the product an
audit platform rather than a document generator, and it is spread across several deterministic
engines that all share one property: **they are pure functions of data, so the same inputs always
produce the same audit plan, and the plan can be re-derived and checked.**

Nothing here calls a model. Nothing here guesses. Every one of these is L1-compliant by construction.

### 7A.1 The auto-configured audit — SIRA pre-fill

This is the capability the user is describing: **the system proposes the audit work automatically.**

`populate_planning_suggestions(p_engagement_id)` (`0025_planning.sql:139`) reads the latest
**published SIRA cycle** and derives, for the engagement, a set of planning suggestions. The pure
surface is `src/data/planning.ts` — `populateSuggestions()` returns `PlanningSuggestion[]`, each
carrying:

- `riskId` — the risk this suggestion comes from;
- `inherentRating` and `riskBand` — how severe the risk is;
- `suggestedControls` — the controls the risk model says should be tested;
- `priorFindingCount` — how many times this risk produced a finding before.

**The part that matters is the decision, not the suggestion.** Each suggestion carries a
`SuggestionDecisionRow` — `accepted`, `reason`, `decidedAt`. An auditor accepts or declines each
proposal **and the reason is recorded**. The engine proposes; the human disposes; the ledger keeps
both. That is how an auto-configured audit stays defensible: the machine's suggestion and the
auditor's judgement are both in the record, and a declined suggestion with a reason is as auditable as
an accepted one.

The SIRA side of that is `siraEngine.ts` (138 lines) — **deterministic scoring only: no I/O, no
randomness, no AI** — implementing four aggregation methods (`weighted_sum`, `maximum`,
`weighted_average`, `weighted_average_floor`) over a client-defined factor/scale/band model, with all
scores normalised to 0–100. Crucially it is **the exact mirror of the SQL function
`public.sira_compute`**, and `siraEngine.test.ts` runs the same fixtures through both and asserts they
agree. The UI's preview and the database's stored score cannot drift, because a test proves they
compute the same number.

`src/lib/siraScoring.ts` (139 lines, on B) is the scoring *surface* model built on top, and it holds a
detail worth quoting because it is the engine's ethic in one line: *"nothing is inferred: an unscored
entity×risk pair is reported as unscored, never as a zero."* **An unknown is never silently
converted into a data point.** For an audit tool that is not a nicety — a risk scored 0 because it was
never assessed is a false assurance.

### 7A.2 The analyst engine — 14 deterministic audit checks

`src/lib/analyticsEngine.ts` (432 lines) is the financial-analysis engine: **14 named checks, every one
a pure deterministic function with unit tests, no randomness, no AI, no I/O.**

| Check | What it finds |
|---|---|
| `duplicates`, `near_duplicates` | the same transaction twice, and almost-the-same |
| `sequence_gaps` | missing document numbers |
| `outliers_zscore`, `outliers_iqr` | statistical outliers by two independent methods |
| `benford_first_digit` | digit-distribution fraud signal |
| `round_numbers` | suspiciously round postings |
| `weekend_postings` | entries made when nobody should be working |
| `same_user_create_approve` | segregation-of-duties violation |
| `missing_attributes` | incomplete records |
| `period_variance` | period-over-period movement |
| `gl_to_tb` | general ledger against trial balance |
| `sira_vs_planning` | **the risk model against the plan that was actually executed** |
| `controls_vs_tests` | controls declared against controls actually tested |

Every result row carries **the row references it flagged**, so the UI can offer "Raise finding" with
the rule id, the parameters used, and the exact source rows. That is the difference between a flag and
evidence.

Note `sira_vs_planning` and `controls_vs_tests`: the engine audits **the audit** — it checks whether
the plan that was executed actually addressed the risks the model identified. Self-checking is built
into the analysis layer, not bolted on.

### 7A.3 Determinism enforced down to the sampling

`src/lib/auditEngines.ts` contains `createDeterministicPrng` — a Mulberry32 PRNG seeded from a string
— with the stated guarantee that **no unseeded randomness is used in any audit sampling or
statistical calculation.** `drawSeededSample(population, sampleSize, seed)` then draws a reproducible
sample, and `verifyPopulationGate(populationData, expectedSha256)` checks the population against its
committed SHA-256.

The consequence: **an auditor can reproduce any sample the system drew, months later, and prove the
population had not changed.** Sampling is normally the least defensible part of an audit — the auditor
says "I picked 30 items" and the client has to take their word. Here the draw is a pure function of a
seed, so it is re-derivable, and the population is hash-gated so it cannot be quietly swapped
afterwards. That is a genuinely strong property, and it is achieved with no model, no randomness and
no network.

### 7A.4 The automation engine — deterministic rules, with a loop guard

`0056_automation_engine.sql` is the server-side engine: it reads `automation_events` (written by the
config-area triggers in `0051`), matches enabled rules whose conditions pass, and for each action
writes in-app notifications and queued email. Its own header states the ethic: **"the engine is
deterministic (L1)… It never sends anything itself."** Dispatch is a separate Edge Function, so the
engine cannot act outside the transaction.

Two safeguards worth naming, because they are what stops automation from becoming a runaway:

- **Loop guard:** an action cannot trigger its own rule.
- **Rate limit:** more than **20 events per rule per hour auto-pauses the rule with a notice.**

`src/lib/automationRules.ts` (204 lines) is the pure data model the visual editors build against —
conditions (`eq`, `ne`, `gte`, `lte`, `contains`, `in`) and actions (`notify`, `set_flag`, `webhook`,
`proposal`, `escalate`) as **data, not code**, so a client can configure their own automation and the
same shape is evaluated by both the server engine and the unit tests. Again: *"Nothing here calls the
network."*

### 7A.5 The monitor runtime — six deterministic rule kinds

From `docs/WRITE-REPORT.md`: monitor rules are **threshold, rate over a window, sequence, set
membership, missing expected event, and cross-source reconciliation** — evaluated by a pure function
with **the window and the time as arguments**. Each emits the existing generic `watcher.signal`
catalogue event, and rules ship as drafts: **release needs a qualified human.**

Six rule kinds is the full set continuous-monitoring tools need, and they are all pure. This is the
capability the audit found *"built, unreachable"* (§3) — `rule_engine_process` had **zero** callers —
and it is now wired.

### 7A.6 Why the Audit Engine matters more than it looks

Taken together, these engines do something the audit's "two half-products" framing obscures: **they
automate the configuration of an audit without automating the judgement.**

- The risk model **proposes** the work; the auditor accepts or declines, with a reason, on the ledger.
- The analysis **flags** the rows; it does not conclude — it hands the auditor the references, the
  rule and the parameters.
- Sampling is **reproducible**, so the auditor's method can be independently re-derived.
- Scoring **refuses to invent a zero** for something never assessed.
- Automation **cannot loop**, and pauses itself past 20 events an hour.
- Monitor rules **ship as drafts** — the machine proposes, a human releases.

Every one of those is a decision to keep the human in the loop and make the machine's contribution
inspectable. That is not a limitation imposed by law L1. It is the design, and it is the right design
for a product whose output is used to assure other people's controls.

**And it was almost entirely inert.** The audit found the monitor runtime dead, `rule_engine_process`
uncalled, and the analyst engine's findings never persisted to the graph. The engines were correct,
tested, and attached to nothing — the same defect as §7.5, at larger scale.

### 7A.7 The honest caveat on this section

§7 (Writing Engine) and §7A (Audit Engine) describe the *design and its intent*, drawn from the
modules' own headers, the migrations and `docs/WRITE-REPORT.md`. I read the code for the signatures,
the guarantees and the guards quoted above, and I verified module sizes and line counts directly.

**I did not re-run the engines' test suites**, and I did not independently reproduce the SIRA
SQL/TypeScript parity result or the 1,200-composition matrix. Those are the builders' reported
results. They are the specific claims the independent evaluation in §15 should re-run first, because
they are the load-bearing correctness claims of the whole platform.

## 8. The first fix was a change of method, not a change of code

Before any feature work, the project changed how it decided what was true. This is the precondition
for everything below, and without it the rest would have repeated the same failure.

**Three-value status vocabulary, enforced by a gate.** The feature register permits exactly three
values and no others:

| Status | Means | Evidence required |
|---|---|---|
| `Wired` | Reachable from a screen or a job, and does real work | A named call site, and a passing test through that path |
| `Inert` | Built, may be tested, reachable from nothing | The grep that found no caller |
| `Absent` | Does not exist | The feature, its work package, its acceptance test |

`Partial` was **banned**. The register has 141 rows and a guard fails on any status outside the three.
The register's own stated purpose: *"the recurring defect in this repository is built, tested,
documented as done, and never connected. Prose cannot catch that; a register that is checked against
the code can."*

**Call-site evidence over document claims.** Every row names its call site or names why it is
unreachable. A later pass replaced name-based greps with an alias-aware import resolver, because
name-based greps miss aliased imports — the specific bug that had produced the false `Inert` claims.

## 9. The anti-theatre gates — the software now audits itself

Five gates run in CI and refuse the build when the codebase lies about itself. **These did not exist
before.** They are the structural answer to §5: instead of a document asserting the code is complete,
the build fails if it is not.

| Gate | What it refuses to accept | Verified result |
|---|---|---|
| G2 no-dead-code | a `public` function with no production caller | 533 functions reachable, 39 allow-listed |
| G3 config-effect | a configurable field with no proving test | 50 matrix rows, 41 ENFORCED |
| G4 wiring | a `src/data` export no component imports | every export reachable |
| G5 two-sources | a component reading both seed and database | clean — **the §4 defect class is now gated** |
| G6 RPC parity | an RPC the app calls that is absent from the schema | 116 RPCs present |

Read those two columns against §4. **G5 is the gate that would have caught the two-UIs problem. G3 is
the gate that would have caught the inert configuration. G2 is the gate that would have caught the 15
uncalled functions.** The gates were designed directly from the audit's findings — each one exists to
make a specific observed failure impossible to repeat silently.

All five pass locally on A.

## 10. The two critical defects were fixed

**The app now reads its own database.** Phase 1 built a tenant data loader that hydrates the shell
from Supabase through `jwt_org_id()`-scoped RPCs, replacing the DEV-only seed as the only source, and
converted the parallel in-memory mutations into calls to the real RPCs.

**And the test that proves it is the right test.** The acceptance criterion was deliberately chosen as
the anti-theatre test: *a Playwright spec that runs against a **production build**
(`npm run build && npm run preview`, not `npm run dev`), signs in as a seeded org, and asserts that an
engagement created via SQL appears on the dashboard.* That single test would have caught the entire
headline defect. A's `playwright.config.ts` now runs the production build; `main` still runs
`npm run dev`. **The suite can no longer pass by running in the one mode where the product worked.**

**The lifecycle is now real.** Phase 2 added `set_engagement_stage(p_engagement_id, p_to_stage,
p_expected_stage)` — append-only transition log, rights checks, the existing stage guards, and
`expected_stage` for optimistic concurrency — and wired planning → testing → conclusion through it.
`signoff_role_*` and `testing_mode` are now enforced. `runPreflight` is wired into `freeze_report` and
the freeze gates on `preflight_acks`. The report graph root is persisted so `verify_report_root` has
data.

## 11. The last wholly-missing clause was built

`docs/NOT-DONE.md` listed **§2 cross-universe view-only sharing** as the one clause with no
implementation at all — no share table, no RPC, no projection, no notification, no screen. It is now
built, together with three partial clauses in the same migration
(`0095_scale_harden_sharing_preflight.sql`):

- **§10.1 configurable grace period** — `testing_grace_hours` (0–336, default **0**). The default of 0
  reproduces the previous hard-lock behaviour exactly, so the change is additive by construction.
- **§11.4 central pre-flight** — a pure module of eight checks plus an append-only acknowledgement
  store. The builder recorded that the first migration *claimed* append-only in prose and shipped no
  guard, and a later migration added it. **The builder caught its own version of the §5 defect.**
- **§2 sharing** — grant/revoke, expiry, revocation, in-app and email notification, and a screen.

**The security claim, which is the part to scrutinise.** The builder's position is that every share is
**intra-organisation**, so the tenant predicate `org_id = public.jwt_org_id()` is only ever *added to*
and never relaxed. That is the correct reading of the platform's second law — a sharing path may add
restrictions, never remove them — and it is the only reading under which a sharing feature is safe at
all. **It is also the claim most worth falsifying independently**, because a mistake here leaks one
tenant's data into another's session, and the entire product is sold on that not happening. Flagged in
§15.

## 12. Builder B — the Systeligon build

The briefing above has been A-weighted, because A's branch is the one that carried the remediation of
the audit findings. That understates the second workstream, which is substantial and is where the name
**Systeligon** comes from. B's branch is `feature/systeligon-build-v1` (`51c4156`), ledger
`docs/SYSTELIGON-TASKS.md`, **110 commits ahead of the merge base**.

B's ledger reports **50 DONE / 12 DEFERRED**, with no Partial, Missing, TODO, DOING or BLOCKED rows.
Its measured surface is the **largest of any branch**:

| Metric | A (`scale-harden-v1`) | B (`systeligon-build-v1`) |
|---|---|---|
| Vitest files | 215 | **255** |
| Guards | 22 | **26** |
| SQL test files | 121 | 118 |
| Feature-register `Wired` rows | 60 | **91** |
| Feature-register `Absent` rows | 47 | **26** |
| Anti-theatre gates | G2–G6 | G7–G10 |

*B's vitest test count is reported (2954) and was not reproduced by me; its file, guard and register
counts were.*

**What B built.** The explain layer **E1–E10** — `src/lib/explain/` with `explainFor(user, id,
context)`, redaction, a level-2 guard, the `ExplainPopout` on `HoverPreview` (non-blocking, tooltip plus
`role="complementary"`), IIA standards as data mapped to real screens and RPCs, hover cards and detail
panels across sampling methods, fields, statuses and terms, drilldown from every aggregate to its
filtered records (deep-linkable, no blocking modal), a standards view, and gates G7 (explain coverage),
G8 (drilldown) and G9 (IIA honesty).

Plus functional UI rows **U1** (every dashboard number drills to its exact filtered records), **U2**
(command palette), **U3** (work queue as the front door), **U4** (live activity spine on the existing
`liveSync` transport), **U6** (guided empty states), **U8** (keyboard-first with a `?` shortcut sheet),
**U14** (dead comment dock removed); specification work **S17–S21**; test work **T3–T7**; decision
records **D1–D4**; foundation work **F1–F7**; and gates **G7–G10**.

**The 12 deferrals, stated precisely.** `E8` (`PencilGuide` + guidance data), `U5` (motion that signals
state change only), `U7` (density toggle), `U9`–`U13` (three new themes, four audience profiles,
time-of-day phases, the motion system, animated headers). Every one is a **visual-design** item held
pending an owner design-language decision. They are legitimate deferrals, not parking, and they remain
visible in the ledger rather than being counted as done.

**Note the collision this creates.** A's `U1`/`U3` (pencil-style guided pointers, guided first-run)
overlap B's deferred `E8`, both landing on `src/lib/guidance/`. A's ledger records the collision
explicitly and states its intention to reuse one shared guidance module rather than write a parallel
one. That is the correct call and it is why the remaining guided-first-run work needs **one owner, not
two** — see §15 item 5.

## 13. Breadth added across both branches

*Reported by the builders, evidenced by commits and migrations rather than by my own re-execution of
each feature's tests. Listed as scope added, not as verified behaviour.*

- **The explain layer (E1–E10):** every aggregate number drills to its filtered records, with IIA
  standards mapped to real screens and RPCs, and access-filtered detail.
- **Realtime notification delivery** and the pop-out synchronisation path.
- **Production-build end-to-end testing** — the suite runs against the built artefact.
- **Multi-org isolation under real concurrency.**
- **Methodology and test steps as client-configurable data** — this was "Absent" in the audit's table.
- **A deterministic UI inventory:** 98 screens, 116 RPCs, regenerating byte-identically.
- **Month-named financial statements** — the feature that introduced defect §12.1. It works; it
  arrived without its type declaration.

**One self-correction worth recording,** because it is the behaviour the new method demands: an
explain-id attribution defect was found where the catalogue had been inferred by substring match
across the source, so one screen absorbed 216 identifiers and another absorbed none. It was replaced
with real JSX mount analysis, and a guard now fails on drift. **The builder found its own
false-positive metric and fixed the method rather than the number** — which is precisely what had
failed to happen during the period described in §5.

---

# PART THREE — Where it stands

## 14. Defects found in *this* review

These are new — found during the current review, not carried from the audit above.

| # | Defect | Class | Severity | Impact |
|---|---|---|---|---|
| 12.1 | `period` written to a type that does not declare it | realised | **Critical** | `main` cannot compile |
| 12.2 | `@electric-sql/pglite` missing from `package.json` | realised | **High** | CI red; local green |
| 12.3 | 7 migration numbers double-allocated across branches | **latent** | **Critical if merged** | silent schema drift |
| 12.4 | Two `UI-INVENTORY.md` files, two generators | realised | **High** | design track has no source of truth |
| 12.5 | `G1` ledger row says TODO; work is done | realised | **Low** | doc hygiene |
| 12.6 | Unpushed commit edits the other builder's ledger | process | **Medium** | breaks the tracking mechanism |

### 12.1 — `main` cannot compile

`src/lib/analytics.ts` writes a `period` field onto row objects. `AnalysisResultRow` in
`src/types/index.ts` does not declare it.

```
src/lib/analytics.ts(68,5): error TS2353: 'period' does not exist in type 'AnalysisResultRow'.
src/lib/analytics.ts(381,9): error TS2353: 'period' does not exist in type 'AnalysisResultRow'.
```

Commit `7b9bc07` added three `period: resolvePeriod(...)` usages and never added the field to the
type. `analytics.ts` is byte-identical between 2026-10-27 and now, and the error reproduces at
`491bd4a`, which predates any CI change. **The last green CI on `main` was `d26ea59`, 2026-10-26
10:37; the very next commit is `7b9bc07`.** Red for three days. Verified fix: two lines, `tsc` exit 0
(was 1, exactly 2 errors), analytics tests 5 passed.

**Note the shape of this defect.** It is §5's pattern in miniature: a feature was added, tested, and
documented as working — and its type declaration was never written, so nothing built. The audit's
warning is still live.

### 12.2 — The gates ran on an undeclared dependency

`check-config-effect.mjs`, `check-dead-code.mjs` and `check-rpc-parity.mjs` import
`@electric-sql/pglite`, which appears in **no** `package.json` on **any** branch — it was installed
`--no-save`. All five gates pass locally and fail in CI. A's CI log ends
`FAIL: @electric-sql/pglite is not installed`, after steps 1–12 passed with **215 files / 2474 tests
green**.

**This is §5's defect class recurring in the verification layer itself** — a gate that passes on the
author's machine for a reason CI does not share. The first instance was a CI step asking for secret
names that did not exist. Both produced false confidence rather than false alarm. It should be treated
as a systemic weakness, not two incidents, and it is the strongest argument for running the gates in
CI rather than trusting a local green.

### 12.3 — Seven migrations share a number (Critical if merged)

```
0110  A=0110_phase4_methodology.sql          B=0110_sira_continuity_acceptance.sql
0111  A=0111_phase5_monitor_runner.sql       B=0111_evidence_storage.sql
0112  A=0112_phase5_alert_enrichment.sql     B=0112_integrity_alarm.sql
0113  A=0113_phase5_delivery.sql             B=0113_attestation_package.sql
0114  A=0114_phase5_alert_actions.sql        B=0114_incident_wizard.sql
0115  A=0115_tenant_suspension_enforced.sql  B=0115_capability_library.sql
0116  A=0116_phase6_workpaper_creation.sql   B=0116_activity_spine.sql
```

`0090`–`0106` are **byte-identical** on both branches; divergence begins exactly at `0110`.

**Why this is the most dangerous item here.** Because the *filenames differ*, git will merge this
**cleanly and silently** — no conflict marker. The result is a replay order neither builder chose, in
which two unrelated migrations share a position. Both suites replay in filename order and assert on
the resulting schema, so the failure surfaces later and elsewhere, as schema drift between
environments — precisely the failure mode this platform exists to detect in its customers. Nothing has
been merged, so nothing is corrupted yet.

### 12.4 — Two inventories, two generators

`docs/UI-INVENTORY.md` is meant to be the single source of truth for a parallel UI redesign. It is
generated, and both branches generate it with **different tools** (A: `node scripts/gen-ui-inventory.mjs`;
B: `npx tsx scripts/gen-ui-inventory.mjs`). The files are 1684 and 2038 lines. A's regenerates
deterministically — `1684 lines, 98 screens, 116 RPCs`, byte-identical. Two inventories is zero
inventories.

### 12.5 / 12.6 — Ledger and process integrity

`G1` is marked `TODO` but the work is done. A local unpushed commit (`a350d1e`) edits
`docs/SYSTELIGON-TASKS.md`, which belongs to Builder B; `BRANCH-MAP.md` states the mechanism outright —
*"One branch owns one ledger. No two branches edit the same ledger file."* — and a prior commit on A's
branch already reverted this same mistake once.

**Honest note.** The ledgers are the mechanism by which "done" is decided, and this review found two
cases where they overstated. That is not misconduct; it is the normal drift of self-reported status,
and it is exactly the drift the §8 method was built to catch. It is why every figure below is labelled.

## 15. Progress

Baseline is `main` as it stands today. A and B are **parallel branches from a shared ancestor** —
neither contains the other; they diverge at 31 and 28 commits. Their numbers are not additive, and the
merged total will be lower than the sum because both rebuilt overlapping ground.

| Metric | `main` | A (`scale-harden-v1`) | B (`systeligon-build-v1`) |
|---|---|---|---|
| Migrations | 87 | 116 | 114 |
| SQL test files | 92 | 121 | 118 |
| Vitest files | 144 | 215 | 255 |
| Vitest tests | — (does not build) | **2474** *(verified in CI log)* | 2954 *(reported)* |
| Guards | 18 | 22 | 26 |
| Playwright specs | 25 | 30 | 30 |
| Type check | **fails, 2 errors** *(verified)* | **exit 0** *(verified)* | **exit 0** *(verified)* |
| Anti-theatre gates | none | 5, all passing *(verified)* | G7–G10 |
| Feature register | **absent** | 60 Wired / 37 Inert / 47 Absent | 91 Wired / 28 Inert / 26 Absent |
| Ledger | — | 46 DONE / 4 TODO | 50 DONE / 12 DEFERRED |
| Commits ahead of merge base | — | 113 | 110 |

**Scale of the work, measured.** A alone is **113 commits, 479 files changed, 55,213 insertions**
against `main`. That is the distance between "two half-products" and where it now stands.

**The register is the most honest row in that table.** `main` does not have one. A reports 60 of 141
rows `Wired`, 37 `Inert`, 47 `Absent`. Those `Inert` and `Absent` counts are the point: the project
now *knows* what is not connected, and states it, rather than describing it as `Partial`.

**What I verified vs what is reported.** I reproduced: A's type check, A's five gates, A's CI test
count, A's inventory determinism, `main`'s failure and its exact error count, and every branch's file
counts. I did **not** reproduce B's test pass counts — I confirmed its commits, divergence and clean
type check. B's figures are reported as reported. The feature-register counts are the builders'.

**B's 12 deferrals are legitimate** — all visual-design items (motion, density, themes, audience
profiles) held pending an owner design decision. A deferral is not a completion, and they remain
visible.

## 16. What remains

**Blocking, in order:**

1. Repair `main`'s type error (§12.1) — two lines. Nothing proceeds sanely while the base is red.
2. Declare `@electric-sql/pglite` (§12.2) — one line. Unblocks A's CI.
3. Renumber the collided migrations and update the branch map (§12.3) — **before any merge**.
4. Settle one inventory and one generator (§12.4).
5. Build `U1`/`U2`/`U3` — guided first-run: *zero → first sealed report with no further code.* This is
   the commercially important one and it overlaps a deferred item on B, so it needs one owner.
6. Correct the stale `G1` row (§12.5).
7. Write `docs/SCALE-PLAN.md` — required by the original brief, present on no branch.

**The 47 `Absent` and 37 `Inert` rows in the register are the real remaining backlog.** They are
enumerated with evidence in `docs/FEATURE-REGISTER.md`, which is the document to read for the true
scope.

**Not achievable by engineering, and not claimed as done:**

- Making the repository private (a patent-disclosure clock is running).
- Adding a proprietary licence.
- Deploying the edge functions.
- Supplying connector credentials through the wizard.
- Re-recording the tutorial media against the final interface (committed assets are placeholders).

**The one claim to falsify first.** §11's sharing-path security assertion — that `jwt_org_id()`
equality is only ever added to, never relaxed. A mistake there leaks tenant data between organisations.
The independent evaluation commissioned alongside this briefing is instructed to attack it directly,
with a positive case (a share works) and negative cases (a non-Head cannot grant; a revoked share is
invisible; ordinary tenant data remains isolated).

**No item in this briefing is presented as complete unless it was reproduced.**

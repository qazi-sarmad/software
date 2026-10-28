# Systeligon — the deterministic forensic engine

Owner requirement (2026-10-28). This document is the buildable specification, and it is written to
keep one promise: **everything described here is deterministic, hard-coded, and calls nothing
external.** No AI, no model calls, no embeddings, no network dependency. Law L1 holds.

The name is the owner's. The boundary in §7 is the part that must be read before promising anything
to a client.

---

## 1. What it is

A rule engine and document analyser that runs inside the tenant, over the tenant's own data, and
produces findings that name the rule, the rule version, and the rows that triggered them — so any
finding can be reproduced exactly, forever.

It is not a model. It does not "understand" anything. It applies rules and reports what matched.

---

## 2. The three ways it is used

### 2.1 Automatic, on population upload

1. The auditor drops a population file.
2. The engine **counts it and analyses its shape**.
3. **Header detection.** If the data is not simple, the engine detects the header row; if it is
   ambiguous, it shows the auditor the detected headers and **asks for confirmation** before the true
   population is counted. The header row is excluded from the count. This is the existing behaviour —
   `PopulationPanel.tsx:59` already does `rowCount = lines.length - 1` — but today it *assumes* row 1
   is the header. The engine must instead detect, propose, and confirm.
4. The population is registered with its hash and its confirmed row count. The database already
   refuses to verify a population without both, and refuses any sample that points at an unverified
   population (L3).
5. The auditor is offered **Systeligon** for this test.

### 2.2 If Systeligon is accepted

- The engine runs its rule pack over the population.
- It returns the rows it **requires evidence for**.
- It **auto-populates rows below** the tested set, with the remark fields it needs.
- The auditor attaches evidence and writes remarks.
- The engine **verifies the evidence** against the remark (§6) and **reverts** the row if it is not
  satisfied.
- The auditor **may close anyway**, but only with a remark, and that override is **explicitly carried
  forward and shown to the reviewer at the next stage** — the reviewer must not have to discover it.

### 2.3 If Systeligon is declined

- The sampling method and controls are chosen, which fixes the number to be extracted: **the floor**.
- The auditor self-populates the drawn floor of rows.
- **Paste behaviour.** Pasting a block copied from a spreadsheet fills every cell it covers — the
  header row pasted from Excel maps onto the column headers automatically. This is deterministic
  clipboard parsing, not magic.
- **If the population is larger than the floor**, rows are added automatically and the tested number
  updates. The floor is a minimum, never a ceiling.
- Evidence may be attached **per row, or as one package for the whole test** (a single PDF, a zip, a
  workbook).
- Verification then runs in whichever mode the org configured (§6).

**This flow is the flow for every stage wherever testing happens** — planning walkthroughs, control
tests, substantive testing — not just the testing stage. The methodology and the stage names are
org-configurable (Phase 4).

---

## 3. What the engine can actually do

Honest capability list. "Detect" always means "match a rule and report the match".

### 3.1 Numeric and structural forensics — strong

| Rule family | What it finds |
|---|---|
| Benford's law | Digit-distribution deviation across a value column |
| Duplicates | Identical or near-identical records (same amount, vendor, date) |
| Sequence gaps | Missing invoice, receipt, journal or cheque numbers |
| Round-number clustering | Suspicious over-representation of round values |
| Just-below-threshold | Values clustered immediately under a limit |
| Weekend / holiday / after-hours | Postings outside business time |
| Segregation of duties | The same actor recording and approving, or creating and paying |
| Reconciliation breaks | Two sources that should agree and do not |
| Completeness | Expected records absent for a period, entity or source |
| Rate and velocity | Unusual volume of activity by actor, account or day |
| Cross-source consistency | The same fact stated differently in two systems |

### 3.2 Document review — strong for structure, limited for meaning

The engine reads documents deterministically (see §5) and can find:

- Missing required elements (a minute with no quorum, a contract with no signature block, an
  approval with no date).
- Inconsistencies **across** documents (the amount in the invoice is not the amount in the approval).
- Internal inconsistencies (a date after the report date, an end before a start, a total that does
  not equal its parts).
- Contradictions between documents (the same figure with two different values).
- Absent follow-through (a prior action item with no corresponding later record).

### 3.3 Sequential documents — minutes, action tracking, policy comparison

This is where the engine earns its keep on documents, and all of it is deterministic.

**Action-item tracking across a series of minutes.** Given minutes in date order, the engine
maintains a register and follows each item forward:

- An action raised in minute 1 with an owner and a due date, checked against every later minute.
- Items **carried forward** — raised, not closed, and not mentioned again.
- Items that **vanish** — raised, then never appear in any later minute. Silence is a finding.
- Items **closed with no evidence** — marked done, but no document supports it.
- Items **reopened** — closed, then raised again.
- Items **closed before they were raised**, or closed by someone other than the owner.
- Owner and due date **changed** without a recorded decision to change them.
- An item whose due date **passes** with no status change.

Because the whole register is derived from the documents, the engine can show, for any action item,
its complete history: every minute it appears in, in order, with the exact text that mentioned it.
That history is the evidence, and it is reproducible.

**Policy against procedure against regulation.** The engine compares two or more document sets and
reports the mismatches:

- A **policy** clause with no corresponding **procedure** step — stated intent, no mechanism.
- A **procedure** step with no enabling **policy** — an action with no authority behind it.
- A **regulation** requirement not covered by any policy or procedure — a coverage gap.
- A **policy** that contradicts another policy, or a procedure that contradicts a regulation.
- The **same rule stated differently** in two documents, with the differences shown side by side.
- A policy **version** that changed without the procedure being updated to match.
- A control in the register with no procedure step, and a procedure step with no control.

**How comparison works without a model.** Documents are parsed into structure — headings, numbered
clauses, obligation sentences, defined terms, references. The engine then matches on those structures:
shared defined terms, shared reference numbers, obligation verbs ("must", "shall", "is required to"),
and explicit cross-references. It reports **what it matched and what it could not match**, and it
shows the two passages side by side with their locations. It does not decide which document is right.
That is a human call, and it is recorded as such.

The engine is explicit about its own coverage: it reports how many clauses it parsed, how many it
matched, and how many it **could not interpret** — because an unparsed clause is not a clean clause,
and silently ignoring one would be the same class of lie as the config panel that read nothing.

**Structural pattern rules** (unchanged from before):

- A decision recorded with no quorum, no owner, or no action item.
- An action item with no responsible person or no due date.
- A prior decision with no recorded outcome.
- In configuration and source: hardcoded credentials, `SELECT *`, an external call with no error
  handling, an unbounded loop, a disabled check, a dead branch, a hardcoded environment value.
- In Power Query: a step whose declared output does not match the step that follows; a merge with no
  matching key; a filter that removes the rows the stated logic depends on.

**It cannot judge whether a decision was wise, whether a policy is sound, whether code is correct in
intent, or whether a minute reflects good governance.** It finds the *shape* of a problem and shows
the evidence. A human decides what the shape means. This is the boundary, and §7 explains why it must
not be crossed.

---

## 4. Rule packs

- Rules live under `src/lib/systeligon/rules/`, pure and versioned.
- Every rule declares `id`, `version`, `kind`, `params`, `appliesTo`, and the IIA standards it
  supports (see `docs/iia-standards-reference.md`).
- A rule pack is a named, versioned bundle shipped per audit type, so a new client gets a working
  rulebook on day one.
- **Adhoc rule builder**: pick a source, a condition, a threshold. Deterministic, and the built rule
  is saved as a versioned artifact like any other.
- **Rule templates per methodology** — org-configurable, consistent with Phase 4.

---

## 5. Document extraction (deterministic, no network)

Three tiers, in this order:

1. **Native extraction (always first).** A digital PDF has a text layer; read it directly. DOCX is a
   zip of OOXML — `src/lib/docxImport.ts` already parses it with mammoth (BSD-2-Clause). XLSX already
   has a parser (`src/lib/xlsx`). This covers the large majority of real evidence at almost no size
   cost.
2. **OCR (lazy-loaded, bundled).** Only for scans and images with no text layer. The engine is
   **bundled, not called** — nothing leaves the tenant. It is loaded on demand so it costs nothing
   until someone actually drops in a scan. This is the tier the owner asked for: hard-coded, zero
   external reliance.
3. **Structured extraction.** Fields (vendor, date, amount, reference, period, signature presence) are
   pulled by declared parsers, not by inference.

Everything extracted is stored with the **source hash**, so a finding can always be traced to the
exact bytes that produced it.

---

## 6. Evidence verification — the two modes, and their limit

The org configures one, per audit or per org:

**Mode A — completeness.** Every tested row has a remark and a closed decision of `effective` /
`ineffective` (the words themselves are org-configurable). This is a structural check and is exact.

**Mode B — evidence against remark.** The engine checks that the evidence:
- exists and is reachable;
- matches the declared type;
- hash-matches what was recorded at attachment time;
- covers the period, entity and amount the remark claims;
- has internally consistent structured fields.

**What Mode B does not do** is decide whether the evidence *proves* the remark in a human sense. It
checks that the evidence is real, present, the right kind, and consistent with the claim. A human
still owns the judgement. §7 explains why this line is where it is.

---

## 7. The boundary — read this before promising anything

The owner's ambition is that Systeligon should feel "almost unbelievable that this is not a
top-tier AI model". The honest position:

**For everything in §3.1 and the structural parts of §3.2, a rule engine is genuinely better than an
LLM** — because it is reproducible, attributable, versionable, and cannot hallucinate a finding that
no rule produced. An auditor can defend a rule-based finding. They cannot defend "the model thought
so."

**For open-ended semantic judgement — is this decision reasonable, is this code logically correct,
does this minute reflect good governance — a rule engine cannot do it, at any level of effort.** No
amount of engineering turns pattern matching into comprehension. Claiming otherwise would be the same
class of lie as the config panel that saved a value nothing read: it would look like a capability and
be nothing.

So the promise is: **Systeligon is a forensic rule engine that finds anomalies, inconsistencies and
known defect patterns, and can prove why.** That is a genuine market differentiator, it is defensible
to a regulator, and it is buildable. It is not a model and must never be described as one — not in the
UI, not in a sales conversation, not in this document.

If model-based interpretation is ever wanted, it is a Law change: a written owner decision, an
amendment to `src/guards/noAi.test.ts` made deliberately, and a capability that is clearly labelled and
never silently influences a sealed report.

---

## 8. Over-the-air rule updates

The owner asked for updates through Super Admin. That path **is an attack surface**: whoever can push
a rule pack can change what the audit engine concludes. Therefore:

- Rule packs are **signed** (reusing `signing_keys` from `0096_integrity_anchoring.sql`).
- They are **versioned and append-only**, on the existing config-as-ledger spine.
- Every pack is **attributable**: a sealed report records the pack version that scored it.
- An unsigned or unverifiable pack is **refused**, and the refusal is logged.

Done this way, over-the-air updates are a feature. Done casually, they are a way to change results
without a trace.

---

## 9. The report writer, under Systeligon

Systeligon is the umbrella. The report writer is one of its surfaces, not a separate product: the same
engine that flags a row, tracks an action item across minutes, or matches a policy to a procedure also
assembles the report that presents those findings — so a finding and its write-up cannot disagree,
because they come from one source.

Already substantially built, and this should be credited: `DesignCanvas.tsx` (rulers, snap grid, zoom,
drag, resize, multi-column flow, design shapes), `FormatCanvas.tsx`, `ReportFormatPanel.tsx`,
`FigureStudio.tsx`, `DesignPane.tsx`, with pure geometry in `src/lib/writing/designCanvas.ts`, plus
`compose.ts`, `canonical.ts`, `bundle.ts` and the render pipeline.

What is added:

1. **Org-wide format adoption.** Upload an existing report; the engine detects its structure,
   typography, palette and page setup, and proposes a format. Deterministic: DOCX styles and PPTX
   themes are known XML parts. The codebase already references PPTX theme extraction.
2. **Auto-detect fonts and colours** from the uploaded template, and map them onto the org's format.
3. **Generated design elements** — a library of deterministic, parameterised figures and blocks
   (charts, callouts, dividers, tables) the user can drop in. Generated from data and tokens, never
   from a model.
4. **Findings flow straight into the report.** A Systeligon finding carries its rule id, version and
   source rows; the report renders it with that provenance intact. The writer never restates a finding
   in its own words, because a restatement is where a fact can drift.
5. **Editable at every stage** — before drafting, during, after, and after management comments. A
   format is a versioned artifact, so re-adjusting formatting never alters a fact.

This pairs with the font repository requirement: self-host the curated set, drop the Google CDN
dependency, store per-font licence metadata, allow org upload, and auto-detect from the client's own
templates.

---

## 9a. Intellectual property — read this before filing or publishing anything

The owner asked whether Systeligon is patentable. It is a fair question and the answer has an urgent
practical edge, so it is recorded here rather than left to a later conversation. **This is not legal
advice; it is a plain statement of the facts and the deadline.**

**The urgency.** The repository is **public** on GitHub, created 2026-09-30 and pushed to as recently
as today. In most jurisdictions, a **public disclosure starts a clock**: in the United States you have
**twelve months from first public disclosure** to file, after which your own disclosure can be used
against you; in the **UK and most of Europe there is effectively no grace period at all** — a public
disclosure before filing destroys novelty outright. The commit history is the disclosure date, and it
is provable. So the clock is already running and may already have expired in Europe.

**Therefore, in order of priority:**

1. **Make the repository private now.** It costs nothing, it stops the clock advancing, and it is
   already on the owner-action list. This is the single highest-value action available today.
2. **Add a proprietary licence.** The repo currently has **no licence**, which is better than a
   permissive one — but it should state "all rights reserved" explicitly.
3. **Talk to a patent attorney before filing anything further or describing the mechanism publicly.**
   Do not publish the mechanism in a blog post, a sales deck or a demo before that conversation.

**What is genuinely strong here, and what is not.** A patent needs an *inventive step*, not just a
good product. The strong candidate is narrow and specific: **a deterministic, reproducible method for
verifying audit evidence and cross-document consistency that records rule identity, rule version and
source provenance for every finding, such that a sealed output can be re-derived and independently
verified.** That is a concrete method with a technical effect. What is **not** patentable is "software
that analyses audits" — that is an abstract idea and will be rejected. The defensibility in practice
will come more from the accumulated rule library, the IIA mappings and the sealed-output provenance
than from the concept alone.

**The honest strategic note.** For a product this size, **copyright over the code, trademark over the
name, and trade secret over the rule library** are likely to matter more than a patent, and cost far
less. A patent filing is expensive and slow; the owner has said there is no budget. Trade secret
protection — keeping the rule library private and the repository closed — is free and immediate.

**A caution on the name — and why this one is different.** The previous candidates were both in use:
`systellect.com` is taken (registered 2010, a live "Engineering Intelligence" AI consultancy) and
`systelligence` has prior open-source use. **`systeligon` checked clean** on 2026-10-28:

| Check | Result |
|---|---|
| `systeligon.com` RDAP record | **no record — available** |
| DNS: `.com`, `.io`, `.ai`, `.app` | **no resolution on any** |
| npm registry | **not found** |
| GitHub repositories | **zero** |

That is a materially better position, but **it is not trademark clearance.** A domain being free
means nobody bought the domain; it does not mean nobody registered the mark. Two caveats to hold:

- **Register the domains now.** They are cheap and the availability can change within days of any
  public mention. `.com` and `.io` at minimum.
- **Search the trademark registers before printing it on anything** — USPTO (US), UKIPO (UK), EUIPO
  (EU), and any market being sold into. I can only report the signals above; I cannot give a clearance
  opinion, and an unavailable domain was the *weaker* signal of the two.

The name stays in **one constants module** (task S16) regardless, so a rename remains one commit.

**Owner actions, and only these:** make the repository private; add a proprietary licence; engage
patent counsel if a filing is wanted; run a trademark search on the final name. No further code work
is blocked by any of this.

---

## 11. Where this can be stretched

The owner asked what else the system can be engineered to do. This section records the honest answer:
what the existing assets genuinely support, what is novel, and what must not be attempted.

**Sequencing warning, stated first.** Nothing in this section starts until the current build is
finished — Phases 1–6, gates G1–G10, Systeligon S1–S16, fonts F1–F7. The failure mode for an
ambitious product is not a lack of ideas; it is starting the next one before the last one works. This
section exists so the ideas are **captured and not lost**, not so they are started.

### 11.1 The category shift — the biggest available move

Today this is a **point-in-time audit tool**: someone runs an audit, the tool helps, the report is
sealed. The assets already present — deterministic monitors, connectors, a versioned rule library,
sealed and timestamped outputs — support a different category: **continuous assurance**. Rules run on
a schedule against client systems, and the client learns about a control failure the week it happens
rather than the year after.

That is a category change, not a feature, and it is the single largest available expansion. It needs
no new invention, only the monitor runner (Phase 5) pointed at a schedule.

### 11.2 Adjacent products built from the same assets

Each of these reuses the engine rather than extending it, which is why they are credible:

| Product | Reuses | Notes |
|---|---|---|
| **Continuous control monitoring** (SOX/ICFR) | monitors + connectors + rules | Control testing is what the engine already does |
| **Regulatory coverage attestation** | policy/procedure comparison (§3.3) | Encode a regulation as obligations, produce a coverage matrix |
| **Data quality assurance** | forensic rules (§3.1) | Sellable to a CFO with no audit at all |
| **Third-party / vendor assurance** | same engine over questionnaires | Different inputs, identical machinery |
| **Forensic investigation support** | journal-entry testing, duplicate payments, vendor-master analysis | The strongest rule families already |
| **Grant / funding assurance** | lifecycle + evidence verification | Compliance-shaped, well suited |
| **Multi-entity / franchise assurance** | one rulebook across many entities | Compare like with like |
| **Certification-grade evidence packs** | `0096` anchoring + Merkle + timestamps | See §11.3 |

### 11.3 The genuinely novel capability: verifiable attestation

This is the one worth protecting. Because outputs are **hash-chained, signed, Merkle-rooted and
timestamped**, Systeligon can produce an assurance package that a **third party can verify without
trusting the producer** — a regulator, a board, or a counterparty re-derives the root and confirms
nothing changed.

Almost nothing on the market does this, because it requires the discipline of deterministic rules and
append-only config that this codebase already has. It is also, not coincidentally, the strongest
patent candidate (§9a).

### 11.4 Deterministic capabilities not yet built

- **Cross-engagement systemic detection.** The same finding recurring across engagements is a
  systemic issue, not N isolated ones. Deterministic within one tenant; see the L2 warning below.
- **Control dependency graph.** Model which controls depend on which, so the engine can answer "if
  this control fails, what else is exposed." Pure graph traversal.
- **Deterministic exposure simulation.** Given a failed control and the affected rows, compute the
  value at risk. Arithmetic over data already held.
- **Audit plan optimisation.** Given risks, resources and a period, produce a schedule that covers the
  required risk. Constraint solving, deterministic.
- **Sampling optimisation.** Minimum sample size for a stated confidence and materiality
  (Clopper-Pearson is already on the Phase 2 list).
- **Control metrics over time.** Trend the engine's own output: is the control environment improving?

### 11.5 The moat is the discipline, not the features

Worth being explicit, because it changes what to invest in: the defensible asset is **the explain
layer plus sealed provenance** — every number traceable to a rule, a version and a row, and every
output independently verifiable. Competitors can copy a feature list. Copying the discipline means
rebuilding their data model, and that is why it is the moat.

The rule library is the second asset, and it should be held as a **trade secret** (§9a).

### 11.6 What must not be attempted

- **Open-ended semantic judgement.** §7. No amount of effort changes this.
- **Cross-tenant data pooling.** Law L2 forbids tenant data leaving the tenant. Benchmarking across
  clients would break it. If ever wanted, it requires explicit per-client consent, aggregation with
  a minimum cohort size, and a written Law change — not a feature flag.
- **Anything calling a model.** Law L1. This is a written decision to reverse, not a design choice.

### 11.7 If only one is pursued

**Continuous assurance (§11.1)**, because it reuses what is already built, changes the category rather
than the feature list, and makes the sealed-attestation story (§11.3) recur monthly instead of
annually.

---

## 12. Work packages

| # | Task | Depends on |
|---|---|---|
| S1 | `src/lib/systeligon/` — rule schema, runner, versioning, result shape | — |
| S2 | Header detection + confirm-before-count in the population flow | — |
| S3 | The accepted-Systeligon flow (flag → rows → evidence → verify → revert/override) | S1 |
| S4 | The declined flow: floor, paste-to-fill, auto-add rows beyond the floor, package evidence | — |
| S5 | Mode A / Mode B verification, org-configurable | S1 |
| S6 | Forensic rule library (§3.1) — one pure module per family, each versioned and tested | S1 |
| S7 | Document extraction tiers 1–3, with source hashes | — |
| S8 | Structural document review rules (§3.2) | S7 |
| S9 | Pattern rules for minutes, config, source and Power Query (§3.3) | S7 |
| S10 | Rule packs per audit type + adhoc rule builder | S1 |
| S11 | Signed OTA rule-pack distribution | S1 |
| S12 | Override visibility: an override at one stage is shown to the reviewer at the next | S3 |
| S13 | Report writer under Systeligon: org format adoption + font/colour auto-detect + generated elements + findings-to-report provenance | — |
| S14 | Sequential minutes: action-item register, carry-forward, vanish, reopen, close-without-evidence | S7 |
| S15 | Policy / procedure / regulation comparison, with coverage reporting | S7 |
| S16 | Name held in one constants module so a rename is one commit | — |

---

## 11. Acceptance

- A population upload detects headers, asks for confirmation, and counts the true population minus
  the header row.
- Systeligon, when accepted, flags rows, requests evidence, auto-populates, verifies, and reverts
  on failure — with the override path visible to the next reviewer.
- When declined, the floor is enforced as a minimum, paste fills cells, and rows are added beyond the
  floor when the population is larger.
- Every finding names its rule, its version, and its source rows, and re-runs identically.
- No rule, no extraction step and no update path calls anything external; the no-AI guard still passes.
- A sealed report records the rule-pack version that scored it.
- The editor adopts an uploaded report's structure and typography, and formatting stays editable at
  every stage without altering a fact.

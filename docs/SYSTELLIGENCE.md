# Systelligence — the deterministic forensic engine

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
5. The auditor is offered **Systelligence** for this test.

### 2.2 If Systelligence is accepted

- The engine runs its rule pack over the population.
- It returns the rows it **requires evidence for**.
- It **auto-populates rows below** the tested set, with the remark fields it needs.
- The auditor attaches evidence and writes remarks.
- The engine **verifies the evidence** against the remark (§6) and **reverts** the row if it is not
  satisfied.
- The auditor **may close anyway**, but only with a remark, and that override is **explicitly carried
  forward and shown to the reviewer at the next stage** — the reviewer must not have to discover it.

### 2.3 If Systelligence is declined

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

### 3.3 Minutes, configuration, code and Power Query — pattern-level, not comprehension

The engine can find **known structural patterns**:

- A decision recorded with no quorum, no owner, or no action item.
- An action item with no responsible person or no due date.
- A prior decision with no recorded outcome.
- A policy statement contradicted by another document.
- In configuration and source: hardcoded credentials, `SELECT *`, an external call with no error
  handling, an unbounded loop, a disabled check, a dead branch, a hardcoded environment value.
- In Power Query: a step whose declared output does not match the step that follows; a merge with no
  matching key; a filter that removes the rows the stated logic depends on.

**It cannot judge whether a decision was wise, whether code is correct in intent, or whether a
minute reflects good governance.** It finds the *shape* of a problem. A human decides what the shape
means. This is the boundary, and §7 explains why it must not be crossed.

---

## 4. Rule packs

- Rules live under `src/lib/systelligence/rules/`, pure and versioned.
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

The owner's ambition is that Systelligence should feel "almost unbelievable that this is not a
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

So the promise is: **Systelligence is a forensic rule engine that finds anomalies, inconsistencies and
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

## 9. Editor — Canva-style report formatting

Already substantially built, and this should be credited: `DesignCanvas.tsx` (rulers, snap grid, zoom,
drag, resize, multi-column flow, design shapes), `FormatCanvas.tsx`, `ReportFormatPanel.tsx`,
`FigureStudio.tsx`, `DesignPane.tsx`, with pure geometry in `src/lib/writing/designCanvas.ts`.

What is added:

1. **Org-wide format adoption.** Upload an existing report; the engine detects its structure,
   typography, palette and page setup, and proposes a format. Deterministic: DOCX styles and PPTX
   themes are known XML parts. The codebase already references PPTX theme extraction.
2. **Auto-detect fonts and colours** from the uploaded template, and map them onto the org's format.
3. **Generated design elements** — a library of deterministic, parameterised figures and blocks
   (charts, callouts, dividers, tables) the user can drop in. Generated from data and tokens, never
   from a model.
4. **Editable at every stage** — before drafting, during, after, and after management comments. A
   format is a versioned artifact, so re-adjusting formatting never alters a fact.

This pairs with the font repository requirement: self-host the curated set, drop the Google CDN
dependency, store per-font licence metadata, allow org upload, and auto-detect from the client's own
templates.

---

## 10. Work packages

| # | Task | Depends on |
|---|---|---|
| S1 | `src/lib/systelligence/` — rule schema, runner, versioning, result shape | — |
| S2 | Header detection + confirm-before-count in the population flow | — |
| S3 | The accepted-Systelligence flow (flag → rows → evidence → verify → revert/override) | S1 |
| S4 | The declined flow: floor, paste-to-fill, auto-add rows beyond the floor, package evidence | — |
| S5 | Mode A / Mode B verification, org-configurable | S1 |
| S6 | Forensic rule library (§3.1) — one pure module per family, each versioned and tested | S1 |
| S7 | Document extraction tiers 1–3, with source hashes | — |
| S8 | Structural document review rules (§3.2) | S7 |
| S9 | Pattern rules for minutes, config, source and Power Query (§3.3) | S7 |
| S10 | Rule packs per audit type + adhoc rule builder | S1 |
| S11 | Signed OTA rule-pack distribution | S1 |
| S12 | Override visibility: an override at one stage is shown to the reviewer at the next | S3 |
| S13 | Editor: org format adoption + font/colour auto-detect + generated elements | — |

---

## 11. Acceptance

- A population upload detects headers, asks for confirmation, and counts the true population minus
  the header row.
- Systelligence, when accepted, flags rows, requests evidence, auto-populates, verifies, and reverts
  on failure — with the override path visible to the next reviewer.
- When declined, the floor is enforced as a minimum, paste fills cells, and rows are added beyond the
  floor when the population is larger.
- Every finding names its rule, its version, and its source rows, and re-runs identically.
- No rule, no extraction step and no update path calls anything external; the no-AI guard still passes.
- A sealed report records the rule-pack version that scored it.
- The editor adopts an uploaded report's structure and typography, and formatting stays editable at
  every stage without altering a fact.

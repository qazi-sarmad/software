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


### 5a. Recognising what was handed over

The owner asked whether the system auto-recognises document types, handles `.zip` and `.rar`, and
reads titles and data. The verified state first.

**What exists.** `jszip` is a dependency, so ZIP is available. `mammoth` handles DOCX, `xlsx` handles
spreadsheets, `pdf-lib` handles PDF. Routing is by **extension**, via guards such as `isDocx(filename)`
(`src/lib/docxImport.ts`) and `isSupportedPopulationFile(name)` (`src/lib/population.ts`).

**What is missing.**

- **No magic-byte detection.** An extension is a claim, not a fact. A `.xlsx` renamed `.csv` is
  misrouted; a `.exe` named `.pdf` is attempted. Detection must read the leading bytes: `PK\x03\x04`
  (zip, and therefore also docx/xlsx/pptx), `%PDF-`, `\xD0\xCF\x11\xE0` (legacy Office),
  `Rar!\x1A\x07`, `\x89PNG`, `\xFF\xD8\xFF` (JPEG), `II*\x00` / `MM\x00*` (TIFF).
- **No `.rar` support.** No RAR library is present. This needs a deliberate decision, not a reflex
  install: the RAR decompressor is licence-restricted, so the options are a permissively licensed
  implementation, asking the user to convert, or refusing the format with a clear message.
- **Office formats are themselves ZIPs.** Detection must identify docx/xlsx/pptx from the archive's
  entry names (`word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml`) *before* treating it
  as a plain archive, or every DOCX is unpacked into XML fragments.
- **No title or metadata extraction.** DOCX carries `docProps/core.xml` (title, author, created,
  modified) and `docProps/app.xml`; XLSX carries the same parts; PDF carries `/Info` or XMP. All are
  plain XML, all parseable deterministically, none needs a model.
- **No recursion.** An archive is not unpacked into its members and routed individually.

**The design.**

1. **Sniff magic bytes first.** The extension is a hint, never the decision.
2. **Classify**: office document, PDF, image, archive, tabular, unknown.
3. **For an archive, unpack with hard limits** — maximum entries, maximum uncompressed size, maximum
   compression ratio (a zip bomb is a denial of service), reject absolute and `..` paths (path
   traversal), never execute anything, and record every member's hash.
4. **Recurse** into each member with a depth limit, routing each through step 2.
5. **Extract per format**: title, author, created and modified dates, headings, tables, defined terms,
   dates and amounts — into a structured record that keeps the source hash.
6. **Return an inventory** of what was found so the user confirms before anything is imported. Same
   confirm-before-count principle as S2.
7. **Report anything unrecognised as unrecognised.** Never silently skipped — an unparsed file is not
   an empty file.

**Boundary.** This recognises *form*, not *meaning*. It can say "this is a DOCX, titled X, with 14
headings and 3 tables." It cannot say "this document approves the budget." That is §7.

---

## 6. Evidence verification — the two modes, and their limit

### 6.0 Evidence storage — the finding, stated plainly

The owner asked whether all evidence and attachments are stored in the app. **They are not, and this
is the most serious gap found in this review.** Verified:

- **`EvidenceTab.tsx` has a working upload control.** It reads the file, computes its SHA-256 in the
  browser, and calls `attachEvidenceToWorkpaper`.
- **`attachEvidenceToWorkpaper` (`src/context/AppContext.tsx:730`) never writes the bytes anywhere.**
  It builds an in-memory item `{id, name, uploadedAt, uploadedBy, sha256, sizeBytes}` and appends it to
  `workpaper.evidenceItems` in React state. There are **zero** `storage.from(...).upload(...)` calls in
  the entire file. The file's contents are discarded when the tab closes.
- **Only `reportFiles.ts` uploads anything at all** — the rendered report PDF and DOCX, to a
  `reports` bucket. Those are the only bytes that leave the browser.
- **`evidence_files` (migration `0035_document_viewer.sql`) has no storage column.** Its columns are
  `id, org_id, engagement_id, workpaper_id, filename, stage, content_sha256, created_by, created_at`.
  There is **nowhere to record where a file's bytes live**, and nothing inserts into it except a
  select in `documents.ts`.
- **No storage bucket is created anywhere.** No migration, script, edge function or config declares
  `reports`, `archives`, `org-branding` or any other bucket. The code assumes they exist.

**What this means in practice.** An auditor uploads a bank statement. The screen says the file is
attached and shows a SHA-256. The record survives only until the page reloads. There is no file to
retrieve, no document to view, no evidence to verify — and critically, **the hash that the evidence
verification mode depends on is a hash of bytes nobody kept.** Mode A and Mode B (§6.1, §6.2) both
compare a stored hash against a re-derived one; with no stored bytes, there is nothing to re-derive.

This is the same defect class as the unwired monitors and the missing tamper alarm — built, tested,
never completed — but the consequence is worse, because the product's central claim is that evidence
is verified. **An evidence verification feature with no stored evidence is a claim the product cannot
support.**

**The fix, in order:**

1. **Create the buckets** in a migration or a documented setup step: `evidence`, `reports`,
   `archives`, `org-branding`, each private, with RLS on `storage.objects` keyed to
   `jwt_org_id()` by path prefix so one tenant can never read another's object.
2. **Add `storage_path`, `mime_type`, `byte_size` and `content_sha256` to `evidence_files`**, and
   insert the row only after the upload succeeds — the same ordering `reportFiles.ts` already uses.
3. **Upload on attach.** Write the bytes, then the row, then the ledger entry. Never the reverse.
4. **Re-derive on verify.** Download by path, re-hash, compare to `content_sha256`. That is what makes
   Mode A and Mode B real rather than decorative.
5. **Signed, short-lived URLs** for viewing, never public objects.
6. **Enforce the size cap** already configured in `OrgGovernancePanel` ("Evidence upload limits") and
   the 25 MB the UI promises.
7. **Delete the false affordance** if any of the above is not done. A control that appears to store
   evidence and does not is worse than no control, because it manufactures confidence.

Until step 1–4 are done, the evidence tab must carry a visible "stored in this session only" warning
rather than implying persistence. Honesty about the limit is the §7 principle applied to ourselves.

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

## 10. Intellectual property — read this before filing or publishing anything

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

### 11.1 Continuous assurance — what exists, and what is missing

The owner asked four specific questions. Each is answered from the code, not from opinion.

**What does continuous controls monitoring actually do?** The engine has six deterministic rule kinds
(`src/lib/writing/monitors.ts`):

| Kind | Fires when |
|---|---|
| `threshold` | A field crosses a value (any payment over X) |
| `rate` | A field's count or sum over a window exceeds a limit (N postings by one user in an hour) |
| `sequence` | Ordered fields appear out of order (approval recorded before the request) |
| `set_membership` | A signal's tags do not include required tags (a payment with no matching PO) |
| `missing_event` | An expected event does not arrive within an interval (a control test never run) |
| `reconciliation` | Two sources disagree on the total of a field (invoice total vs ledger) |

Each rule carries `id`, `version`, `status`, `description`, and produces an alert with the **plain-words
reason composed from the rule** (never generated), the **staged records it derives from with their
content hashes**, and the evaluation time as an argument. Alerts are hash-chained (`verifyAlertChain`).
There is also triage: `open` / `dismissed` / `snoozed` / `escalated`, and `isReportable`.

That is a real, well-built engine. Now the honest part.

**Is it wired well? No — it is not wired at all.** Verified:

- **`runMonitors` and `evaluateMonitor` are called only from test files.** Nothing in `src/data/`,
  `src/components/` or `src/hooks/` invokes them. The engine is dead code in the product.
- **No alert ever reaches the UI.** A search for `MonitorAlert` and `watcher.signal` outside tests
  returns nothing. So the answer to "are anomalies real-time reported?" is **no — they are not
  reported by any means**, real-time or otherwise.
- **Alerts carry no linkage.** `MonitorAlert` has `ruleId`, `ruleVersion`, `kind`, `reason`,
  `references`, `evaluatedAt`. There is **no field for department, entity, SIRA risk, or control.**
  So the answer to "does it identify the relevant department, match it to its SIRA, and show inherent
  and residual risk?" is **no — none of that exists on the alert**, although the pieces to join it
  exist elsewhere (see below).
- **No adhoc audit is suggested from an alert.** `adhoc` appears in `src/data/plan.ts` and
  `PlanItemsPanel.tsx`, so adhoc plan items exist as a concept — but nothing connects an alert to one.

**What does exist, and makes the join feasible.** This is why the work is a build, not an invention:

- **SIRA already models risk**: `inherentRisk`, `inherent_rating`, `residualRisk`, `residual_risk`
  appear across `src/data/sira.ts`, the types and the migrations. Inherent and residual risk are
  already first-class.
- **Department linkage already exists in planning**: `src/lib/findingTarget.ts` has `departmentsOf()`,
  `auditsForDepartment()` and `workpapersForAudit()`. The join from a finding to a department to its
  audits is already written.
- **Scheduling infrastructure exists**: `pg_cron` is used, with ten scheduled jobs across migrations
  (`0074_scheduled_jobs.sql` and others). The runner can be scheduled without new infrastructure.
- **Realtime and a poll fallback already exist**: `src/lib/liveSync.ts` implements exactly the design
  asked for — `chooseTransport()` returns `realtime` when a Supabase Realtime channel reaches
  `SUBSCRIBED`, otherwise `poll`, with `DEFAULT_POLL_INTERVAL_MS = 5000` and a one-second floor. It is
  pure and takes elapsed time as an argument. Notifications already have `useLiveNotifications` and
  `NotificationBell`.

**So the build is a set of joins, not a new engine:**

1. **A scheduled runner.** Call `runMonitors` on a `pg_cron` schedule per org, over that org's staged
   signals. Persist alerts. Emit `watcher.signal`.
2. **Alert enrichment.** Extend `MonitorAlert` with the resolved `entityId`, `department`, `siraRiskId`,
   `inherentRisk`, `residualRisk` and the affected `controlId`s. This is the owner's requirement and it
   is the highest-value part: an alert that says "this department's residual risk is high and this
   control just failed" is worth ten alerts that say "a rule fired."
3. **Delivery.** Push into the Work Queue (in-app) and by email, using the existing notification
   templates and the liveSync transport. Real-time when Realtime is up, poll otherwise — already solved.
4. **Adhoc audit suggestion.** From an alert, offer to raise an adhoc plan item, pre-filled with the
   entity, department and control. The plan already supports adhoc items; this is the missing link.
5. **Remediation wizard.** From an alert, the actions that resolve it (create a finding, raise a CAP,
   request evidence, escalate, dismiss with reason). Every action explained by the explain layer.

**The owner's instinct is the right one.** Enrichment is what turns the engine from a rule-firer into
something a Head of Audit opens every morning. An alert with its department, its SIRA position, its
inherent and residual risk, and a one-click path to an adhoc audit is a different product from an
alert with a rule id.

### 11.1a Capabilities not yet listed, all deterministic

Additional competencies the assets support, in rough priority:

**Risk and control intelligence**
- **Residual-risk drift**: track each SIRA risk over time and flag movement before it breaches tolerance.
- **Control coverage matrix**: which risks have controls, which controls have tests, which have neither.
  Gaps become findings. Pure set arithmetic over the register.
- **Control effectiveness history**: per control, the trend of test outcomes, so a control failing three
  times running is visibly failing rather than three unrelated events.
- **Key-control indicator**: flag controls whose failure affects the most other controls (dependency
  graph, §11.4).
- **Risk appetite breach**: compare live exposure against the org's stated appetite and flag breaches.

**Population and evidence intelligence**
- **Population profile**: automatically describe a population — row count, value range, null density,
  duplicate density, period coverage — and flag anything implausible before testing starts.
- **Stratification suggestion**: propose the strata and sample sizes from the population's own shape.
- **Evidence sufficiency**: does the attached evidence cover the whole tested period and value, or only
  part of it? Deterministic date and range arithmetic.
- **Evidence freshness**: evidence dated after the report date, or before the period it purports to cover.
- **Chain-of-custody**: every evidence item carries who attached it, when, and its hash, so any later
  change is detectable.

**Process and governance intelligence**
- **Segregation-of-duties matrix**: derive who can do what from the roles and rights data, and flag
  conflicting combinations. The rights model already exists.
- **Delegation-of-authority breach**: approvals above a person's limit.
- **Policy exception register**: exceptions granted, to whom, by whom, for how long, and whether expired.
- **Meeting-governance score**: quorum present, actions assigned, prior actions closed — per meeting,
  trended. Reuses §3.3.
- **Regulatory change impact**: when a regulation version changes, list every policy and procedure that
  references it and is now out of date. Reuses the comparison engine.

**Assurance operations**
- **Engagement health**: is this engagement behind, over budget, or blocked, from its own timestamps and
  status history.
- **Reviewer load and ageing**: how long items sit in review, by reviewer. Deterministic arithmetic.
- **Finding ageing and recurrence**: findings open too long, and findings recurring across periods.
- **Report consistency**: the same figure appearing in two places in a report with different values —
  caught before issue, not after.
- **Audit trail completeness**: every required event present for each engagement, with the gap named.

**Platform and trust**
- **Tamper alarm**: the user-facing half of `0096`. Verify roots on a schedule and raise a signal when a
  signature or timestamp fails. Detection exists; the alarm does not.
- **Sealed-output verifier**: an independent re-derivation tool so a third party can verify a package
  without trusting the producer (§11.3).
- **Ledger continuity check**: verify the hash chain has no gap, on a schedule, and alert if it does.

Every item above is a pure function or a join over data already held. None requires a model.


### 11.1b SIRA continuity — does a year's work feed the next year?

The owner asked whether a completed year's SIRA produces recommendations for the next version, and
whether continuous-audit anomalies feed back into it. Verified state, then design.

**What exists — more than expected.**

- **SIRA is already cyclic.** `sira_cycles` is keyed `(org_id, universe_id, year)` (`0020_sira_cycles.sql`).
  A cycle is created per year, scored, then published.
- **Emergent risk is already first-class.** `SiraEmergentRisk` carries `universeId`, `entityId`,
  `title`, `description`, and a decision of `accepted`/`rejected` **with a reason**
  (`decideEmergentRisk`). That is precisely the channel an anomaly should enter through.
- **Planning already pre-fills from SIRA.** `populate_planning_suggestions()` (`0025_planning.sql`)
  reads the latest *published* cycle's scores for the engagement's entity and returns suggestions
  carrying `inherent_rating`, `risk_band`, `risk_name` and `prior_finding_count`. It applies nothing —
  the auditor accepts or rejects each item, logged by `decide_planning_suggestion`.
- **Prior-year import is built AND wired.** `prior_year_imports` (`0044_prior_year_import.sql`)
  imports risk/control mapping, scope, procedures and resource estimates, marked `imported_confirm`
  until confirmed, and `PriorYearImportPanel` is rendered inside `PlanningPanel`.

**What is missing — the owner's point.**

- **`populate_planning_suggestions` and `decide_planning_suggestion` have ZERO non-test callers.**
  The SIRA pre-fill is a dead RPC. The data path exists; nothing calls it.
- **A published cycle does not seed the next.** `create_sira_cycle` inserts a bare draft row. Prior
  scores, accepted emergent risks and the year's findings are not carried forward. Every year starts
  from nothing.
- **Anomalies do not reach SIRA at all.** Alerts are unwired (C1) and carry no entity link (C2), so
  there is no path into emergent risk.
- **`prior_finding_count` counts all findings ever**, not the prior period's. It is a count, not a
  carried-forward assessment.

**The design — a closed loop.**

1. **Close the year.** On publication, produce a **carry-forward pack**: each risk's prior score and
   band, the movement, the findings that touched it, the controls that failed, and the emergent risks
   accepted during the year. Deterministic, from records already held.
2. **Seed the next cycle.** `create_sira_cycle` optionally takes the prior cycle and pre-populates
   scores marked `carried_forward`, so the auditor adjusts rather than retypes. Every carried value
   keeps its provenance.
3. **Feed anomalies in.** An alert (C2) with a resolved entity and control raises a **proposed
   emergent risk** through the existing `submitEmergentRisk` channel, carrying the alert id, the rule
   version and the affected rows as evidence. Accepted or rejected with a reason, as now.
4. **Feed findings in.** Findings closed during the year propose control changes on the affected
   risks, again as suggestions.
5. **Close the loop visibly.** The cycle view shows, per risk: prior score, current score, what moved
   it, and the evidence.

**The acceptance rule — the owner's correction, and it is the right one.** The accept/reject/override
control belongs with the role that finalises and reviews the SIRA for the next year, and it should
stay there. But **the finaliser's decision is a proposal, not a closure.** The owner's words: it
should be there, it should be reminded, it should be shown — but ultimately it needs acceptance from
**the auditors themselves**.

So the flow is two-key, not one:

1. **The engine proposes.** Carry-forward items and anomaly-derived risks arrive as suggestions with
   their evidence attached.
2. **The finaliser sees them, cannot miss them, and acts.** The SIRA cycle for the next year will not
   publish while proposals are outstanding. They are surfaced on the cycle, counted on the dashboard,
   and reminded by notification until resolved. The finaliser may **accept**, **reject with a reason**,
   or **override** — the override capability stays, exactly as the owner wants.
3. **But acceptance is the auditor's.** An item the finaliser accepts is not closed; it is
   *endorsed* and routed to the auditor responsible for that risk or entity. Only their acceptance
   closes it. A finaliser override that the auditor has not accepted is visible as such, and it does
   not silently become the risk model.
4. **Everything is shown.** The cycle view displays, per item: who proposed it, what evidence, what
   the finaliser decided and why, who accepted it and when, and how long it has been waiting. Nothing
   closes quietly.
5. **Silence is a finding.** A proposal neither accepted nor rejected by its deadline is reported as
   outstanding, the same way a vanished action item is (§3.3).

The principle is the one already used by `decide_planning_suggestion`, extended: **the system
proposes, the finaliser endorses, the auditor accepts, and every step is logged with a reason.** A
single role able to both propose and close would be a control weakness, and the audit profession
would say so. The two-key design is what makes this defensible to an external reviewer.

### 11.1c Making the interface feel outrageously good — what to build, and what not to

The owner asked what would make the dashboards and UI "sexier, too-good-to-be-true, interactive."
The honest answer has a shape: **the interface should feel like it already knows what you need, and
every number should be one click from its proof.** Flashy is easy and worthless. What follows is
ordered by effect per unit of work.

**The foundation already exists and should be credited.** 150 design tokens in `src/styles/tokens.css`,
a nine-step type scale (`apple-11` to `apple-40`), a contrast test, a floating non-modal window
manager, d3 for charts, and five gates that protect the UI (`check-tokens`, `check-ui-contract`,
`check-shrink`, `check-tutorials`, `check-function-deploy-list`). This is a real design system. Do not
rebuild it.

**Tier 1 — the things that make it feel alive (highest value, all deterministic)**

1. **Everything is one click from its proof.** Every number on every dashboard opens the exact
   filtered records behind it. This is already law (the explain layer) but it is what separates a
   dashboard that looks good from one that is *trusted*. A CFO who can click "£4.2m" and see the 63
   rows is a different experience from one who has to ask.
2. **The command palette.** `Cmd/Ctrl-K` opening everything: screens, records, actions, and the
   explain layer. In a product with this many screens, it is the single highest-leverage interaction.
   Type "benford" and go straight there. Type an entity name and jump to it.
3. **The work queue as the front door.** Not a dashboard of charts — a list of what needs *you*,
   today, ordered by consequence. "3 CAPs overdue. 1 report awaiting your approval. 2 comments
   unanswered." Every item one click from the action. This is what makes a product feel indispensable.
4. **The live activity spine.** A quiet, non-intrusive stream — "Ayesha approved the SIRA cycle",
   "Report R-2026-014 was sealed" — using the `liveSync` transport that already exists. It makes the
   product feel inhabited. Realtime when available, poll otherwise, already solved.
5. **Progressive disclosure done well.** The screen shows the conclusion; the drilldown shows the
   evidence; the popout explains the term. Three depths, each one click, never a modal.

**Tier 2 — the things that make it feel expensive**

6. **Motion with meaning.** Numbers count up when they change. Rows slide in. A frozen report gets a
   brief seal animation. Motion should signal *state change*, never decorate. Must respect
   `prefers-reduced-motion` — one component already does; make it universal.
7. **The empty state as a guide.** A new org's dashboard should not be a wall of zeros. It should say
   "Create your first universe" with one button. This is the guided first-run requirement, and it is
   the difference between a product that feels finished and one that feels blank.
8. **Density that respects the professional.** Auditors read tables, not cards. A comfortable /
   compact / dense toggle, remembered per user. Card-heavy dashboards look modern and slow real work.
9. **Typography doing the work.** The nine-step scale is there. Use weight and size for hierarchy and
   stop using colour for it. Big numbers, small labels, generous whitespace — that is what "premium"
   actually means.
10. **Keyboard everything.** Every action reachable without a mouse. `?` opens the shortcut sheet.

**Tier 3 — the genuinely differentiating surfaces**

11. **The alert card that explains itself.** Once C2 is done, an alert reads: *"Duplicate payment
    £48,200 — Vendor Services — residual risk High — control CTRL-114 last failed 12 days ago"* with
    one-click "raise adhoc audit". That card, on a dashboard, is the product's best sales pitch.
12. **The SIRA heatmap that moves.** Risk position over time, animated across cycles. Deterministic,
    from data already held, and it makes a year of work visible in one image.
13. **The report builder as a canvas.** Already substantially built (`DesignCanvas`, rulers, snap,
    zoom, multi-column flow). It needs polish, not invention.
14. **A "verify this" affordance everywhere.** A small shield icon on every sealed artifact that
    opens the verification path. It makes trust visible rather than claimed.
15. **Guided pointers, done with taste.** The pencil-style hand-drawn arrows the owner asked for.
    One at a time, dismissible, keyboard-reachable, never blocking.

**What NOT to do — and this matters**

- **No gratuitous animation.** A spinning logo, a parallax hero, a gradient blob — all of it reads as
  a toy to the exact buyer (a Head of Audit, a CFO, an audit committee) you are selling to. Serious
  products look calm.
- **No dashboard of vanity charts.** Every chart must answer a question someone actually asks. A
  donut chart of "findings by severity" that nobody acts on is noise.
- **No dark patterns.** No fake urgency, no nagging, no "are you sure you want to leave" modals.
- **No AI-flavoured UI.** No "✨ AI insight" badges. The product's claim is determinism; decorating it
  as magic undercuts the one thing that makes it different. This is the §7 boundary in visual form.
- **No blocking modals, ever.** Already law, and it is the right law.

**The honest summary.** The "too good to be true" feeling in this product will not come from
visual flourish. It will come from **speed, certainty and depth**: the number appears instantly, you
can click it and see the proof, the term explains itself, and you never wonder whether it is right.
That feeling is earned by the explain layer and the wiring, not by gradients. The screens that will
make someone say "wait, it does *that*" are the alert card (11), the drilldown (1), and the command
palette (2) — all three cheap, all three deterministic, all three already half-built.

**One caveat on scope.** None of this replaces the wiring work. A beautiful dashboard over an unwired
monitor engine is a better-looking lie. Build Tier 1 first, and only after the data is real.

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

### 11.3 Verifiable third-party attestation — partly planned already, and worth completing

The owner asked whether this was already planned. **Yes, the foundation was — and much of it is
already built.** Being precise about the split matters:

**Already planned and built** (`supabase/migrations/0096_integrity_anchoring.sql`):

- `signing_keys` and `signatures` — report roots, certificates and daily ledger roots signed with an
  organisation key.
- `timestamp_authorities` and `timestamp_trust_anchors` — seeded, editable by Super Admin, never
  hard-coded, so "when" is provable and not merely asserted.
- `timestamp_requests` / `timestamp_tokens` — a queue that **never blocks sealing** (a seal writes a
  queued row and returns), with `min_authorities` defaulting to 2 so one compromised authority is not
  enough.
- The ledger is hash-chained and append-only, and `SPEC-v10.md` already requires exports to carry the
  filters applied, the timestamp, the user and a content hash.

**Already planned but not finished:**

- **The tamper alarm.** Detection exists; nothing tells a human. §11.1a "Platform and trust" covers it.

**Not planned — genuinely new:**

- **A verifier a third party can run.** Today the machinery *produces* signed, timestamped,
  Merkle-rooted outputs. Nothing lets an outsider — a regulator, a board, a counterparty, an acquirer —
  **re-derive the root and confirm nothing changed, without trusting the producer.** That is the
  product surface, and it is the part that is unusual in the market.
- **A portable attestation package.** A self-contained artifact (roots, signatures, timestamps, the
  rule versions that scored it, the verifying instructions) that can be handed over and checked offline.
- **Cross-implementation verification.** A published, documented procedure — not our code — so a third
  party can verify with their own tooling. That is what makes it attestation rather than assertion.

So the honest summary: the **cryptographic spine was planned and is largely built**; the
**third-party verification product was not planned at all.** The spine is the hard part and it is
done. Turning it into a verifiable package is comparatively small work, which is why this is worth
prioritising — and it remains the strongest patent candidate (§10).


### 11.3a Tamper response — what happens, who is told, how it is fixed

The owner asked what tampering would actually do, how they would be alerted, and how it would be
remediated. Answered from the code, then designed.

**What exists — more than was stated earlier.** Migration `0077_verified_archival.sql`:

- `integrity_alerts` table: `org_id`, `kind`, `object_type`, `object_id`, `expected_hash`,
  `actual_hash`, `detail`.
- `raise_integrity_alert(...)` — `security definer`, granted to `service_role` only — writes the
  alert **and appends an `integrity_alert` entry to the hash-chained ledger**. A detected tamper is
  itself recorded in the append-only trail.
- The archival functions call it: `population_archive_check` and `population_archive_verify` raise an
  alert when a stored hash does not match.
- `verify_report_root`, `verify_certificate`, `verify_board_pack` and `verify_ledger` exist, and
  `PublicVerifyRoute` is a real anonymous surface where an outsider can check a root.

**Question by question.**

**What would tampering do?** It makes verification **fail**. The stored root and the re-derived root
diverge; expected and actual hashes are recorded; an `integrity_alert` row is written; a ledger entry
is appended. The sealed output is not "corrected" and cannot be — the tamper is *proved*, permanently,
with the before and after values.

**How would you be alerted? Today: you would not.** Verified: `listIntegrityAlerts()` is exported from
`src/data/archival.ts` and **called from nowhere**, and no migration emits a notification or email for
an integrity alert. Detection is complete; **the alarm is missing.** A tamper today is recorded in a
table nobody reads — the same defect class as the unwired monitor engine.

**How it is remediated, guided.** T-series work:

1. **Detect without being asked.** A scheduled sweep (T1) verifies roots, signatures and timestamps; a
   ledger continuity check (T2) verifies the chain has no gap. Detection must not wait for a click.
2. **Alert on every channel that matters.** Work Queue item, email, and a dashboard banner to the
   org's integrity owners and the platform admin. Severity separates "a hash mismatch on one archive"
   from "the ledger chain is broken" — the second is an incident, not a warning.
3. **A guided incident wizard, not a message.** It shows in plain words: what changed, when, by whom
   (from the ledger and activity log), and what it affects — which report, archive, population or
   certificate. Then the options, each requiring a reason: **restore** from the sealed copy,
   **re-derive and re-seal** with an incident note, **freeze** the affected engagement, or
   **escalate** to the platform admin. Every action appends to the ledger.
4. **The incident record is itself append-only.** It cannot be deleted or edited, only annotated. An
   incident that can be quietly closed is not evidence.
5. **Explain every step.** Each option and its consequence is described by the explain layer.
6. **Verify afterwards.** Re-run verification and show the result, so the incident closes on proof
   rather than on assertion.

**A boundary worth stating plainly.** This is **tamper-evidence, not tamper-prevention.** Nothing here
stops a person with direct database access from changing a row. What it does is make the change
**provable** — the root no longer matches, the mismatch is recorded in a chained ledger, and the
expected and actual values are preserved. Prevention is an infrastructure-level problem. Claiming
prevention would be exactly the overstatement §7 exists to stop.

### 11.3b The review comment popout — status

The owner asked what the state of the review comment popout is. Verified answer: **it exists, it is
reachable, and it is the thinnest surface in the product.**

**What works.** `CommentHistoryPanel.tsx` is a real component, reachable from
`RecordContent.tsx` under the `comment_history` record type, which is dispatched from
`ReviewCommentsGlobalDock.tsx` via `openInspector('comment_history')`. `ReviewCommentsGlobalDock` is
mounted in `App.tsx`, so the path is live. It renders a thread and a reply box
(`handleSendReply`), and it is hosted in the floating, non-modal inspector window
(`FloatingWindowManager`) — so the "no blocking modals" law is respected. `src/lib/comments.ts`
holds the pure logic: `isCommentOpen`, `isLiveWorkingPaper`, `pendingComments`.

**What is missing.**

- **Almost no testids.** The panel has **one** testid, `bubble-mine` / `bubble-other`. The law
  requires every interactive element to carry `data-testid="<screenId>-<element>"`. There is no
  `<screenId>` prefix and no testid on the reply box, the send button, the thread container, or the
  empty state.
- **No documented states.** No loading, empty, error, denied or ready handling is visible in the
  panel. Every screen in the contract lists its states; this one has none.
- **Not in the inventory.** `docs/UI-INVENTORY.md` lists `comment_history` only as a row in the
  inspector-kinds table. It has no screen entry: no purpose, no route, no rights, no data functions,
  no RPCs, no testids, no inbound or outbound navigation.
- **`ReviewCommentsDock.tsx` is dead.** It is a second, older comment dock that is **mounted nowhere**
  — verified, zero importers outside its own file. It should be deleted, or it will be maintained by
  mistake.
- **No popout in the explain-layer sense.** The owner's ask is a *popout* — hover a comment and see
  the context, the workpaper, the engagement, the author, the age, the resolution path. What exists is
  a thread list in an inspector window. That is a dock, not a popout.
- **No drilldown.** There is no path from a comment to the exact record it concerns.

**The work.**

1. Give the panel a `screenId` and a testid on **every** interactive element.
2. Implement and document all states: loading, empty, error, denied, ready.
3. Add the full screen entry to `docs/UI-INVENTORY.md`.
4. Delete `ReviewCommentsDock.tsx`.
5. Build the actual popout: hover or focus a comment marker and show the author, the age, the
   workpaper and engagement, the status, and the resolution path — access-filtered through
   `src/lib/access.ts`, exactly like every other explain-layer popout, and keyboard-reachable.
6. Add drilldown from the comment to its record.
7. Cover it in the explain-coverage gate (G7).

This is small work with a disproportionate effect: review comments are where a reviewer spends their
day, and it is currently the least-built surface in the product.

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

The rule library is the second asset, and it should be held as a **trade secret** (§10).

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
| S17 | Document recognition: magic-byte sniffing, archive unpacking with bomb/traversal limits, office-inside-zip detection, metadata and title extraction, recursion, inventory-before-import (§5a) | S7 |
| S18 | SIRA continuity: carry-forward pack on publish, seed the next cycle, anomalies and findings proposed as emergent risk (§11.1b) | S1, C2 |
| S19 | Two-key SIRA acceptance: finaliser endorses, auditor accepts; publish blocked while proposals are outstanding; reminders until resolved; silence is a finding (§11.1b) | S18 |
| S20 | Evidence storage: create buckets with org-scoped RLS, add storage_path/mime/size to evidence_files, upload on attach, re-derive on verify, signed URLs, size cap (§6.0) | — |
| S21 | Review comment popout: screenId + testids on every element, all states, inventory entry, delete the dead ReviewCommentsDock, hover/focus popout, drilldown (§11.3b) | — |

### Continuous assurance (C-series) — spec §11.1

| # | Task | Depends on |
|---|---|---|
| C1 | Scheduled runner: `runMonitors` per org on `pg_cron`, persist alerts, emit `watcher.signal` | S1, Phase 5 |
| C2 | Alert enrichment: resolve entity, department, SIRA risk, inherent + residual risk, controls | C1 |
| C3 | Delivery: Work Queue in-app + email, via liveSync (realtime, poll fallback) | C1 |
| C4 | Adhoc audit suggestion from an alert, pre-filled with entity/department/control | C2 |
| C5 | Remediation wizard from an alert (finding, CAP, request evidence, escalate, dismiss with reason) | C2 |
| C6 | Alert triage surface with rights gating | C1 |
| C7 | Anomaly to SIRA: a resolved alert proposes an emergent risk carrying the alert id, rule version and affected rows | C2, S18 |

### Trust and attestation (T-series) — spec §11.3

| # | Task | Depends on |
|---|---|---|
| T1 | Tamper alarm: verify roots on a schedule, raise a signal on signature/timestamp failure | — |
| T2 | Ledger continuity check on a schedule | — |
| T3 | Portable attestation package (roots, signatures, timestamps, rule versions, instructions) | T1 |
| T4 | Third-party verifier: documented procedure usable with independent tooling | T3 |
| T5 | Attestation screen: view, export and verify a package | T3 |
| T6 | Guided integrity incident wizard: what changed, who, what it affects, then restore / re-derive / freeze / escalate, each with a reason, all append-only, verify afterwards (§11.3a) | T1 |
| T7 | Wire the existing alarm: surface integrity_alerts, notify on every channel, severity-split a hash mismatch from a broken ledger chain | T1 |

### Interface quality (U-series) — spec §11.1c

| # | Task |
|---|---|
| U1 | Drilldown from every dashboard number to its exact filtered records |
| U2 | Command palette (Cmd/Ctrl-K): screens, records, actions, explain layer |
| U3 | Work queue as the front door, ordered by consequence |
| U4 | Live activity spine on the existing liveSync transport |
| U5 | Motion with meaning, universal prefers-reduced-motion |
| U6 | Guided empty states for a new org |
| U7 | Density toggle (comfortable / compact / dense), remembered per user |
| U8 | Keyboard-first: every action reachable, `?` shortcut sheet |

### Deterministic capability library (D-series) — spec §11.1a

| # | Task |
|---|---|
| D1 | Risk and control intelligence (residual-risk drift, control coverage matrix, effectiveness history, key-control indicator, appetite breach) |
| D2 | Population and evidence intelligence (population profile, stratification suggestion, evidence sufficiency, freshness, chain-of-custody) |
| D3 | Process and governance intelligence (SoD matrix, delegation-of-authority breach, policy exceptions, meeting-governance score, regulatory change impact) |
| D4 | Assurance operations (engagement health, reviewer load and ageing, finding ageing and recurrence, report consistency, audit trail completeness) |

Each D-series item is a pure function under `src/lib/` with direct unit tests, plus a screen surface.

---

## 13. Acceptance

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

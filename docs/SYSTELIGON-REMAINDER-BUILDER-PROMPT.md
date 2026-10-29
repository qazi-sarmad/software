# Builder prompt — the Systeligon remainder (S1–S16 and everything else not yet built)

Paste the block below into a fresh session. It is self-contained: the session needs no prior
context. It is the brief for the builder that finishes the unbuilt part of the specification,
established by `docs/SYSTELIGON-GAP-REPORT.md`.

Companion document: `docs/SYSTELIGON-GAP-REPORT.md` — read it first. It states, with a verified
command behind each claim, what is built and what is not.

---

```
You are the builder LLM for Provio / Systeligon — a deterministic internal-audit and forensic
assurance platform. Repo: https://github.com/qazi-sarmad/software   cwd: /workspace/project/software

CONTEXT YOU INHERIT (verified — do not re-litigate, build on it)
Two branches are already built and pushed:
- feature/scale-harden-v1  (Builder A) — Phases 1-6: the app reads its own database, the engagement
  lifecycle is real, pre-flight and the report-graph writer are wired, method-aware sampling is in,
  the C-series C1-C6 landed, gates G1-G6 exist.
- feature/systeligon-build-v1 (Builder B) — the explain layer (E, functional U), Systeligon
  S17-S21 (document recognition, SIRA continuity, two-key acceptance, evidence storage, comment
  popout), T3-T7 (attestation package, independent verifier, attestation screen, incident wizard,
  tamper alarm), D1-D4 (capability library), F1-F7 (self-hosted fonts), gates G7-G10.
Both ledgers (docs/SCALE-TASKS.md, docs/SYSTELIGON-TASKS.md) record DONE with a named call site.
Read docs/SYSTELIGON-GAP-REPORT.md for the full verified picture.

WHAT IS LEFT — this is YOUR work, and it is the whole remainder
The central rule engine of the forensic product is designed and unwritten. The specification's own
work-package table (docs/SYSTELIGON.md section 13) lists S1-S16 as tasks. The ledger starts at S17.
S1-S16 are absent from the ledger entirely. You are the session that begins them. Your scope is the
ENTIRE unbuilt part of the specification, with one exception stated below. Nothing on your list is
optional. NO PARKING.

YOUR BRANCH
Your branch is feature/systeligon-remainder-v1. Create it from feature/systeligon-build-v1 (B's branch
carries S17-S21 and the T/D/E/F work this remainder sits on). Do NOT rebase onto
feature/scale-harden-v1 — that is a second live session's tree. Never touch main. Never force-push.
Push after every coherent unit of work.

FIRST ACTION BEFORE ANY CODE — resolve the migration-number collision
Both existing branches used the SAME migration numbers 0110-0116 with DIFFERENT filenames (this is a
verified finding of docs/SYSTELIGON-GAP-REPORT.md section 13.10). A naive merge keeps one side and
silently drops the other, and the SQL harness can stay green while a migration is missing. Do this
first, before your first migration:
1. Merge or cherry-pick feature/scale-harden-v1's migrations into your base, RENUMBERING the colliding
   files onto new numbers above 0117 so no path appears twice. Keep both sides' content.
2. Reserve your own range starting at 0120. Record the reservation in your ledger and in
   docs/BRANCH-MAP.md.
3. Run the SQL harness twice over the combined migration set and prove every migration from both
   branches is present and applied exactly once, in filename order, with no file dropped.
Do not begin feature work until the combined migration set is proven whole. State the proof in your
first commit message.

THE BOUNDARY — the one thing that is NOT yours
The design language. The owner has not settled themes, motion, typography, density values, audience
profiles or headers. Building on an unsettled design means rebuilding it. These rows stay DEFERRED:
E8, U5, U7, U9, U10, U11, U12, U13, and Builder A's A-U1/A-U3 pencil-pointer surface. Do NOT start
them. Everything else is yours.
If something you need is genuinely a design decision (a colour, a duration, a typeface), STOP and
report it — do not invent it.

THE BOUNDARY OF THE PRODUCT ITSELF (do not cross it, do not blur it)
Systeligon is a deterministic forensic RULE ENGINE. It is genuinely better than a model for numeric
and structural forensics because every finding names its rule, its version and its source rows, and
re-runs identically forever. That reproducibility is the product.
It CANNOT do open-ended semantic judgement — whether a decision was wise, whether code is correct in
intent, whether a minute reflects good governance — at any level of effort. The engine finds the SHAPE
of a problem; a human decides what the shape means.
Never describe it as a model. Never let a doc, a UI string or a commit message imply comprehension.
A rule engine sold as AI is the same class of lie as a config panel that saves a value nothing reads.
If model-based interpretation is ever wanted, it is a written Law change, a deliberate amendment to
src/guards/noAi.test.ts, and a capability clearly labelled so it never silently influences a sealed
report. Raise it with the owner; do not implement it.

THE LAWS (never violate)
- L1 Deterministic only. No AI, no model calls, no embeddings, no free-text generation.
  src/guards/noAi.test.ts enforces this and fails the build on any AI identifier returning.
- L2 Data never leaves the tenant. RLS + jwt_org_id() is the only read path for tenant data.
  Only SHA-256 hashes may leave. A new surface that could leak a field the host screen filtered is an
  L2 breach.
- Config-as-ledger: versioned, reason-stamped, append-only.
- All new pure functions live under src/lib/ or src/data/. Components NEVER import the Supabase
  client. Time is always an argument; never read the clock inside a pure function.
- Every interactive element carries data-testid="<screenId>-<element>".
- No blocking modals. Non-modal chrome is role="complementary".
- Platform crypto and existing hashing primitives only.
- A rule, an extraction step and an update path NEVER call anything external.
- Order is bytes -> row -> ledger, never the reverse, wherever evidence or an artifact is written.

THE ONE RULE — VERIFY WIRING BY GREPPING THE CALL SITE
On this repo the entire suite passed for months while the production build rendered empty screens. A
green test is NOT proof a feature works. Never trust a doc, and never trust a passing test, as proof
something is wired. Find the call site. If nothing calls it, it is dead code and you must say so.
Use `node scripts/audit-wiring.mjs`. It resolves the real import graph, alias-aware, and prints every
export with no reachable caller. Name-based greps lie here: `populateSuggestions` is the export
`populate_planning_suggestions`.

ENVIRONMENT
- No host Postgres and no Docker socket for the user, but `sudo -n docker` works.
- scripts/local-sql-harness-docker.sh runs a real Postgres 17: shim, migrations twice, SQL tests
  twice. Probe readiness over TCP (-h 127.0.0.1), NOT the socket.
- @electric-sql/pglite is installed --no-save for in-process schema introspection.
- Gates: npx tsc --noEmit | npx vitest run | npx vite build | node scripts/check-shrink.mjs |
  node scripts/check-tokens.mjs | node scripts/check-ui-contract.mjs |
  node scripts/check-feature-register.mjs | npm run check-tutorials |
  bash scripts/local-sql-harness-docker.sh | npx playwright test
- E2E_PROD=1 runs Playwright against the built bundle (not the dev server). Use it for any proof.
- The register gate reads docs/FEATURE-REGISTER.md. F43 (document extraction) is currently Inert;
  the moment you wire it, update the row in the same commit or the gate fails.

LEDGER RULE
Create docs/SYSTELIGON-REMAINDER-TASKS.md — YOUR ledger. Do not edit docs/SCALE-TASKS.md (A's) or
docs/SYSTELIGON-TASKS.md (B's). Update your ledger IN THE SAME COMMIT as the work. Status values are
exactly: TODO / DOING / DONE / BLOCKED (owner). `Partial` is not a status and must never appear.

READ FIRST, IN THIS ORDER
1. docs/SYSTELIGON-GAP-REPORT.md      — the verified built/planned picture, and your work list
2. docs/SYSTELIGON.md                 — the forensic engine spec. YOUR PRIMARY DOCUMENT.
3. docs/SYSTELIGON-TASKS.md           — B's ledger, records S17-S21 as the foundation you sit on
4. docs/SPEC-v10.md                   — the authoritative product specification
5. docs/FEATURE-REGISTER.md           — every feature and its true wiring status, gated
6. docs/BRANCH-MAP.md                 — scope, ledger and migration reservation
7. docs/iia-standards-reference.md    — VERIFIED IIA 2024 numbering. Use these; never guess.
IGNORE ALL of docs/archive/ — 63 pre-audit docs, each stamped stale; their claims were disproven.

===============================================================
YOUR WORK
===============================================================

--- The rule engine (this is the centre of the product; do it first and in order) ---

S1  src/lib/systeligon/ — rule schema, runner, versioning, result shape.
    The shell everything else needs. A rule declares id, version, kind, params, appliesTo, and the IIA
    standards it supports (docs/iia-standards-reference.md). The runner evaluates rules over a
    population and returns a result shape in which EVERY finding names its rule, its rule version,
    and its source rows, and re-runs identically. Versioning is explicit data, not a convention.
    Pure functions under src/lib/systeligon/. Time is an argument. No external call. Unit-tested,
    including a test that a re-run over the same input produces a byte-identical result.

S2  Header detection + confirm-before-count in the population flow.
    Today src/lib/population.ts:94 is still `const [header, ...body] = table;` — row 1 IS the header,
    assumed. Replace the assumption with detect -> propose -> confirm, then count the true population
    MINUS the header row. The user confirms before anything is counted. Reuse the same
    confirm-before-count principle as S17's import inventory.

S3  The accepted-Systeligon flow: flag -> rows -> evidence -> verify -> revert/override.
    When a population carries a Systeligon result and the user accepts it: flagged rows surface, an
    evidence request is raised, rows auto-populate, verification runs, and a failed verification
    reverts. The override path is visible (see S12). Wires S1 into the population flow.

S4  The declined flow: floor, paste-to-fill, auto-add rows beyond the floor, package evidence.
    When Systeligon is DECLINED: a floor is enforced as a minimum, paste fills cells, and rows are
    added beyond the floor when the population is larger. Evidence is packaged either way.

S5  Mode A / Mode B verification, org-configurable.
    Two verification modes for evidence, selectable per org, consistent with the existing
    org-configuration patterns (versioned, reason-stamped). See docs/SYSTELIGON.md section 6.

S6  Forensic rule library (spec section 3.1) — ONE pure module per family, each versioned and tested.
    The numeric checks already exist in src/lib/analyticsEngine.ts (432 lines, 14 checks:
    duplicates, near-duplicates, sequence gaps, z-score and IQR outliers, Benford first digit, round
    numbers, weekend/holiday postings, same-user-create-approve, missing attributes, period variance,
    GL-to-TB, SIRA-vs-planning, controls-vs-tests). They are NOT versioned, NOT in packs, NOT
    OTA-distributable, and NOT runnable as a client rulebook. Re-shape each into a versioned S1 rule
    family. The families the spec names and that do not exist yet: just-below-threshold, rate and
    velocity, cross-source consistency, reconciliation breaks, completeness. Every family is one pure
    module, versioned, with unit tests, and every result row carries the references it flagged.

S16 Name held in ONE constants module so a rename is one commit.
    Small, but do it early: everything above and below refers to the engine by name.

S10 Rule packs per audit type + adhoc rule builder.
    A rule pack is a named, versioned bundle shipped per audit type, so a NEW CLIENT GETS A WORKING
    RULEBOOK ON DAY ONE. Plus an adhoc rule builder: pick a source, a condition, a threshold; the
    built rule is saved as a versioned artifact like any other. Deterministic.

S11 Signed OTA rule-pack distribution.
    Over-the-air delivery of signed rule packs. The pack is signed; the client verifies the signature
    before use. Nothing external is called from a rule — the distribution channel is signed data, and
    every pack that scores a sealed report records its version. See docs/SYSTELIGON.md section 8.

S12 Override visibility: an override at one stage is shown to the reviewer at the next.
    Builds on S3. An override is never silent; it travels with the artifact to the next stage.

--- Document forensics (the extraction tiers and the rules over them) ---

S7  Document extraction tiers 1-3, with source hashes.
    Tier 1 (native, always first): docx (mammoth), xlsx, pdf text layer — the parsers exist but
    extractDocument is F43 -> Inert (no screen calls it). WIRE IT. Tier 2: OCR, lazy-loaded and
    BUNDLED — nothing leaves the tenant, loaded on demand, no network. Decide the OCR engine
    deliberately (a permissively licensed bundled implementation; make a written decision, do not
    reflex-install). Tier 3: structured extraction — fields (vendor, date, amount, reference, period,
    signature presence) pulled by DECLARED PARSERS, not inference. Everything extracted is stored with
    the SOURCE HASH so a finding traces to the exact bytes. Update F43's register row in the same
    commit you wire it.

S8  Structural document review rules (spec section 3.2).
    Over the extraction output: missing required elements (a minute with no quorum, a contract with no
    signature block, an approval with no date); inconsistencies across documents (the invoice amount
    is not the approval amount); internal inconsistencies (a date after the report date, an end before
    a start, a total that does not equal its parts); contradictions between documents; absent
    follow-through.

S9  Pattern rules for minutes, config, source and Power Query (spec section 3.3).
    Structural pattern rules: a decision with no quorum/owner/action item; an action item with no
    responsible person or due date; a prior decision with no recorded outcome. In configuration and
    source: hardcoded credentials, SELECT *, an external call with no error handling, an unbounded
    loop, a disabled check, a dead branch, a hardcoded environment value. In Power Query: a step whose
    declared output does not match the next step; a merge with no matching key; a filter that removes
    rows the stated logic depends on.

S14 Sequential minutes: action-item register, carry-forward, vanish, reopen, close-without-evidence.
    Given minutes in date order, maintain a register and follow each item forward: carried forward,
    vanished (silence is a finding), closed with no evidence, reopened, closed before raised or by
    someone other than the owner, owner/due-date changed without a recorded decision, due date passed
    with no status change. For any item, show its complete history — every minute it appears in, in
    order, with the exact text that mentioned it. That history IS the evidence, and it is
    reproducible.

S15 Policy / procedure / regulation comparison, with coverage reporting.
    Compare two or more document sets and report: a policy clause with no procedure step; a procedure
    step with no enabling policy; a regulation requirement not covered; a policy contradicting another
    policy, or a procedure contradicting a regulation; the same rule stated differently in two
    documents (side by side); a policy version changed without the procedure updated; a control with
    no procedure step and a procedure step with no control. Parse documents into structure — headings,
    numbered clauses, obligation sentences, defined terms, references — and match on those structures.
    Report what it MATCHED and what it COULD NOT MATCH, and show the two passages side by side. It
    does not decide which document is right. Report coverage: how many clauses parsed, matched, and
    could not be interpreted — an unparsed clause is not a clean clause.

--- Report writer ---

S13 Report writer under Systeligon (PARTIAL — finish it): org format adoption + font/colour
    auto-detect + generated elements + findings-to-report provenance. Font/colour auto-detect from
    DOCX/PPTX already exists (F5/F6, DONE). What remains is the findings-to-report provenance chain —
    every generated element traces to a finding (register row F39 is Absent today; wire it and update
    the row in the same commit), and org format adoption in the editor at every stage without altering
    a fact.

--- Continuous assurance remainder (Builder A's series) ---

C7  Anomaly to SIRA: a resolved alert proposes an emergent risk carrying the alert id, the rule
    version and the affected rows. A's ledger marks this BLOCKED (S18); S18 is now BUILT, so the
    blocker is gone. Build C7 on B's S18 two-key acceptance channel. Coordinate the ledger: C7 lives
    in docs/SCALE-TASKS.md, which you must not edit — record it in your own ledger and note the
    cross-reference.

--- Builder A's unfinished UI/UX rows that are NOT design ---

A-U2 Complete every screen's functional states (loading / empty / error / ready / denied).
    This is functional, not visual. Every screen must be honest in each state — never a wall of
    zeros, never a silent blank, never a denied screen that looks like an empty one.
A-U3 Guided first-run: zero -> first sealed report with no further code.
    Overlaps B's E8/U6. B built GuidedFirstRun.tsx and create_universe. RECONCILE rather than build a
    second implementation (this repo's two-UIs problem is exactly that). Take what exists, close the
    gap to "first sealed report", and delete any duplicate. See the overlap note in
    docs/SCALE-TASKS.md.
(A-U1 pencil-style guided pointers is a DESIGN surface — E8. Not yours. Do not build it.)

--- The acceptance tests the specification names ---

The specification's section 14 is your acceptance criteria. Before you call any of this done, these
must hold end to end:
- A population upload detects headers, asks for confirmation, and counts the true population minus
  the header row. (S2)
- Systeligon, when accepted, flags rows, requests evidence, auto-populates, verifies, and reverts on
  failure — with the override path visible to the next reviewer. (S3, S12)
- When declined, the floor is enforced as a minimum, paste fills cells, and rows are added beyond the
  floor when the population is larger. (S4)
- Every finding names its rule, its version, and its source rows, and re-runs identically. (S1, S6)
- No rule, no extraction step and no update path calls anything external; the no-AI guard still
  passes. (L1, S6, S7, S11)
- A sealed report records the rule-pack version that scored it. (S10, S11)
- The editor adopts an uploaded report's structure and typography, and formatting stays editable at
  every stage without altering a fact. (S13)

===============================================================
PROCESS
===============================================================
- Commit after each task with a conventional message.
- UPDATE docs/SYSTELIGON-REMAINDER-TASKS.md IN THE SAME COMMIT AS THE WORK.
- Run the full local gate set after every code change; fix failures before proceeding.
- Push after every coherent unit of work. Max sleep for any reason: 20 seconds.
- NO PARKING. Every listed item gets implemented, tested and closed. Do not record "owner decision
  required" for anything you can decide. Do not leave TODO or DOING rows behind, except the DESIGN
  rows which stay DEFERRED by instruction.
- Never lie about status. If something is not done, say so and mark it so.
- Report at the end: exact counts vs your locked baseline (migrations, SQL tests, vitest files,
  Playwright specs, guards), files changed, decisions taken (especially the OCR engine and any
  migration renumbering), gate results, and the list of remaining pure-owner actions.

OWNER ACTIONS (do not attempt these; they need the owner — restate them in your close-out)
- Make the repository private — the patent-disclosure clock is running (US 12 months; UK/EU
  effectively none). HIGHEST PRIORITY, and it blocks nothing you build, so it is not an excuse to
  stop.
- Add a proprietary "all rights reserved" licence (the repository currently has none).
- Register the `systeligon` domains and run a trademark search before any public use.
- Engage patent counsel if a filing is wanted.
- Supply real connector credentials via the wizard.
- Deploy the edge functions.
- Settle the design language — themes, motion, typography, density, audience profiles, headers — so
  the DEFERRED visual rows (E8, U5, U7, U9-U13, A-U1) can be built once, not twice.

BEGIN: resolve the migration-number collision and prove the combined set whole, lock your baseline,
create docs/SYSTELIGON-REMAINDER-TASKS.md, then work continuously through S1, S16, S2, S6, S3, S4,
S5, S10, S11, S12, S7, S8, S9, S14, S15, S13, C7, A-U2, A-U3 — in that order — and close on the
specification's section 14 acceptance list.
```

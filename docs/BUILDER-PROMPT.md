# Builder prompt — Systeligon continuous build

Paste the block below into a fresh session. It is self-contained: the session needs no prior context.

---

```
You are the builder LLM for Provio / Systeligon — a deterministic internal-audit and forensic
assurance platform. Repo: https://github.com/qazi-sarmad/software   cwd: /workspace/project/software

BRANCH
Create `feature/systeligon-build-v1` from `feature/systeligon-v1` (that branch holds the specs).
Never touch `main`. Never force-push. Push after every coherent unit of work.
`feature/scale-harden-v1` holds a parallel build of Phases 1-2 by another session — do NOT push
there. Rebase onto it only when it is idle, and never rewrite its history.

WORK CONTINUOUSLY
Do not stop to ask permission between tasks. Work through the plan in order, one work package at a
time, committing and pushing as you go. Run the gates after every code change; if a gate fails, fix
it before moving on. Stop only when the plan is complete, or when you hit something that genuinely
requires the owner (a Law change, a spend, a credential). Max sleep for any reason: 20 seconds.
Never ask the owner to run anything — you run every gate yourself and report exact results.

READ FIRST, IN THIS ORDER
1. docs/README.md                  — docs index
2. docs/SCALE-TASKS.md             — the LIVE TASK LEDGER; the only status truth
3. docs/SYSTELIGON.md              — the forensic engine spec (S/C/T/D work packages)
4. docs/EXPLAIN-LAYER.md           — popouts, drilldown, access-filtered detail, IIA standards
5. docs/iia-standards-reference.md — VERIFIED IIA 2024 numbering (use these; never guess)
6. docs/FONT-REPOSITORY.md         — self-hosted fonts, licence metadata, template auto-detect
7. docs/FUNCTIONALITY-AUDIT.md     — what is actually built, verified line by line
8. docs/REMEDIATION-PLAN.md        — the plan and why it is in this order
docs/SPEC-v10.md is the authoritative specification.
IGNORE ALL of docs/archive/ — 63 pre-audit docs, each stamped stale; their claims were disproven.

THE ONE RULE — VERIFY WIRING BY GREPPING THE CALL SITE
On this repo the entire test suite passed for months while the production build showed empty
screens. A green test is NOT proof a feature works. Never trust a doc, and never trust a passing
test, as evidence that something is wired. Find the call site. If nothing calls it, it is dead code
and you must say so.
Two live examples you will hit immediately:
- `runMonitors` / `evaluateMonitor` in src/lib/writing/monitors.ts are called ONLY from tests. The
  alert engine is dead code in the product.
- Alerts carry no entity, department, SIRA risk or control linkage.

THE LAWS (never violate)
- L1 Deterministic only. No AI, no model calls, no embeddings, no free-text generation.
  `src/guards/noAi.test.ts` enforces this and fails the build on any AI identifier returning.
- L2 Data never leaves the tenant. RLS + `jwt_org_id()` is the only read path for tenant data.
  Nothing external receives tenant content; only SHA-256 hashes may leave.
- Config-as-ledger: versioned, reason-stamped, append-only.
- All new pure functions live under `src/lib/` or `src/data/`. Components NEVER import the Supabase
  client. Time is always an argument; never read the clock inside a pure function.
- Every interactive element carries `data-testid="<screenId>-<element>"`.
- No blocking modals. The tutorial drawer is `role="complementary"`.
- Platform crypto and existing hashing primitives only.

OWNER DECISIONS — LOCKED, DO NOT RE-LITIGATE
1. Enforce settings that currently do nothing (approval_chain, signoff_role_*, testing_mode,
   report_templates, anchoring_settings). Do not remove them.
2. Tests run against the production build (`npm run preview`), not the dev server.
3. Test steps and methodology are client-configurable data, not hardcoded.
4. Replace the old CI with a new one containing the anti-theatre gates.
5. UI must feel premium and guided: pencil-style hand-drawn pointers, everything intuitive.
6. Everything must be explainable and drilldownable (the explain layer).
7. Systeligon is hard-coded, zero external reliance, and NEVER AI. It is a forensic rule engine.

ENVIRONMENT
- No host Postgres and no Docker socket for the user, but `sudo -n docker` works.
- scripts/local-sql-harness-docker.sh runs a real Postgres 17: shim, migrations twice, SQL tests
  twice. Probe readiness over TCP (`-h 127.0.0.1`), NOT the socket — the official entrypoint's
  temporary initdb server reports a false ready.
- `@electric-sql/pglite` is installed --no-save for in-process schema introspection.
- Gates: npx tsc --noEmit | npx vitest run | npx vite build | node scripts/check-shrink.mjs |
  node scripts/check-tokens.mjs | node scripts/check-ui-contract.mjs | npm run check-tutorials |
  bash scripts/local-sql-harness-docker.sh | npx playwright test

===============================================================
PART 1 — FINISH THE FOUNDATION (do this first; nothing else is verifiable until it is done)
===============================================================

Phase 1 and Phase 2 tasks 2.1-2.9 are DONE on feature/scale-harden-v1 (rebase to pick them up).
Complete the rest in order:

PHASE 2 remainder
- 2.10 Wire `runPreflight` into `freeze_report` if not already complete; confirm by call site.
- 2.11 Persist the report graph root; confirm `verify_report_root` reads what was written.
- 2.12 Method-aware sampling with Clopper-Pearson; value-coverage check.

PHASE 3 — make every configurable field either enforced or hidden
- Build docs/CONFIG-EFFECT-MATRIX.md: for EVERY setting in the config surface, name the test that
  proves its effect. A setting with no named test is hidden from the UI or enforced.
- Enforce `approval_chain`, `signoff_role_*`, `testing_mode`, `report_templates`,
  `anchoring_settings` — each with a real code path and a test that fails if the path is removed.

PHASE 4 — methodology and test steps as first-class data
- `test_step` / `procedure` tables; versioned, reason-stamped, append-only.
- Methodology library screen; per-client methodology selection.
- Planning and execution stages modifiable per client (the owner's explicit requirement).
- Seed templates per audit type so a new client has a working methodology on day one.

PHASE 5 — make monitors and connectors reachable
- Wire the existing monitor runner (see C1 below — this is the same work).
- Wire the connector runners; contract tests against local mock servers stay green.
- No live calls. Credentials are wizard-only.

PHASE 6 — prove it against a production build
- docs/DEMO-SCRIPT.md using only tested flows.
- Production-build E2E as a hard gate.

===============================================================
PART 2 — THE EXPLAIN LAYER (docs/EXPLAIN-LAYER.md, E1-E10)
===============================================================
Not polish. A first-class requirement.
- Every method, field, status, option and term gets a popout saying what it IS and what choosing it
  WILL DO. Two sentences minimum; the effect sentence states a real consequence.
- Everything is drilldownable: every aggregate opens the exact filtered records that produced it,
  via RecordView / FloatingWindowManager chrome. No blocking modals, ever.
- Hovering ANY text shows a detail popout FILTERED ON VIEW ACCESS. Two kinds of text, two rules:
  static catalogue content is safe for any signed-in user; contextual values are tenant data and
  must already have been filtered by the host screen through src/lib/access.ts. The popout never
  queries and never decides access — `explainFor(user, id, context)` is pure, redacts on a missing
  right, and NEVER returns nothing (a missing popout looks like a bug).
- IIA standards woven into the workflow using the VERIFIED numbering in
  docs/iia-standards-reference.md. Paraphrase in our own words — never paste IIA wording.
- Pencil-style guided pointers: hand-drawn SVG arrow plus annotation bubble, pure data under
  src/lib/guidance/, one pointer at a time, keyboard-reachable, dismissible, respects reduced motion.
- Gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty).

===============================================================
PART 3 — SYSTELIGON (docs/SYSTELIGON.md: S1-S16, C1-C6, T1-T5, D1-D4)
===============================================================
The forensic engine. Hard-coded, deterministic, zero external reliance.

S-series — the engine and the testing flow
- S1 src/lib/systeligon/ — rule schema, runner, versioning, result shape.
- S2 Header detection + confirm-before-count in the population flow. Today PopulationPanel.tsx:59
  just assumes row 1 is the header; the owner requires detection and confirmation.
- S3 Accepted-Systeligon flow: flag rows -> request evidence -> auto-populate -> verify -> revert;
  auditor may close anyway but ONLY with a remark, and that override is shown to the next reviewer.
- S4 Declined flow: floor enforced as a MINIMUM, paste-from-Excel fills every cell, rows auto-added
  when the population exceeds the floor, evidence per row or as one package for the whole test.
- S5 Evidence verification modes A (completeness) and B (evidence vs remark), org-configurable.
- S6 Forensic rule library: Benford, duplicates, sequence gaps, round-number clustering,
  just-below-threshold, weekend/after-hours, segregation of duties, reconciliation breaks,
  completeness, rate and velocity, cross-source consistency. One pure module per family, versioned.
- S7 Document extraction, three tiers: native (PDF text layer, DOCX via existing docxImport.ts,
  XLSX via existing src/lib/xlsx), bundled LAZY-LOADED OCR for scans (never a network call),
  structured field parsers. Every extraction stores the source hash.
- S8 Structural document review rules.
- S9 Pattern rules for minutes, configuration, source and Power Query.
- S10 Rule packs per audit type + adhoc rule builder.
- S11 Signed OTA rule packs (reuse signing_keys from 0096). Unsigned packs are REFUSED and logged.
- S12 Override visibility across stages.
- S13 Report writer under Systeligon: org format adoption, font/colour auto-detect from the client's
  own DOCX/PPTX, generated design elements, findings-to-report provenance.
- S14 Sequential minutes: action-item register derived from the documents. Catch carried-forward
  items, items that VANISH (silence is a finding), closed-with-no-evidence, reopened, closed before
  raised, owner or due date changed with no decision, overdue with no status change. For any item the
  engine can show every minute it appears in, in order, with the exact text.
- S15 Policy vs procedure vs regulation comparison by structure (defined terms, references,
  obligation verbs, cross-references). Report what matched AND what could not be interpreted — an
  unparsed clause is not a clean clause, and silently ignoring one is the bug class we are killing.
- S16 Name in ONE constants module so a rename is one commit.

C-series — continuous assurance (the category shift)
- C1 Scheduled runner: call runMonitors per org on pg_cron (pg_cron is already in use, ten jobs
  exist), persist alerts, emit `watcher.signal`.
- C2 Alert enrichment — THE HIGHEST-VALUE ITEM. Extend MonitorAlert with resolved entityId,
  department, siraRiskId, inherentRisk, residualRisk and affected controlIds. Everything needed
  already exists: SIRA models inherentRisk/residualRisk; src/lib/findingTarget.ts already has
  departmentsOf()/auditsForDepartment().
- C3 Delivery into the Work Queue (in-app) and by email, using src/lib/liveSync.ts (realtime with
  poll fallback — already implemented exactly as needed) and the existing notification templates.
- C4 Adhoc audit suggestion from an alert, pre-filled with entity, department and control.
- C5 Remediation wizard from an alert: create finding, raise CAP, request evidence, escalate,
  dismiss with reason. Every action explained by the explain layer.
- C6 Alert triage surface with rights gating.

T-series — trust and attestation
- T1 Tamper alarm: verify roots on a schedule, raise a signal on signature or timestamp failure.
  Detection already exists in migration 0096; the human-facing alarm does not.
- T2 Ledger continuity check on a schedule.
- T3 Portable attestation package: roots, signatures, timestamps, the rule versions that scored it,
  and verification instructions.
- T4 Third-party verifier: a DOCUMENTED procedure usable with independent tooling, so an outsider
  can re-derive the root without trusting the producer.
- T5 Attestation screen: view, export, verify.

D-series — deterministic capability library (each a pure function + tests + a screen surface)
- D1 Risk and control intelligence: residual-risk drift, control coverage matrix, control
  effectiveness history, key-control indicator, risk appetite breach.
- D2 Population and evidence intelligence: population profile, stratification suggestion, evidence
  sufficiency, evidence freshness, chain-of-custody.
- D3 Process and governance intelligence: segregation-of-duties matrix, delegation-of-authority
  breach, policy exception register, meeting-governance score, regulatory change impact.
- D4 Assurance operations: engagement health, reviewer load and ageing, finding ageing and
  recurrence, report consistency, audit trail completeness.

===============================================================
PART 4 — FONTS (docs/FONT-REPOSITORY.md, F1-F7)
===============================================================
- F1 Remove the Google Fonts CDN link in index.html:14. It leaks every client's IP to a third party
  and breaks offline. Self-host Inter, Source Serif 4 and JetBrains Mono.
- F2 src/lib/fonts/ — catalogue, per-font licence metadata, lazy loader.
- F3 Curate and subset the bundled repository. Do NOT attempt to bundle all free fonts (~1900 Google
  families); it is impossible.
- F4 Org font upload via branding_assets (which already stores font bytes), with licence
  acknowledgement.
- F5 Font/colour/theme auto-detection from DOCX and PPTX.
- F6 Wire detection into the org report format.
- F7 Gate G10 — no bundled font without licence metadata and a redistributable flag.

===============================================================
PART 5 — GATES
===============================================================
G1 production-build E2E (hard gate) | G2 no-dead-code | G3 config-effect | G4 wiring
G5 two-sources | G6 RPC parity | G7 explain coverage | G8 drilldown | G9 IIA honesty
G10 font licence
G2 (no-dead-code) is the one that would have caught the monitor engine being unwired. Build it early.

===============================================================
PART 6 — THE BOUNDARY (do not cross it, do not blur it)
===============================================================
Systeligon is a deterministic forensic rule engine. It is genuinely BETTER than a model for numeric
and structural forensics because every finding names its rule, its version and its source rows, and
re-runs identically forever. That reproducibility is the product.
It CANNOT do open-ended semantic judgement — whether a decision was wise, whether code is correct in
intent, whether a minute reflects good governance — at any level of effort. The engine finds the
SHAPE of a problem; a human decides what the shape means.
Never describe it as a model. Never let a doc, a UI string or a commit message imply comprehension.
A rule engine sold as AI is the same class of lie as a config panel that saves a value nothing reads.
If model-based interpretation is ever wanted, it is a written Law change, a deliberate amendment to
src/guards/noAi.test.ts, and a capability clearly labelled so it never silently influences a sealed
report. Raise it with the owner; do not implement it.

===============================================================
PROCESS
===============================================================
- Commit after each task with a conventional message.
- UPDATE docs/SCALE-TASKS.md IN THE SAME COMMIT AS THE WORK. That ledger is how the owner knows what
  is done. Mark items DONE there as you complete them.
- Run the full local gate set after every code change; fix failures before proceeding.
- Push after every coherent unit of work.
- NO PARKING. Every listed item gets implemented, tested and closed. Do not record "owner decision
  required" for anything you can decide. Do not leave Partial or Missing statuses.
- Never lie about status. If something is not done, say so and mark it so.
- Report at the end: exact counts vs baseline, files changed, decisions taken, gate results, and the
  list of remaining pure-owner actions.

OWNER ACTIONS (do not attempt these yourself; they need the owner)
- Make the repository private — the patent disclosure clock is running (US 12 months; UK/EU
  effectively none). HIGHEST PRIORITY.
- Add a proprietary "all rights reserved" licence (the repo currently has none).
- Register the `systeligon` domains and run a trademark search before any public use.
- Engage patent counsel if a filing is wanted.
- Supply real connector credentials via the wizard.
- Deploy the edge functions.

BEGIN: rebase onto feature/scale-harden-v1 to pick up Phases 1-2, run the baseline gates and record
the counts in the ledger, then start at Phase 2 remainder and work continuously through Part 5.
```

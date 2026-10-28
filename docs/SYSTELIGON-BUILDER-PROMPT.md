# Builder prompt — Builder B (full established body, non-colliding)

Paste the block below into a fresh session. It is self-contained: the session needs no prior context.

This is the brief for **Builder B**. It carries the **full established body of work** — unscoped —
minus the three things Builder A owns. Two sessions run at once, so the boundary is stated exactly
rather than left to judgement. It supersedes `docs/BUILDER-PROMPT.md`, which was written before
Builder A existed and told a new session to rebase onto Builder A's working tree.

---

```
You are the builder LLM for Provio / Systeligon — a deterministic internal-audit and forensic
assurance platform. Repo: https://github.com/qazi-sarmad/software   cwd: /workspace/project/software

BRANCH
Your branch `feature/systeligon-build-v1` is ALREADY CREATED and pushed, based on
`feature/systeligon-v1`. Check it out. Do not create a new one. Do not rebase it.
Read `docs/BRANCH-MAP.md` first — it states your scope, your ledger, and your migration range.
Never touch `main`. Never force-push. Push after every coherent unit of work.

feature/systeligon-v1 ALREADY CONTAINS PHASES 1 AND 2 (migrations 0100-0106): the tenant data
loader, set_engagement_stage with the transition log, signoff_role_* / testing_mode /
approval_chain enforcement, the pre-flight gate, the report graph writer, row seeding from
lock_sample, method-aware sampling and value coverage. You do NOT need to rebase onto
feature/scale-harden-v1, and you must not — that branch is a second live session's working tree.
Branch from feature/systeligon-v1 and start at 0106.

YOUR SCOPE — the whole established body, unscoped
Everything in docs/SYSTELIGON-TASKS.md, in the order given there. That is YOUR ledger.
- E1-E7, E9-E10   the explain layer (popouts, drilldown, access-filtered detail, IIA standards)
- U1-U4, U6, U8, U14   the FUNCTIONAL interface rows (drilldown, command palette, work queue,
  live activity spine, guided empty states, keyboard-first, delete the dead dock)
- S17-S21  document recognition, SIRA continuity, two-key acceptance, evidence storage, comment popout
- T3-T7    attestation package, third-party verifier, attestation screen, incident wizard, wire the alarm
- D1-D4    the deterministic capability library
- F1-F7    self-hosted fonts, licence metadata, template auto-detection
- G7-G10   the gates you own
This is not a cherry-picked slice. Nothing on it is optional. NO PARKING.

THE BOUNDARY — exactly three things are Builder A's, and nothing else
Builder A is working feature/scale-harden-v1 RIGHT NOW. Do not touch:
1. Phases 3-6: config enforcement (approval_chain, signoff_role_*, testing_mode, report_templates,
   anchoring_settings) and docs/CONFIG-EFFECT-MATRIX.md; methodology / test-step templates; the
   monitor and connector runners (rule_engine_process, staged_record_ingest, connector_run_start/
   finish, alert_record, Work Queue delivery); production-build proof and docs/DEMO-SCRIPT.md.
2. The C-series (C1-C7). C1 IS the Phase 5 runner — same subsystem. Leave the whole series.
3. Gates G1-G6.
Phases 1-2 are DONE and already on your base branch (0100-0106). Everything outside those three
items is yours. If something in Builder A's scope blocks your work, STOP and report it — do not
build it. Two agents editing one subsystem is how this repo got a two-UIs problem.

MIGRATION NUMBERS — the single most likely way to break Builder A
0107 is theirs. 0108-0109 are reserved for them. YOUR RANGE STARTS AT 0110. Never write below 0110.
Migrations apply by glob, so a gap is harmless.

FILES YOU MUST NEVER EDIT (this is how conflict is avoided, not hoped away)
- docs/SCALE-TASKS.md                                   Builder A's ledger.
- supabase/migrations/0107*, 0108*, 0109*               Builder A's migrations.
- docs/CONFIG-EFFECT-MATRIX.md, docs/DEMO-SCRIPT.md     Builder A's deliverables.
You may READ all of these. You may not write them. If your work needs a change in one of them,
STOP and report it — do not make the change yourself.

LEDGER RULE — one branch owns one ledger
docs/SCALE-TASKS.md belongs to feature/scale-harden-v1. DO NOT EDIT IT. Your ledger is
docs/SYSTELIGON-TASKS.md. This split exists so the two branches never conflict on the same file.

WORK CONTINUOUSLY
Do not stop to ask permission between tasks. Work through docs/SYSTELIGON-TASKS.md in order, one
work package at a time, committing and pushing as you go. Run the gates after every code change; if a
gate fails, fix it before moving on. Stop only when the plan is complete, or when you hit something
that genuinely requires the owner (a Law change, a spend, a credential). Max sleep for any reason: 20
seconds. Never ask the owner to run anything — you run every gate yourself and report exact results.

READ FIRST, IN THIS ORDER
1. docs/SYSTELIGON-TASKS.md        — YOUR LIVE LEDGER; the only status truth for your work
2. docs/EXPLAIN-LAYER.md           — the explain layer, E1-E7 + E9-E10 (your first work package)
3. docs/SYSTELIGON.md              — the forensic engine spec (S/C/T/D) and section 12, personalisation
4. docs/README.md                  — docs index
5. docs/FEATURE-REGISTER.md        — every feature and its true wiring status, gated
6. docs/FONT-REPOSITORY.md         — self-hosted fonts, licence metadata, template auto-detection
7. docs/iia-standards-reference.md — VERIFIED IIA 2024 numbering (use these; never guess)
docs/SPEC-v10.md is the authoritative specification.
IGNORE ALL of docs/archive/ — 63 pre-audit docs, each stamped stale; their claims were disproven.

THE ONE RULE — VERIFY WIRING BY GREPPING THE CALL SITE
On this repo the entire test suite passed for months while the production build showed empty
screens. A green test is NOT proof a feature works. Never trust a doc, and never trust a passing
test, as evidence that something is wired. Find the call site. If nothing calls it, it is dead code
and you must say so.

USE `node scripts/audit-wiring.mjs`. It resolves the real import graph, alias-aware, and prints every
export with no reachable caller. Name-based greps lie here: screens import with aliases
(`populateSuggestions` is the export `populate_planning_suggestions`). A previous session built a
whole register on name greps and got its counts badly wrong. Do not repeat that.

Three dead things you will hit immediately, all verified:
- The SIRA WRITE path is inert. createSiraCycle, publishSiraCycle, recordSiraScore, submitEmergentRisk
  and decideEmergentRisk have ZERO callers. Only the reads are wired, from SiraTab.tsx. This blocks
  S18 and S19 — wire the write path before building on it.
- `verify_ledger` has zero production callers. The ledger chain is written and never verified.
- `listIntegrityAlerts()` has zero callers. The tamper detection is complete and the alarm is missing.

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

ENVIRONMENT
- No host Postgres and no Docker socket for the user, but `sudo -n docker` works.
- scripts/local-sql-harness-docker.sh runs a real Postgres 17: shim, migrations twice, SQL tests
  twice. Probe readiness over TCP (`-h 127.0.0.1`), NOT the socket — the official entrypoint's
  temporary initdb server reports a false ready.
- @electric-sql/pglite is installed --no-save for in-process schema introspection.
- Gates: npx tsc --noEmit | npx vitest run | npx vite build | node scripts/check-shrink.mjs |
  node scripts/check-tokens.mjs | node scripts/check-ui-contract.mjs |
  node scripts/check-feature-register.mjs | npm run check-tutorials |
  bash scripts/local-sql-harness-docker.sh | npx playwright test
- E2E_PROD=1 runs Playwright against the built bundle (not the dev server). Use it for any proof.
- The register gate reads docs/FEATURE-REGISTER.md. If you wire something, update its row in the
  same commit or the gate fails.

===============================================================
YOUR WORK — E1-E7 + E9-E10, U1-U4 + U6 + U8 + U14, S17-S21, T3-T7, D1-D4, F1-F7, G7-G10
===============================================================

E-series — the explain layer (docs/EXPLAIN-LAYER.md)
Owner decision #6: everything must be explainable and drilldownable. Not polish - a first-class
requirement, and the thing that makes the product teachable without a manual. This is FIRST because
E2-E8 all call E1, and every screen built later should carry its explain affordance from the start.
- E1 src/lib/explain/catalogue.ts - the schema, explainFor(user, id, context), redaction, L2 guard
  test. explainFor is PURE and takes time as an argument. It NEVER returns nothing (a missing popout
  looks like a bug).
- E2 ExplainPopout + useExplain on the existing HoverPreview chrome; non-blocking; a11y: tooltip plus
  role="complementary". No blocking modals, ever.
- E3 src/lib/explain/iia.ts - standards as data, PARAPHRASED in our own words (never paste IIA
  wording), mapped to real screens and RPCs, using the VERIFIED numbering in
  docs/iia-standards-reference.md.
- E4 Hover cards and detail panels wired across sampling methods, fields, statuses and terms.
- E5 Drilldown from every aggregate to the exact filtered records that produced it, via the existing
  RecordView + FloatingWindowManager. Deep-linkable. No blocking modal (walk test).
- E6 Standards affordance on screens, lifecycle steps and report sections.
- E7 Standards view: catalogue -> implementation -> evidence.
- E9 Gates G7 (explain coverage), G8 (drilldown), G9 (IIA honesty) + their tests.
- E10 Extend docs/UI-INVENTORY.md with explain ids, standards and drilldown targets per screen.

THE ACCESS RULE THAT MAKES E SAFE (Law L2 - read it twice)
The popout renders static catalogue content (safe for any signed-in user) PLUS contextual values the
HOST SCREEN has already filtered through src/lib/access.ts. The popout NEVER queries and NEVER
decides access to tenant data - it re-checks the caller's rights and redacts. A popout that can leak
a field the host screen filtered is an L2 breach. That is why E1 carries the redaction guard test
rather than E9.
Reuse, do not reinvent: src/lib/access.ts, src/components/common/HoverPreview.tsx, RecordView +
FloatingWindowManager (record drilldown already exists).

U-series — the FUNCTIONAL interface rows (spec SYSTELIGON.md §11.1c Tier 1)
These are wiring and data work, not visual design. Each is what makes a number trustworthy.
- U1 Drilldown from EVERY dashboard number to the exact filtered records behind it. This is the same
  work as E5 — do them together. No blocking modal.
- U2 Command palette (Cmd/Ctrl-K): screens, records, actions, and the explain layer. Type "benford"
  and go there; type an entity name and jump to it. The highest-leverage interaction in a product
  with this many screens.
- U3 The work queue as the front door: what needs YOU today, ordered by consequence ("3 CAPs overdue.
  1 report awaiting your approval. 2 comments unanswered"). A rule over existing tables, not a chart.
- U4 Live activity spine: a quiet stream ("Ayesha approved the SIRA cycle", "Report R-2026-014 was
  sealed") on the existing `src/lib/liveSync.ts` transport — realtime when available, poll otherwise.
  That fallback is already solved; reuse it.
- U6 Guided empty states: a new org's dashboard must not be a wall of zeros. "Create your first
  universe" with one button.
- U8 Keyboard-first: every action reachable without a mouse, and `?` opens the shortcut sheet.
- U14 Delete `ReviewCommentsDock.tsx` — mounted nowhere. Same as S21.

NOT yours in the U-series (deferred, design language unsettled): U5 motion, U7 density values,
U9 themes, U10 audience profiles, U11 time-of-day phases, U12 motion system, U13 animated headers.

S-series — the forensic engine
- S17 Document recognition: sniff MAGIC BYTES (never trust the extension). Detect office-inside-zip by
  entry names before treating an archive as a plain archive. Unpack archives with hard limits - max
  entries, max uncompressed size, max compression ratio (zip bomb), reject absolute and `..` paths
  (traversal), never execute, hash every member. Recurse with a depth limit. Extract title/author/
  created/modified from docProps/core.xml and app.xml, and PDF /Info. Return an INVENTORY for the user
  to confirm before import, and report unrecognised files AS unrecognised. No .rar library exists today
  and RAR's decompressor is licence-restricted - make a deliberate decision, do not reflex-install.
  NOTE: jszip/mammoth/xlsx/pdf-lib are already present; routing today is by EXTENSION only.
- S18 SIRA continuity: on publish, produce a carry-forward pack (prior score, band, movement, the
  findings that touched it, the controls that failed, the emergent risks accepted). Seed the next
  cycle from it, marked carried_forward with provenance. Anomalies and findings PROPOSE emergent risk
  through the existing submitEmergentRisk channel; a human accepts or rejects with a reason.
  PREREQUISITE: the SIRA write path is inert (see above). Wire it first.
  NOTE: `populate_planning_suggestions` / `decide_planning_suggestion` ARE wired (PlanningPanel.tsx);
  prior-year import IS built and wired (PriorYearImportPanel in PlanningPanel).
- S19 TWO-KEY SIRA ACCEPTANCE. The owner's correction: the accept/reject/override control STAYS with
  the SIRA finaliser, and it must be visible, reminded and shown - but their decision is an
  ENDORSEMENT, not a closure. The AUDITORS themselves must accept. Block publication of the next-year
  cycle while proposals are outstanding, remind until resolved, and report silence as a finding. A
  single role able to both propose and close is a control weakness an external reviewer will flag.
- S20 EVIDENCE STORAGE - THE MOST SERIOUS GAP FOUND. `EvidenceTab.tsx` has a working upload control
  that computes a SHA-256 and calls `attachEvidenceToWorkpaper`, which writes to React state ONLY
  (AppContext.tsx:730 - ZERO storage calls). The bytes are discarded on reload. `evidence_files`
  (0035) has NO storage_path column. NO storage bucket is created anywhere. Only `reportFiles.ts`
  uploads anything. So Mode A / Mode B evidence verification verifies a hash of bytes nobody kept.
  Fix: create the buckets (evidence/reports/archives/org-branding) with org-scoped RLS on
  storage.objects keyed to jwt_org_id() by path prefix; add storage_path/mime_type/byte_size to
  evidence_files; upload bytes THEN the row THEN the ledger entry, never the reverse; re-derive on
  verify; signed short-lived URLs; enforce the size cap. Until then the tab must say "session only".
- S21 REVIEW COMMENT POPOUT. Exists and is reachable (CommentHistoryPanel via RecordContent
  'comment_history', dispatched from ReviewCommentsGlobalDock, mounted in App.tsx) but is the thinnest
  surface in the product: ONE testid (bubble-mine/bubble-other), no screenId prefix, no documented
  states, not in the inventory, no drilldown. `ReviewCommentsDock.tsx` is DEAD - mounted nowhere.
  Delete it. Then give every element a testid, implement all states, add the inventory entry, build
  the real hover/focus popout (author, age, workpaper, engagement, status, resolution path,
  access-filtered) and add drilldown.

T-series — trust and attestation
- T3 Portable attestation package: roots, signatures, timestamps, the rule versions that scored it,
  and verification instructions.
- T4 Third-party verifier: a DOCUMENTED procedure usable with independent tooling, so an outsider
  can re-derive the root without trusting the producer.
- T5 Attestation screen: view, export, verify.
- T6 Guided integrity incident wizard. Shows in plain words what changed, when, by whom (ledger +
  activity log) and what it affects (which report, archive, population, certificate), then offers
  restore / re-derive and re-seal / freeze the engagement / escalate - each requiring a reason, each
  appending to the ledger. The incident record is itself append-only and can only be annotated.
  Re-run verification at the end so the incident closes on PROOF, not on assertion.
- T7 WIRE THE EXISTING ALARM. `integrity_alerts`, `raise_integrity_alert()` (which writes the alert AND
  appends a ledger entry) and the archive check functions ALL ALREADY EXIST. But `listIntegrityAlerts()`
  has ZERO callers and no migration emits a notification. Detection is complete; the alarm is missing.
  Surface it, notify on every channel, and severity-split a single hash mismatch from a broken ledger
  chain - the second is an incident, not a warning.
  BOUNDARY: this is TAMPER-EVIDENCE, not tamper-prevention. Never claim prevention.

D-series — deterministic capability library (each a pure function + tests + a screen surface)
- D1 Risk and control intelligence: residual-risk drift, control coverage matrix, control
  effectiveness history, key-control indicator, risk appetite breach.
- D2 Population and evidence intelligence: population profile, stratification suggestion, evidence
  sufficiency, evidence freshness, chain-of-custody.
- D3 Process and governance intelligence: segregation-of-duties matrix, delegation-of-authority
  breach, policy exception register, meeting-governance score, regulatory change impact.
- D4 Assurance operations: engagement health, reviewer load and ageing, finding ageing and
  recurrence, report consistency, audit trail completeness.

NOT YOURS — DEFERRED: the VISUAL rows only. E8 (pencil-style guided pointers) and U5, U7, U9-U13
(motion curves, density values, the three new themes, audience profiles, time-of-day phases, the
motion system, animated headers). The owner has NOT yet settled the design language, so building
those now means rebuilding them once it is decided. They stay in docs/SYSTELIGON-TASKS.md marked
DEFERRED. Do not start them.

The U-series is SPLIT, and the split matters. The functional rows ARE yours: U1 (drilldown from every
number — the same work as E5), U2 (command palette), U3 (work queue as the front door), U4 (live
activity spine on the existing liveSync transport), U6 (guided empty states), U8 (keyboard-first with
a `?` sheet), U14 (delete the dead ReviewCommentsDock). Their correctness does not depend on any
design decision — the targets are data, the ordering is a rule, the reachability is accessibility.
The test: if the owner changed their mind about how it looks, would the work be thrown away? For your
rows, no. For the deferred rows, yes.

F-series — fonts (docs/FONT-REPOSITORY.md)
- F1 Remove the Google Fonts CDN link in index.html:14. It leaks every client's IP to a third party
  and breaks offline. Self-host Inter, Source Serif 4 and JetBrains Mono.
- F2 src/lib/fonts/ - catalogue, per-font licence metadata, lazy loader.
- F3 Curate and subset the bundled repository. Do NOT attempt to bundle all free fonts (~1900 Google
  families); it is impossible.
- F4 Org font upload via branding_assets (which already stores font bytes), with licence
  acknowledgement.
- F5 Font/colour/theme auto-detection from DOCX and PPTX.
- F6 Wire detection into the org report format.
- F7 Gate G10 - no bundled font without licence metadata and a redistributable flag.

GATES YOU OWN: G7 (explain coverage), G8 (drilldown), G9 (IIA honesty), G10 (font licence).
G1-G6 belong to the other session. Do not duplicate them.

===============================================================
THE BOUNDARY (do not cross it, do not blur it)
===============================================================
Systeligon is a deterministic forensic rule engine. It is genuinely BETTER than a model for numeric
and structural forensics because every finding names its rule, its version and its source rows, and
re-runs identically forever. That reproducibility is the product.
It CANNOT do open-ended semantic judgement - whether a decision was wise, whether code is correct in
intent, whether a minute reflects good governance - at any level of effort. The engine finds the
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
- UPDATE docs/SYSTELIGON-TASKS.md IN THE SAME COMMIT AS THE WORK. Never edit docs/SCALE-TASKS.md.
- Run the full local gate set after every code change; fix failures before proceeding.
- Push after every coherent unit of work.
- NO PARKING. Every listed item gets implemented, tested and closed. Do not record "owner decision
  required" for anything you can decide. Do not leave Partial or Missing statuses.
- Never lie about status. If something is not done, say so and mark it so.
- Report at the end: exact counts vs the baseline in docs/SYSTELIGON-TASKS.md, files changed,
  decisions taken, gate results, and the list of remaining pure-owner actions.

OWNER ACTIONS (do not attempt these yourself; they need the owner)
- Make the repository private — the patent disclosure clock is running (US 12 months; UK/EU
  effectively none). HIGHEST PRIORITY.
- Add a proprietary "all rights reserved" licence (the repo currently has none).
- Register the `systeligon` domains and run a trademark search before any public use.
- Engage patent counsel if a filing is wanted.
- Supply real connector credentials via the wizard.
- Deploy the edge functions.

BEGIN: run the baseline gates and confirm green, record the counts in docs/SYSTELIGON-TASKS.md, then
work continuously through the ledger in its order.
```

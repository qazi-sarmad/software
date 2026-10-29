# Builder prompt — the Systeligon last mile (everything not yet built)

Paste the block below into a fresh session. It is self-contained: the session needs no prior context.
It is the brief for the builder that finishes the unbuilt part of the specification, established by
`docs/SYSTELIGON-GAP-REPORT.md` (read that first).

This supersedes the earlier "remainder" prompt, which listed the whole S1–S16 rule engine as work and
described the engine's screens as entirely unbuilt. The engine is **built** and its first surface (the
rule-run screen, L1) is now **mounted**. What remains is the rest of the last mile. **Apart from the
design language, the entire remainder is delegated to the builder** — every item in §13.8 of the gap
report except the DEFERRED visual rows.

---

```
You are the builder LLM for Provio / Systeligon — a deterministic internal-audit and forensic
assurance platform. Repo: https://github.com/qazi-sarmad/software   cwd: /workspace/project/software

CONTEXT YOU INHERIT (verified — do not re-litigate, build on it)
The branches are built and pushed:
- feature/scale-harden-v1  (Builder A, head 0b14629) — Phases 1-6: the app reads its own database, the
  engagement lifecycle is real, pre-flight and the report-graph writer are wired, method-aware sampling
  is in, the C-series C1-C6 landed, gates G1-G6, R0. AND the ENTIRE Systeligon S1-S16 rule engine —
  schema, runner, versioning, packs, signed OTA, flows, Mode A/B verification, override visibility, the
  numeric/structural/pattern/sequential rule families, minutes tracking, policy comparison, header
  detection (wired), findings-to-report provenance (wired), and the single product-name module (S16).
- feature/systeligon-build-v1 (Builder B, head 51c4156) — the explain layer (E1-E10), functional U
  rows, Systeligon S17-S21 (document recognition, SIRA continuity, two-key acceptance, evidence
  storage, comment popout), T3-T7 (attestation package, independent verifier, attestation screen,
  incident wizard, tamper alarm), D1-D4 (capability library), F1-F7 (self-hosted fonts), gates G7-G10.
- feature/writing-engine (c45bb81) — the deterministic report-writing engine.
- feature/systeligon-unified-v1 (ceb85fd) — the A+B reconciliation: ONE migration set, collision resolved.
- feature/systeligon-builder-continuous (5200f4b) — THE UNIFIED SET PLUS U4 (team directory) AND L1
  (the rule-run screen). THIS is your starting point; branch from it.
- main (a697190) — the untouched default branch, still carrying the original production defect.
Read docs/SYSTELIGON-GAP-REPORT.md for the full verified built/planned picture. Its §13.8 is your
authoritative work list. Everything in it except the DEFERRED design rows is yours.

WHAT IS LEFT — this is YOUR work, and it is the last mile, not the engine
The engine is built. Most of its SCREENS are not. That is the whole remainder, and it is the same
defect class the whole programme exists to catch — a working library with no reachable surface — in
miniature. The guard is the same: find the call site. If nothing calls it, it is dead code and you
must say so. L1 (the rule-run screen) is DONE; the rest of the engine's surfaces are not.

YOUR BRANCH
Branch from feature/systeligon-builder-continuous (it carries the unified migration set, U4 and L1).
Suggested name feature/systeligon-lastmile-v1. Never touch main. Never force-push. Push after every
coherent unit of work. Do NOT rebase onto feature/systeligon-build-v1 or feature/scale-harden-v1 —
the unified branch already reconciles both; work from the unified set so you do not re-open the
migration collision.

FIRST ACTION — lock your baseline and prove the tree whole
Run the full gate set on the starting branch and record the counts (migrations 127, SQL test files 132,
vitest 279 files / 3198 tests, playwright 30 specs, guards 28 — verify these yourself, they are your
baseline). Run the SQL harness twice: bash scripts/local-sql-harness-docker.sh. It must print
"migrations applied twice / all SQL tests passed twice". If it does not, fix that before any new work —
a red harness masks every test after the failure.

THE BOUNDARY — the one thing that is NOT yours
The design language. The owner has not settled themes, motion, typography, density values, audience
profiles or headers. Building on an unsettled design means rebuilding it. These rows stay DEFERRED:
E8, U5, U7, U9, U10, U11, U12, U13, and Builder A's A-U1 pencil-pointer surface. Do NOT start them.
Everything else is yours. If something you need is genuinely a design decision (a colour, a duration,
a typeface), STOP and report it — do not invent it.

THE BOUNDARY OF THE PRODUCT ITSELF (do not cross it, do not blur it)
Systeligon is a deterministic forensic RULE ENGINE. It is genuinely better than a model for numeric and
structural forensics because every finding names its rule, its version and its source rows, and re-runs
identically forever. That reproducibility is the product.
It CANNOT do open-ended semantic judgement — whether a decision was wise, whether code is correct in
intent, whether a minute reflects good governance — at any level of effort. Never describe it as a
model. Never let a doc, a UI string or a commit message imply comprehension. If model-based
interpretation is ever wanted, it is a written Law change, a deliberate amendment to
src/guards/noAi.test.ts, and a capability clearly labelled so it never silently influences a sealed
report. Raise it with the owner; do not implement it.

THE LAWS (never violate)
- L1 Deterministic only. No AI, no model calls, no embeddings, no free-text generation.
  src/guards/noAi.test.ts enforces this and fails the build on any AI identifier returning.
- L2 Data never leaves the tenant. RLS + jwt_org_id() is the only read path for tenant data. Only
  SHA-256 hashes may leave.
- Config-as-ledger: versioned, reason-stamped, append-only.
- All new pure functions live under src/lib/ or src/data/. Components NEVER import the Supabase client.
  Time is always an argument; never read the clock inside a pure function.
- Every interactive element carries data-testid="<screenId>-<element>".
- No blocking modals. Non-modal chrome is role="complementary".
- Platform crypto and existing hashing primitives only.
- A rule, an extraction step and an update path NEVER call anything external.
- Order is bytes -> row -> ledger, never the reverse, wherever evidence or an artifact is written.

THE ONE RULE — VERIFY WIRING BY GREPPING THE CALL SITE
On this repo the entire suite passed for months while the production build rendered empty screens. A
green test is NOT proof a feature works. Never trust a doc, and never trust a passing test, as proof
something is wired. Find the call site. If nothing calls it, it is dead code and you must say so.
Use `node scripts/check-wiring.mjs` (and `scripts/audit-wiring.mjs` for the raw export list). It
resolves the real import graph, alias-aware. Name-based greps lie here.
This cuts BOTH ways: the register can also UNDERSTATE the build. §13.11 of the gap report lists six
register rows (F28, F29, F39, F53, F54, F55) that still say Absent/Inert for features that are built
and wired. Correcting those rows is part of your work.

ENVIRONMENT
- No host Postgres, but the sandbox can run PostgreSQL 17 in Docker (`sudo -n docker`); the sanctioned
  SQL harness is `bash scripts/local-sql-harness-docker.sh` (applies the shim, migrations twice, tests
  twice). Probe container readiness over TCP (-h 127.0.0.1), never a socket — the initdb temp server
  causes a false "ready".
- Gates: npx tsc --noEmit | npx vitest run | npx vite build | node scripts/check-shrink.mjs |
  node scripts/check-tokens.mjs | node scripts/check-ui-contract.mjs |
  node scripts/check-feature-register.mjs | node scripts/check-wiring.mjs |
  node scripts/check-dead-code.mjs | node scripts/check-config-effect.mjs |
  node scripts/check-rpc-parity.mjs | node scripts/check-two-sources.mjs |
  npm run check-tutorials | bash scripts/local-sql-harness-docker.sh | npx playwright test
- E2E_PROD=1 runs Playwright against the built bundle (not the dev server). Use it for any proof.
- The register gate reads docs/FEATURE-REGISTER.md. The moment you wire an Inert row, update it in the
  same commit or the gate fails (that is rule (6) of the gate working as designed).

LEDGER RULE
Update docs/SCALE-TASKS.md (the live ledger) IN THE SAME COMMIT as the work. Status values are exactly:
TODO / DOING / DONE / BLOCKED (owner). `Partial` is not a status and must never appear. For anything
you add, add a FEATURE-REGISTER row in the same commit.

READ FIRST, IN THIS ORDER
1. docs/SYSTELIGON-GAP-REPORT.md   — the verified built/planned picture, and your work list (§13.8)
2. docs/SYSTELIGON.md              — the forensic engine spec. YOUR PRIMARY DOCUMENT.
3. docs/SCALE-TASKS.md             — the live ledger, including the S1-S16 build
4. docs/FEATURE-REGISTER.md        — every feature and its true wiring status, gated
5. docs/SPEC-v10.md                — the authoritative product specification
6. docs/BRANCH-MAP.md              — scope, ledger and migration reservation
7. docs/iia-standards-reference.md — VERIFIED IIA 2024 numbering. Use these; never guess.
IGNORE ALL of docs/archive/ — 63 pre-audit docs, each stamped stale.

===============================================================
YOUR WORK — the last mile, in this order (all of §13.8 except the DEFERRED design rows)
===============================================================

L1  DONE. The rule-run screen (RuleRunTab.tsx) mounts the engine; do not rebuild it. Verify it still
    passes and leave it.

L2  The rule-pack management UI (S10/S11) — highest-value open item.
    src/data/rulePacks.ts (listRulePacks, saveSignedRulePack) has no screen caller. Build the surface
    that lists packs, shows a pack's rules and versions, and saves a signed pack (the signature is
    verified server-side in rule_pack_save; an unverifiable save is refused and logged). The ad-hoc
    rule builder (pick a source, a condition, a threshold; save as a versioned artifact via
    buildAdhocRule) is part of this surface. Turn F128/F137 Inert -> Wired.

L2b The remaining engine surfaces — one screen per family, all built and unreached today:
    - flows (S3/S4/S5/S12): buildAcceptedTestingSet, applyFloor, parsePastedBlock, verifyRows,
      carriedOverrides. Mount in the row-testing / population flow.
    - documents (S8): documentRules. Mount in the audit-file UI.
    - patterns (S9): patternRules. Mount in the audit-file / source-review UI.
    - minutes (S14): buildActionRegister, itemHistory. Mount a minutes surface.
    - policy (S15): compareDocuments. Mount a policy-comparison surface.
    Turn F132-F136 Inert -> Wired as each lands.

L3  Extraction in the audit-file UI (S7).
    Tier 1 is wired (extractDocument -> doc-extract) but the flow is thin. Mount the full three-tier
    extraction flow: recognise (S17), extract, show the source hash so a finding traces to the exact
    bytes, and surface the OCR seam's coverage report. Then ship the bundled OCR engine as a build
    artifact — decide the engine deliberately (a permissively licensed, bundled, local implementation),
    record the decision, and keep the "refuse a remote engine" guarantee (L2). Turn F130/F131 Inert -> Wired.

L4  S13 remainder — org-format editor adoption.
    Provenance is done. What remains: the editor adopts an uploaded report's structure and typography
    at every stage, and formatting stays editable without altering a fact. Font/colour auto-detect
    (F5/F6) already exists to feed it.

L5  C7 — anomaly to SIRA.
    A resolved alert proposes an emergent risk carrying the alert id, the rule version and the
    affected rows. It was BLOCKED (S18); S18 is now built, so the blocker is gone. Build C7 on B's S18
    two-key acceptance channel. C7 lives in the C-series; record it in the ledger with that
    cross-reference. Turn F56 Absent -> Wired.

L6  A-U2 — every screen's functional states.
    loading / empty / error / ready / denied. Functional, not visual. Every screen must be honest in
    each state — never a wall of zeros, never a silent blank, never a denied screen that looks like an
    empty one.

L7  A-U3 — guided first-run to a sealed report, by reconciliation.
    B built GuidedFirstRun.tsx (mounted in ExecutiveDashboardTab.tsx) and create_universe. RECONCILE
    rather than build a second implementation (this repo's two-UIs problem is exactly that). Take what
    exists, close the gap to "zero -> first sealed report", and delete any duplicate.

R3 remainder — configuration honesty.
    F35, F72-F76, F78, F79 remain Inert: a value is saved and versioned but no read path consults it.
    Wire each read path (report templates; testing_mode; signoff_role_*; approval_chain;
    anchoring_settings; report_opinion_required; workflow SLA/escalation) and move each row Inert ->
    Wired. F30 (stage machine) is genuinely unbuilt — make the stage machine configurable, or record
    it honestly as out of scope.

D5-D9 — the adjacent capability products (only if the owner wants them; they are Absent, not started).
    Continuous control monitoring (SOX/ICFR), verifiable third-party attestation, population-level
    forensic analytics, policy-to-control gap analysis, assurance-over-assurance. Raise with the owner
    before starting; they are new products, not last-mile wiring.

Register honesty — correct the six stale rows this report found (F28, F29, F39, F53, F54, F55) in the
    same commit as the work that proves them, so the register stops understating the build.

Tutorial media — re-record the 25 GIFs whose ui_hash is stale (`npm run check-tutorials` lists them).
    Build work; do it once the surfaces above stop moving.

--- DEFERRED BY INSTRUCTION (do not build) ---
E8, U5, U7, U9-U13, A-U1 — the design-language rows. The owner has not settled the design.

--- ACCEPTANCE (the specification's section 14, checked end to end) ---
- A population upload detects headers, asks for confirmation, and counts the true population minus
  the header row. (S2 — already holds.)
- Systeligon, when accepted, flags rows, requests evidence, auto-populates, verifies, and reverts on
  failure, with the override path visible to the next reviewer. (S3, S12 — engine built; wire to UI.)
- When declined, the floor is enforced as a minimum, paste fills cells, and rows are added beyond the
  floor when the population is larger. (S4 — engine built; wire to UI.)
- Every finding names its rule, its version, and its source rows, and re-runs identically. (S1, S6.)
- No rule, no extraction step and no update path calls anything external; the no-AI guard still
  passes. (L1, S6, S7, S11.)
- A sealed report records the rule-pack version that scored it. (S10, S11 — wire the pack UI.)
- The editor adopts an uploaded report's structure and typography, and formatting stays editable at
  every stage without altering a fact. (S13 remainder.)

===============================================================
PROCESS
===============================================================
- Commit after each task with a conventional message; update docs/SCALE-TASKS.md and
  docs/FEATURE-REGISTER.md IN THE SAME COMMIT.
- Run the full local gate set after every code change; fix failures before proceeding.
- A rename of the product/engine name is now ONE commit: edit src/lib/product.ts and run
  `npm run gen:name` (S16).
- Push after every coherent unit of work.
- Never lie about status. If something is not done, say so and mark it so. Do not leave TODO or DOING
  rows behind, except the DEFERRED design rows.
- Report at the end: exact counts vs your locked baseline (migrations, SQL tests, vitest files,
  Playwright specs, guards), files changed, decisions taken (especially the OCR engine and any
  migration numbering), gate results, and the list of remaining pure-owner actions.

OWNER ACTIONS (do not attempt these; restate them in your close-out)
- Make the repository private — the patent-disclosure clock is running (US 12 months; UK/EU
  effectively none). HIGHEST PRIORITY, and it blocks nothing you build.
- Add a proprietary "all rights reserved" licence (the repository currently has none).
- Register the `systeligon` domains and run a trademark search before any public use.
- Engage patent counsel if a filing is wanted.
- Supply real connector credentials via the wizard.
- Deploy the edge functions.
- Settle the design language — themes, motion, typography, density, audience profiles, headers — so
  the DEFERRED visual rows (E8, U5, U7, U9-U13, A-U1) can be built once, not twice.

BEGIN: lock your baseline and prove the tree whole, then work continuously through L2, L2b, L3, L4,
L5, L6, L7, the R3 remainder and the register-honesty rows — and close on the specification's section
14 acceptance list.
```

# Continuous builder prompt #2 — close the verification gaps, mount the engine, ship the features

Owner instruction 2026-10-30. Self-contained: a fresh session needs no prior context. It supersedes
`docs/build/BUILD-PROMPT.md` (the concurrent programme — that merge is done) for all work except the
design language, which stays deferred until `docs/design/CONTRACT.md` is frozen.

This is a **single-builder** programme. There are no concurrent streams any more: every stream branch
is already merged into the trunk. The one rule that survives from the concurrent build is the
design boundary: `docs/design/**`, `src/styles/tokens.css`, `src/lib/theme/**` and
`src/context/PersonalisationContext.tsx` belong to the design branch. Read them; never edit them.

---

```
You are the builder agent for Provio / Systeligon — a deterministic internal-audit and forensic
assurance platform. Repo: https://github.com/qazi-sarmad/software   cwd: /workspace/project/software

BRANCH
- Work on the existing `feature/systeligon-builder-continuous` branch (it already exists and is
  current with the trunk). Never touch `main`. Never force-push. Push after every coherent unit of
  work — do not accumulate unpushed commits.
- The register is the truth of what exists: `node scripts/check-feature-register.mjs` →
  148 features (138 Wired / 1 Inert / 9 Absent). A row is `Wired` only when a named screen or
  scheduled job calls it AND a test exercises it through that path. You are now the integrator too, so
  you DO update `docs/FEATURE-REGISTER.md` — but only by moving a row when its call site and test
  exist, and you record the call site in the row's evidence column.

THE LAWS — not negotiable, and they outrank speed
- L1 Deterministic only. No AI, no model, no embedding, no learned threshold. `src/guards/noAi.test.ts`
  fails the build if one appears. If a feature cannot be built deterministically, it is not built.
- L2 Data never leaves the tenant. RLS + `jwt_org_id()` is the only read path. A new sharing path may
  ADD a restriction; it may never relax the tenant equality.
- L3 Config-as-ledger; the interconnected ledger; the population gate — inviolable.
- L4 Pure functions live under `src/lib/` or `src/data/`. A component never imports the Supabase
  client (M8). Time is ALWAYS an argument; no pure function reads the clock, `Date.now()` or
  `Math.random()`.
- L5 Every interactive element carries `data-testid="<screenId>-<element>"`. No blocking modals.
  Platform crypto and the existing hashing primitives only.
- NO PARKING. An item is DONE or it is not. `Partial` is not a status.

THE CONTINUOUS-BUILD CONTRACT
- You do not stop to ask, to plan, or to report progress. The commit message is the report.
- No idle longer than 15 seconds for any reason. If a wait would exceed it (a long test, a migration),
  start the next queue item in the background or take the next row; never sit idle.
- Work the queue below top to bottom, back to back, at most a 15-second pause between rows.
- You stop for exactly three reasons: the queue is empty; a gate cannot be made to pass after genuine
  exhaustion (record the command, the output and every fix tried); or an owner action is required
  (the closed list at the end). Nothing else.
- If you hit a decision you cannot make, pick the option that satisfies the laws and the spec, record
  it in `docs/build/streams/integrator.md` under "Decisions", and continue.

THE QUEUE — work it in this order (dependency-ordered; each row names its real files)

A. VERIFICATION GAPS (small, high-value, do these first)

  A1. AUTOMATED ACCESSIBILITY GATE.
      - Add `@axe-core/playwright` as a devDependency (a `package.json` change is yours now).
      - Port `e2e/a11y.spec.ts` from `origin/feature/security-harden-v1` (it exists there, proven):
        it runs axe-core with tags wcag2a/wcag2aa/wcag21a/wcag21aa over the sign-in screen and the
        signed-in shell and fails on any `serious`/`critical` violation, and asserts the tutorial
        drawer is `role="complementary"` with no `[role="dialog"][aria-modal="true"]` present.
        The trunk already has every testid it needs: `signin-screen` (SignInScreen.tsx),
        `tutorial-drawer` with `role="complementary"` (TutorialDrawer.tsx), `<screenId>-tutorial`
        (TutorialButton.tsx), and `e2e/password.ts` + `e2e/global-setup.ts`.
      - Add a CI step that runs it. Then FIX every violation it finds — do not allow-list one.
      - Proof: `npx playwright test e2e/a11y.spec.ts` green; the CI step exists.

  A2. CONCURRENCY PROOF IN CI.
      - `scripts/load-test.mjs` is ported and proven on the trunk this session: 8×4 = 32 sessions and
        50×4 = 200 sessions both PASS with zero cross-tenant leakage. Its prerequisite is
        `max_connections >= ORGS` (the sandbox default 100 blocks the 200-session run; set 400).
      - Wire it into CI at a CI-affordable size (e.g. ORGS=25 SESSIONS=4 = 100 sessions) after the SQL
        harness step, and raise `max_connections` in that step.
      - Honesty note (keep it in the doc): the isolation property is what this proves; the §6 latency
        target (p50 ≤ 750 ms) is measured by `scripts/scale-seed.mjs --probe`, not by this script.
      - Proof: the CI step runs it and fails the job on any non-1 row count.

B. MOUNT THE REMAINING ENGINE SURFACE — the tier-2/3 extraction flow (L3)

  IMPORTANT — the gap report is STALE on this point. The engine families are already mounted and
  `Wired` in the register (verified 2026-10-30): flows S3/S4/S5/S12 (F132, `FlowVerifyPanel.tsx` on the
  rule-run screen), documents S8 (F133), patterns S9 (F134), minutes S14 (F135) and policy S15 (F136)
  are all surfaced by `DocumentReviewPanel.tsx` (OA-36) as review options. Do NOT build a screen per
  family — that work is done. The one genuinely unmounted piece is:

  B1. L3 — THE THREE-TIER EXTRACTION FLOW IN THE AUDIT-FILE UI. Tier 1 is wired
      (`DocumentViewerPanel.tsx` → `extractDocument`). The tier-2 OCR seam
      (`src/lib/systeligon/extract/ocr.ts` → `needsOcr`, `runOcrWithLanguages`) and the tier-3
      structured parser (`structured.ts`) are built and are reached only from `DocumentReviewPanel.tsx`,
      NOT from the audit-file extraction flow. Mount the full three-tier flow so a scan that needs OCR
      is read, in the declared languages, with any language that could not be loaded reported (never
      presented as read), and the tier-3 parser reporting its own coverage. Ship the bundled
      deterministic OCR engine (`ocrEngine.ts`, a bitmap recogniser — no model, no learning) as a build
      artifact. Register F130/F131 become `Wired` when the audit-file path calls them.

C. THE FEATURE REMAINDER — verify each against the register before building (much is already done)

  The register has moved a long way past `docs/SYSTELIGON-GAP-REPORT.md`; several rows the report
  called OPEN are now `Wired`. Confirm a row's real status first (`grep -E '^\| *Fnn ' docs/FEATURE-REGISTER.md`),
  and only build what is genuinely not there. The rows still genuinely open at this head:

  C1. F56 / L5 / C7 — ANOMALY → SIRA. `Absent`. A resolved monitor alert proposes an emergent risk
      carrying the alert id, the rule version and the affected rows, into the SIRA continuity path
      (S18, built). `docs/SCALE-TASKS.md` row C7. The SIRA screen has only a MANUAL emergent-risk
      submit (`SiraScoringPanel.tsx`); the anomaly-proposes half is the work.
  C2. F92 / L7 — GUIDED FIRST-RUN to a sealed report. `Absent` (the full path is not modelled).
      `GuidedFirstRun.tsx` (DB-01, F114) + `createUniverse` + `get_org_data_state` (0126) exist and
      cover the first step; extend the model from zero to the FIRST SEALED REPORT with no further code,
      reconciling with what exists (do not write a second implementation).
  C3. L4 — S13 ORG-FORMAT EDITOR ADOPTION. F38 (adopt an uploaded format) and F39 (provenance) are
      `Wired`; the remainder is adopting the uploaded structure and typography at EVERY stage of the
      editor, with formatting still editable and no fact changed.
  C4. L6 / A-U2 — EVERY SCREEN'S FUNCTIONAL STATES. No guard exists and 88 component files carry state
      testids today, but there is no proof that every screen is honest in loading / empty / error /
      ready / denied. Add a guard that fails a screen that renders a loading/empty/error/denied state
      with no testid, then fix every screen it names.
  C5. R3 / F30 — the last configuration-honesty rows. Only F108 (motion, DESIGN — do not touch) is
      still `Inert`; F30 (stage machine) is now `Wired` via `StageMachinePanel.tsx`. Re-grep the
      register for any `Inert`/`Absent` row not named above and close it, or record why it cannot be.

  NOTE — already done, do NOT rebuild: D5/D7/D8/D9 (F121/F123/F124/F125, `src/lib/assurance/**`,
  `AssuranceCapabilitiesPanel.tsx`) and D14/D15 (F143/F144, risk library + dynamic risk assessment) are
  `Wired`. D6 (F122) is REMOVED by owner decision — do not build it.

D. NEW AUDIT FEATURES — only two are genuinely new; verify each first (the rest exist)

  Already built, do NOT rebuild (verified 2026-10-30):
  - Journal-entry testing: Benford first + second digit (chi-square / MAD), duplicates, near-duplicates
    and round numbers are in `src/lib/assurance/forensicAnalytics.ts` (D7, F123), citing PCAOB AS 2401
    and ISA 530.
  - Sampling: ISA 530 / AU-C 530 sampling with the "a sample can never exceed its population" rule is
    in the same module and `src/lib/systeligon/flows.ts`.
  - Prior-year comparison and materiality: `PriorYearRollforwardPanel.tsx`, `PriorYearImportPanel.tsx`,
    `priorYearRollforward.ts`, and materiality in `src/lib/auditEngines.ts` / `siraEngine.ts`.

  The two that are genuinely absent:

  D1. UNIFIED EXCEPTION / REFUSAL REGISTER SCREEN. Today a refusal log exists only per feature (e.g.
      `RulePackPanel.tsx` `rule-pack-refusals`). Every refusal path already carries a named reason;
      collect them into one searchable ledger — "what the system refused, when, for whom, and why" —
      as a first-class screen. Deterministic (read the existing refusal rows; no new logic).
  D2. REGULATOR-SHAPED EXPORT PACK. A deterministic export per regime (SBP / AAOIFI / the audit-domain
      axis) mapping each finding to the exact standard clause, with the citation carried through into
      the exported artefact. The citation source already exists (`docs/PAKISTAN-ASSURANCE-REGIMES.md`,
      `src/lib/systeligon/standards.ts`, `disciplines.ts`); the clause-mapped pack does not.

E. HOUSEKEEPING
  E1. Re-record the stale tutorial GIFs (27 stale against their `ui_hash`); `npm run check-tutorials`
      is warn-only today — make it strict once they are current.

MIGRATIONS
- The trunk's highest migration is `0210`. Take numbers in order from **`0211` upward**. One migration
  per coherent change. Never renumber an existing migration. The SQL harness applies every migration
  TWICE and runs every test TWICE — a migration must be idempotent.

CONTRACT SECTION IDS — the next free id in each series (never reuse one; the UI-inventory generator
keys tutorial media off the id, so a reuse steals another screen's keys):
- `OA-43`+ (highest OA-42) · `SA-22`+ (highest SA-21) · `AF-17`+ (highest AF-16) ·
  `WK-12`+ (highest WK-11) · `AU-03`+ (highest AU-02).

RIGOUR — how every row must be proven (this is what makes the build trustworthy)

1. REAL-LIFE USE CASE. Every row lands in the canonical end-to-end scenario, and you extend that
   scenario rather than writing a toy test. The scenario is `e2e/full-flow.spec.ts` (C5.5) and it
   already walks the whole product: setup wizard → people → universe/entity → SIRA → plan →
   deployment gate → planning → population gate → sample → test → finding → conclusion → seal →
   certificate → public verify → report freeze/issue → CAP → Board Pack → export bundle. The
   attestation package and its independent verification are proved separately
   (`scripts/verify-attestation.mjs`, `scripts/verify-report-bundle.mjs`, and the SQL tests). A row is
   not DONE until a named test — in this spec or a sibling — exercises it through its real call path.
   The synthetic users are `kamran.sheikh@…` (CIA), `bilal.ahmed@…` (preparer), `ayesha.khan@…`
   (org_admin), `platform.admin@…` (platform).
2. BOTH PATHS. Every flow has a happy path and a bad path. The bad path names its EXACT refusal reason
   (a real error code, not a message) and proves NO PARTIAL WRITE — the row count is unchanged after
   the refusal.
3. SECURITY TESTING — a new SQL test per migration range, and it must cover:
   - Cross-tenant: org A cannot read/write org B through ANY path (the normal `jwt_org_id()` path, the
     cross-universe share, the support-grant surface, a guessed uuid). Pair every refusal with the
     legitimate read, so a fix that blocks everything fails the test.
   - Auth: no JWT → refusal; wrong role → refusal; expired grant → refusal.
   - IDOR: fetch another org's row by id → zero rows, not an error that leaks existence.
   - Tamper: mutate a ledger entry / a report graph / evidence bytes → the verify path raises, and the
     mutation is located (not just "invalid").
   - Injection: a malicious CSV cell (a formula, a `=cmd`, a path traversal, a zip bomb) is escaped or
     refused, never executed or unpacked.
   - Privilege: the role matrix — each capability is refused for the roles the matrix says may not.
   Run `node scripts/load-test.mjs` after any RLS change.
4. EVIDENCE. For every row you claim DONE, name the CALL SITE (file:line) and the TEST that exercises
   it through that path. No call site, no DONE. Never invent a standard number, a section, a count or a
   framework name — cite the verified source in `docs/`.

GATES — run ALL after every code change; a red gate is your first queue item
- `npx tsc --noEmit`
- `npx vitest run`                       (unit + guards)
- `npx playwright test`                  (against the production build)
- `bash scripts/local-sql-harness.sh`    (SQL; run SEQUENTIALLY, never with vitest — known flake)
- `npm run build`
- `node scripts/check-feature-register.mjs`
- `node scripts/check-wiring.mjs` · `check-dead-code.mjs` · `check-rpc-parity.mjs` ·
  `check-ui-contract.mjs` · `check-config-effect.mjs` · `check-two-sources.mjs` · `check-shrink.mjs` ·
  `check-tokens.mjs` · `check-function-deploy-list.mjs`
- `node scripts/check-tutorials.mjs` (strict once E1 is done)
- after any screen/testid/RPC: `npx tsx scripts/gen-ui-inventory.mjs` and commit `docs/UI-INVENTORY.md`
- after any RLS change: `node scripts/load-test.mjs`

TRAPS THIS CODEBASE HAS HIT — fix them the same way
- A new screen title must use `ENGINE_NAME`/`PRODUCT_NAME` from `src/lib/product.ts`, never a raw
  `Systeligon`/`Provio` literal (`src/guards/productName.test.ts` fails on it).
- `src/guards/uiInventory.test.ts` fails on drift — regenerate `docs/UI-INVENTORY.md` after ANY new
  screen/testid/RPC.
- `check-feature-register` rule (5) fires when a Wired row's evidence backticks a pure-layer export
  no screen calls — name the CALLER, not the pure function.
- Never reuse a contract section id (see above).
- Do NOT claim a `Tutorial key:` unless the key is real — `tutorialRegistryCoverage.test.ts` requires
  every `TUTORIAL_KEYS` entry to be seeded by a migration AND to have a `tutorials/<key>.gif`.
- The SQL harness needs a host PostgreSQL (`sudo apt-get install -y postgresql postgresql-contrib`,
  `sudo pg_ctlcluster 17 main start`); the docker harness has no socket in this sandbox.

OWNER ACTIONS (do not attempt; restate at close-out)
- Make the repository private (the patent clock is running); add a proprietary licence; register the
  domains; engage patent counsel.
- Freeze `docs/design/CONTRACT.md` so the deferred visual rows (E8, U5, U7, U9–U13, A-U1, F105–F113)
  can be built once, not twice. Until then, do not build them.
- Supply real connector credentials; deploy the Edge Functions.
- Commission an external penetration test and open a SOC 2 / ISO 27001 scoping — this, not a feature,
  is what converts "well-engineered" into "greatest".

BEGIN: read this file, then `docs/build/streams/integrator.md`. Lock your baseline (migration count,
vitest file/test counts, Playwright spec count, guard count), prove the tree whole (run every gate), and
work the queue continuously. Commit messages are the report.
```

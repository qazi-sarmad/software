# Builder prompt — the Systeligon last mile (everything not yet built)

Paste the block below into a fresh session. It is self-contained: the session needs no prior context.
It is the brief for the builder that finishes the unbuilt part of the specification, established by
`docs/SYSTELIGON-GAP-REPORT.md` (read that first).

This supersedes the earlier "remainder" prompt, which listed the whole S1–S16 rule engine as work,
described the engine's screens as entirely unbuilt, and left L2 open. Since then: the engine is
**built**, **two** of its surfaces are **mounted** (the rule-run screen L1 and the rule-pack manager
L2), the release transition exists (`0128_rule_pack_release.sql`), and six understated register rows
are corrected. **Apart from the design language, the entire remainder is delegated to the builder** —
every item in §13.8 of the gap report except the DEFERRED visual rows.

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
- feature/systeligon-builder-continuous (cd2e352) — THE UNIFIED SET PLUS U4 (team directory), L1 (the
  rule-run screen), L2 (the rule-pack management surface), the D5/D7/D8/D9 and D10-D13 work packages,
  and the verified references docs/ASSURANCE-RULEBOOKS.md and docs/PAKISTAN-ASSURANCE-REGIMES.md.
  THIS is your starting point; branch from it.
- main (a697190) — the untouched default branch, still carrying the original production defect.
Read docs/SYSTELIGON-GAP-REPORT.md for the full verified built/planned picture. Its §13.8 is your
authoritative work list. Everything in it except the DEFERRED design rows is yours.

WHAT IS LEFT — this is YOUR work, and it is the last mile, not the engine
The engine is built and two of its surfaces are mounted (L1, L2). Most of its OTHER surfaces are not.
That is the whole remainder, and it is the same defect class the whole programme exists to catch — a
working library with no reachable surface — in miniature. The guard is the same: find the call site.
If nothing calls it, it is dead code and you must say so. L1 and L2 are DONE; the rest of the engine's
surfaces are not.

YOUR BRANCH
Branch from feature/systeligon-builder-continuous (it carries the unified migration set, U4, L1 and
L2). Suggested name feature/systeligon-lastmile-v1. Never touch main. Never force-push. Push after
every coherent unit of work. Do NOT rebase onto feature/systeligon-build-v1 or feature/scale-harden-v1
— the unified branch already reconciles both; work from the unified set so you do not re-open the
migration collision.

FIRST ACTION — lock your baseline and prove the tree whole
Run the full gate set on the starting branch and record the counts (migrations 128, SQL test files 133,
vitest 281 files / 3209 tests, playwright 30 specs, guards 28 — verify these yourself, they are your
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
- Platform crypto and existing hashing primitives only. Key generation is the platform primitive
  (`generateSigningKey` in src/lib/anchoring.ts) — never a bespoke RNG.
- A rule, an extraction step and an update path NEVER call anything external.
- Order is bytes -> row -> ledger, never the reverse, wherever evidence or an artifact is written.

THE ONE RULE — VERIFY WIRING BY GREPPING THE CALL SITE
On this repo the entire suite passed for months while the production build rendered empty screens. A
green test is NOT proof a feature works. Never trust a doc, and never trust a passing test, as proof
something is wired. Find the call site. If nothing calls it, it is dead code and you must say so.
Use `node scripts/check-wiring.mjs` (and `scripts/audit-wiring.mjs` for the raw export list). It
resolves the real import graph, alias-aware. Name-based greps lie here.
This cuts BOTH ways: the register can also UNDERSTATE the build. §13.11 of the gap report listed six
register rows (F28, F29, F39, F53, F54, F55) that said Absent/Inert for features that are built and
wired. Those six are now corrected on the starting branch. Keep the rule: if you find another stale row,
correct it in the same commit as the work that proves it.

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
  same commit or the gate fails (that is rule (6) of the gate working as designed). The generated
  docs/UI-INVENTORY.md must be regenerated with `npx tsx scripts/gen-ui-inventory.mjs` whenever a screen,
  testid or RPC changes — `src/guards/uiInventory.test.ts` fails on drift.
- A new screen needs a contract section in docs/ACP-UI-CONTRACT.md (check-ui-contract fails otherwise).
- Never leave a raw product/engine-name literal in live code outside src/lib/product.ts —
  src/guards/productName.test.ts fails the build. Import PRODUCT_NAME / ENGINE_NAME instead.

LEDGER RULE
Update docs/SCALE-TASKS.md (the live ledger) IN THE SAME COMMIT as the work. Status values are exactly:
TODO / DOING / DONE / BLOCKED (owner). `Partial` is not a status and must never appear. For anything
you add, add a FEATURE-REGISTER row in the same commit.

READ FIRST, IN THIS ORDER
1. docs/SYSTELIGON-GAP-REPORT.md   — the verified built/planned picture, and your work list (§13.8)
2. docs/SYSTELIGON.md              — the forensic engine spec. YOUR PRIMARY DOCUMENT.
3. docs/SCALE-TASKS.md             — the live ledger, including the S1-S16 build and L1/L2
4. docs/FEATURE-REGISTER.md        — every feature and its true wiring status, gated
5. docs/SPEC-v10.md                — the authoritative product specification
6. docs/BRANCH-MAP.md              — scope, ledger and migration reservation
7. docs/iia-standards-reference.md — VERIFIED IIA 2024 numbering. Use these; never guess.
8. docs/ASSURANCE-RULEBOOKS.md     — VERIFIED control sets, forensic standards and quality standards
   for D5/D7/D8/D9. The rule citations come from here. Never invent a standard number or a count.
9. docs/PAKISTAN-ASSURANCE-REGIMES.md — VERIFIED client classification matrix (C1–C8) for D10, and the
   management / IT / Shari'ah audit-type axis for D11. The regulator and obligation citations come from
   here. Never invent a section number, a stage count or a framework name.
10. docs/AUDIT-DOMAINS-MODEL.md     — the three-universe model (Management / Shari'ah / IT), each with
   its own rule base. Read before D11.
11. docs/RISK-ASSESSMENT-MODEL.md    — the risk library, auto-adjusted factors and manual override for
   D14/D15. Read before building either.
12. docs/Shariah Standards-AAOIFI.pdf — the AAOIFI Shari'ah Standards (2015 English ed., 54 standards).
   The verified source for the Shari'ah pack (D11). Cite SS (n) + title on every rule.
13. docs/Risk Assessment, reimagined.pdf — PwC 2026 survey. Shapes the model/defaults for D15, not a
   finding rule. The deterministic input taxonomy is in docs/ASSURANCE-RULEBOOKS.md §6.
14. docs/COMPENDIUM OF SHARIAH STANDARDS ADOPTED BY STATE BANK OF PAKISTAN.pdf — the SBP-adopted
   AAOIFI subset + SBP's own Sharikat ul Milk / Diminishing Musharakah standard (updated 31 Oct 2024).
   The Pakistan Shari'ah overlay for D11. Cite the standard number + the SBP circular.
15. docs/SHARIAH GOVERNANCE FRAMEWORK.pdf — the SBP SGF for IBIs (effective 1 Jan 2025). The
   governance spine of the Pakistan Shari'ah audit (D11): SB, RSBM, SCD, PD, ISA, ESA, FAPC, the SB
   report and the external-audit-report format.
16. docs/STANDARDS-DISTRIBUTION.md — the Super Admin rollout of signed rule-base packs to entitled
   tenants (D16), and the rule-scope answer (population vs any other scope).
IGNORE ALL of docs/archive/ — 63 pre-audit docs, each stamped stale.

===============================================================
YOUR WORK — the last mile, in this order (all of §13.8 except the DEFERRED design rows)
===============================================================

L1  DONE. The rule-run screen (RuleRunTab.tsx, contract AF-16) mounts the engine and now reads the
    released pack through getReleasedRulePack/resolveReleasedRules, falling back to the in-code library
    when no pack is released. Verify it still passes and leave it.

L2  DONE. The rule-pack management UI (S10/S11, contract OA-33, RulePackPanel.tsx) is mounted: it
    lists packs, generates and registers a signing key, signs a pack, verifies the signature locally
    before sending it, releases a draft, reads the refusal log, and builds an ad-hoc rule. The release
    transition is 0128_rule_pack_release.sql (rule_pack_release, signing_key_register,
    rule_pack_refusals_list, rule_pack_released_rules). F137 is Wired; F128 stays Inert because
    RuleRegistry and packRules still have no screen caller. Verify and leave it.

L2b The remaining engine surfaces — one screen per family, all built and unreached today:
    - flows (S3/S4/S5/S12): buildAcceptedTestingSet, applyFloor, parsePastedBlock, verifyRows,
      carriedOverrides. Mount in the row-testing / population flow.
    - documents (S8): documentRules. Mount in the audit-file UI.
    - patterns (S9): patternRules. Mount in the audit-file / source-review UI.
    - minutes (S14): buildActionRegister, itemHistory. Mount a minutes surface.
    - policy (S15): compareDocuments. Mount a policy-comparison surface.
    Turn F132-F136 Inert -> Wired as each lands. Each needs a contract section, testids and a regenerated
    UI-INVENTORY.md.

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

D5, D7, D8, D9 — the adjacent capability products. THE OWNER HAS NOW SETTLED THE SCOPE: all four are
    IN SCOPE, at full depth, working end-to-end. D6 (verifiable third-party attestation) is REMOVED —
    do not build it. These are new capability products, not last-mile wiring, and they are held to the
    SAME standard as the engine: deterministic, no AI, every rule named and versioned and citing a
    verified source. Read docs/ASSURANCE-RULEBOOKS.md FIRST — it is the verified source reference for
    all four, and it is where the rule citations come from. Ground every rule in it; never invent a
    standard number, a control count or a threshold. Where a source is licensed, encode the structure
    and paraphrase — never paste licensed text into the product, a UI string or a rule description.

    THE BAR (the owner's words, made checkable). "Working end-to-end, extraordinarily, with the
    highest skill embedded in its rule base." Concretely, each of the four must be: a real rule base
    (not a demo), reachable from a screen, backed by migrations + tests + a regenerated register row,
    with every rule naming its source and re-running identically forever. A capability that computes a
    number no screen shows is the exact defect this programme exists to catch — it is NOT done.

D5 — Continuous control monitoring (SOX / ICFR). F121 Absent -> Wired.
    Reuse the monitors + connectors + rule engine; control testing is what the engine already does.
    - Encode the COSO ICIF-2013 taxonomy (5 components, 17 principles) as a versioned control set,
      and the assertion mapping + deficiency-severity ladder from PCAOB AS 2201 (see
      ASSURANCE-RULEBOOKS.md §1). Also load ISO/IEC 27001:2022 Annex A (93 controls, 4 themes) and
      NIST SP 800-53 Rev.5 families as alternate control sets — same machinery, different taxonomy.
    - Severity is a RULE, never a model: deficiency / significant deficiency / material weakness,
      with materiality and significance as versioned configuration.
    - A control is monitored on a schedule (pg_cron) against live signals; a failing test opens a
      finding that names the control, the principle, the rule version and the source rows.
    - Surface: a control-monitoring screen (contract section + testids + regenerated UI-INVENTORY.md).
    - Acceptance: a control configured once is monitored continuously, a breach opens a finding with
      its rule and rows named, and the run re-derives identically.

D7 — Population-level forensic analytics. F123 Absent -> Wired.
    The existing analyticsEngine runs over a sample; D7 runs the forensic set over the WHOLE population.
    - Run every existing forensic rule (duplicates, near-duplicates, sequence gaps, z-score/IQR
      outliers, Benford first digit, round numbers, weekend postings, same-user create-approve, missing
      attributes, period variance, GL-to-TB) over a complete population.
    - Add the PCAOB AS 2401 / AU-C 240 journal-entry family as named, versioned rules (unusual
      accounts, unusual user, unusual time, round numbers, back-dated, closed-period, missing
      description) and Benford second digit. See ASSURANCE-RULEBOOKS.md §2.
    - Depends on the population-rows writer (B's 0119) being present — without it a population has no
      rows and every draw raises population_gate. Confirm that writer is on your starting tree first.
    - Surface: a population-forensics screen with a drilldown from each finding to its rows.
    - Acceptance: a population with planted anomalies is flagged with each anomaly named by rule,
      version and row; a clean population yields no false positive.

D8 — Policy-to-control gap analysis. F124 Absent -> Wired.
    Reuse the policy/procedure comparison (S15 compareDocuments) and the gov.regulatory capability.
    - Encode a regulation as a set of obligations (id, source clause, subject); compute
      obligation × control -> covered / partially covered / gap, with the clause named. Generalise the
      ISO 27001:2022 Statement of Applicability shape (ASSURANCE-RULEBOOKS.md §3).
    - Version drift: a policy aligned to an older regulation version is a finding naming the clauses
      that moved.
    - Surface: a policy-comparison / coverage-matrix screen.
    - Acceptance: a corpus of policies against a regulation produces a coverage matrix where every gap
      names the obligation and clause, and the result re-derives identically.

D9 — Assurance-over-assurance. F125 Absent -> Wired.
    Audit the audit function against the IIA Global Internal Audit Standards (2024) — numbering from
    docs/iia-standards-reference.md, never guessed (ASSURANCE-RULEBOOKS.md §4).
    - Reuse B's self-diagnostic (0120_self_diagnostic.sql), the assuranceOps capability family, the
      analytics-of-the-analytics checks (sira_vs_planning, controls_vs_tests) and the hash-chained
      ledger. Do NOT build a second self-diagnostic — reconcile, as in L7.
    - Measure conformance to 8.3, 8.4, 12.1-12.3, 13.1-13.6, 14.1-14.6, 15.1-15.2 and produce the
      evidence pack an external quality-assessment reviewer would request.
    - Surface: the conformance screen; counts, flags and one broken-ledger sequence only — never a row
      of tenant content (Law L2).
    - Acceptance: the function's conformance is computed from its own records, each measure cites its
      standard number, and the pack re-derives identically.

    D6 (verifiable third-party attestation) is REMOVED from scope by owner instruction. If you find
    F122 referenced, mark it honestly as removed, not Absent, and note the owner decision.

D10 — Client classification at onboarding, and the ICFR trigger. NEW; owner instruction 2026-10-29.
    Read docs/PAKISTAN-ASSURANCE-REGIMES.md FIRST — it is the verified classification matrix and it is
    where the regulator, law, framework and mandatory-obligation citations come from. Never invent a
    section number, a stage count or a framework name.
    - `orgs` (0002) carries only name/is_demo/created_at. Add the classification as versioned,
      reason-stamped org data: classification (C1–C8 from the reference), principal regulator,
      jurisdiction, and an `is_islamic` / shari'ah-obligation flag. Config-as-ledger: a change is
      versioned and reason-stamped.
    - Add it to the Super Admin onboarding (the provisioning wizard, SA-16) AND the Org Admin
      onboarding: a classification picker with the regulator and the obligations it triggers shown
      inline. The picker is data, not a hard-coded if/else — a table of classifications → obligations.
    - **The ICFR trigger.** The classification decides whether ICFR is mandatory and at what rigour:
      C6 (banks/DFIs) → the SBP ICFR Roadmap form (BSD Circular 7 of 2004 + Circular 5 of 2009, eight
      stages, annual management assessment, board endorsement, Long Form Report); C7 (SOEs) → COSO ERM
      + ISO 31000 + COBIT under the SOE Regulations 2024; C1 → the Companies Act 2017 s.227 directors'
      statement with COSO ICIF; C2 → board comment in the directors' report; C3–C5 → basic or exempt.
      When ICFR is mandatory the tenant is offered the D5 control set and the required reporting
      artifact is enabled. When it is exempt, the product says so and does not invent an obligation.
    - Surface: the classification appears on the org settings screen and drives the obligation set.
    - Acceptance: a tenant created as "Banking company / DFI" is offered the SBP ICFR control set and
      the LFR artifact; a tenant created as "SMC" is told it is exempt; the choice is versioned and
      reason-stamped; no obligation is asserted without a citation.

D11 — The audit-domain axis: three universes, three rule bases. NEW; owner instruction 2026-10-29.
    Read docs/AUDIT-DOMAINS-MODEL.md FIRST — it is the model, and it answers the owner's question
    (three default universes, selectable and configurable, each with its own rule base). Management
    audit is the product and is built. IT audit and Shari'ah audit are containers with no rule base —
    the same "built container, no reachable rule" defect. Close it.
    - Seed three default universes per org — Management Audit, Shari'ah Audit, IT Audit — each an
      ordinary `universes` row with `domain` (or a new `audit_type`) set. `universes.domain` exists
      (`0003`) but NO screen reads or sets it. Make it first-class: the universe creation/settings
      screen sets it, and the rule-run screen loads the matching rule base from it. The three are
      DEFAULTS, not a hard limit — an org may add a fourth discipline and point it at a rule pack. Never
      hard-code "exactly three".
    - **IT audit pack** — a real rule base over the COBIT 2019 objectives / ISO 27001:2022 Annex A (93
      controls, 4 themes) / NIST 800-53 Rev. 5 families in docs/ASSURANCE-RULEBOOKS.md §1: change
      management, access control and privileged access, backup and DR, SDLC, patch management, logging
      and monitoring. Named, versioned rules, each citing its control id.
    - **Shari'ah audit pack** — FULLY VERIFIED NOW. Three verified sources are in this repo:
      `docs/Shariah Standards-AAOIFI.pdf` (the 54 AAOIFI Shari'ah Standards, 2015 English ed.),
      `docs/COMPENDIUM OF SHARIAH STANDARDS ADOPTED BY STATE BANK OF PAKISTAN.pdf` (the SBP-adopted
      AAOIFI subset + SBP's own Sharikat ul Milk / Diminishing Musharakah standard, updated 31 Oct
      2024), and `docs/SHARIAH GOVERNANCE FRAMEWORK.pdf` (the SBP SGF for IBIs, effective 1 Jan 2025).
      See docs/ASSURANCE-RULEBOOKS.md §5. Build the pack in TWO layers:
        (a) the AAOIFI structural rules from SS 1–54 — riba (SS 1/3/19), gharar (SS 31), ownership
            sequence (SS 8/18), profit-distribution integrity (SS 12/13/40), zakah (SS 35);
        (b) the SBP overlay — the adopted-standard subset in the Compendium (note SBP has NOT adopted
            every AAOIFI standard: the Compendium carries 38 items, e.g. it does NOT include SS 1, 6,
            20, 21, 26, 27, 29, 30, 31, 33, 35, 40, 41, 43, 44, 47) and the SGF governance rules (SB
            role and report, RSBM, SCD, PD, ISA — including the mandatory quarterly post-disbursement
            profit-and-loss-distribution audit, ESA, FAPC, and the Annexure-B Shariah Board report /
            Annexure-C external audit report formats).
      Cite the exact standard number and title (and the SBP circular where the Compendium gives one)
      on every rule. The substantive Shari'ah judgment is always the SSB's, never the product's.
    - Surface: the universe settings screen sets the discipline; the rule-run screen loads the matching
      pack; the risk library offers the discipline's risks (see D14). Each pack needs a contract section,
      testids and a regenerated UI-INVENTORY.md.
    - Acceptance: a universe of each discipline runs its own pack; the three defaults are seeded and an
      org can add a fourth; every rule names its control id and source; a Shari'ah universe runs only
      verified AAOIFI rules or the SBP Compendium/SGF overlay, each citing its source.

D12 — Traffic-signal readiness panels that ACT (Super Admin + Org Admin). NEW; owner instruction 2026-10-29.
    The owner wants the control panels, especially at deployment and onboarding, to read as LIVID
    TRAFFIC SIGNALS: one glance tells a non-technical administrator what is ready, what is degraded and
    what is broken. This is functional honesty made visual, not decoration. AND, owner instruction
    2026-10-29 (second round): a signal is not a dead light — it must carry the FIX.
    - Extend `platform_provisioning_status` (0097) — already counts + booleans — into a full readiness
      signal set, and add the equivalent for the Org Admin. Each signal is a deterministic verdict:
      red / amber / green, with the reason in words. Reuse the existing `evaluateFit` verdict vocabulary
      (`SuperAdminHosting.tsx` already renders green/amber/red from `lib/hostingFit`).
    - Cover at least: schema/migrations applied; storage buckets present (0120 evidence storage);
      Edge Functions deployed (doc-extract, invite-user, email-dispatch, graph-oauth, archive-upload,
      secrets-put, hosting-test); the platform sender configured; a signing key registered; the
      classification set (D10); the first admin invited and accepted; the first engagement creatable;
      backups/DR configured; and — for a real deployment — the app build's environment variables present.
    - **The honest rule**: a signal is never a wall of green. If a check cannot be evaluated (a bucket
      not wired, a function not deployed), the signal is amber with "not evaluated" named — never green
      by default. This is A-U2 (functional states) and the R3 config-honesty rule applied to readiness.
    - **ACTIONABLE — the corrective-action direct flow (owner instruction).** Every non-green signal
      carries, in the signal itself:
        1. a **"Fix this" affordance** that deep-links to the exact configuration screen and field that
           resolves it (e.g. an un-deployed Edge Function → the hosting/deploy surface; a missing
           classification → the D10 onboarding picker; a missing bucket → the storage step). The flow
           takes the admin to the fix, it does not merely describe it. Where the fix is a re-run, offer
           the re-run; where it is a setting, open the setting.
        2. a **"Contact Super Admin" action** that opens the complaint-management flow below, with the
           whole issue auto-generated and attached.
    - **Complaint management system (owner instruction).** A first-class, coded issue path, not a mailto:
        - `complaints` table (org_id, code, severity, source_signal, title, body, status, created_by,
          assigned_to, created_at, resolved_at) with a **human-readable code** (e.g. `PRV-<org>-0007`)
          minted on create, org-scoped, RLS-guarded, and append-only on its event log (L5).
        - `complaint_create` RPC: takes the signal id(s) and **auto-generates the entire issue** —
          the failed check, its reason, the environment layer, and the **system logs** (the readiness
          RPC's own output, the relevant error rows, the last migration/function-deploy state, the
          build/env flags) — as a structured bundle. Never free-text only.
        - **Emails the Super Admin directly** with that bundle. Reuse the existing email-dispatch
          machinery and the platform-sender configuration (do NOT build a second sender). The email
          carries the complaint code, the severity, the auto-generated bundle and a link back.
        - A complaint-management surface (Super Admin: all complaints; Org Admin: this org's) to list,
          filter by code/severity/status, assign, comment, and resolve — resolution recorded with a
          reason (config-as-ledger).
    - **Self-diagnostic, per-issue, segregated (owner instruction).** A `runDiagnostic(signalId)` path:
        - runs the check for **one** signal **in isolation**, so one failing check cannot mask another
          (issue-to-issue segregation — the same discipline as the RLS tests isolating tables).
        - returns a structured result: pass / fail, the reason, the evidence it read, and — where it can
          — a **suggested remediation** drawn from a seeded remediation catalogue keyed to the signal.
        - is runnable from the signal itself ("Re-check"), and the result is recorded (who ran it, when,
          what it found) so a later reviewer sees the history.
        - **never mutates** state as a side effect of diagnosing; a diagnostic that changes state is not
          a diagnostic. The fix is a separate, explicit action.
    - Surface: a readiness banner/section on SuperAdminProvisioning and OrgControlPanel. Non-blocking,
      no modal (spec §27.5). Counts and booleans only cross to the platform role (L2); the log bundle in
      a complaint is the minimum needed and is org-scoped.
    - Acceptance: every signal names its check and its reason; an un-evaluated check is amber, never
      green; every non-green signal offers a "Fix this" deep-link and a "Contact Super Admin" action; a
      complaint gets a code, an auto-generated bundle with logs, and an email to the Super Admin; a
      self-diagnostic runs one signal in isolation, records its result, and changes no state.

D14 — The risk library, auto-adjusted factors, and manual override. NEW; owner instruction 2026-10-29.
    Read docs/RISK-ASSESSMENT-MODEL.md FIRST — it is the specification, and it is elaborate on purpose
    (owner instruction: "ensure the risk libraries, and auto-adjusted factors (with manual override) is
    present and is elaborate"). Today the SIRA model can be *scored* but cannot be *fed*: `risks_library`
    is empty, there is no auto-adjustment, and there is no override.
    - **The risk library, seeded and layered**: the universal layer (`risks_library.is_universal`), the
      org layer (scoped by org_id), and **discipline packs** (management / IT / Shari'ah) loaded when a
      universe is of that discipline (D11). Add `discipline`, `source`, `risk_type`, `is_emerging`,
      default `inherent_rating`/`residual_rating`/`appetite`/`tolerance`. SEED it non-empty — management
      from COSO ICIF-2013 + IIA 2024 + the seven PwC ERM themes; IT from COBIT 2019 / ISO 27001:2022 /
      NIST 800-53; Shari'ah from AAOIFI SS 1–54. Versioned and reason-stamped (L5).
    - **Auto-adjusted factors**: a proposal step that derives each SIRA factor value from data — prior
      findings, time since audit, control-test failures, incidents, KRI breaches, change velocity,
      regulatory exposure from the D10 classification — each proposal carrying `{proposed_value, inputs,
      rule_id, rule_version, source}`. Show the proposal with its inputs; the auditor confirms. **An
      unknown input yields "unknown", never 0.**
    - **Manual override, elaborate and recorded**: `override_value` + MANDATORY `override_reason` +
      `override_by`/`override_at` + `auto_value_at_override` + the overridden `rule_id`/`rule_version`.
      An override is visible at every stage (reuse the S12 `carriedOverrides` vocabulary), never destroys
      the auto value, is revertible (the revert recorded), and a band change it causes is flagged for D9.
      Needs a right; a read-only user sees but cannot override. Extend `sira_scores` with `auto_values`
      and `overrides` so a score is fully reconstructible.
    - **KRI and appetite/tolerance**: a KRI is a named measure with a threshold and a tolerance band, a
      deterministic breach verdict; risk appetite and tolerance are versioned org settings.
    - Surface: the SIRA model screen shows auto values and overrides side by side; the library screen
      lists, filters by discipline, and edits (versioned). No AI — `src/guards/noAi.test.ts` must pass.
    - Acceptance: the library is seeded and non-empty; a factor is auto-proposed with inputs and rule
      version named; an override requires a reason and shows the auto value; an override is visible
      downstream and revertible; a band change from an override is flagged; an unknown input is
      "unknown", not 0.

D15 — Dynamic risk assessment: the PwC model made deterministic. NEW; owner instruction 2026-10-29.
    Read docs/ASSURANCE-RULEBOOKS.md §6 and docs/Risk Assessment, reimagined.pdf. This is the process
    around the library (D14), from a professional-practice survey — it shapes the MODEL and the
    DEFAULTS, not a finding-producing rule. Five themes, all deterministic, NO AI.
    - **Standardised inputs, common taxonomy**: one risk taxonomy shared by the library, the SIRA model,
      ERM and the rule packs, so a risk trends across cycles and compares to the ERM register. Seeded,
      org-extensible, versioned.
    - **ERM mapping**: a table mapping each enterprise risk theme to the audit coverage addressing it,
      with a coverage verdict (direct / limited / monitoring / none), the linked engagement or plan item,
      and its KRIs — the PwC worked example as data. A top ERM risk with NO coverage is surfaced as a
      gap. This is what lets a leader "see alignment, overlap, and coverage gaps".
    - **Trigger-based refresh**: a deterministic trigger set (KRI breach, incident above band, control
      test failure, strategic change, management request). Each produces a plan-change PROPOSAL
      (track / defer / cancel / rescope) with rationale, which a human accepts — never an automatic plan
      rewrite.
    - **Risk-to-coverage narrative**: what changed since the last cycle, the drivers, the affected
      people/process/technology, and the tradeoffs (what moved up, what moved down) — deterministic
      text from data, rendered by the writing engine, no model.
    - Acceptance: the taxonomy is shared and seeded; the ERM map surfaces an uncovered top risk as a
      gap; a KRI breach produces a plan-change proposal with rationale and does not rewrite the plan;
      the narrative is generated from data; the no-AI guard passes.

D16 — Standards distribution: roll out rule-base updates through the Super Admin to paying tenants.
    NEW; owner instruction 2026-10-30. Read docs/STANDARDS-DISTRIBUTION.md FIRST — it is the spec.
    Every rule base the product ships (the forensic core, the ICFR/SOX set, the IT set, the AAOIFI
    Shari'ah pack, the SBP Compendium pack, the SGF pack, the PwC risk taxonomy) becomes a signed,
    versioned **standards pack** the Super Admin rolls out to ENTITLED tenants.
    - The entitlement gate ALREADY EXISTS: `src/data/entitlements.ts` + `has_feature` (0051/0052) +
      `SuperAdminFeatures.tsx`, with price classes free / included / add_on / custom. REUSE it — do not
      build a second entitlement system. A standards pack is a feature; its price class is add_on or
      custom for the licensed packs; the forensic core and ICFR baseline are included.
    - The signing machinery ALREADY EXISTS: `src/lib/systeligon/ota.ts` (`signPack`, `verifyPack`,
      `packContentHash`) and `0128_rule_pack_release.sql`. EXTEND it with a **source-provenance block**
      (document + edition + standard number) on each pack, and a **`scopes: RuleTarget[]`** field.
    - Build the distribution tables: `standards_packs` (platform catalogue, append-only: pack_id,
      version, discipline, sources, rules, content_hash, signature, released_at), `org_standards_
      subscriptions` (per-tenant subscribed_version, applied_at, applied_by, reason; append-only), and
      `standards_rollout_log` (who rolled what to whom, per-tenant outcome). All RLS-guarded; counts and
      booleans only cross to the platform role (L2).
    - Build `standards_rollout(pack_id, version, org_ids[])`: verify the signature (refuse an unsigned
      or content-changed pack), check `has_feature(org, pack_id)` per org, SKIP and RECORD a non-entitled
      org (never silently apply), append a subscription row and switch the effective version for an
      entitled org that has not pinned one, and return the per-tenant outcome.
    - Tenant side: the rule run loads the SUBSCRIBED version, not "the latest"; a sealed report
      re-derives on the version it sealed with; a tenant with the right may PIN a version (recorded with
      a reason) or request the latest; a "standards" section shows the version it is on and what is
      available. Only the Super Admin rolls an entitled pack forward.
    - Super Admin surface: a "Standards" tab on `SuperAdminPortal.tsx` — the catalogue (pack, version,
      discipline, sources, released date), per-pack rollout (pick version + tenants, roll out, read the
      per-tenant outcome), a tenant's pack/version/pin view, and the rollout history. Honest states: a
      pack with no entitled tenant says so; a failed rollout shows the reason, never a green tick.
    - **The scope answer (owner question)**: the rules are NOT tied to population — a rule declares its
      `appliesTo` scope (`RuleTarget = population | journal | document | minutes | policy | config |
      ledger`, already in types.ts) and `runRules(..., { target })` runs the matching scope. Add a
      **scope selector** to the run surface so a subscribed pack's non-population rules are reachable,
      and seal the **scope** alongside the rule id + version on every finding, so a population finding
      and a document finding are never conflated in a sealed report. A pack declares the scopes it covers.
    - **The report-writing invariant (owner instruction)**: D16 must NOT disturb the composer. The
      matrix stays 5 formality × 5 tone × 2 voice × 2 locale = 100 cells × 12 models = **1,200
      compositions** (`registers.ts`, `locale.ts`, `models.ts`, `matrix.test.ts`). For a fixed pack
      version and claim set, all 1,200 combinations still share ONE graph root; only the render hash
      varies. The matrix test must still pass unchanged.
    - Acceptance: a standards pack is signed and versioned with a source-provenance block; the Super
      Admin rolls it to entitled tenants and a non-entitled tenant is skipped and recorded; a tenant
      runs the subscribed version and a sealed report re-derives on its own version; a pin is recorded
      with a reason; the run surface offers a pack's scopes and seals the scope with each finding; the
      1,200-combination matrix still passes with one graph root.

D13 — Deployment and environment readiness in the Super Admin. NEW; owner instruction 2026-10-29.
    The owner asked whether deployment should be part of the Super Admin. The answer, and the work:
    - **The app is a static SPA; the environment is three separate deployments**, and only one of them
      is the app: (1) the SPA to a static host (Vercel/Netlify/Cloudflare Pages/S3) with a catch-all
      rewrite to /index.html (`vercel.json` is committed on the starting branch); (2) the **Supabase
      side** — migrations, storage buckets (0120) and the Edge Functions — which a static host does NOT
      deploy; (3) the environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) at
      build time, without which the production shell renders empty.
    - So yes: the Super Admin SHOULD own and display the **readiness** of all three — that is D12's
      signal set — but it does not perform the deploy. The deploy is a pipeline (CI/CD + the host's
      dashboard + `supabase db push` / function deploy); the Super Admin's job is to say, after the
      fact, whether the environment is actually ready, and to name what is missing. Reuse the existing
      `hosting_connections` / `hosting_connection_test_result` machinery (0069) and the migration-job
      surface (`SuperAdminMigration`) — do NOT build a second deployment system.
    - Build a "Deployment readiness" section on the Super Admin that reads the three layers' status
      (app build/env present, migrations applied, buckets present, functions deployed) and renders each
      as a D12 traffic signal with the reason. Where a status is not readable from the database (the
      static host, the build env), the panel says "verify at the host" and links to the runbook — it
      never claims green on something it cannot see.
    - Deliverable: the readiness section + a short `docs/DEPLOYMENT-RUNBOOK.md` (the three layers, the
      exact commands, the required variables, and the order).
    - Acceptance: the Super Admin shows the three-layer readiness with honest per-layer verdicts; a
      missing bucket or an un-deployed function shows amber/red with the name; the runbook reproduces a
      clean deploy end to end.

Register honesty — the six stale rows (F28, F29, F39, F53, F54, F55) are ALREADY corrected on the
    starting branch (94 Wired / 27 Inert / 24 Absent). Keep the rule for any further stale row you find:
    correct it in the same commit as the work that proves it.

THE 27 INERT AND 21 ABSENT ROWS ARE YOURS — all of them. NEW; owner instruction 2026-10-29.
    Owner instruction, verbatim in effect: hand ALL 27 Inert and ALL 24 Absent rows to the builder in
    this continuous-build prompt, worked through with at most a 15-second pause between them. Nothing in
    the register is left out of scope, and nothing is parked behind a design decision except the DEFERRED
    design rows below. The full list is in docs/FEATURE-REGISTER.md §14 and restated here so you do not
    have to go looking. The rule for every row is the same and it is not negotiable: FIND THE CALL SITE.
    A row is `Wired` only when a named screen or scheduled job calls it AND a test exercises it through
    that path. If nothing calls it, it is `Inert` and you must say so; if it does not exist, it is
    `Absent`. Correct the register in the same commit as the work that proves it.

    The 27 `Inert` rows (a built thing with no reachable caller — wire it or say why not):
      F35 report templates · F49 monitor rules · F50 monitor runner · F51 alert persistence ·
      F52 alert→Work Queue delivery · F57 connector run start/finish · F58 staged record ingest ·
      F59 the 22 connector adapters · F72 testing_mode · F73 signoff_role_* · F74 approval_chain ·
      F75 report_templates readers · F76 anchoring_settings · F78 report_opinion_required ·
      F79 workflow SLA/escalation · F85 support access grant/revoke · F96 in-app notification delivery ·
      F108 motion system · F112 contrast test coverage · F128 rule versioning/packs (RuleRegistry,
      packRules) · F130 structured extraction tier 3 · F131 OCR seam tier 2 · F132 accepted/declined
      flows + Mode A/B · F133 structural document rules · F134 pattern rules · F135 minutes action
      register · F136 policy/procedure comparison.
      Note: F49–F52 and F57–F59 are the C-series monitor/connector runtime; F72–F79 are the R3
      configuration-honesty rows; F128–F136 are the Systeligon engine surfaces (L2b/L3).

    The 24 `Absent` rows (does not exist — build it or, for the one removal, record why not):
      F30 configurable stage machine · F56 anomaly→emergent-risk→SIRA · F84 multi-org isolation under
      concurrency · F86 support access logged · F92 guided zero-to-first-report wizard · F98 realtime
      pop-out sync · F105 additional themes · F106 audience profiles · F107 time-of-day phases ·
      F109 animated headers · F111 density toggle · F113 motion/theme/personalisation gates ·
      F121 continuous control monitoring (D5) · F122 verifiable third-party attestation (D6 — REMOVED by
      the owner, do NOT build; record it as removed, not absent) · F123 population forensic analytics
      (D7) · F124 policy-to-control gap analysis (D8) · F125 assurance-over-assurance (D9) ·
      F139 client classification + ICFR trigger (D10) · F140 audit domains + rule packs (D11) ·
      F141 actionable traffic-signal readiness (D12) · F142 deployment readiness (D13).
      Also build D14 (risk library / auto-adjusted factors / override), D15 (dynamic risk assessment)
      and D16 (standards distribution — roll rule-base updates out through the Super Admin to entitled
      tenants) — see docs/RISK-ASSESSMENT-MODEL.md, docs/ASSURANCE-RULEBOOKS.md §6 and
      docs/STANDARDS-DISTRIBUTION.md — they are new rows F143/F144/F145 to add to the register as you
      build them.

    The two rows NOT to build, and the one caveat:
      - F122 (D6) — removed by the owner. Record it as removed, with the date, and move on.
      - F105/F106/F107/F109/F111/F113 and the other U/E/A design rows — DEFERRED below; do not build
        until the owner settles the design language. They are the ONLY rows held back.

    Work them with at most a 15-second pause between rows. If a row needs a surface that does not exist
    yet, build the smallest honest surface that reaches it, prove it with a test through that path, and
    correct the register row in the same commit. Commit messages are the report — say which row moved and
    from what status to what status, with the call site and the test that proves it.

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
- A sealed report records the rule-pack version that scored it. (S10, S11 — the pack UI is built; the
  engine runs the released pack; verify end to end.)
- The editor adopts an uploaded report's structure and typography, and formatting stays editable at
  every stage without altering a fact. (S13 remainder.)
- D5: a control configured once is monitored continuously; a breach opens a finding naming the
  control, the principle, the rule version and the source rows; the run re-derives identically.
- D7: a population with planted anomalies is flagged over the whole population, each anomaly named by
  rule, version and row; a clean population yields no false positive.
- D8: a policy corpus against a regulation yields a coverage matrix where every gap names the
  obligation and clause, and the result re-derives identically.
- D9: the audit function's conformance to the IIA 2024 standards is computed from its own records,
  each measure cites its standard number, and the evidence pack re-derives identically.
- D10: a tenant's classification is set at onboarding, versioned and reason-stamped, and drives its
  obligations; a "Banking company / DFI" is offered the SBP ICFR control set and the LFR artifact; an
  "SMC" is told it is exempt; no obligation is asserted without a citation.
- D11: a universe of each discipline (Management / Shari'ah / IT) runs its own rule base; the three
  defaults are seeded and an org can add a fourth; every rule names its control id and source; a
  Shari'ah universe runs only rules citing a verified source (AAOIFI SS, the SBP Compendium or the
  SBP SGF).
- D12: every readiness signal names its check and its reason; an un-evaluated check is amber, never
  green by default; every non-green signal offers a "Fix this" deep-link and a "Contact Super Admin"
  action; a complaint gets a code, an auto-generated bundle with logs, and an email to the Super Admin;
  a self-diagnostic runs one signal in isolation, records its result, and changes no state.
- D13: the Super Admin shows the three-layer deployment readiness with honest per-layer verdicts, and
  `docs/DEPLOYMENT-RUNBOOK.md` reproduces a clean deploy end to end.
- D14: the risk library is seeded and non-empty; a SIRA factor is auto-proposed with its inputs and its
  rule version named; an override requires a reason, shows the auto value, is visible downstream and is
  revertible; a band change from an override is flagged; an unknown input is "unknown", not 0.
- D15: the risk taxonomy is shared and seeded; the ERM map surfaces an uncovered top risk as a gap; a
  KRI breach produces a plan-change proposal with rationale and does not rewrite the plan; the
  narrative is generated from data.
- D16: every rule base is a signed, versioned standards pack with a source-provenance block; the Super
  Admin rolls a pack version to entitled tenants and a non-entitled tenant is skipped and recorded; a
  tenant runs the subscribed version and a sealed report re-derives on its own version; a pin is
  recorded with a reason; the run surface offers a pack's scopes and seals the scope with each finding;
  the composer still yields 1,200 combinations with one graph root per fixed claim set and pack version.
- Every register row: the 27 `Inert` and 24 `Absent` rows are each moved honestly (wired + proved, or
  said plainly to be unwired), with the register corrected in the same commit. F122 (D6) is recorded as
  removed, not built. Only the DEFERRED design rows are held back.
- No D-capability rule calls anything external; the no-AI guard still passes. (L1.)

===============================================================
PROCESS
===============================================================
- CONTINUOUS BUILD. You do not stop to ask, to plan, or to report progress. The commit message is the
  report. No idle longer than 15 seconds for any reason — if a wait would exceed it, take the next queue
  item instead. Work the rows back to back with at most a 15-second pause between them.
- Commit after each task with a conventional message; update docs/SCALE-TASKS.md and
  docs/FEATURE-REGISTER.md IN THE SAME COMMIT. A commit message is the report — say what changed and why.
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

BEGIN: lock your baseline and prove the tree whole, then work continuously through L2b, L3, L4, L5, L6,
L7, the R3 remainder, D5/D7/D8/D9, D10/D11/D12/D13, D14/D15/D16, EVERY remaining Inert and Absent
register row (27 and 24 of them — at most a 15-second pause between rows), and the tutorial media —
and close on the specification's section 14 acceptance list. Commit messages are the report.
```

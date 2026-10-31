> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# WRITE-1 decisions

Numbered, one entry per decision. Each records: task, point, options, choice, reason, and how to
reverse it. Classes are FIXED (written in the brief, implemented as written), NEVER IMPROVISE (not
decided here), and IMPROVISE-THEN-DOCUMENT (this file).

---

## D-W-F12 — continuous monitoring and connectors are in scope (2026-10-26)

- Task: W0.1 (owner instruction recorded at the start of the run).
- Point: continuous monitoring and connectors were parked by an earlier decision (F12).
- Options: (a) leave F12 parked; (b) bring both into this run.
- Choice: (b). The owner asked for them during the run. Alert rules stay deterministic (thresholds,
  rates over a window, sequences, set membership, missing-expected-event, cross-source
  reconciliation). No learning, no scoring by a model.
- Reason: the owner's instruction supersedes the parked decision; the deterministic constraint keeps
  Law L1 intact.
- Reverse: revert `docs/PARITY.md` and `docs/NOT-DONE.md` to show F12 parked, and drop migration
  `0092` onward that build the connector and monitor tables.

## D-W-VOICE — grammatical voice is a fourth register axis (2026-10-26)

- Task: W2.
- Point: the brief fixed formality (1..5), tone (1..5) and locale (en-GB, en-US). The owner asked,
  during the run, for active and passive voice as well.
- Options: (a) treat voice as a value inside each formality phrase variant; (b) add voice as a
  separate register axis with its own human-authored phrase variants.
- Choice: (b). `Register = { formality 1..5, tone 1..5, voice: 'active' | 'passive' }`, plus
  `locale`. The full variant matrix becomes 5 x 5 x 2 x 2 = 100 renderings of the same facts.
- Reason: (b) keeps voice orthogonal to formality and tone, so a reviewer can read the whole matrix,
  and it matches how the brief already treats tone ("tone may change emphasis and word choice only").
  The invariant is unchanged: the graph root is identical across every variant; only the render hash
  changes.
- Reverse: remove `voice` from `Register`, from `phrases`, and from the realisation rules; the
  matrix-completeness test then runs 5 x 5 x 2.

## D-W-MIGRATIONS — the schema lands with each module, not in one W1.4 migration

- Task: W1.4.
- Point: the brief places all new tables at W1.4, but W2–W4 each need their table to be testable.
- Options: (a) one large migration at W1.4 covering phrases, claims, figures and templates;
  (b) a migration per module, each M1-checked and M6-tested, numbered from the live `ls`.
- Choice: (b). W1.4 creates the claim and template core; W2 adds the phrase library; W4 adds the
  figure registry. Each is safe to apply repeatedly (M2).
- Reason: (b) keeps each commit's SQL gate meaningful and a failure local to its module. The brief's
  own rule "new migration and test numbers always come from `ls`" already anticipates this.
- Reverse: squash the three migrations into one; the harness applies either.

## D-W-CRYPTO — hashing uses the platform crypto already in the repo

- Task: W1.2.
- Point: the engine needs SHA-256 over canonical bytes, in the browser and in Node.
- Options: (a) add a dependency; (b) use WebCrypto `crypto.subtle` in the app and `node:crypto` in
  Node-only scripts, exactly as `src/lib/ledger.ts` and `src/lib/certificate.ts` already do.
- Choice: (b). No new dependency. The browser path fails closed with `HashUnavailableError` when
  WebCrypto is absent, matching `ledger.ts`.
- Reason: the dependency rule forbids a new dependency without a recorded reason, and the repo
  already has the primitive and a fail-closed test.
- Reverse: swap the hash helper for a library; nothing else changes.

## D-W-TIMESTAMP — time is an argument, never a clock read

- Task: W1.2, W7.1.
- Point: the brief bans clock reads inside the engine ("time is an argument").
- Options: (a) read `Date.now()` inside the composer; (b) pass a `fixed_timestamp` argument through
  every pure function, defaulting only at the UI boundary.
- Choice: (b). The composer and renderer take a `fixed_timestamp`; the UI supplies the real time
  once. A guard test scans the engine directory for `Date.now()`/`new Date()` without an argument.
- Reason: reproducible bytes and reproducible hashes need a fixed time.
- Reverse: none needed; removing the argument would break the render-twice test.

## D-W-PUBLIC-ROOT — the anonymous surface grows by exactly one function

- Task: W10.3.
- Point: the brief permits W10's public report check to add one anon function, deliberately, with a
  recorded decision, the allow-list guard updated, and a test that nothing else became anonymous.
- Options: (a) extend `verify_certificate`; (b) add one sibling function `verify_report_root`.
- Choice: (b). A separate function keeps the certificate contract untouched and returns no tenant
  content: given a graph root it returns only existence, issuance time and the version identifiers.
  Built in migration `0094_verify_report_root.sql`; the guard now allows exactly three names, test 72
  is updated and `supabase/tests/99_verify_report_root.sql` is new.
- Reason: (b) is the smaller change to an existing, tested contract, and the brief names the sibling
  option explicitly. Full entry in `docs/ACP-DECISIONS.md` (D-W10.3-verify-report-root).
- Reverse: drop the function, revert `src/guards/anonGrantAllowList.test.ts` to the two names, remove
  the public page route and `src/data/certificate.ts` `verifyReportRoot`, and delete test 99.

## D-W-FORMAT-EDITOR — the report format editor is per client, versioned and role-scoped

- Task: owner instruction 2026-10-26 (a per-client, versioned, role-scoped interactive report format
  editor).
- Point: the owner asked for an interactive editor for the look and structure of a report, scoped to
  a client and versioned, with roles able to view or edit.
- Options: (a) fold format into the existing `branding` row; (b) a new `report_formats` table with its
  own hash-chained version log, keyed by `(org_id, format_key, version)`, with `format_audiences`
  for the role mapping.
- Choice: (b). "Client" is the tenant organisation, matching spec §3 and every other tenant-scoped
  table. A format is presentation only: it never carries a claim, so it cannot change a fact, the
  graph root or a figure. Saving a draft appends the next version; publishing freezes that version
  (immutable, a trigger refuses an update). A published version is what the renderers use; a draft is
  editable. The audience list is the client's declared intent stored as data, but the database still
  decides by right at call time (`edit_config` to save or publish; `view_reports` to read), so the
  closed 14-right list does not grow.
- Reason: a separate table keeps the format lifecycle (draft -> published) and its version chain
  independent of branding, which has its own shape; and a presentation-only object is the only kind
  that can vary freely without touching the evidence-bound graph.
- Reverse: drop `report_formats`, `report_format_versions` and `format_audiences`, remove the
  `format_*` RPCs, and delete `src/lib/writing/reportFormat.ts` and `ReportFormatPanel.tsx`. Nothing
  else reads them.

## D-W-TUTREG — the registry gap is fixed by a new seed migration, not by editing 0071

- Task: W12.
- Point: `oa.connectors` (OA-23) and `oa.formats` (OA-24) were added to
  `src/lib/tutorialKeys.json` and given GIFs after 0071 was written, but no migration seeds their
  `tutorials` rows. `check-tutorials` compares the JSON against the GIF files, so it passed; nothing
  compared the JSON against the migrations. On a fresh database the registry held 77 rows while the
  app offered 79 keys. The rows appeared locally only because `e2e/global-setup.ts` upserts the JSON
  for the recorder.
- Options: (a) edit 0071 in place to add the two rows; (b) add a new migration 0092 that seeds the
  two rows and re-apply it in test 90; (c) rely on the e2e seed.
- Choice: (b). 0071 is already applied everywhere and editing it would not reach an existing
  database; a new migration is the M1/M2-safe repair (grep showed no existing row for either key).
  A build-time guard (`src/guards/tutorialRegistryCoverage.test.ts`) and two assertions in
  `supabase/tests/90_tutorial_steps.sql` now fail if any JSON key has no seeding migration.
- Reason: keeps the "repairs go above the failing statement" rule (M7) and the "one migration per
  change" habit, and closes the defect class at build time rather than per-key.
- Reverse: delete `0092_tutorial_registry_gap.sql`, drop the two assertions in test 90 and the guard;
  the registry then returns to 77 rows on a fresh database.

## D-W-ENGINETESTS — the engine's untested core modules gain direct tests

- Task: W13 (test hardening).
- Point: `graph`, `observations` and `phrases` had no test file of their own; `planner`, `monitors`
  and `lineagePanel` were covered only incidentally. The brief requires the graph-root/render-hash
  invariant, the approved-observation gate, phrase immutability and slot discipline to be tested.
- Options: (a) leave the incidental coverage; (b) add one focused test file per module, driving the
  real functions with the shared fixtures.
- Choice: (b). New files: `src/lib/writing/graph.test.ts` (13 cases),
  `src/lib/writing/observations.test.ts` (14 cases), `src/lib/writing/phrases.test.ts` (28 cases).
  No mocks; the tests call the real modules with `fixtures.ts` data.
- Reason: the invariants are the product; a regression in `claimCanonical` or `applyApprovalGate`
  would silently corrupt every report. Focused tests make the failure local.
- Reverse: delete the three test files; nothing in `src/lib/writing/` changes.

## D-W-BUILDERVIEW — the report builder is a view of the Audit File window (2026-10-26)

- Task: W12 (the report-builder screen), owner instruction to mount it in the Audit File window.
- Point: W12 lists the report builder among the engine screens, but the spec (§28) forbids a Reports
  tab and a Workbench tab, and the Audit File window already carries a "Report" view with the
  free-text report editor. The builder must be reachable without adding a tab.
- Options: (a) add a top-level navigation tab; (b) add a second view inside the existing Audit File
  window beside the Report editor; (c) replace the Report editor with the builder.
- Choice: (b). `AuditFileModal.tsx` gains `phaseView` value `'builder'`, a tab-strip entry "Report
  builder", and a render branch `<ReportBuilderPanel />` with `data-testid="audit-file-builder"`. The
  free-text editor stays: it is the auditor-text lane (W5.4), a different thing from a deterministic
  report.
- Reason: (a) is forbidden by §28; (c) would delete the auditor-text surface the spec keeps. A view
  of the window reuses the existing navigation, the existing rights gate and the existing
  `audit-file-view-<view>` testid convention the recorder already drives.
- Reverse: remove `'builder'` from the `phaseView` union, the `['builder', 'Report builder']` tab
  entry and the render branch; `ReportBuilderPanel` becomes unreferenced. Also drop the WK-11 contract
  section, the `oa.report-builder` tutorial key, migration `0093`, the WK-11 sweep entry and the
  `WK-11` id in `screenshotCoverage.test.ts`.

## D-W-BUILDERREG — the report-builder tutorial row is a new migration, not an edit of 0092 (2026-10-26)

- Task: W12 (registry row for the new screen).
- Point: `oa.report-builder` (WK-11) is a new tutorial key. The build-time guard
  `tutorialRegistryCoverage.test.ts` requires every JSON key to be seeded by some migration, and
  `supabase/tests/90_tutorial_steps.sql` asserts the post-0071 keys have rows.
- Options: (a) add the row to 0092; (b) add a new migration 0093 and re-apply it in test 90.
- Choice: (b). 0093 seeds `oa.report-builder` with its real ordered steps and its GIF path, in the
  same `insert ... on conflict (key) do nothing` shape as 0071/0092 (M2). Test 90 re-applies 0093 and
  asserts the row has at least four steps.
- Reason: 0092 is already applied where it exists; a new migration is the M1/M2-safe repair and keeps
  one migration per change. M7 (repairs go above the failing statement) is respected because nothing
  is being repaired — this is a new key.
- Reverse: delete `0093_tutorial_registry_report_builder.sql`, the `\i` line in test 90 and the
  `oa.report-builder` assertions in test 90; the registry returns to 79 rows on a fresh database.

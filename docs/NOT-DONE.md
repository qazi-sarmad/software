# Not done (open items with a recorded plan)

Each item below is known, is not fixed in the current branch, and has a plan. Phase 2 must
clear the first two before Phase 2 closes.

## 1. vitest and tinypool advisories (resolved in Phase 2, task 2A)

- Advisories: `vitest` 0.0.95 to 4.1.10 (critical, direct devDependency), `tinypool` 2.1.1 and below
  (critical, transitive, RCE via worker options), `@vitest/mocker` 2.1.0 to 4.1.10 (moderate,
  path traversal in redirect mocks).
- Fix applied: `vitest` upgraded to `^5.0.4` on branch `phase-2-access` (commit `f73d86b`), which is a
  **major version bump** and was therefore held back from Phase 1. `npm audit --audit-level=critical`
  now exits 0 (was 2 critical). CI run 38696591808 green. Only `package.json` and `package-lock.json`
  changed.

## 2. Dependency pin (resolved in Phase 1, recorded here for the audit trail)

- `source-map-js` 1.2.1 had a high-severity event-loop DoS. Pinned to 1.2.2 with an npm override.
  Production audit at high level is clean.

## 3. Per-user passwords in end-to-end tests

- Today the end-to-end setup generates one random password per CI run and sets it on all five
  synthetic test users in `provio-test`. The password is held only in that run's environment
  and is not written to the repo.
- Improvement: give each test user its own random password per run, so one leaked value does not open all five accounts.
- Priority: low. The accounts are synthetic and hold no client data.

## 4. Browser coverage

- CI runs Chromium only. Phase 4 and Phase 9 require Firefox and WebKit in Playwright.

## 5. Hosted test secret carries a trailing newline (owner action)

- `TEST_SUPABASE_DB_URL` still carries a trailing newline. This environment's CI token has no `secrets:write`
  (403) and no Supabase token exists, so the secret cannot be re-set from the CI environment.
- Until it is re-set, CI step 6 and `supabase/tests/15_ledger_concurrency.sql` strip whitespace.
- Owner: `printf '%s' "$URL" | gh secret set TEST_SUPABASE_DB_URL`, then remove both strips.

## 6. Administration portal covers People and Roles only (Phase 2 scope)

- §23 lists the whole Org Admin portal. Phase 2 built the People and Roles parts (members, roles,
  rights, scopes, reporting lines, invite cap). Organisation settings, structure, controls,
  methodology, the risk model, workflow, SLA and escalation, finding structure, notifications,
  BI parameters, templates and branding, export and retention, and AI remain not built.
- Priority: medium. The remaining parts are Phase 3+ work; each is a separate task.

## 7. Overdue-request escalation needs a scheduler (Phase 3 scope)

- §7 and §22 require overdue plan-change/deployment requests to escalate on a timer.
  `public.escalate_overdue_deployment_requests()` is built and tested, but nothing calls it on a
  schedule: no scheduler (pg_cron or an external worker) exists in this environment.
- Owner action: wire `escalate_overdue_deployment_requests()` to a scheduler when the deployment
  provides one. Until then it must be invoked by hand.

## 8. SIRA cycles, plan versions and gate outcomes are not yet read into the UI

- The Phase 3 database objects (SIRA model/cycles, plan versions, deployment outcomes, ethics
  acknowledgements) are exercised by SQL tests and the `src/data/*` modules, and the panels render
  from the payload the tab passes in. No screen yet loads a persisted SIRA model, cycle or plan
  version to display (the demo tenant still feeds the screen rows).
- Priority: low. The reading screens are Phase 4+ work; the panels accept the loaded rows unchanged
  when it lands.

## 9. Browser coverage (unchanged from item 4)

- CI runs Chromium only. Firefox and WebKit are Phase 4+ work.

## 10. Activity-log archival needs a Storage-upload edge function (Phase 7 scope)

- `archive_activity_period` builds the JSON in-database, writes an `archive_jobs` row, records a
  hash-chained ledger entry with the content hash, and then removes the archived rows from the live
  activity log. The actual upload to Storage is a placeholder: the function writes the archive job
  and a signed-URL stub, but no edge function performs the upload yet.
- Owner action: add an edge function that uploads the built JSON to the `archive_jobs.storage_path`
  and marks the job `done`. Until then the ledger entry is the durable record.
- Evidence: `0043_activity_archival.sql`, `52_activity_archival.sql`, decision D-7C-storage.

## 11. PDF/DOCX generation for exports (Phase 7 scope)

- The §18 export table lists PDF, XLSX and DOCX for several objects. The Phase 7 export panel
  serialises CSV, JSON and a deterministic text payload in the browser and records the content hash;
  it does not generate a PDF, XLSX or DOCX binary. The per-object RPCs return the data to be
  serialised, as the task specifies.
- Owner action: add a server-side (or in-browser) PDF/XLSX/DOCX renderer behind the same
  `log_export` call so the recorded hash still covers the delivered file.
- Evidence: `src/lib/exportSerialise.ts`, `src/components/admin/ExportPanel.tsx`.

## 12. Import parsers cover CSV only (Phase 7 scope)

- §19 lists CSV, XLSX and DOCX tables per source. The Phase 7 wizard parses CSV in the browser; the
  database validation (`validate_import`) is format-agnostic and already handles mapped rows from any
  parser. XLSX and DOCX parsing is deferred.
- Owner action: add XLSX/DOCX parsers that produce the same mapped-rows shape.
- Evidence: `src/components/admin/ImportWizardPanel.tsx` (`parseCsv`).

## 13. Screenshots owner-deferred (Phase 7)

- No screenshots were captured for the Phase 7 surfaces (export panel, import wizard, activity log,
  prior-year import); this is owner-deferred as in Phases 0-3.


## 14. One-stage vs two-stage testing selection UI deferred (Phase 4 scope)

- §23 requires the organisation to choose one-stage or two-stage testing and to set sign-off roles
  per stage. The org setting and the database gate exist; no screen sets the choice yet.
- Owner action: add the control to the Org Admin portal.
- Evidence: `docs/PHASE-4-REPORT.md`.

## 15. Per-organisation BI parameter admin UI deferred (Phase 4 scope)

- §23 lists BI parameters among the Methodology settings. The parameters are data; no admin screen
  edits them yet.
- Evidence: `docs/PHASE-4-REPORT.md`.


## 16. Document extraction edge function deferred (Phase 5 scope)

- §13.1 requires full extraction and analysis of modern formats. `document_extractions` and the FTS
  index exist and `search_documents` reads them, but no edge function performs the extraction: the
  stub writes a `pending` row and returns.
- Owner action: add an edge function that extracts text (PDF/DOCX/XLSX/CSV), fills `extracted_text`
  and `page_count`, and sets `extraction_status` to `done` or `failed`.
- Evidence: `0035_document_viewer.sql`, `44_document_viewer.sql`, decision D-5D-extraction-stub.

## 17. One-stage vs two-stage testing mode UI deferred (Phase 5 scope)

- The database supports both modes; no screen switches the mode or shows the two-stage reviewer
  step. Same owner action as item 14.
- Evidence: `docs/PHASE-5-REPORT.md`.

## 18. Screenshots owner-deferred (Phase 5)

- No screenshots were captured for the Phase 5 surfaces (findings, issues, conclusion, document
  viewer); owner-deferred as in Phases 0-4.

## 19. Email dispatch edge function (Phase 6 scope)

- §15.5 says the report email is queued at issuance. The queue row is written (`email_queue`,
  `queue_email`), but nothing sends it: there is no edge function and no provider is wired (D-6E,
  B-6E-provider).
- Owner action: add an edge function that reads `pending` rows and dispatches through the chosen
  provider, then sets `status` to `sent` or `failed` with `error_text`.
- Evidence: `0039_email_queue.sql`, `48_email_queue.sql`, decision D-6E.

## 20. Graph or Resend provider wiring (Phase 6 scope)

- Per decision D-6E the provider choice is pending the owner. Neither a Resend domain nor a Graph
  delegated credential is configured; `provider_config` is unset for every org.
- Evidence: decision D-6E, blocker B-6E-provider.

## 21. PDF/DOCX report generation and branding templates (Phase 6 scope)

- §15.5 and §23 require the issued report as a branded PDF/DOCX. The report exists as blocks in the
  database; no renderer produces a binary, and no branding template is applied.
- Owner action: add a renderer behind `freeze_report`/`issue_report` so the issued artefact is the
  branded document.
- Evidence: `0036_report_drafting.sql`, `src/components/audit/ReportEditorPanel.tsx`.

## 22. Screenshots owner-deferred (Phase 6)

- No screenshots were captured for the Phase 6 surfaces (report editor, comments, freeze panel, CAP
  register, issuance); owner-deferred as in Phases 0-5.

## 23. Superadmin UI deferred to Phase 8.1 (owner-designed)

- Phase 8 is DB and logic only. `src/data/platform.ts` exposes `platformSetFeatureFlag`,
  `grantSupportAccess`, `revokeSupportAccess`, `platformEnableAI` and `platformSetInviteCap`, but no
  `/superadmin` screen calls them.
- Owner action: design and build the Phase 8.1 platform portal.
- Evidence: `src/data/platform.ts`, `src/data/platform.test.ts`, decision D-8E-coverage.

## 24. Support-session authentication (Phase 8 scope)

- `support_access_grants` is metadata: a grant row with a scope, an expiry (<= 48h) and a revoke
  reason. The platform admin still cannot read tenant business tables. An authenticated support
  session that acts under a grant is Phase 9/10 work.
- Evidence: `0031_platform_control_plane.sql`, test `40`, `src/data/platform.ts`.

## 25. Tenant-side per-org email configuration UI (Phase 8 scope)

- The provider is set through `admin_set_email_provider`; no Org Admin screen sets it, and the
  provider choice itself is the owner's (D-6E, B-6E-provider).

## 26. AI advisory summaries (Phase 8 scope)

- `platform_enable_ai` turns AI on per org and records the model endpoint; no advisory summary is
  generated. AI remains off by default (§13.2).
- Evidence: `0045_platform_ai_ledger.sql`, decision D-8C-ledger.

## 27. Screenshots owner-deferred (Phase 8)

- No screenshots were captured; Phase 8 has no UI. Owner-deferred as in Phases 0-7.




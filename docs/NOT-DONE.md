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

## 3. Per-user passwords in end-to-end tests (resolved in R6c)

- Resolved: each synthetic user now gets its own random password per run. `e2e/global-setup.ts`
  builds a per-address password map and writes it to the git-ignored `e2e/.auth/passwords.json`;
  every spec reads its own account's password through `e2e/password.ts` `passwordFor(email)`.
- Evidence: commit R6c, decision D-R6c-passwords.

## 4. Browser coverage (resolved in R6d)

- Resolved: `playwright.config.ts` declares `chromium`, `firefox` and `webkit`. Normal CI step 7 pins
  `--project=chromium`; `.github/workflows/browsers.yml` runs Firefox and WebKit on
  `workflow_dispatch` only.
- Evidence: commit R6d, decisions D-R6d-browsers and D-R6d-nolocalrun.

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

## 8. SIRA cycles, plan versions and gate outcomes are not yet read into the UI (resolved in R6a)

- Resolved: the SIRA screen now loads the persisted SIRA model, cycles and emergent risks, and the
  latest plan with its version history, for the selected universe through `src/data/sira.ts` and
  `src/data/plan.ts` (new `latestPlanForUniverse`). The Audit Plan screen loads persisted plan items,
  plan versions, deployment-gate outcomes (new `listGateOutcomes` reading the `engagement_deployed`
  activity rows) and deployment requests. All reads go through `src/data`; no component touches the
  client. A failed read shows an inline error.
- Evidence: commit R6a, decisions D-R6a-users, D-R6a-gate-source; `src/components/sira/SiraTab.tsx`,
  `src/components/plan/AuditPlanTab.tsx`, `e2e/r6.spec.ts`, `src/data/r6a.test.ts`.

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

## 12. Import parsers: XLSX added (R6b); DOCX still deferred (Phase 7 scope)

- §19 lists CSV, XLSX and DOCX tables per source. The wizard now parses both CSV (inline) and
  XLSX/XLS/XLSM (SheetJS, `src/lib/xlsx.ts`, loaded on demand so it stays out of the main bundle);
  both paths return the same `{ headers, rows }` shape and the database validation
  (`validate_import`) is format-agnostic. DOCX table parsing is still deferred.
- SheetJS moved to `xlsx@0.20.3`, installed from the vendor CDN
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) by D1. The npm `xlsx` package stopped at
  0.18.5 and carried two unfixed advisories; 0.20.3 resolves both, so `npm audit` now reports zero
  vulnerabilities. It still runs only on a file the operator picked in their own browser.
- Evidence: `src/lib/xlsx.ts`, `src/lib/xlsx.test.ts`, `src/components/admin/ImportWizardPanel.tsx`,
  `e2e/fixtures/rcm-sample.xlsx`, `e2e/r6.spec.ts`.

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
- Update (S4): the shared renderers now exist — `src/lib/render/pdf.ts` (pdf-lib + fontkit),
  `pptx.ts` (pptxgenjs, editable text/tables/charts) and `qr.ts`, all consuming one `BrandingSpec`
  from `src/data/branding.ts` (migration 0058). The report editor is not yet wired to `renderPdf`;
  that wiring and the DOCX path remain owner-scoped.

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

## Not done in the assurance and control plane (branch `feature/board-ai-control-plane`)

- **Continuous-auditing watchers** (file drop, HTTP polling, database view) are PARKED by F12 and were
  not built. The F7 event interface stays generic so a future `watcher.signal` event can plug in.
- **Tutorial GIFs** for the S7 keys are registered in `docs/ACP-TUTORIALS.md` and named in the UI
  contract, but `scripts/record-tutorials.mjs` and `npm run tutorials:record` are S12 work; the S7 GIFs
  are produced then.
- **Event catalogue gaps.** Events whose source does not exist yet are not wired: every key in the F7
  catalogue that has no emitter is listed by the S2 automation test rather than faked.
- Slices S11 to S13 (hosting fit and the migration runner, the completed wizards, and the final
  contract) are not started at the time of writing. S8 (certificate and public verification), S9
  (external auditor portal) and S10 (Time-Travel and Patterns) are complete.
- **Time-Travel coverage gaps.** `engagement_as_of` reconstructs workpapers, findings, seals and
  statuses from append-only history (ledger, activity log, version tables). Entities that keep only
  current state cannot be reconstructed; the function reports them as "Not recorded before <date>"
  rather than guessing. Activity archived out of the live window is outside the as-of range; the UI
  states the earliest available date.
- **External auditor invitation email.** `external_auditor_invite` queues the acceptance email through
  the F6 queue; with the default stub provider it stays queued until an adapter is configured and the
  dispatcher runs. This is by design (D-S9-invite-not-sent), not a gap.
- **External auditor account creation.** The portal assumes the account already exists. The owner's
  Supabase Auth signup/email-confirmation settings decide how the invitee creates one; the acceptance
  page says so plainly when signups are off. No owner credential is needed for this build (F23).




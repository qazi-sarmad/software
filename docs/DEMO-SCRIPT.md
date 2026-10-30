# DEMO-SCRIPT — the flows that are proven, in the order they are proven

Every step below names the test that proves it, and the testid the presenter clicks. If a step is
not in this file, it is not in the demo. That is the rule: a live demo may only use a flow a passing
test has already walked, so nothing on stage can be a surprise.

Proving commands (run them yourself before the demo):

```
bash scripts/local-sql-harness-docker.sh                 # schema + 121 SQL tests, applied twice
source .env.e2e-local                                    # E2E_PROD=1 -> built bundle via vite preview
npx playwright test --project=chromium                   # 143 passed, 3 skipped
```

The whole E2E suite runs against the **production build**, not the dev server (owner decision 2,
gate G1). That is the point: the demo shows the same artefact a client receives.

---

## Cast

| Who | Sign in as | Holds |
|---|---|---|
| Super Admin (QSCorp) | `platform.admin@provio-test.invalid` | no tenant; provisions tenants |
| Org Admin | `ayesha.khan@provio-test.invalid` | `manage_users`, `edit_config`; sees no audit content |
| CIA (Level-1 Head) | `kamran.sheikh@provio-test.invalid` | all four assurance rights; approves, seals, shares |
| Preparer | `bilal.ahmed@provio-test.invalid` | `perform_work`; does the testing work |
| External auditor | `external.auditor@provio-test.invalid` | read-only portal for one engagement |

Passwords are generated per run into `e2e/.auth/passwords.json` (git-ignored).

---

## Act 1 — Platform: provision a tenant (guided, no dead ends)

1. **Open the platform portal.** Go to `/superadmin`, sign in as Super Admin.
   *Proved by* `wp6-system.spec.ts` › `[WP6] Super Admin reaches the guided provisioning path`
   (`superadmin-portal`, `superadmin-tab-provisioning`).
2. **Walk the readiness checklist.** In `sa-provisioning`, choose a tenant from
   `sa-provisioning-tenant-select`. The five rows appear: `sa-provisioning-check-status`, `-roles`,
   `-sender`, `-invite`, `-engagement`.
   *Proved by* the same test. *Note shown on screen:* no step is a blocking modal
   (`[aria-modal="true"]` count is asserted 0).

## Act 2 — Tenant: guided setup

3. **Org Admin completes setup.** Sign in as Org Admin, open the profile menu → `menu-org-control` →
   `org-control-tab-setup`. The wizard renders: `org-setup`, `org_admin-wizard`,
   `org_admin-wizard-steps`.
   *Proved by* `wp6-system.spec.ts` › `[WP6] Org Admin completes the guided setup...`.
4. **Roles and rights are real.** Still in the control plane, the roles screen lists the seven seeded
   roles with their rights matrix. The rights are enforced by RLS, not decoration — a Preparer sees
   no audit-config surface at all.
   *Proved by* `full-flow.spec.ts` › `[E2E] setup wizard and people administration are reachable`;
   enforcement proved by `rls.spec.ts` and SQL test `123_scale_isolation.sql`.

## Act 3 — The audit: universe to sealed report

5. **Audit universe and the deployment gate.** As CIA, nav **Audit Universe** → `db-entities`,
   `add-entity-open`. Then **Audit Plan** → `plan-records`, and the gate itself: `plan-open-gate`,
   `plan-open-combined`, `plan-open-ethics`.
   *Proved by* `full-flow.spec.ts` › `[E2E] universe and entity screens render, and the deployment
   gate is a gate not a button`. The gate is the only way an audit file appears (§7).
6. **SIRA.** Nav **SIRA** → `tab-sira`, then `sira-open-model` or `sira-model-empty`, and
   `sira-open-cycles` or `sira-cycles-empty`.
   *Proved by* `full-flow.spec.ts` › `[E2E] SIRA model and cycles render...`.
7. **Open the engagement and walk the stages.** Nav **Audit Files** → click the first
   `audit-card-*`. Inside, click `audit-file-view-workspace`, `-findings`, `-conclusion`; each
   surface renders (`audit-file-workspace`, `-findings`, `-conclusion`).
   *Proved by* `wp6-system.spec.ts` › `[WP6] an engagement moves through planning → testing →
   conclusion...`.
8. **Planning, the population gate and sampling.** As Preparer, open the engagement → workspace:
   `planning-panel`, `population-panel`, `sampling-panel`, `rowtesting-panel`, `analyst-panel`.
   *Proved by* `full-flow.spec.ts` › `[E2E] planning, the population gate and sampling render inside
   an engagement`. The population gate is the only path to a test (§11.1, Law L3).
9. **Create a workpaper, then sample and test.** In the testing workspace, `WorkpaperCreatePanel`
   creates the workpaper the panels need; then `SamplingPanel` draws a sample and `RowTestingPanel`
   records results. If the engagement has no workpaper, both panels show a **designed empty state**
   rather than disappearing.
   *Proved by* `src/components/audit/phase4Panels.test.tsx` (both panels with `workpaperId={null}`)
   and SQL test `117_phase6_workpaper_creation.sql`.
10. **Findings, conclusion, report, CAP, certificate, export.** From the file: `findings-panel`,
    `conclusion-panel` with `conclusion-preflight`, `report-editor`, `cap-register`, and the
    certificate and export views (`audit-file-certificate`, `export-panel`, `export-controls`).
    *Proved by* `full-flow.spec.ts` › `[E2E] findings and issues, conclusion, certificate, report,
    CAP and export are all reachable`.
11. **The report builder (rights-gated).** As CIA (holds `review_and_approve`), open
    `audit-file-view-builder`: `wk-report-builder-panel`, `wk-report-builder-graph-root`,
    `wk-report-builder-render-hash`. Show the graph root does **not** move when only the register
    changes; then `wk-report-builder-freeze-run` → `wk-report-builder-freeze-result`.
    *Proved by* `full-flow.spec.ts` › `[E2E] the report builder composes, reconciles, compares and
    freezes for a holder of the right`. As a Preparer, the same tab shows `wk-report-builder-denied`
    — the designed refusal, not an empty panel (same spec, step 10's test).
12. **Seal, certificate, public verification.** The seal is a Conclusion-stage sign-off; the
    certificate follows it. Then open `/verify/<certificate-id>` in a private window — no session,
    and it never shows tenant content.
    *Proved by* `full-flow.spec.ts` › `[E2E] the seal, certificate and public verification path
    exists end to end` and `[E2E] the public verification page answers without a session and never
    leaks tenant content`.

## Act 4 — Prove it is real (the parts that separate this from a mock)

13. **Multi-org isolation, live.** Org A sees its audit card; a second browser context signed in as
    Org B Admin shows **no** Audit Files tab at all.
    *Proved by* `wp6-system.spec.ts` › `[WP6] multi-org isolation holds inside the same run`, and
    under concurrency by `rls.spec.ts` › `[E2E] concurrent reads from two orgs never cross the tenant
    boundary` and SQL test `118_phase6_concurrency_isolation.sql`.
14. **Cross-universe share is view-only.** As CIA, control plane → `share-panel`; grant via
    `share-grant-universe` / `share-grant-grantee` / `share-grant-submit`. As the Preparer grantee,
    the read-only `share-panel-with-me` surface opens what was shared.
    *Proved by* `wp6-system.spec.ts` › `[WP6] cross-universe view-only share...`. The grant is a real
    platform action: the result line reads `Saved` or says exactly why it was refused.
15. **Export bundle.** From the file, `audit-file-view-export` → `export-run` →
    `export-confirmation` (with its hash) or the designed "cannot export" surface.
    *Proved by* `wp6-system.spec.ts` › `[WP6] an export bundle is produced from the Audit File`.
16. **Board Pack.** Dashboard → the Board Pack panel: the generator (`wk-boardpack-generator`,
    `wk-boardpack-scope`, `wk-boardpack-boundary`, `wk-boardpack-generate`), the section list
    (reorderable, turn-off, never delete — `oa-boardpack-section-cover`, `oa-boardpack-up-cover`), and
    opening a pack shows the web view (`wk-boardpack-view`) with its hash and sources index
    (`wk-boardpack-section-sources`), plus the PDF and PPTX downloads (`wk-boardpack-pdf`,
    `wk-boardpack-pptx`).
    *Proved by* `s7-board-pack.spec.ts` (6 tests). *Note:* on a project with no pack yet, two of
    these self-skip — that is honest, not a failure.
17. **External auditor portal.** Sign in as the external auditor at `/external`: the read-only
    portal shows the engagement summary and a hash-verification tool, and offers no write control.
    A tenant member who opens `/external` is told plainly.
    *Proved by* `s9-external-auditor.spec.ts` (8 tests).
18. **Certificate public route.** `/verify/<unknown-id>` reports not found and shows no tenant
    content.
    *Proved by* `s8-certificate.spec.ts`.

## Act 5 — Config that actually does something

19. **Change a setting, watch it take effect.** In the Org Admin control plane, toggle a
    configuration field that the config-effect gate proves is enforced (see
    `docs/CONFIG-EFFECT-MATRIX.md` — 41 of 50 fields ENFORCED, each with a named test).
    *Proved by* `node scripts/check-config-effect.mjs` and the named SQL tests in the matrix
    (`108_phase3_workflow_enforcement.sql`, `110_phase3_config_effects.sql`).
20. **Methodology library.** Open the methodology screen: create, edit and publish a procedure
    template with its test steps as data.
    *Proved by* SQL test `111_phase4_methodology.sql` and the methodology screen's contract tests.

---

## Do not demo

- **C7 (anomaly → SIRA)** — `BLOCKED (S18)`, Builder B's S18 continuity work. Not wired; not in the
  demo.
- **Evidence file storage** — the upload control computes a SHA-256 but the bytes are not yet stored
  (SYSTELIGON.md §6.0, fix = S20). Show the verification surface only where a report file exists.
- **The 12 stale tutorial GIFs** — they render, but their `ui_hash` no longer matches; regenerate
  before a recorded walkthrough (Phase 6 remainder).
- Anything under `docs/archive/` — stale by banner.

## Timing

Acts 1–3 are the core story (~12 min at a measured pace). Act 4 is the credibility act (~6 min);
do not cut it — it is the difference between a mock and a product. Acts 5 is optional (~4 min).

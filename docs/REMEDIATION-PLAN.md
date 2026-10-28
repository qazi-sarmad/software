# Remediation plan — from a two-half-product to a working, configurable audit platform

Companion to `docs/FUNCTIONALITY-AUDIT.md` (the code-verified evidence). This document is the plan:
what best-in-class audit software does, how configurable Provio is per client today (stage by stage,
step by step), where it falls short, and exactly how we make it functional and prove it.

Audit base: `feature/scale-harden-v1` @ `70291e3`.

---

## Part 0 — First, the honest frame

You did not send it. No damage was done; that is what testing before a demo is for. But your instinct
was correct and worth writing down, because the *reason* it would have gone badly is not "there are
some bugs". It is this:

> A professional would have asked one question — "can I configure the approval chain for this
> client?" — the answer would have been yes, the screen would have opened, the setting would have
> saved with a reason and a version history… **and then nothing would have happened when they used
> it.**

That is worse than a crash. A crash is honest. A config screen that saves a value no code ever reads
is a lie told to the user's face. The audit found a systemic version of this: 23 configuration
tables, mostly settable and versioned, with a meaningful share having **no behavioural effect**
(`approval_chain`, `signoff_role_*`, `testing_mode`, report templates, CAP workflow), plus the
overarching defect that **the UI is not wired to the database in production at all**.

So the plan has two jobs, in this order:

1. **Make the product work end to end** (the integration layer — everything else is unverifiable
   until this exists).
2. **Make the configuration real** (every setting that can be saved must be *enforced*, or it must
   not be offered).

Job 2 is the one that protects your self-respect. Job 1 is the prerequisite.

---

## Part 1 — What best-in-class audit software does, and where Provio stands

The reference set is TeamMate+, CaseWare, AuditBoard, Workiva, Diligent/HighBond, Fieldguide and
Optro. Stripped of marketing, they all do the same twelve things. Here is Provio's honest standing.

| # | Capability | Best-in-class behaviour | Provio today |
|---|---|---|---|
| 1 | Risk universe & SIRA | Risk register, scoring model, SIRA cycles, annual plan, resource schedule | **Backend strong** (SIRA cycles, scales, universe/entities, approval). UI reads it only partly |
| 2 | Engagement lifecycle | Planning → Testing → Conclusion → Reporting → Follow-up, with gates at each transition | **Broken** — stage is never persisted; no transition RPC exists |
| 3 | Methodology | Per-client procedure library, test-step templates, checklists, sign-off hierarchy | **Absent** — no step/procedure catalogue table exists at all |
| 4 | Workpapers | Electronic binder, index, review notes, evidence, versioning, cross-refs | **Partial** — rows and sign-off exist; review notes exist; binder index is seed-driven |
| 5 | Sampling | MUS/PPS, attribute, stratified, sample-size calculator, Clopper-Pearson precision | **Minimal** — schema accepts 7 methods, engine implements 1 (`random`); no value coverage |
| 6 | Reporting | Templates, opinion, management letter, board pack, issuance, distribution | **Partial** — freeze/issue RPCs work; report templates stored but their readers are never called |
| 7 | Issues & CAP | Findings → severity → root cause → action → owner → due → escalation → closure verification | **Partial** — CAP status machine exists in `src/lib/cap.ts`; the DB `cap_items` path is unused by the UI |
| 8 | Continuous monitoring | Analytics rules, exceptions, dashboards | **Built, unreachable** — `evaluateMonitor`/`runMonitors`/`verifyAlertChain` have no production caller |
| 9 | Configuration | Per-client workflows, approval chains, SLAs, roles, templates, retention | **Broad but partly inert** — see Part 2 |
| 10 | Security & tenancy | RLS multi-tenancy, SSO, audit trail, e-signature, immutability, retention | **Strong** — RLS on all 176 tables, ledger, certificates, anchoring |
| 11 | Integration | ERP/GRC connectors, SSO, API | **Catalogue only** — 22 adapters defined; no runner wired |
| 12 | Standards alignment | IIA Standards, SOX/ICFR, ISO 27001 mapping | **Not assessed in this audit** |

**Summary:** Provio's *depth* is in items 1, 10 and parts of 6 — genuinely strong, better than many
commercial tools. Its *gap* is items 2, 3, 5, 8 and 11: the working machinery that turns a risk model
into a finished audit. And item 9 is the dangerous one — it looks complete and is half inert.

---

## Part 2 — Configurability per client: what exists, what is enforced

This is the answer to "how configurable is it per client for all stages, steps, etc."

### 2.1 The configuration surface (verified)

176 tables, **153 org-scoped** (carry `org_id`, therefore per-tenant configurable). 23 are
configuration tables proper. The config-as-ledger spine is real: `config_areas` (registry),
`config_versions` (append-only history), `role_config_log`, and every save is reason-stamped.

| Configuration area | Table(s) | Setter RPC | Read by app? | **Enforced?** |
|---|---|---|---|---|
| Roles & rights | `roles`, `team_role_rights` | `admin_provision_member`, `admin_set_member_role`, `admin_delete_role` | yes | **Yes** — `caller_has_right` |
| Lifecycle sign-off roles | `org_lifecycle_settings.signoff_role_*` | `admin_save_lifecycle_settings` | yes | **No** — sign paths never read it |
| Testing mode (1/2 stage) | `org_lifecycle_settings.testing_mode` | `admin_save_lifecycle_settings` | yes | **No** |
| Grace before hard lock | `org_lifecycle_settings.testing_grace_hours` | `admin_save_lifecycle_settings` | yes | **Yes** — trigger `testing_lock_active` |
| Opinion required | `org_lifecycle_settings.report_opinion_required` | `admin_save_lifecycle_settings` | yes | partial |
| Workflow approval chain | `workflow_settings.approval_chain` | `admin_save_workflow_settings` | yes | **No** — stored, never read for a decision |
| Workflow SLA / escalation | `workflow_settings.sla_hours`, `escalation_role`, `escalation_hours` | `admin_save_workflow_settings` | yes | partial (SLA computed, escalation job exists) |
| Engagement gates | `engagement_gate_settings` | (deploy/approve/escalate RPCs) | yes | **Yes** |
| Plan approval rights | `plan_approval_settings` | `plan_approval_config` | yes | **Yes** — `create_plan`, `approve_plan` |
| Entity approval | `entity_approval_settings` | `entity_approval_config` | yes | **Yes** |
| Finding structure / patterns | `pattern_settings` | `pattern_settings_save` | yes | **Yes** — `pattern_findings` |
| Notification templates | `notification_templates` | `notification_template_save` | yes | **Yes** — `render_notification` |
| Report templates | `report_templates` | `report_template_save` | **no** | **No** — readers never called |
| Branding | `branding*` | branding save | yes | yes (PDF) |
| Email profile | `email_settings` | (edge) | partial | partial |
| Export retention | `export_retention_settings` | `admin_save_export_retention` | yes | **Yes** |
| Upload limits | (upload limits) | `admin_save_upload_limits` | yes | **Yes** |
| Trust anchor / timestamp authority | `anchoring_settings` | `admin_save_trust_anchor`, `admin_save_timestamp_authority` | **no** | **No** — setters are dead code |
| Certificate config | `certificate_config` | `certificate_config_save` | yes | **Yes** |
| Entitlements / feature flags | `tenant_entitlements`, `tenant_settings.feature_flags` | `platform_set_entitlement`, `platform_set_feature_flag` | yes | **Yes** — `has_feature` |
| Invite caps | `invite_cap_settings` | `platform_set_invite_cap` | yes | **Yes** — `invite_user_capped` |
| Tenant status | `tenant_settings.status` | `platform_set_tenant_status` | yes | **Yes** |
| SIRA model / methodology scales | `sira_model_versions`, `methodology_scales` | yes | yes | **Yes** |
| CAP workflow | `cap_items` | `update_cap` | **no** (UI uses in-memory `transitionCapStatus`) | partial |

**Verdict on configurability:** org-level configuration is *broad and mostly enforced* — genuinely
better than the audit's headline suggested. The failures cluster in three places:

1. **Stored but inert** (the self-respect risk): `approval_chain`, `signoff_role_*`, `testing_mode`,
   `report_templates`, `anchoring_settings`.
2. **Absent**: methodology / procedure library / **test-step templates** — there is no catalogue
   table for "what steps does a control test consist of", so steps cannot be configured per client.
   Steps today are React state (`AppContext.setTestStepCompleted`).
3. **Fixed by construction**: the stage machine is three hardcoded strings
   (`'planning' | 'testing' | 'conclusion'`), not a configurable workflow.

### 2.2 Stage by stage, step by step

| Stage | Configurable per client? | Notes |
|---|---|---|
| Universe & SIRA | Yes — model, scales, entity approval, pattern settings | enforced |
| Planning | Partly — approval rights, plan items, sections | planning **step list** is fixed, not configurable |
| Testing | Partly — grace hours, engagement gates, sampling | `testing_mode` inert; **test steps not configurable**; sampling method inert |
| Conclusion | Partly — sign-off roles stored but inert | opinion-required partial |
| Reporting | Partly — certificate, retention, branding enforced; **report template inert** | |
| CAP / follow-up | Partly — CAP status machine exists in TS; DB path unused | |
| Notifications | Yes — templates enforced | delivery untested under Realtime |
| Roles / rights | Yes — fully enforced, custom roles | the strongest area |

---

## Part 3 — The remediation plan

Order is not negotiable: each phase is the precondition for testing the next. Six phases.

### Phase 1 — Make the app read its own database (foundation)

**Why first:** with no data loaded, nothing else can be verified in production, and every other fix
is untestable.

- Build a **tenant data loader** (`src/data/tenant.ts`) that hydrates the shell from Supabase through
  `jwt_org_id()`-scoped RPCs. Replace the DEV-only `demoSeed` as the *only* source.
- Introduce a `TenantDataProvider` that loads universes, entities, engagements, workpapers,
  observations, issues, CAPs, comments, roles and ledger for the session.
- Keep `EMPTY_SEED` for genuinely no-tenant routes (public `/e/:token`).
- Convert the seed-shaped types into row types so screens read one source of truth.
- Remove the parallel in-memory mutations (`signOffEngagement`, `transitionCapStatus`,
  `appendLedgerEntry`, `setTestStepCompleted`) **or** make them call the RPCs.

**Acceptance test (the anti-theatre test):** a Playwright spec that runs against a **production
build** (`npm run build && npm run preview`, not `npm run dev`), signs in as a seeded org, and asserts
that an engagement created via SQL appears on the dashboard. This single test would have caught the
entire headline defect.

### Phase 2 — Make the lifecycle real

- New migration: `set_engagement_stage(p_engagement_id, p_to_stage, p_expected_stage)` — append-only
  transition log, checks rights and the existing stage guards (ethics acks etc.), `expected_stage`
  for optimistic concurrency.
- Wire planning → testing → conclusion in the UI to that RPC.
- **Enforce `signoff_role_*`**: `sign_planning` / `sign_conclusion` must read
  `org_lifecycle_settings` and refuse if the caller lacks the configured role.
- **Enforce `testing_mode`**: one-stage vs two-stage changes which sign-offs are required.
- **Enforce `approval_chain`**: the workflow chain must be consulted when an approval is decided, or
  the field must be removed from the UI. (Decision: enforce, because it is a top-five buyer question.)
- **Wire `runPreflight`** into `freeze_report` and gate the freeze on `preflight_acks`.
- **Persist the report graph root**: a writer for `report_graphs` so `verify_report_root` has data.
- **Seed `workpaper_rows` from `lock_sample`** so a drawn sample becomes the tested set, and add the
  value-coverage check (top-value items must be included or explicitly waived with a reason).
- **Method-aware sampling**: implement at least MUS/PPS, systematic and stratified, plus a sample-size
  calculator with a Clopper-Pearson upper bound. `control_total_cents` used for reconciliation.

**Acceptance:** SQL tests for every new RPC (happy + RLS refusal); a Playwright flow that moves an
engagement through all three stages against a production build; a test proving a report cannot freeze
with an unacknowledged pre-flight item.

### Phase 3 — Make the configuration honest (the self-respect phase)

For every row in the Part 2 table marked **No** / **partial**:

- Either **enforce it** and add a test proving the setting changes behaviour, or **remove it from the
  UI** and mark it deferred in the config registry.
- Add a **configuration effect test** for each: set the value, then assert the product behaves
  differently. Example: set `approval_chain = ['reviewer','head']`, then assert a single approval is
  refused until both have signed.
- Fix the two dead setters (`admin_save_trust_anchor`, `admin_save_timestamp_authority`) or hide
  their screens.

**Acceptance:** a `docs/CONFIG-EFFECT-MATRIX.md` where every configurable field has a named test that
proves its effect. No field may be listed as "stored" without "enforced" or "hidden".

### Phase 4 — Methodology & steps (the missing capability)

- New tables: `procedure_templates`, `test_step_templates`, `procedure_template_versions` — per org,
  versioned, reason-stamped, in the `config_areas` registry.
- A test step becomes data (id, label, kind, required evidence, order), not React state.
- Screens: a methodology library admin (create/edit/publish a procedure template), and a test-step
  panel driven by the template.
- Client provisioning seeds a default template per audit type.

**Acceptance:** create a template with 3 steps, apply it to an engagement, complete the steps, sign
off; SQL + Playwright.

### Phase 5 — Continuous monitoring & connectors (make the built parts reachable)

- Wire `rule_engine_process`, `staged_record_ingest`, `connector_run_start/finish`, `alert_record`
  into a runner (edge function) so monitors actually fire `watcher.signal`.
- Populate the Work Queue from fired alerts; add the delivery test.
- Either wire the 22 adapters or clearly label them "catalogue only, not live" in the UI.

**Acceptance:** a monitor rule fires on a seeded signal and lands in the Work Queue; a connector run
against a local mock server stages records.

### Phase 6 — Prove it, then demo it

- The full system suite (WP6 in the earlier brief) **against a production build**.
- Multi-org isolation under concurrency.
- A **demo script** (`docs/DEMO-SCRIPT.md`) that only uses flows covered by a passing test, so
  nothing in a live demo can be a surprise.

---

## Part 4 — How we guarantee it is functional (the anti-theatre machinery)

This is the part that answers "how are we going to ensure that this is all functional". Tests alone
did not catch this, so we change the *kind* of test.

1. **Production-build E2E.** Playwright must run against `npm run preview` (built bundle), not
   `npm run dev`. This alone kills the headline class of defect. Add it as a CI gate.
2. **No-dead-code gate.** A script (we have the method) fails the build if a `public` function has no
   production caller and is not explicitly allow-listed. Prevents the 15-dead-functions problem
   recurring.
3. **Config-effect gate.** Every row in the config registry must have an effect test; a script fails
   if a configurable field has no corresponding test. Prevents "stored but inert".
4. **Wiring gate.** Every `src/data/*.ts` export must be imported by a component or be allow-listed;
   every screen must have at least one test that loads it with real data.
5. **Two-sources gate.** A lint rule banning the pattern of a component reading both the seed and the
   database, which is what produced the "two UIs" problem.
6. **RPC parity gate.** Every RPC the app calls must exist in the final schema (catches the
   `SamplingPanel` empty-orgId bug class), and every RPC the schema exposes for the UI must be called
   or allow-listed.

These six gates are cheap, deterministic (Law 1 friendly) and would each have caught a real defect
found in the audit.

---

## Part 5 — What to do about today's test

- **Do not** give a non-technical professional the current build. In production it shows empty
  states; in dev it shows a demo tenant that is not their data. Neither is a fair representation.
- If a demo is unavoidable today, use the **dev build with the demo tenant** and present it
  explicitly as "a clickable prototype of the intended workflow", not as working software. That is
  honest and still valuable — the design and the depth are real.
- The earliest honest "you can try it with your own data" point is **after Phase 1 + Phase 2**:
  the app reads the database and an engagement can move through its stages.

---

## Part 6 — Effort estimate (order of magnitude, not a promise)

| Phase | Rough size | Unblocks |
|---|---|---|
| 1 — DB-backed shell | Largest single piece | everything |
| 2 — Lifecycle real | Large | a real audit run |
| 3 — Config honest | Medium | buyer due diligence |
| 4 — Methodology/steps | Medium | "configurable per client" claim |
| 5 — Monitors/connectors | Medium | continuous monitoring claim |
| 6 — Proof & demo | Small per cycle, run continuously | confidence |

Phases 1–2 are the critical path to something you can put in front of a professional without
flinching. Phases 3–4 are what make it *sellable* to an audit function rather than demoable.

---

## Part 7 — Decisions this plan forces (each needs your yes)

1. **Enforce or remove** `approval_chain`, `signoff_role_*`, `testing_mode`, `report_templates`,
   `anchoring_settings`. Recommendation: enforce — these are the questions buyers ask.
2. **Production-build E2E as a hard gate.** Recommendation: yes, even though it slows CI.
3. **Methodology/steps as first-class data** (Phase 4) vs. a fixed standard set. Recommendation: data,
   because "configurable per client" is the differentiator.
4. **Dead-code and config-effect gates** added to CI. Recommendation: yes.
5. **Demo posture today**: prototype framing (recommended) or postpone.

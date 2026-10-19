# ACP UI contract

The owner will inject a new UI later (F19). This file is the stable interface between the screens and
whatever replaces them. One section per screen ID from Appendix A. Each section gives: purpose,
route, rights required, the data functions it calls (real names), the testids it exposes, its states
and its tutorial key.

Rules that hold for every screen below:

- All data comes through `src/data/*.ts`. No component imports the database client (rule M8).
- Every interactive element carries `data-testid="<screenId>-<element>"`.
- Every Playwright spec and the tutorial recorder bind only to the testids listed here.
- No screen is a blocking modal. The tutorial player is a drawer (`role="complementary"`).
- Empty, loading and error states are explicit and named below.

Screens marked **(S1)** exist on this branch. The rest of Appendix A is S2 onward and is registered
as its slice lands.

---

## GL-01 — consultation banner (S1)

- **Purpose:** a persistent, non-blocking strip shown to BOTH parties while a Dual Session is active:
  who, which tier, time left, and an End button (F4).
- **Route:** rendered inside the authenticated shell, below the header, on every screen. Not a route.
- **Rights:** none to view (both parties see it). `edit_config` is required to *end* it as a tenant.
- **Data:** `getActiveConsultation(orgId)` (`src/data/consultation.ts`),
  `endConsultation(sessionId, reason?)`, `secondsLeft(expiresAt, now?)`, `formatRemaining(seconds)`.
- **Testids:** `consultation-banner`, `consultation-banner-time`, `consultation-banner-end`,
  `consultation-banner-dismiss`, `consultation-banner-error`.
- **States:** hidden when there is no active session or when dismissed; visible strip otherwise.
  Polls every 5 s as the fallback for the Realtime stream.
- **Tutorial key:** `oa.dual-session` / `sa.dual-session`.

## TUT-01 — tutorial drawer (S1)

- **Purpose:** the non-blocking player for a recorded tutorial: the GIF, numbered steps, "Copy steps"
  and "Did this help?" (F18).
- **Route:** a side drawer opened from any screen's "Show me how".
- **Rights:** any signed-in user.
- **Data:** `listTutorials()` (`src/data/tutorials.ts`), `recordTutorialView(key, helped)`.
- **Testids:** `tutorial-drawer`, `tutorial-drawer-close`, `tutorial-drawer-media`,
  `tutorial-drawer-missing`, `tutorial-drawer-steps`, `tutorial-drawer-copy`,
  `tutorial-drawer-feedback`, `tutorial-drawer-yes`, `tutorial-drawer-no`.
- **States:** media present (`tutorial-drawer-media`) or missing (`tutorial-drawer-missing`).
  `role="complementary"`, never a modal, never a scrim.
- **Tutorial key:** n/a (this is the player).

## SA-09 — Dual Session console (S1)

- **Purpose:** the platform side of the two-tier consultation: request a session for a tenant,
  acknowledge an invitation, end a session (F4).
- **Route:** `/superadmin`, tab `Dual Session`.
- **Rights:** platform admin (`is_platform_admin()`); a session never grants audit content.
- **Data:** `listTenants()` (`src/data/platform.ts`), `getActiveConsultation(orgId)`,
  `requestConsultation(orgId, kind, durationHours)`, `acknowledgeConsultation(sessionId)`,
  `endConsultation(sessionId, reason?)` (`src/data/consultation.ts`).
- **Testids:** `superadmin-consultation`, `superadmin-consultation-loading`,
  `superadmin-consultation-error`, `superadmin-consultation-result`,
  `superadmin-consultation-hours`, `superadmin-consultation-request`,
  `superadmin-consultation-empty`, `superadmin-consultation-<tenantId>`,
  `superadmin-consultation-ack-<tenantId>`, `superadmin-consultation-end-<tenantId>`.
  The tenant and tier dropdowns are labelled "Tenant for the consultation" and "Consultation tier".
- **States:** loading, error (with Retry), empty (no tenants), ready.
- **Tutorial key:** `sa.dual-session`.

## SA-14 — features and plans (S1)

- **Purpose:** the platform feature catalogue with price class and default, and the per-tenant
  entitlement matrix. A change requires a reason and writes append-only history (F25).
- **Route:** `/superadmin`, tab `Features & plans`.
- **Rights:** platform admin only. A tenant never writes entitlements.
- **Data:** `listFeatureCatalogue()`, `listTenantEntitlements(orgId)`, `setEntitlement(orgId,
  featureKey, enabled, plan, reason)` (`src/data/entitlements.ts`), `listTenants()`
  (`src/data/platform.ts`).
- **Testids:** `superadmin-features`, `superadmin-features-loading`, `superadmin-features-error`,
  `superadmin-features-result`, `superadmin-features-empty`, `superadmin-feature-catalogue`,
  `feature-catalogue-<key>`, `superadmin-entitlements`, `entitlement-<key>`,
  `entitlement-reason-<key>`, `entitlement-toggle-<key>`.
  The tenant dropdown is labelled "Tenant for entitlements".
- **States:** loading, error (with Retry), empty (no tenants), ready. A toggle without a reason shows
  "A reason is required when you change a feature." and sends nothing.
- **Tutorial key:** `sa.features`, `sa.plans`.

## SA-13 — tutorial library (S1)

- **Purpose:** registry health: missing, stale and ok, per Appendix A key (F18).
- **Route:** `/superadmin`, tab `Tutorials`.
- **Rights:** platform admin.
- **Data:** `listTutorials()`, `tutorialHealth(rows, liveHashes)` (`src/data/tutorials.ts`).
- **Testids:** `superadmin-tutorials`, `superadmin-tutorials-loading`, `superadmin-tutorials-empty`,
  `tutorial-<key>`.
- **States:** loading, empty, ready.
- **Tutorial key:** `sa.tutorials`.

## SA-05 — platform notification recipients (S1)

- **Purpose:** the list of Super Admin alert addresses used for platform alerts and as the platform
  half of `config.changed` (F7).
- **Route:** `/superadmin`, tab `Recipients`.
- **Rights:** platform admin.
- **Data:** `listRecipients()`, `addRecipient(address)`, `removeRecipient(id)`,
  `looksLikeEmail(text)` (`src/data/platformSettings.ts`).
- **Testids:** `superadmin-recipients`, `superadmin-recipients-loading`, `superadmin-recipients-empty`,
  `superadmin-recipients-input`, `superadmin-recipients-add`, `recipient-<address>`,
  `recipient-remove-<address>`.
- **States:** loading, empty, ready. An invalid address is refused with a plain message.
- **Tutorial key:** `sa.recipients`.

## SA-01 / OA-01 — setup wizards (S1, framework)

- **Purpose:** two linear, persisted wizards with progress, per-step validation, Back, Save and exit,
  a resume banner and a tutorial on every step (F17).
- **Route:** `/superadmin` tab `Setup`; Org Admin control plane tab `Setup`.
- **Rights:** platform admin for `super_admin`; `edit_config` for `org_admin`.
- **Data:** `listSetupSteps(scope)`, `saveSetupStep(scope, stepKey, status, answerRef)`,
  `setupProgress(steps, total)` (`src/data/setup.ts`); `visibleSteps(scope, enabledFeatures)`
  (`src/lib/wizardSteps.ts`).
- **Testids (scope is `org_admin` or `super_admin`):** `<scope>-wizard`, `<scope>-wizard-loading`,
  `<scope>-wizard-error`, `<scope>-wizard-empty`, `<scope>-wizard-resume`, `<scope>-wizard-progress`,
  `<scope>-wizard-steps`, `<scope>-wizard-step-<stepKey>`, `<scope>-wizard-body`,
  `<scope>-wizard-show-<stepKey>`, `<scope>-wizard-content-<stepKey>`, `<scope>-wizard-back`,
  `<scope>-wizard-skip`, `<scope>-wizard-save`, `<scope>-wizard-next`.
- **States:** loading, error (with Retry), empty, ready; a resume banner when a later step is open.
  A step whose `requiresFeature` is not entitled is hidden (F25).
- **Tutorial key:** `oa.setup-wizard` (+ `oa.setup-1` … `oa.setup-9`), `sa.setup-wizard`
  (+ `sa.setup-1` … `sa.setup-9`).

## OA-04 — features, read-only (S1)

- **Purpose:** the organisation's effective feature set, read-only, with "Ask QSCorp to add this" for
  add-ons. Only the Super Admin writes entitlements (F25).
- **Route:** Org Admin control plane, tab `Features`.
- **Rights:** `edit_config` to open the control plane.
- **Data:** `listFeatureCatalogue()`, `listTenantEntitlements(orgId)` (`src/data/entitlements.ts`).
- **Testids:** `org-control-panel`, `org-control-denied`, `org-control-tabs`,
  `org-control-tab-features`, `org-features`, `org-features-loading`, `org-features-error`,
  `org-features-list`, `org-feature-<key>`.
- **States:** loading, error, ready. No toggle exists on this screen; it is read-only by design.
- **Tutorial key:** `oa.features`.

## OA-16 — Dual Session, tenant side (S1)

- **Purpose:** the Org Admin invites QSCorp to tier 2, acknowledges a platform request, and ends a
  session (F4).
- **Route:** Org Admin control plane, tab `Dual Session`.
- **Rights:** `edit_config`.
- **Data:** `requestConsultation(orgId, 'full_admin', hours)`, `getActiveConsultation(orgId)`,
  `acknowledgeConsultation(sessionId)`, `endConsultation(sessionId, reason?)`
  (`src/data/consultation.ts`).
- **Testids:** `org-consultation`, `org-consultation-session`, `org-consultation-acknowledge`,
  `org-consultation-invite`, `org-consultation-result`.
- **States:** no session (the invite button only), requested (an Acknowledge button when the platform
  side initiated), active.
- **Tutorial key:** `oa.dual-session`.

## OA-17 — configuration history (S1)

- **Purpose:** one read-only story of every configuration change in the organisation, newest first,
  hash-chained, with a change made by a QSCorp consultant labelled "Platform consultant" (F4, L5).
- **Route:** Org Admin control plane, tab `History`.
- **Rights:** `edit_config`. A platform admin sees it only while an active consultation session
  exists; the database refuses everything else.
- **Data:** `listConfigHistory(limit?)` (`src/data/configHistory.ts`) →
  `config_history_list(p_limit)`.
- **Testids:** `org-history`, `org-history-loading`, `org-history-error`, `org-history-empty`,
  `org-history-table`, `org-history-row-<index>`, `org-history-platform-<index>`.
- **States:** loading, error (with Retry), empty ("No configuration has changed yet."), ready.
  Read-only: the screen exposes no write control.
- **Tutorial key:** `oa.history`.

---

## Tutorials regenerated

`npm run tutorials:record` regenerates every GIF (S12). The recorder binds only to the testids listed
above. `docs/ACP-TUTORIALS.md` lists every key and its steps.

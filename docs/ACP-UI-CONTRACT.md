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

### Tutorial button and first-visit autoplay (S12.c)

Every Appendix A screen renders one `TutorialButton` beside its heading, bound to that screen's key
(`src/lib/tutorialKeys.json`). The button label is "Show me how"; its testid is `<screenId>-tutorial`.
On a screen's first visit for a browser the drawer autoplays once and the
key is remembered in `localStorage` under `acp.tutorial.seen.<key>` (and the autoplay preference
under `acp.tutorial.autoplay`), so the same screen never autoplays twice. The e2e
`e2e/s12-tutorials.spec.ts` proves the autoplay-once behaviour; the other ACP e2e specs pre-seed
`acp.tutorial.autoplay` to `off` in their storage state so the drawer never intercepts a click.

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

## SA-04 — email sender profiles (S2)

- **Purpose:** the platform default sender, the per-tenant override, the fallback switch and a Test
  button per adapter (F6). A credential is never shown: only set / not set / last tested.
- **Route:** `/superadmin`, tab `Email senders`.
- **Rights:** platform admin.
- **Data:** `listSenderProfiles(orgId)`, `saveSenderProfile(orgId, scope, provider, displayName,
  fromAddress, replyTo, config, enabled, dailyCap)`, `setDefaultProfile(id)`,
  `forceProfile(orgId, profileId, allowTenant, fallback)`, `recordTestResult(id, text, status)`
  (`src/data/senderProfiles.ts`).
- **Testids:** `superadmin-email`, `superadmin-email-loading`, `superadmin-email-error`,
  `superadmin-email-result`, `superadmin-email-empty`, `superadmin-email-provider`,
  `superadmin-email-display-name`, `superadmin-email-from`, `superadmin-email-secret`,
  `superadmin-email-save`, `superadmin-email-list`, `sender-<id>`, `sender-test-<id>`,
  `sender-default-<id>`, `superadmin-email-org`, `superadmin-email-tenant-empty`,
  `superadmin-email-tenant-list`, `tenant-allow-<id>`, `tenant-deny-<id>`.
- **States:** loading, error (with Retry), empty ("No platform sender is set yet. Email is queued and
  not sent."), ready.
- **Tutorial keys:** `sa.email-resend`, `sa.email-microsoft`, `sa.email-smtp`, `sa.email-default`,
  `sa.email-force-tenant`.

## SA-07 / SA-08 — automation rules and message templates (S2)

- **Purpose:** a visual rule editor (event + conditions + actions) and a visual template editor
  (blocks moved with up and down buttons). No screen accepts JSON (F1). Test with a sample event is a
  dry run that sends nothing (F7).
- **Route:** `/superadmin`, tab `Automation`; sub-tabs `Rules` and `Message templates`.
- **Rights:** platform admin.
- **Data:** `listRules(orgId)`, `saveRule(orgId, key, name, eventKey, conditions, actions, enabled)`,
  `testRule(ruleId, sample)`, `listEventCatalogue()`, `listTemplates(orgId)`,
  `saveTemplate(orgId, eventKey, subject, blocks)` (`src/data/automation.ts`).
- **Testids:** `superadmin-automation`, `superadmin-automation-loading`,
  `superadmin-automation-error`, `superadmin-automation-result`, `superadmin-automation-saved`,
  `superadmin-automation-empty`, `superadmin-automation-tabs`,
  `superadmin-automation-tab-rules`, `superadmin-automation-tab-templates`, `rule-key`, `rule-name`,
  `rule-event`, `rule-enabled`, `rule-add-condition`, `rule-no-conditions`, `rule-condition-<i>`,
  `rule-condition-field-<i>`, `rule-condition-op-<i>`, `rule-condition-value-<i>`,
  `rule-condition-remove-<i>`, `rule-add-action`, `rule-no-actions`, `rule-action-<i>`,
  `rule-action-type-<i>`, `rule-action-message-<i>`, `rule-action-remove-<i>`, `rule-save`,
  `rule-list`, `rule-<key>`, `rule-test-<key>`, `rule-test-output`, `template-event`,
  `template-subject`, `template-blocks`, `template-block-<i>`, `template-block-text-<i>`,
  `template-block-up-<i>`, `template-block-down-<i>`, `template-block-remove-<i>`,
  `template-add-<type>`, `template-save`, `template-list`, `template-<eventKey>`.
- **States:** loading, error (with Retry), empty (no rules / no platform sender), ready. The test
  output panel appears only after a test and always says "nothing was sent".
- **Tutorial keys:** `sa.automation`, `sa.templates`.

## OA-11 — email sender (S2)

- **Purpose:** the Org Admin's own sender, its Test button, and a plain message when the platform
  does not allow a tenant sender (F6).
- **Route:** Org Admin control plane, tab `Email`.
- **Rights:** `edit_config`. The database refuses a tenant profile when the platform denies it.
- **Data:** `listSenderProfiles(orgId)`, `saveSenderProfile(...)`, `recordTestResult(id, text, status)`
  (`src/data/senderProfiles.ts`).
- **Testids:** `org-email`, `org-email-loading`, `org-email-error`, `org-email-result`,
  `org-email-saved`, `org-email-denied`, `org-email-provider`, `org-email-display-name`,
  `org-email-from`, `org-email-save`, `org-email-empty`, `org-email-list`, `org-sender-<id>`,
  `org-sender-test-<id>`.
- **States:** loading, error (with Retry), denied (the platform sends instead), empty ("You have no
  sending address yet. Notifications are waiting, not lost."), ready.
- **Tutorial keys:** `oa.email-resend`, `oa.email-microsoft`, `oa.email-smtp`, `oa.email-test`.

## OA-12 / OA-13 — notification and escalation rules (S2)

- **Purpose:** the Org Admin copies a platform rule and changes it, or starts a new one. The same
  editor covers escalation rules, whose recommendation is filled from the event fields (F7, F12).
- **Route:** Org Admin control plane, tab `Rules`.
- **Rights:** `edit_config`.
- **Data:** `listRules(orgId)`, `saveRule(...)`, `testRule(ruleId, sample)`, `listEventCatalogue()`,
  `listTemplates(orgId)` (`src/data/automation.ts`).
- **Testids:** `org-automation`, `org-automation-loading`, `org-automation-error`,
  `org-automation-result`, `org-automation-saved`, `org-automation-empty`, `org-automation-new`,
  `org-automation-editor`, `org-rule-key`, `org-rule-name`, `org-rule-event`, `org-rule-enabled`,
  `org-rule-add-condition`, `org-rule-condition-<i>`, `org-rule-condition-field-<i>`,
  `org-rule-condition-op-<i>`, `org-rule-condition-value-<i>`, `org-rule-condition-remove-<i>`,
  `org-rule-add-action`, `org-rule-action-<i>`, `org-rule-action-type-<i>`,
  `org-rule-action-message-<i>`, `org-rule-action-remove-<i>`, `org-rule-save`, `org-rule-cancel`,
  `org-rule-list`, `org-rule-<key>`, `org-rule-copy-<key>`, `org-rule-edit-<key>`,
  `org-rule-test-<key>`, `org-rule-test-output`, `org-template-list`, `org-template-<eventKey>`.
- **States:** loading, error (with Retry), empty (no rules), ready. A platform template offers "Copy
  and change"; a tenant rule offers "Change".
- **Tutorial keys:** `oa.automation`, `oa.templates-email`, `oa.escalation`.

## OA-20 — invite a colleague (S3)

- **Purpose:** the Org Admin invites a colleague by email and role. The invitation is recorded as a
  single-use row and its acceptance link is queued; the copy says "queued", never "sent", because no
  account exists until the invitee accepts (D20 defect, F6, S3). The invitee accepts at
  `/invite/accept?token=…`, which creates their account and applies the invitation.
- **Route:** Org Admin control plane, tab `People`, block "Invite a colleague". Acceptance:
  `/invite/accept?token=…`, outside the tenant shell and outside the auth gate.
- **Rights:** `manage_users`. The database re-checks it inside `invite_user_capped`.
- **Data:** `inviteUser(email, roleSlug)` → `{ ok, inviteId, status }`, `inviteStatus(inviteId)`,
  `createInviteeAccount(email, password)`, `acceptMemberInvite(token)` (`src/data/admin.ts`).
  `status` is the queue's own: `queued` until the dispatcher accepts the row.
- **Testids:** `people-admin-panel`, `admin-people`, `admin-invite`, `admin-invite-sent`,
  `admin-error`; acceptance `oa-accept`, `oa-accept-token`, `oa-accept-email`, `oa-accept-password`,
  `oa-accept-submit`, `oa-accept-error`, `oa-accept-hint`, `oa-accept-done`, `oa-accept-continue`.
- **States:** ready; the confirmation reads "Invitation queued for <email>". An invalid address keeps
  the button disabled. A cap breach or a missing right shows the RPC's message in `admin-error`.
  Acceptance: idle; busy; the token pre-filled from the link; a short password or a missing code is
  refused inline; email confirmation required is stated plainly; done.
- **Tutorial keys:** `oa.invite`.

---

## OA-02 / OA-03 — branding and report format (S4)

- **Purpose:** the Org Admin sets the organisation's profile, branding and report format (fonts,
  brand colours, logos, page size, margins, header and footer text, cover style, PPTX theme). The
  live preview runs through the real `BrandingSpec`, so what the admin sees is what the renderers
  produce (F9).
- **Route:** Org Admin control plane, tab `Branding`.
- **Rights:** `edit_config` (the database re-checks it in `admin_set_branding`). Feature-gated:
  `admin_set_branding` needs `branding_custom_fonts`, `admin_upload_pptx_theme` needs
  `pptx_theme_upload` (F25, D-S4-branding-entitlements).
- **Data:** `getBranding(orgId)` → `BrandingSpec`, `saveBranding(orgId, fields)` →
  `{ ok } | { ok:false, reason }`, `uploadBrandingAsset(orgId, kind, filename, mime, base64)`,
  `savePptxTheme(orgId, theme)`, `listBrandingAssets(orgId)` (`src/data/branding.ts`). The PPTX theme
  is extracted in the browser by `extractPptxTheme` (`src/lib/render/pptx.ts`) and only the extracted
  facts are written; no JSON is typed by any user (F1, D-S4-pptx-theme).
- **Testids:** `oa-branding`, `oa-branding-title`, `oa-branding-loading`, `oa-branding-readonly`,
  `oa-branding-form`, `oa-branding-font-heading`, `oa-branding-font-body`,
  `oa-branding-colour-primary`, `oa-branding-colour-accent`, `oa-branding-colour-text`,
  `oa-branding-colour-background`, `oa-branding-page-size`, `oa-branding-cover-style`,
  `oa-branding-margin-0`..`oa-branding-margin-3`, `oa-branding-header`, `oa-branding-footer`,
  `oa-branding-logo-light`, `oa-branding-logo-input`, `oa-branding-theme-upload`,
  `oa-branding-theme-note`, `oa-branding-save`, `oa-branding-error`, `oa-branding-saved`,
  `oa-branding-preview`, `oa-branding-preview-header`, `oa-branding-preview-footer`,
  `oa-branding-preview-note`.
- **States:** loading ("Loading branding…"); ready; error (`InlineError`); read-only (no save button,
  a plain notice). A save refusal (rights or entitlement) is shown in `oa-branding-error` in the
  server's own words. An over-size asset is refused by the RPC.
- **Tutorial keys:** `oa.branding`, `oa.pptx-theme`.

---

## OA-06 / OA-07 — AI settings and voice library (S5)

- **Purpose:** the Org Admin sets the model endpoint, the access mode, the use-case toggles, the
  parameters and the voice library. It can never add, remove, change or choose a model: that is the
  Super Admin's registry, and the server refuses an attempt (F8). A vendor-hosted endpoint is
  refused with the L2 message.
- **Route:** Org Admin control plane, tab `AI`.
- **Rights:** `edit_config`; feature-gated `ai_assist` (endpoint, use cases), `ai_voice_library`
  (voice profile, terms, samples) (F25).
- **Data:** `listUseCases(orgId)`, `saveUseCase(...)`, `setEndpoint(orgId, url, mode, secretId?)`,
  `getVoiceProfile(orgId)`, `saveVoiceProfile(...)`, `listVoiceTerms(orgId)`, `addVoiceTerm(...)`,
  `listVoiceSamples(orgId)`, `addVoiceSample(...)`, `isEndpointDenied(url)` (`src/data/ai.ts`).
- **Testids:** `org-ai-panel`, `oa-ai-loading`, `oa-ai-error`, `oa-ai-result`, `oa-ai-endpoint`,
  `oa-ai-endpoint-url`, `oa-ai-endpoint-mode`, `oa-ai-endpoint-save`, `oa-ai-usecases`,
  `oa-ai-usecase-<key>`, `oa-ai-usecase-toggle-<key>`, `oa-voice`, `oa-voice-tone`, `oa-voice-save`,
  `oa-voice-term-<id>`, `oa-voice-term-preferred`, `oa-voice-term-avoid`, `oa-voice-term-add`,
  `oa-voice-sample-<id>`, `oa-voice-sample-kind`, `oa-voice-sample-text`, `oa-voice-sample-add`.
- **States:** loading ("Loading the AI settings…"); ready; error (`InlineError`); a save refusal
  (rights, entitlement, deny-list) is shown in `oa-ai-result` in the server's own words.
- **Tutorial keys:** `oa.ai`, `oa.ai-test`, `oa.ai-usecases`, `oa.voice`.

---

## SA-06 — AI model registry and endpoint deny-list (S5)

- **Purpose:** the Super Admin adds, removes or changes a model, and edits the deny-list of
  vendor-hosted hosts (F8). Only the Super Admin writes `ai_models` and `ai_endpoint_denylist`.
- **Route:** platform portal, tab `AI models`.
- **Rights:** platform admin (`require_platform_admin`).
- **Data:** `listAiModels()`, `addAiModel(name, modelRef, notes?)`, `updateAiModel(id, name,
  modelRef, status)`, `removeAiModel(id)`, `listDenyPatterns()`, `addDenyPattern(pattern, label?)`,
  `removeDenyPattern(id)` (`src/data/ai.ts`).
- **Testids:** `superadmin-ai`, `sa-ai-loading`, `sa-ai-error`, `sa-ai-result`, `sa-ai-models`,
  `sa-ai-models-empty`, `sa-ai-model-<id>`, `sa-ai-model-toggle-<id>`, `sa-ai-model-remove-<id>`,
  `sa-ai-model-name`, `sa-ai-model-ref`, `sa-ai-model-add`, `sa-ai-denylist`,
  `sa-ai-pattern-<id>`, `sa-ai-pattern-remove-<id>`, `sa-ai-pattern-input`, `sa-ai-pattern-add`.
- **States:** loading; ready; error (`InlineError`); a save refusal is shown in `sa-ai-result`.
- **Tutorial keys:** `sa.ai-models`, `sa.ai-denylist`.

---

## OA-13 — escalation rules (S6)

- **Purpose:** the Org Admin builds a rule that watches an event, tests conditions, and escalates to
  configured roles with a DETERMINISTIC recommendation ("Audit required: Yes / No / Needs review")
  filled from the event fields by a rule-defined template. It can also raise a Work Queue proposal a
  CIA converts through the normal plan flow. There is no AI in the decision (L1, F12).
- **Route:** Org Admin control plane, tab `Escalation`.
- **Rights:** `edit_config`. Feature-gated: `escalation` (`F25`). The database re-checks both.
- **Data:** `listEscalations(orgId)`, `listProposals(orgId)`, `saveEscalationRule(orgId, ruleKey,
  name, eventKey, conditions, actions, enabled)`, `decideProposal(proposalId, status)`,
  `convertProposal(proposalId, engagementId?)` (`src/data/escalation.ts`); `listRules(orgId)`,
  `listEventCatalogue()` (`src/data/automation.ts`). The recommendation preview uses
  `recommend(payload, template)` and `describeBranch(branch)` (`src/lib/escalation.ts`).
- **Testids:** `oa-escalation`, `oa-escalation-loading`, `oa-escalation-error`, `oa-escalation-new`,
  `oa-escalation-editor`, `oa-escalation-name`, `oa-escalation-event`,
  `oa-escalation-add-condition`, `oa-escalation-condition-<i>`,
  `oa-escalation-condition-field-<i>`, `oa-escalation-condition-value-<i>`,
  `oa-escalation-condition-remove-<i>`, `oa-escalation-branch-<i>`,
  `oa-escalation-branch-field-<i>`, `oa-escalation-branch-equals-<i>`,
  `oa-escalation-branch-recommend-<i>`, `oa-escalation-branch-remove-<i>`,
  `oa-escalation-add-branch`, `oa-escalation-preview`, `oa-escalation-save`,
  `oa-escalation-cancel`, `oa-escalation-saved`, `oa-escalation-result`, `oa-escalation-empty`,
  `oa-escalation-list`, `oa-escalation-rule-<key>`, `oa-escalation-log`, `oa-escalation-<id>`.
- **States:** loading; error (`InlineError`); empty (no rules); ready. A save refusal (for example a
  feature not in the plan) is shown in `oa-escalation-result`. The editor never shows a JSON box (F1).
- **Tutorial keys:** `oa.escalation`.

## WK-08 — escalation cards and proposals (S6)

- **Purpose:** a role targeted by an escalation sees its card and the deterministic recommendation;
  a CIA converts a proposal through the normal plan and deployment-gate flow (F12). An optional AI
  note may sit beside the recommendation, labelled, and never changes it (F8).
- **Route:** Work Queue tab, block "Escalations for you".
- **Rights:** the escalation list is filtered server-side to `view_all_scopes` or a role the caller
  holds; conversion needs `manage_engagements`.
- **Data:** `listEscalations(orgId)`, `listProposals(orgId)`, `decideProposal(id, status)`,
  `convertProposal(id, engagementId?)` (`src/data/escalation.ts`).
- **Testids:** `wk-escalation`, `wk-escalation-error`, `wk-escalation-result`, `wk-proposal-list`,
  `wk-proposal-<id>`, `wk-proposal-convert-<id>`, `wk-proposal-dismiss-<id>`,
  `wk-escalation-list`, `wk-escalation-<id>`.
- **States:** the block renders nothing when the caller has no escalation and no proposal; otherwise
  it lists them. A conversion refusal is shown in `wk-escalation-result`.
- **Tutorial keys:** `oa.escalation-cards`.

---

## OA-09 — Board Pack configuration (S7)

- **Purpose:** the Org Admin reorders, enables and disables the pack sections. A section is never
  deleted, only switched off (configuration, not code).
- **Route:** the "Sections" tab inside the Board Pack panel on the Dashboard.
- **Rights:** `edit_config` (a consultant in a session may reach it through `config_actor_ok`).
- **Data:** `listBoardPackSections(orgId)`, `saveBoardPackSections(orgId, sections)`
  (`src/data/boardPack.ts`).
- **Testids:** `wk-boardpack`, `wk-boardpack-tab-config`, `oa-boardpack-config`,
  `oa-boardpack-section-<key>`, `oa-boardpack-up-<key>`, `oa-boardpack-down-<key>`,
  `oa-boardpack-enabled-<key>`, `wk-boardpack-error`, `wk-boardpack-result`.
- **States:** loading; a section list, or an inline error. The first section's Up button and the last
  section's Down button are disabled.
- **Tutorial key:** `oa.boardpack-config`.

---

## WK-01 to WK-04 — Dashboard Board Pack panel (S7)

- **Purpose:** the Dashboard carries the pack history, the generator, the open pack with a drill-down
  on every figure, and the PDF and PPTX downloads with the verification chip (F10).
- **Route:** the Dashboard tab, block "Board Pack".
- **Rights:** `view_board_pack` to see the panel and open a pack; `generate_board_pack` to generate.
  The `board_pack` entitlement gates the feature and `board_pack_pptx` gates the PPTX.
- **Data:** `listBoardPacks(orgId, scopeKey?)`, `getBoardPack(packId)`,
  `generateBoardPack(orgId, opts)`, `listBoardPackSections(orgId)`,
  `saveBoardPackSections(orgId, sections)`, `getOrgSettingsExtra(orgId)`,
  `saveOrgSettingsExtra(orgId, fields)` (`src/data/boardPack.ts`); `getBranding(orgId)`;
  the renderers `renderPdf`, `renderPptx`, `renderQrDataUrl` via `buildBoardPackPdf` and
  `buildBoardPackPptx` (`src/lib/boardPackDocuments.ts`).
- **Testids:** `wk-boardpack`, `wk-boardpack-loading`, `wk-boardpack-error`, `wk-boardpack-result`,
  `wk-boardpack-tab-history`, `wk-boardpack-tab-config`, `wk-boardpack-tab-view`,
  `wk-boardpack-generator`, `wk-boardpack-scope`, `wk-boardpack-boundary`, `wk-boardpack-from`,
  `wk-boardpack-to`, `wk-boardpack-generate`, `wk-boardpack-no-generate`, `wk-boardpack-history`,
  `wk-boardpack-empty`, `wk-boardpack-<id>`, `wk-boardpack-open-<id>`, `wk-boardpack-view`,
  `wk-boardpack-pdf`, `wk-boardpack-pptx`, `wk-boardpack-url-missing`, `wk-boardpack-missing-refs`,
  `wk-boardpack-verify-chip`, `wk-boardpack-section-sira`, `wk-boardpack-section-issues`,
  `wk-boardpack-section-sealed`, `wk-boardpack-section-changes`, `wk-boardpack-section-sources`,
  `wk-boardpack-figure-sira-<i>`, `wk-boardpack-figure-cap-<band>`, `wk-boardpack-figure-sealed`,
  `wk-boardpack-delta`, `wk-boardpack-source-<path>`.
- **States:** a role without `view_board_pack` sees nothing. Loading, an empty history ("No pack yet"),
  an inline error, and the open pack. The PDF and PPTX buttons are disabled until `app_base_url` is
  set, with `wk-boardpack-url-missing` shown.
- **Tutorial keys:** `oa.boardpack-use` (WK-01), `oa.boardpack-generate` (WK-02),
  `oa.boardpack-view` (WK-03), `oa.boardpack-download` (WK-04).

---

## WK-05 — Certificate panel (S8)

- **Purpose:** issue, revoke and download an engagement certificate; configure which fields appear
  (F11).
- **Route:** the Audit File window, view "Certificate" (`audit-file-view-certificate`).
- **Rights:** `manage_engagements` to issue, `can_reopen` to revoke, `edit_config` to change the
  field list. The `certificates` entitlement gates the feature.
- **Data:** `listCertificates(orgId)`, `getCertificate(certificateId)`,
  `issueCertificate(engagementId, extra?)`, `revokeCertificate(certificateId, reason)`,
  `getCertificateConfig(orgId)`, `saveCertificateConfig(orgId, fields)` (`src/data/certificate.ts`);
  `getOrgSettingsExtra(orgId)`; `getBranding(orgId)`; the shared `renderPdf` and `renderQrDataUrl`
  renderers (`src/lib/render/`). Pure helpers in `src/lib/certificate.ts`.
- **Testids:** `wk-certificate`, `wk-certificate-loading`, `wk-certificate-error`,
  `wk-certificate-issue`, `wk-certificate-no-issue`, `wk-certificate-ok`, `wk-certificate-result`,
  `wk-certificate-empty`, `wk-certificate-list`, `wk-certificate-<id>`, `wk-certificate-status-<id>`,
  `wk-certificate-pdf-<id>`, `wk-certificate-revoke-<id>`, `wk-certificate-revoke-form-<id>`,
  `wk-certificate-revoke-reason-<id>`, `wk-certificate-revoke-confirm-<id>`, `oa-certificate-config`,
  `oa-certificate-field-<key>`, `oa-certificate-enabled-<key>`.
- **States:** loading; an empty list ("No certificate has been issued…"); an inline error. Revoke is
  refused until the reason is at least five characters. A role without `manage_engagements` sees a
  disabled issue button and a plain explanation.
- **Tutorial key:** `oa.certificate`.

---

## WK-06 — Public verification page (S8)

- **Purpose:** the ONLY anonymous surface (F11). A visitor checks a certificate or Board Pack by id
  and may compare a dropped JSON or PDF hash in the browser.
- **Route:** `/verify/:id` (certificate) and `/pack/:id` (Board Pack), outside the auth guard.
- **Rights:** none. The page calls exactly one of the two anon-callable RPCs.
- **Data:** `verifyCertificate(certificateId)`, `verifyBoardPack(packId)` (`src/data/certificate.ts`);
  `parseDroppedDocument`, `matchesHash`, `statusLabel` (`src/lib/certificate.ts`).
- **Testids:** `wk-verify`, `wk-verify-loading`, `wk-verify-error`, `wk-verify-status`,
  `wk-verify-not-found`, `wk-verify-rate-limited`, `wk-verify-organisation`, `wk-verify-title`,
  `wk-verify-issued`, `wk-verify-workpapers`, `wk-verify-findings`, `wk-verify-hash`, `wk-verify-drop`,
  `wk-verify-file`, `wk-verify-drop-error`, `wk-verify-drop-result`.
- **States:** loading; valid / superseded / revoked / not found / rate limited. Organisation name and
  title appear only when the tenant turned `public_verify_show_title` on.
- **Tutorial key:** `oa.verify`.

---

## OA-14 — external auditors (S9)

- **Purpose:** invite an external auditor by email and edit the per-engagement permission matrix
  (F13). An external auditor is a separate read-only principal, never an org role.
- **Route:** the Org Control panel, tab "External auditors" (`org-control-tab-auditors`).
- **Rights:** `edit_config` to invite, edit the matrix or revoke. The `external_auditors` entitlement
  gates the feature; a refusal from the server is shown in plain words.
- **Data:** `inviteExternalAuditor({email, engagementIds, expiryKind, accessDays})`,
  `listExternalAuditors(orgId)`, `saveExternalAuditorGrants(orgId, grants)`,
  `revokeExternalAuditor(orgId, userId, engagementId?)`, `listExternalAccessLog(orgId, limit)`
  (`src/data/externalAuditors.ts`). Pure helpers in `src/lib/externalAuditors.ts` (`grantIsLive`,
  `permissionsOf`, `permissionMatrix`, `normaliseEngagementIds`, `describeExpiry`, `SIGNUP_DISABLED_HINT`).
- **Testids:** `oa-auditors`, `oa-auditors-loading`, `oa-auditors-error`, `oa-auditors-result-error`,
  `oa-auditors-result-ok`, `oa-auditors-email`, `oa-auditors-expiry-kind`, `oa-auditors-days`,
  `oa-auditors-permanent-warning`, `oa-auditors-engagements`, `oa-auditors-engagement-<id>`,
  `oa-auditors-no-engagements`, `oa-auditors-invite`, `oa-auditors-matrix`, `oa-auditors-matrix-empty`,
  `oa-auditors-row-<userId>`, `oa-auditors-cell-<userId>-<permission>`, `oa-auditors-expiry-<userId>`,
  `oa-auditors-revoke-<userId>`, `oa-auditors-log`, `oa-auditors-log-empty`.
- **States:** loading; an empty matrix ("No external auditors yet."); an empty log; an inline error.
  Choosing "Permanent" shows a plain warning. Revoking a whole account is a hold-to-confirm. The
  invitation result is "Invitation queued…", never "sent" (D20).
- **Tutorial keys:** `oa.auditors`, `oa.auditor-matrix`.

---

## EX-01 to EX-04 — the external auditor portal (S9)

- **Purpose:** the read-only portal an external auditor sees (F13). It lists the engagements the
  auditor is granted, shows an engagement summary, exposes the latest Board Pack and certificate
  hashes, and verifies a dropped document in the browser.
- **Route:** `/external` (portal), `/external/accept?token=…` (accept an invitation). Both are
  outside the tenant shell; the portal needs a session, the acceptance page is where the session is
  first used. A tenant member who opens `/external` sees a plain notice, never the portal.
- **Rights:** none from the closed list (F13: the list is unaffected). Access is decided by the
  database through the security-definer `ext_*` family, which checks an active, unexpired grant.
- **Data:** `getMyAccess()`, `listMyEngagements()`, `getEngagementSummary(engagementId)`,
  `getLatestPack(engagementId)`, `getLatestCertificate(engagementId)`,
  `verifyExternalCertificate(certificateId)`, `acceptExternalInvite(token)`
  (`src/data/externalAuditors.ts`). The accept call reaches the `invite-user` Edge Function, which
  binds the account through `external_auditor_accept` (service-role only).
- **Testids:** `ex-accept`, `ex-accept-token`, `ex-accept-submit`, `ex-accept-error`, `ex-accept-done`,
  `ex-accept-continue`, `ex-accept-hint`; `ex-portal`, `ex-portal-loading`, `ex-portal-inactive`,
  `ex-portal-error`, `ex-portal-empty`, `ex-portal-engagements`, `ex-portal-engagement-<id>`,
  `ex-portal-summary`, `ex-portal-downloads`, `ex-portal-pack-hash`, `ex-portal-cert-hash`,
  `ex-portal-verify`, `ex-portal-verify-result`, `ex-portal-drop`, `ex-portal-drop-input`,
  `ex-portal-drop-error`, `ex-portal-drop-result`; `external-portal-wrong-principal` (tenant member).
- **States:** loading; inactive ("Your access is not active"); an empty engagement list; an inline
  error; a drop that matches or does not match. There is no write control anywhere.
- **Tutorial keys:** `ex.accept`, `ex.home`, `ex.engagement`, `ex.verify`.

---

## OA-21 — patterns settings (S10)

- **Purpose:** set the deterministic pattern thresholds (F15). Similarity threshold, minimum group
  size, years back, included severities and the right that can see the view. No AI is involved and
  nothing here changes a finding.
- **Route:** the Org Control panel, tab "Features" is OA-04; the Patterns settings live in the
  Issues & CAP Register "Patterns" view, its "Settings" sub-view (`oa-patterns-config`). It needs
  `edit_config`; a caller without it sees the read-only notice.
- **Rights:** `edit_config` to read and write the settings. The `patterns` entitlement gates the
  feature; a refusal from the server is shown in plain words.
- **Data:** `getPatternSettings(orgId)`, `savePatternSettings(orgId, settings)`
  (`src/data/patterns.ts`). Pure logic in `src/lib/patterns.ts`.
- **Testids:** `oa-patterns-config`, `oa-patterns-config-readonly`, `oa-patterns-threshold`,
  `oa-patterns-min-size`, `oa-patterns-years`, `oa-patterns-visibility`, `oa-patterns-save`,
  `oa-patterns-result`, `oa-patterns-result-error`.
- **States:** loading; read-only for a caller without `edit_config`; an inline error; a plain result
  line after a save. Every control is a slider, a number input or a select — never a JSON box.
- **Tutorial key:** `oa.patterns-config`.

---

## WK-09 — Time-Travel (S10, F14)

- **Purpose:** reconstruct one engagement as of a past moment from append-only history (F14). The
  timeline handle snaps to recorded events; the state shows workpapers, findings and seals as they
  were, or says what history did not record.
- **Route:** inside the Audit File window, the "Time-Travel" phase view (`audit-file-as-of`), offered
  only to a caller holding `view_insights` (`audit-file-view-as_of`). Read-only.
- **Rights:** `view_insights`. The `time_travel` entitlement gates the database functions; a refusal
  from the server is surfaced as the state's error, never hidden.
- **Data:** `listAsOfEvents(engagementId, ts)`, `getEngagementAsOf(engagementId, ts)`
  (`src/data/timeTravel.ts`). Pure logic in `src/lib/asOfTimeline.ts` (`snapToEvent`, `diffStates`,
  `isBeforeEarliest`, `formatAsOf`).
- **Testids:** `wk-timetravel`, `wk-timetravel-loading`, `wk-timetravel-banner`, `wk-timetravel-track`,
  `wk-timetravel-handle`, `wk-timetravel-prev`, `wk-timetravel-next`, `wk-timetravel-date`,
  `wk-timetravel-now`, `wk-timetravel-compare`, `wk-timetravel-state`, `wk-timetravel-workpapers`,
  `wk-timetravel-not-recorded`, `wk-timetravel-diff`, `wk-timetravel-diff-empty`,
  `wk-timetravel-diff-<id>`, `wk-timetravel-event-<action>`.
- **States:** loading; an as-of state with the banner; "Not recorded before <date>" when the entity
  kept no history; a diff region that lists added, changed and removed records. Animation respects
  `prefers-reduced-motion`.
- **Tutorial key:** `oa.timetravel`.

## WK-10 — Cross-engagement patterns (S10, F15)

- **Purpose:** group concluded findings across engagements by deterministic text similarity and shared
  tags (F15). Three views: clusters, a heat map (entity by year, or by category) and a node graph.
  Clicking a cluster member, a graph node or a heat-map cell opens the original sealed finding.
- **Route:** the Issues & CAP Register, a "Patterns" view (`issues-view-patterns`). The view switch
  is offered to everyone; the data needs `view_insights`.
- **Rights:** `view_insights` for the data; `edit_config` for the settings sub-view (OA-21). The
  `patterns` entitlement gates the feature. A caller without `view_insights` sees `wk-patterns-denied`.
- **Data:** `getPatternFindings(orgId)`, `getPatternSettings(orgId)`, `savePatternSettings(orgId, ...)`
  (`src/data/patterns.ts`); the drill-down read is `getFindingDetail(findingId)`
  (`src/data/observations.ts`). Pure logic in `src/lib/patterns.ts` (TF-IDF, clustering, deterministic
  seeded layout, `heatMap`).
- **Testids:** `wk-patterns`, `wk-patterns-loading`, `wk-patterns-denied`, `wk-patterns-empty`,
  `wk-patterns-unclustered`, `wk-patterns-tab-<view>`, `wk-patterns-clusters`, `wk-patterns-cluster-<id>`,
  `wk-patterns-finding-<id>`, `wk-patterns-node-<id>`, `wk-patterns-graph`, `wk-patterns-graph-empty`,
  `wk-patterns-heatmap`, `wk-patterns-heat-by`, `wk-patterns-heatmap-cells`,
  `wk-patterns-cell-<entityId>-<bucket>`, `wk-patterns-cell-count-<entityId>-<bucket>`,
  `wk-patterns-heatmap-empty`. The drill-down renders `finding-drilldown`, `finding-drilldown-title`,
  `finding-drilldown-severity`, `finding-drilldown-entity`, `finding-drilldown-unavailable` and
  `finding-drilldown-error`, and is reachable at `/view/finding/:id`.
- **States:** loading; a plain refusal for a caller without `view_insights`; an empty clusters list;
  an empty graph or heat map; an inline error. The graph node is a keyboard-reachable button.
- **Tutorial key:** `oa.patterns`.

---

## SA-10 / SA-11 — hosting fit check and hosting rules (S11, F16)

- **Purpose:** a searchable stack catalogue ("RDS", "Aurora", "Azure PG", "Cloud SQL", "Docker",
  "VMware", "SQL Server", "Oracle", "MySQL" and more) pre-fills a short questionnaire; the
  deterministic `evaluateFit` returns a verdict (any blocker → Red; else any warning → Amber; else
  Green), a cost tier, plain reasons and a "what the client must provide" checklist. SA-11 edits the
  rules visually, one field / operator / value / severity / cost tier per row.
- **Route:** `/superadmin`, tabs `Hosting fit` (`sa-hosting-tab-check`) and `Rules`
  (`sa-hosting-tab-rules`).
- **Rights:** platform admin only.
- **Data:** `getHostingCatalogue()` (`src/data/hostingFit.ts`), `saveHostingRule(rule)`
  (`src/data/hostingFit.ts`). Pure logic `evaluateFit`, `searchStacks`, `requiredChecklist`
  (`src/lib/hostingFit.ts`).
- **Testids:** `sa-hosting`, `sa-hosting-loading`, `sa-hosting-error`, `sa-hosting-tabs`,
  `sa-hosting-tab-check`, `sa-hosting-tab-rules`, `sa-hosting-fit`, `sa-hosting-search`,
  `sa-hosting-search-empty`, `sa-hosting-search-results`, `sa-hosting-stack-<key>`,
  `sa-hosting-field-<field>` (engine, hosting_kind, os, ram_gb, cpu_cores, disk_gb, backup_policy,
  users, largest_population, docker_available, inbound_443, outbound_internet), `sa-hosting-verdict`,
  `sa-hosting-verdict-value`, `sa-hosting-cost`, `sa-hosting-reasons`, `sa-hosting-checklist`,
  `sa-hosting-rules`, `sa-hosting-rule-saved`, `sa-hosting-rule-<key>`,
  `sa-hosting-rule-enabled-<key>`, `sa-hosting-rule-field-<key>`, `sa-hosting-rule-op-<key>`,
  `sa-hosting-rule-value-<key>`, `sa-hosting-rule-sev-<key>`, `sa-hosting-rule-cost-<key>`.
- **States:** loading; error (with Retry); a rule edit that fails reloads the catalogue and shows the
  error; the verdict region always renders.
- **Tutorial key:** `sa.hosting-fit`, `sa.hosting-rules`.

## SA-12 — migration jobs and deployment kit (S11, F16)

- **Purpose:** platform staff pick a tenant and watch its migration job: status, per-step rows and
  checkpoints, the retention window. The Deployment Kit panel states the env template and hosting
  steps in plain words. The runner itself is a separate Node package (`tools/migration-runner/`).
- **Route:** `/superadmin`, tab `Migration jobs`.
- **Rights:** platform admin only.
- **Data:** `listMigrationJobs(orgId)` (`src/data/hostingFit.ts`), `listTenants()`
  (`src/data/platform.ts`).
- **Testids:** `sa-migration`, `sa-migration-loading`, `sa-migration-error`, `sa-migration-tenant`,
  `sa-migration-refresh`, `sa-migration-jobs-loading`, `sa-migration-jobs-error`, `sa-migration-empty`,
  `sa-migration-job-<id>`, `sa-migration-job-error-<id>`, `sa-migration-steps-<id>`,
  `sa-deployment-kit`.
- **States:** loading tenants; loading jobs; an empty jobs list; an inline job error; a failed job is
  flagged in cinnabar, an awaiting-cutover or retired job in verdigris.
- **Tutorial key:** `sa.migration`.

## OA-15 — hosting and database (S11, F16)

- **Purpose:** the Org Admin enters the target connection (kind, host, port, database, user, SSL mode;
  the password goes through the secrets-put Edge Function and is shown only masked — F5), starts a
  migration job, copies the runner command, and retires the old connection with a hold-to-confirm.
- **Route:** `Organisation settings` → tab `Hosting` (`org-control-tab-hosting`).
- **Rights:** `edit_config`. The `hosting_migration` entitlement gates the RPCs in the database.
- **Data:** `listHostingConnections(orgId)`, `saveHostingConnection(input)`,
  `setConnectionSecret(connectionId, secretId, masked)`, `createMigrationJob(orgId, connectionId)`,
  `migrationRunnerCommand(jobId, jobToken)`, `testHostingConnection({ orgId, connectionId,
  consultationSessionId? })` (`src/data/hostingFit.ts`); `storeSecret(orgId, label, value)`
  (`src/data/secrets.ts`). The Test button calls the `hosting-test` Edge Function (C2.1), which reads
  the password server-side and returns the report below; the password never reaches the browser.
- **Testids:** `oa-hosting`, `oa-hosting-loading`, `oa-hosting-error`, `oa-hosting-action-error`,
  `oa-hosting-notice`, `oa-hosting-label`, `oa-hosting-kind`, `oa-hosting-host`, `oa-hosting-port`,
  `oa-hosting-database`, `oa-hosting-username`, `oa-hosting-ssl`, `oa-hosting-password`,
  `oa-hosting-save`, `oa-hosting-runner-command`, `oa-hosting-empty`, `oa-hosting-connection-<id>`,
  `oa-hosting-mask-<id>`, `oa-hosting-test-<id>`, `oa-hosting-test-run-<id>` (C2.1 connectivity test),
  `oa-hosting-report-<id>`, `oa-hosting-report-reachable-<id>`, `oa-hosting-report-messages-<id>`,
  `oa-hosting-report-extensions-<id>`, `oa-hosting-report-roles-<id>`, `oa-hosting-migrate-<id>`,
  `oa-hosting-retire-<id>`.
- **States:** loading; error (with Retry); an incomplete form refused inline before any call; an empty
  connections list; a runner command panel after a job starts. No blocking modal; retire uses
  hold-to-confirm.
- **Tutorial key:** `oa.hosting`, `oa.migration`, `oa.deployment-kit`, `oa.retire-old`.

---

## SA-02 — platform health, support grants and the read-only support session (C2.2, C2.9)

- **Purpose:** the platform's operations surface. It shows every scheduled job and its last run,
  lists the time-boxed support grants, and opens the tenant-granted, read-only support session that
  those grants unlock.
- **Route:** `/superadmin`, tab `Support access` (`superadmin-tab-support`).
- **Rights:** platform admin (`is_platform_admin()`, `require_platform_admin()` in the database). The
  session additionally requires a live, unrevoked, unexpired `content_read` grant for the tenant.
- **Data:** `listJobHealth()` (`platform_job_health`), `listSupportGrants()`
  (`platform_list_support_grants`), `grantSupportAccess(orgId, scope, durationHours)`,
  `revokeSupportAccess(grantId, reason)` (`src/data/platform.ts`); the session calls
  `supportGrantActive(orgId)` (`support_grant_active`), `supportListEngagements(orgId)`
  (`support_list_engagements`), `supportReadObject(kind, objectId, orgId)` (`support_read_object`)
  and `supportAccessLog(orgId)` (`support_access_log_list`) — all in `src/data/platform.ts`,
  backed by migration 0076.
- **Testids:** `superadmin-support`, `superadmin-support-loading`, `superadmin-support-error`,
  `superadmin-support-result`, `superadmin-support-empty`, `superadmin-support-session`,
  `superadmin-support-session-org`, `superadmin-support-session-open`,
  `superadmin-support-session-error`, `superadmin-support-session-open-panel`,
  `superadmin-support-session-count`, `superadmin-support-session-empty`,
  `superadmin-support-session-list`, `superadmin-support-session-read-result`,
  `superadmin-support-session-trail`, `support-engagement-<id>`, `support-read-<id>`,
  `superadmin-job-health`, `superadmin-job-health-error`, `superadmin-job-health-empty`,
  `superadmin-job-health-list`, `job-<jobName>`, `job-status-<jobName>`, `grant-<grantId>`.
- **States:** loading grants; loading jobs; an empty jobs list (the scheduler is absent); an inline
  job error; a session that stays closed when no live grant exists, with the reason inline; an open
  session with the granted engagements; an inline refusal when the database rejects the call.
  No blocking modal.
- **Tutorial key:** `sa.support`.

---

## Tutorials regenerated

`npm run tutorials:record` regenerates every GIF (S12). The recorder binds only to the testids listed
above. `docs/ACP-TUTORIALS.md` lists every key and its steps.
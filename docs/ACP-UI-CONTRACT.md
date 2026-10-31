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

Appendix A ids **SA-06**, **OA-06**, **OA-07** and **WK-07** are retired: they were the AI model
registry, the AI settings and voice library, and the AI drafting aid, all removed on 2026-10-25
(owner decision D-P0-1, migration `0087_remove_ai.sql`). The id space keeps its numbering so every
other screen id is unchanged; the four retired ids have no section and no tutorial key.

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
  Delivered live: a Supabase Realtime subscription on the published tables, with a 5 s poll as the
  documented fallback when Realtime is unavailable (`src/lib/liveSync.ts` decides the transport).
- **Tutorial key:** `oa.dual-session` / `sa.dual-session`

## GL-02 — in-app notifications and pop-out live sync (§17.1, §22)

Two always-available chrome surfaces that close §22 (Realtime in-app notification delivery) and
§17.1 (a pop-out window that stays in sync). Neither is a blocking modal.

- **Purpose:** (a) the header bell lists the signed-in member's own in-app notifications and counts
  the unread ones; (b) a record opened as a same-origin pop-out (`/view/:recordType/:id`) stays in
  sync with the window that opened it through the shared origin storage.
- **Route:** the bell sits in the header on every authenticated screen (not a route). The pop-out is
  the `/view/:recordType/:id` route, opened by the floating-window pop-out button.
- **Rights:** none beyond an authenticated session. A member sees only its own notifications; the
  `notifications_list` RPC and the `notifications` RLS policy bound the read to
  `org_id = jwt_org_id() and user_id = auth.uid()`.
- **Data:** `listNotifications()` (`src/data/notifications.ts`), `markNotificationRead(id)`,
  `subscribeNotifications(orgId, onChange)`, `chooseTransport`/`pollDue`/`pollInterval`
  (`src/lib/liveSync.ts`), `useLiveNotifications(orgId)` (`src/hooks/useLiveNotifications.ts`),
  `useRecordRevisionSync(recordType, recordId)` (`src/hooks/useRecordRevisionSync.ts`).
- **RPCs / tables:** `notifications_list()`, `notification_mark_read(p_id)`; the `notifications`
  table on the `supabase_realtime` publication. `notification_emit(...)` is the server-side raise.
- **Testids:** `notification-bell`, `notification-bell-count`, `notification-panel`,
  `notification-transport`, `notification-empty`, `notification-list`, `notification-<id>`,
  `notification-mark-read-<id>`, `wk-notifications`, `wk-notifications-transport`,
  `wk-notifications-unread`, `wk-notifications-empty`, `wk-notifications-list`,
  `wk-notification-<id>`, `wk-notification-mark-read-<id>`, `record-page-revision`,
  `record-page-refresh`.
- **States:** bell badge hidden at zero unread; the panel shows `Live` or `Polling` from the chosen
  transport; an empty list renders "Nothing new."; the pop-out shows its current revision and a
  refresh control that publishes a new revision to the parent window.
- **Tutorial key:** none (chrome, not a numbered screen).

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
- **Testids (scope is `org_admin` or `super_admin`; the same ids exist for both scopes):**
  `org_admin-wizard`, `org_admin-wizard-loading`, `org_admin-wizard-error`, `org_admin-wizard-empty`,
  `org_admin-wizard-resume`, `org_admin-wizard-progress`, `org_admin-wizard-steps`,
  `org_admin-wizard-body`, `org_admin-wizard-back`, `org_admin-wizard-skip`,
  `org_admin-wizard-save`, `org_admin-wizard-next`, `super_admin-wizard`,
  `super_admin-wizard-loading`, `super_admin-wizard-error`, `super_admin-wizard-resume`,
  `super_admin-wizard-progress`, `super_admin-wizard-steps`, `super_admin-wizard-body`,
  `super_admin-wizard-back`, `super_admin-wizard-save`, `super_admin-wizard-next`.
  Per step, `<scope>-wizard-step-<stepKey>`, `<scope>-wizard-show-<stepKey>` and
  `<scope>-wizard-content-<stepKey>`, e.g. `org_admin-wizard-step-org.profile`,
  `org_admin-wizard-show-org.profile`, `org_admin-wizard-content-org.golive`,
  `super_admin-wizard-step-sa.readiness`, `super_admin-wizard-show-sa.readiness`.
  The Org Admin step keys are `org.profile`, `org.features`, `org.roles`, `org.ai`,
  `org.presentation`, `org.escalation`, `org.hosting`, `org.email`, `org.golive`; the platform step
  keys are `sa.readiness`, `sa.email`, `sa.recipients`, `sa.ai`, `sa.hosting`, `sa.rules`,
  `sa.features`, `sa.tutorials`, `sa.golive`.
- **States:** loading, error (with Retry), empty, ready; a resume banner when a later step is open.
  A step whose `requiresFeature` is not entitled is hidden (F25).
- **Tutorial key:** `oa.setup-wizard` (+ `oa.setup-1` … `oa.setup-8`), `sa.setup-wizard`
  (+ `sa.setup-1` … `sa.setup-8`).

## OA-04 — features, read-only (S1)

- **Purpose:** the organisation's effective feature set, read-only, with "Ask QSCorp to add this" for
  add-ons. Only the Super Admin writes entitlements (F25).
- **Route:** Org Admin control plane, tab `Features`.
- **Rights:** `edit_config` to open the control plane.
- **Data:** `listFeatureCatalogue()`, `listTenantEntitlements(orgId)` (`src/data/entitlements.ts`).
- **Testids:** `org-control-panel`, `org-control-denied`, `org-control-tabs`,
  `org-control-tab-features`, `org-features`, `org-features-loading`, `org-features-error`,
  `org-features-list`, `org-feature-<key>`., `org-control-no-right`, `org-setup`
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
  `superadmin-email-tenant-list`, `tenant-allow-<id>`, `tenant-deny-<id>`., `superadmin-email-saved`, `superadmin-email-connect-graph`
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
  `org-sender-test-<id>`., `org-email-connect-graph`
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
  `oa-branding-font-heading-licence`, `oa-branding-font-body-licence`,
  `oa-branding-colour-primary`, `oa-branding-colour-accent`, `oa-branding-colour-text`,
  `oa-branding-colour-background`, `oa-branding-page-size`, `oa-branding-cover-style`,
  `oa-branding-margin-0`..`oa-branding-margin-3`, `oa-branding-header`, `oa-branding-footer`,
  `oa-branding-logo-light`, `oa-branding-logo-input`, `oa-branding-theme-upload`,
  `oa-branding-theme-note`, `oa-branding-font-upload`, `oa-branding-font-licence-label`,
  `oa-branding-font-licence-ack`, `oa-branding-font-note`, `oa-branding-detected`,
  `oa-branding-detected-note`, `oa-branding-detected-heading`, `oa-branding-detected-body`,
  `oa-branding-detected-colours`, `oa-branding-detected-toupload`, `oa-branding-adopt`,
  `oa-branding-assets`, `oa-branding-assets-empty`, `oa-branding-assets-list`,
  `oa-branding-asset-<id>`,
  `oa-branding-save`, `oa-branding-error`, `oa-branding-saved`,
  `oa-branding-preview`, `oa-branding-preview-header`, `oa-branding-preview-footer`,
  `oa-branding-preview-note`.
- **States:** loading ("Loading branding…"); ready; error (`InlineError`); read-only (no save button,
  a plain notice). A save refusal (rights or entitlement) is shown in `oa-branding-error` in the
  server's own words. An over-size asset is refused by the RPC. A template upload detects the file's
  own fonts, colours and page setup (F5) and offers to adopt them (F6); a house-font upload is refused
  until the licence acknowledgement (`oa-branding-font-licence-ack`) is ticked (F4). The stored assets
  (`oa-branding-assets`) list every logo, font and template the org holds, empty or populated, and
  refresh after each successful upload.
- **Tutorial keys:** `oa.branding`, `oa.pptx-theme`.

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
  `oa-boardpack-section-<key>`, `oa-boardpack-label-<key>`, `oa-boardpack-up-<key>`,
  `oa-boardpack-down-<key>`, `oa-boardpack-enabled-<key>`, `oa-boardpack-roles-<key>`,
  `oa-boardpack-roles-panel-<key>`, `oa-boardpack-role-<key>-<slug>`, `wk-boardpack-error`,
  `wk-boardpack-result`.
- **States:** loading; a section list, or an inline error. The first section's Up button and the last
  section's Down button are disabled. A section label is editable in place (saved on blur) and a
  per-section role list is opened with the Roles button; an empty role list means every role with
  `view_board_pack`.
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
  `wk-boardpack-section-plan`, `wk-boardpack-section-sealed`, `wk-boardpack-section-changes`,
  `wk-boardpack-section-sources`, `wk-boardpack-figure-sira-<i>`, `wk-boardpack-figure-cap-<band>`,
  `wk-boardpack-figure-sealed`, `wk-boardpack-delta`, `wk-boardpack-source-<path>`,
  `wk-boardpack-source-link-<path>`, `wk-boardpack-heatmap`, `wk-boardpack-heatmap-row-<entity>`,
  `wk-boardpack-heatmap-<entity>-<band>`, `wk-boardpack-gantt`, `wk-boardpack-gantt-window`,
  `wk-boardpack-gantt-row-<i>`, `wk-boardpack-gantt-bar-<i>`, `wk-boardpack-gantt-legend`.
- **States:** a role without `view_board_pack` sees nothing. Loading, an empty history ("No pack yet"),
  an inline error, and the open pack. The PDF and PPTX buttons are disabled until `app_base_url` is
  set, with `wk-boardpack-url-missing` shown. The SIRA section renders the entity x band heatmap
  (migration 0099) and the plan section renders the dated Gantt; a source figure with a resolvable ref
  becomes a drill-down link.
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
  and may compare a dropped JSON or PDF hash in the browser. It also checks a report graph root (W10.3).
- **Route:** `/verify/:id` (certificate), `/pack/:id` (Board Pack) and `/root/:hash` (report graph root), outside the auth guard.
- **Rights:** none. The page calls exactly one of the three anon-callable RPCs.
- **Data:** `verifyCertificate(certificateId)`, `verifyBoardPack(packId)`, `verifyReportRoot(root)`
  (`src/data/certificate.ts`); `parseDroppedDocument`, `matchesHash`, `statusLabel`
  (`src/lib/certificate.ts`).
- **Testids:** `wk-verify`, `wk-verify-loading`, `wk-verify-error`, `wk-verify-status`,
  `wk-verify-not-found`, `wk-verify-rate-limited`, `wk-verify-organisation`, `wk-verify-title`,
  `wk-verify-issued`, `wk-verify-workpapers`, `wk-verify-findings`, `wk-verify-hash`, `wk-verify-drop`,
  `wk-verify-file`, `wk-verify-drop-error`, `wk-verify-drop-result`, and for the report-root kind
  (W10.3) `wk-verify-model`, `wk-verify-engine`, `wk-verify-template`, `wk-verify-phrases`.
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
  `wk-timetravel-diff-<id>`, `wk-timetravel-event-<action>`., `wk-timetravel-asof`, `wk-timetravel-seal`
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

---

## Appendix B — the core audit workspace, auth and chrome

The Appendix A ids above cover the Super Admin, Org Admin, Board Pack, Certificate and External auditor
surfaces. Appendix B documents the screens those ids never covered: the core audit workspace built in
Phases 3 onward (Dashboard, Work Queue, Audit Universe, Audit Plan, SIRA, the Audit File and its views,
the Issues & CAP Register), the auth screens, the shared chrome, and the admin/Super Admin panels added
by SCALE-1 (cross-universe sharing, guided provisioning, activity/export, import, org settings).
They follow the same rules as Appendix A: every interactive element carries
data-testid="<screenId>-<element>", data comes through src/data/*.ts, and no screen is a blocking modal.

## DB-01 — Executive Dashboard (S1)

The landing tab: portfolio tiles (engagements, CAPs, findings, seals), a CAP radial tracker, the CAP table, the engagement Gantt and the Board Pack block, all scoped to the session's universes.

- **Route:** Tab `executive` (nav strip "Dashboard"). Not a route.
- **Rights:** any signed-in member; each tile degrades to its empty state when the scope holds no records.
- **Data:** `AlertCircle`, `CheckCircle2`, `ChevronRight`, `Clock`, `ExternalLink`, `ShieldCheck`, `X`, `motion`, `updatePlanItemDates` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `gantt-approve-shift`, `gantt-shift-error`, `DB-01-cap-hub-drilldown`, `DB-01-tile-entities`, `DB-01-tile-engagements`, `DB-01-tile-issues`, `DB-01-tile-workpapers`, `DB-01-activity-spine`, `DB-01-activity-spine-transport`, `DB-01-activity-spine-empty`, `DB-01-activity-spine-list`
- **States:** loading (skeleton tiles); empty (no engagements in scope); ready; the Board Pack block carries its own loading/empty/error states. The activity spine carries its own quiet empty state ("Nothing has happened yet").
- **Drilldown (E5/U1):** every tile number opens the exact scoped/filtered records it was counted from, in the non-blocking `DrilldownPanel` (`role="complementary"`, testid prefix `DB-01-drilldown`). The CAP hub number (`DB-01-cap-hub-drilldown`) drills to its CAPs. The open family is mirrored to the URL hash (`#drill=<kind>`) so a state is deep-linkable; the hash carries only the family name, never a tenant id.
- **Live activity spine (U4):** a quiet stream of the organisation's recent activity (actor, verb, subject, age) on the existing `liveSync` transport — Realtime when a socket is available, a bounded poll otherwise. The sentence and the kind are the pure `src/lib/activitySpine.ts` layer; the read is the rights-gated `activity_spine_list` RPC (migration 0116), which reduces `detail` to the fields a sentence needs and drops the rest (Law L2). A scoped member gets the empty state, never an error.
- **Tutorial key:** oa.boardpack-use (the Board Pack block)

## DB-02 — Deterministic capability library (D1-D4)

The screen surface for the twenty deterministic capabilities across four families (risk and control, population and evidence, process and governance, assurance operations). Each is a pure function under `src/lib/capabilities/`; the panel hands one call site (`evaluateCapability`) the rows the caller may see, the organisation's thresholds and the current day.

- **Route:** The capability block on the Dashboard tab (`executive`), below the Board Pack block.
- **Rights:** any signed-in member reads the families their scope allows; `edit_config` to change the thresholds.
- **Data:** `capability_config_get`, `capability_config_save`, `capability_run_record`, `capability_runs_list` — through `src/data/capabilities.ts`; components never import the database client (rule M8). With no Supabase environment the panel says "not configured" rather than showing a wall of zeros.
- **Testids:** `DB-02-panel`, `DB-02-unconfigured`, `DB-02-record`, `DB-02-kind-risk_control`, `DB-02-kind-population_evidence`, `DB-02-kind-process_governance`, `DB-02-kind-assurance_ops`, `DB-02-kind-summary`, `DB-02-list`, `DB-02-cap-<id>`, `DB-02-cap-<id>-toggle`, `DB-02-cap-<id>-headline`, `DB-02-cap-<id>-status`, `DB-02-cap-<id>-rule`, `DB-02-cap-<id>-needs`, `DB-02-cap-<id>-rows`, `DB-02-cap-<id>-refs-<i>`, `DB-02-tolerance`, `DB-02-sample`, `DB-02-ageing`, `DB-02-save`, `DB-02-save-denied`, `DB-02-runs`, `DB-02-runs-empty`, `DB-02-message`, `DB-02-error`, `DB-02-explain`
- **States:** loading; unconfigured (no tenant database — says so, never a wall of zeros); ready; per-capability `ready` (findings), `empty` (an honest clean result) and `awaiting_input` (names the missing input).
- **Explain (E1/E2):** the panel carries the `screen.DB-02` explain affordance and the IIA standards affordance for the screen.
- **Determinism (L1):** no model call; every finding names the rule that produced it and the records behind it. A run records the input hash and the derived findings, never the tenant rows (L2).
- **Tutorial key:** —

## WQ-01 — Work Queue (S1)

The user-specific queue: my workpapers, what awaits my sign-off, what awaits my approval and (for a manager) the team's open work, built by the pure `src/lib/workQueue.ts` module.

- **Route:** Tab `pending` (nav strip "Work Queue").
- **Rights:** any signed-in member; each section is filtered by the caller's rights.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `pending-comments`, `tab-pending`, `WQ-01-front-door`, `WQ-01-front-door-count`, `WQ-01-front-door-summary`, `WQ-01-front-door-empty`, `WQ-01-front-door-list`
- **States:** loading; empty per section ("Nothing awaiting you"); ready; error inline.
- **Front door (U3):** the first element on the tab is the consequence-ordered list of what needs this user today, built by the pure `src/lib/frontDoor.ts` rule (overdue CAP → overdue audit → approval → sign-off → comment → open workpaper). Each row is one click from its action; the summary line reads in the spec's shape ("3 CAPs overdue. 1 report awaiting your approval."). Rows carry `data-front-door-kind`. Never a chart, never a modal.
- **Tutorial key:** —

## AU-01 — Audit Universe (S1)

The universe and entity heatmap (spec §6): every entity card shows its approval status and opens the entity-approval inspector.

- **Route:** Tab `universe` (nav strip "Audit Universe").
- **Rights:** any member reads; `edit_config` to add an entity.
- **Data:** `Activity`, `AlertTriangle`, `ArrowRight`, `EntityRow`, `Layers` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `add-entity-form`, `add-entity-open`, `db-entities`
- **States:** loading; empty (no universes/entities); ready; denied on the add form without `edit_config`.
- **Tutorial key:** —

## AU-02 — Entity approval inspector (S1)

Submit an entity for approval, approve or reject it, and read its append-only approval history; the decision is re-checked in the database.

- **Route:** The `entity_approval` inspector window, opened from an entity card.
- **Rights:** `perform_work` to submit; `manage_engagements`/`approve_plan`/`review_and_approve` to decide.
- **Data:** `EntityHistoryEntry`, `EntityRow`, `entityHistory`, `submitEntity` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `entity-approval`, `entity-approval-error`, `entity-approve`, `entity-check-status`, `entity-history`, `entity-history-empty`, `entity-history-loading`, `entity-pending-waiting`, `entity-reject`, `entity-status`, `entity-submit`
- **States:** loading; waiting (`entity-pending-waiting`); ready; history loading/empty; error inline.
- **Tutorial key:** —

## AP-01 — Audit Plan (S1)

The plan register for a universe: items, versions, gate outcomes, and the entry points to the planning panel, the plan-items inspector, the combined-approval inspector and the ethics sign-off.

- **Route:** Tab `plan` (nav strip "Audit Plan").
- **Rights:** any member reads; the open buttons appear only with the matching right.
- **Data:** `DeploymentRequestRow`, `GateOutcomeRow`, `PlanItemRow`, `PlanVersionRow`, `latestPlanForUniverse`, `listGateOutcomes`, `listPlanItems`, `planHistory` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `engagement-signoff`, `plan-action-error`, `plan-open-combined`, `plan-open-ethics`, `plan-open-gate`, `plan-open-items`, `plan-records`, `plan-records-error`, `plan-records-gates`, `plan-records-items`, `plan-records-versions`
- **States:** loading; empty; ready.
- **Tutorial key:** —

## AP-02 — Plan items inspector (S1)

Add a plan item with a justification, see each item's approval status, and read the plan version history.

- **Route:** The `plan_items` inspector window.
- **Rights:** `manage_engagements` to add; `approve_plan` to approve an ad-hoc item.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `plan-add`, `plan-add-button`, `plan-item-list`, `plan-items`, `plan-items-empty`, `plan-justification-hint`, `plan-versions`, `plan-versions-empty`
- **States:** loading; empty (`plan-items-empty`, `plan-versions-empty`); ready.
- **Tutorial key:** —

## AP-03 — Combined approval inspector (S1)

Raise a combined deployment request across an entity's engagements, decide it, and see the SLA and escalation state.

- **Route:** The `combined_approval` inspector window.
- **Rights:** `perform_work` to raise; `approve_plan` to decide.
- **Data:** `requestCombinedDeployment` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `combined-approval`, `combined-approval-error`, `combined-approve`, `combined-decide-reason`, `combined-entity-empty`, `combined-entity-picker`, `combined-escalated`, `combined-escalated-next`, `combined-next-action`, `combined-raise`, `combined-raised`, `combined-reject`, `combined-request`, `combined-sla`, `combined-status`
- **States:** loading; empty entity picker; ready; escalated banner; error inline.
- **Tutorial key:** —

## AP-04 — Planning panel (S1)

The planning phase of an engagement: deterministic suggestions, accept/reject each, the reconciliation check, discrepancy acknowledgement with a reason, and the planning sign-off.

- **Route:** The planning view inside the Audit File window.
- **Rights:** `review_and_approve` to sign off; a caller without it sees the refusal.
- **Data:** `PlanningSuggestion`, `ReconciliationDetail`, `acknowledgeDiscrepancy`, `checkReconciliation`, `decideSuggestion`, `isPlanningSignedOff`, `reconciliationDetail`, `signPlanning` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `planning-ack`, `planning-ack-reason`, `planning-error`, `planning-go-sira`, `planning-import-rcm`, `planning-loading`, `planning-mismatch`, `planning-mismatch-item`, `planning-panel`, `planning-reconciliation`, `planning-signed-off`, `planning-signoff`, `planning-signoff-reason`, `planning-suggestions-empty`
- **States:** loading; suggestions empty; mismatch list; signed-off; error inline.
- **Tutorial key:** —

## AP-05 — Prior-year import inspector (S1)

Bring last year's findings forward: confirm or revert each unconfirmed prior-year item, each with its own status.

- **Route:** The `import_wizard`/prior-year inspector window.
- **Rights:** `manage_engagements`.
- **Data:** `PriorYearImportRow`, `PriorYearItemType`, `importPriorYearItem`, `listPriorYearImports`, `revertPriorYearItem`, `unconfirmedPriorYearImports` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `prior-year-controls`, `prior-year-empty`, `prior-year-error`, `prior-year-import`, `prior-year-loading`, `prior-year-panel`, `prior-year-unconfirmed`
- **States:** loading; empty; unconfirmed list; ready.
- **Tutorial key:** —

## AP-06 — Deploy from the plan (owner 2026-10-30)

The file owner and the deployment of an engagement from a plan item. Deploy when the plan is due; an
earlier deployment needs a reason and the approval of the organisation's configured role. The
deterministic consequences for the audit calendar, the board pack and the plan are shown as
suggestions — DATA to act on, never an automatic write to another surface.

- **Route:** Audit Plan header button `Deploy from plan` (`plan-open-deployment`), the
  `deployment_plan` inspector window.
- **Rights:** `manage_engagements` to name a file owner or deploy; the org's configured
  `engagement_gate_settings.approve_right` (default `approve_plan`) to approve an early deployment.
- **Data:** `deployFromPlan`, `decideDeployment`, `setFileOwner`, `listFileOwners`, `listDeployments`,
  `listDeploymentSuggestions` (`src/data/planDeployment.ts`); `listFileOwnerAudit` (`src/data/fileOwnership.ts`).
  RPCs `engagement_deploy_from_plan`, `engagement_deployment_decide`, `engagement_file_owner_set`,
  `engagement_file_owners_list`, `engagement_deployments_list`, `deployment_suggestions_list`
  (migration 0200), `engagement_owner_audit_list` (migration 0202).
- **Testids:** `plan-open-deployment`, `deployment-plan-panel`, `deployment-plan-error`,
  `deployment-plan-notice`, `deployment-plan-owner-user`, `deployment-plan-owner-reason`,
  `deployment-plan-owner-save`, `deployment-plan-item`, `deployment-plan-date`,
  `deployment-plan-reason`, `deployment-plan-submit`, `deployment-plan-readonly`,
  `deployment-plan-loading`, `deployment-plan-pending-empty`, `deployment-plan-pending-<id>`,
  `deployment-plan-pending-reason-<id>`, `deployment-plan-decision-reason-<id>`,
  `deployment-plan-approve-<id>`, `deployment-plan-refuse-<id>`, `deployment-plan-suggestions-empty`,
  `deployment-plan-suggestions-<id>`, `deployment-plan-suggestion-<id>-<target>`,
  `deployment-plan-owners-empty`, `deployment-plan-owner-<id>`, `deployment-plan-owner-audit-loading`,
  `deployment-plan-owner-audit-empty`, `deployment-plan-owner-audit`,
  `deployment-plan-owner-audit-<id>`, `deployment-plan-owner-audit-flag-<id>`.
- **States:** loading; read-only without `manage_engagements` (`deployment-plan-readonly`); no pending
  early deployment (`deployment-plan-pending-empty`); an early deployment refused for a short reason;
  an early deployment held for approval; an inline error on a refused write (`deployment-plan-error`);
  no audit file yet (`deployment-plan-owner-audit-empty`); a file whose owner was named by default
  (`deployment-plan-owner-audit-flag-<id>`).
- **Tutorial key:** none (no key is claimed until the media exists).

## AP-07 — Prior-year roll-forward &amp; export check (owner 2026-10-30)

Roll a prior engagement's workpapers forward and check that each has a recorded export. Only a person
with prior-year access to the source engagement may build the roll-forward or run the check; the
database refuses the request by name otherwise.

- **Route:** Audit Plan header button `Prior-year roll-forward` (`plan-open-rollforward`), the
  `prior_year_rollforward` inspector window.
- **Rights:** `manage_engagements` to build; prior-year access (the scope predicate
  `prior_year_access_ok`) to the source engagement.
- **Data:** `buildRollForward`, `exportCheck`, `listRollForwards`, `priorYearAccessOk`, `logExport`
  (`src/data/priorYearRollforward.ts`). RPCs `prior_year_rollforward_build`,
  `prior_year_export_check`, `prior_year_rollforwards_list`, `prior_year_access_ok` (migration 0201).
- **Testids:** `plan-open-rollforward`, `prior-year-rollforward-panel`,
  `prior-year-rollforward-error`, `prior-year-rollforward-notice`,
  `prior-year-rollforward-target`, `prior-year-rollforward-source`,
  `prior-year-rollforward-build`, `prior-year-rollforward-access`,
  `prior-year-rollforward-readonly`, `prior-year-rollforward-complete`,
  `prior-year-rollforward-incomplete`, `prior-year-rollforward-counts`,
  `prior-year-rollforward-missing-<id>`, `prior-year-rollforward-export-<id>`,
  `prior-year-rollforward-loading`, `prior-year-rollforward-empty`,
  `prior-year-rollforward-row-<id>`.
- **States:** loading; read-only without `manage_engagements` (`prior-year-rollforward-readonly`);
  no roll-forward yet (`prior-year-rollforward-empty`); access refused for the chosen source
  (`prior-year-rollforward-access`); check complete/incomplete; an inline error on a refused write.
- **Tutorial key:** none (no key is claimed until the media exists).

## SR-01 — SIRA (S1)

The Strategic Internal Risk Assessment (spec §7): the risk table, the persisted model/cycles/plan snapshot, and the entry points to the model editor and cycle inspector.

- **Route:** Tab `sira` (nav strip "SIRA").
- **Rights:** any member reads; the open buttons gate on the matching right.
- **Data:** `PlanRow`, `PlanVersionRow`, `SiraCycle`, `SiraEmergentRisk`, `SiraModel`, `latestPlanForUniverse`, `listEmergentRisks`, `planHistory`, `siraModelSnapshot` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `sira-load-error`, `sira-open-cycles`, `sira-open-model`, `sira-persisted`, `sira-persisted-cycles`, `sira-persisted-model`, `sira-persisted-plan`, `sira-table`, `tab-sira`
- **States:** loading; empty; persisted/not-persisted banner; ready.
- **Tutorial key:** —

## SR-02 — SIRA model editor (S1)

Edit the SIRA model: aggregation, factors and bands; a locked model is read-only.

- **Route:** The `sira_model` inspector window.
- **Rights:** `edit_config`.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `sira-aggregation`, `sira-bands`, `sira-factors`, `sira-model`, `sira-model-empty`, `sira-model-locked`, `sira-model-version`
- **States:** loading; empty (`sira-model-empty`); locked (`sira-model-locked`); ready.
- **Tutorial key:** —

## SR-03 — SIRA cycles inspector (S1)

Create a SIRA cycle, score it, publish the cycle, decide emergent risks with a reason, and close
the two-key acceptance (S18/S19): the finaliser endorses a published cycle, a different auditor
accepts it, and the next cycle is blocked while proposals are outstanding. The scoring panel is the
surface that DRIVES the SIRA write path (`recordSiraScore`, `submitEmergentRisk`).

- **Route:** The `sira_cycles` inspector window.
- **Rights:** `manage_engagements` to create/publish/endorse/score; `review_and_approve` to decide an emergent risk and to accept.
- **Data:** `createSiraCycle`, `publishSiraCycle`, `recordSiraScore`, `submitEmergentRisk`, `decideEmergentRisk`, `proposeEmergentRisks`, `carryForwardPack`, `seedNextCycle`, `endorseSiraCycle`, `decideSiraAcceptance`, `remindSiraAcceptance`, `siraAcceptanceState`, `siraPublishBlock`, `listCycles`, `listCarryForward`, `listEmergentRisks`, `listRisks`, `listScores`, `siraModelSnapshot` (`src/data/sira.ts`); the pure rule `scoreMatrix`/`summariseCycle`/`validateFactorValues`/`previewScore`/`emergentRiskIsValid` (`src/lib/siraScoring.ts`) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `emergent-empty`, `emergent-risks`, `emergent-submit`, `emergent-submit-description`, `emergent-submit-locked`, `emergent-submit-title`, `sira-carry-forward-chain`, `sira-carry-forward-`, `sira-create-cycle`, `sira-cycle-panel`, `sira-cycles`, `sira-cycles-empty`, `sira-cycles-inspector`, `sira-cycles-unscoped`, `sira-pack-`, `sira-record-score`, `sira-remind`, `sira-score-entity`, `sira-score-list`, `sira-score-preview`, `sira-score-risk`, `sira-scoring-frozen`, `sira-scoring-locked`, `sira-scoring-no-cycle`, `sira-scoring-no-model`, `sira-scoring-panel`, `sira-scoring-summary`, `sira-seed-`
- **States:** loading; empty (`sira-cycles-empty`, `emergent-empty`); unscoped (`sira-cycles-unscoped`); ready; publish blocked; awaiting acceptance; pack built; the persisted carry-forward chain (`sira-carry-forward-chain`); scoring with no draft cycle (`sira-scoring-no-cycle`), a frozen cycle (`sira-scoring-frozen`), no model (`sira-scoring-no-model`), locked (`sira-scoring-locked`).
- **Drilldown (E5/U1):** the score list (`sira-score-list`) names the exact entity × risk cells behind the cycle's scored count.
- **Tutorial key:** —

## AF-01 — Audit File window (S1)

The engagement workspace: a floating, non-modal window whose view switch opens Planning, Execution, Review, Population, Sampling, Row testing, Conclusion, Ethics, Findings, Documents, the Deployment gate, the Analyst engine, the Certificate, the Report editor, the Report builder, the CAPs and the Time-Travel/As-of view.

- **Route:** The `audit_file` floating window, opened from an engagement card; the tab is `audit_file`.
- **Rights:** any member reads; each view gates on its own right and shows the refusal otherwise.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `audit-file`, `audit-file-advance-stage`, `audit-file-as-of`, `audit-file-builder`, `audit-file-caps`, `audit-file-certificate`, `audit-file-conclusion`, `audit-file-documents`, `audit-file-export`, `audit-file-findings`, `audit-file-report`, `audit-file-stage`, `audit-file-stage-error`, `audit-file-unavailable`, `audit-file-workspace`, `tab-audit-file`, `workbench-action-error`, `workbench-signoff`
- **States:** loading; unavailable (`audit-file-unavailable`); ready; per-view empty states.
- **Tutorial key:** —

## AF-02 — Audit File — Planning view (S1)

The planning view: the RCM rows, SIRA coverage and any coverage gap.

- **Route:** Audit File window, view "Planning" (`audit-file-view-planning`).
- **Rights:** any member reads.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `audit-file-planning`, `planning-coverage-summary`, `planning-empty`, `planning-no-entity`, `planning-sira`
- **States:** loading; no-entity (`planning-no-entity`); empty; ready.
- **Tutorial key:** —

## AF-03 — Audit File — Execution view (S1)

The execution view: workpaper rows and their status.

- **Route:** Audit File window, view "Execution" (`audit-file-view-execution`).
- **Rights:** any member reads.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `audit-file-execution`, `execution-empty`
- **States:** loading; empty (`execution-empty`); ready.
- **Tutorial key:** —

## AF-04 — Audit File — Review view (S1)

The review view: the sign-off gate count, the signed-off note, the sign-off reason, the report-pack placeholder and the change-control panel.

- **Route:** Audit File window, view "Review" (`audit-file-view-review`).
- **Rights:** `review_and_approve`.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `audit-file-review`, `gate-count`, `report-pack-placeholder`, `signed-off-note`, `signoff-button`, `signoff-error`, `signoff-reason`, `wk-changes`
- **States:** loading; ready; the change-control panel carries its own states.
- **Tutorial key:** —

## AF-05 — Population panel (S1)

Register a population file, show its SHA-256 hash, and lock the population (hold-to-confirm); a locked population is immutable.

- **Route:** Audit File window, view "Population" (`audit-file-view-population`).
- **Rights:** `perform_work`.
- **Data:** `PopulationProfile`, `PopulationRecordRead`, `PopulationRow`, `listPopulationRecords`, `lockPopulation`, `populationProfile`, `registerPopulation`, `sha256Hex` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `population-browse`, `population-dropzone`, `population-empty`, `population-error`, `population-file-input`, `population-hash`, `population-loading`, `population-panel`, `population-register`, `population-gate`, `population-status`, `population-profile-<id>`, `population-profile-view-<id>`, `population-profile-summary-<id>`, `population-profile-flags-<id>`, `control-total`, `population-errors`, `gate-message`, `finalize-test`, `header-confirm`, `header-confirm-0`
- **States:** loading; empty; hashed; locked; profile loading; profile ready (row count, value coverage, duplicate density, period, flags); error inline; header detected and awaiting confirmation (S2 — the engine proposes the header row, the auditor confirms it, rows above it are ignored and the header row is not counted).
- **Tutorial key:** —

## AF-06 — Sampling panel (S1)

Compute a deterministic sample (seed preview, mode, floor), paste an id list, and lock the sample; a locked sample is read-only.

- **Route:** Audit File window, view "Sampling" (`audit-file-view-sampling`).
- **Rights:** `perform_work`.
- **Data:** `SampleMode`, `SampleRow`, `SamplingRuleRow`, `computeSample`, `getSample`, `getSampleSize`, `lockSample` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `sampling-calculation`, `sampling-compute`, `sampling-coverage`, `sampling-coverage-status`, `sampling-current`, `sampling-error`, `sampling-floor`, `sampling-loading`, `sampling-lock`, `sampling-locked`, `sampling-method`, `sampling-no-workpaper`, `sampling-panel`, `sampling-paste`, `sampling-paste-count`, `sampling-precision`, `sampling-rules-empty`, `sampling-seed-preview`, `sampling-tested-rows`, `sampling-waive-reason`
- **States:** loading; no workpaper (`sampling-no-workpaper`); no rules (`sampling-rules-empty`); computed (`sampling-method`, `sampling-calculation`); high-value coverage (`sampling-coverage`, `sampling-coverage-status`; a missing item can be waived with a reason, `sampling-waive-reason`); exact interval (`sampling-precision`); tested rows from the sample (`sampling-tested-rows`); locked (`sampling-locked`); error inline.
- **Tutorial key:** —

## AF-06b — Working-paper creation (S1)

Create the working paper the testing workspace runs against. Before migration 0116 no path created one, so
the sampling and row-testing panels had nothing to bind to and rendered nothing in production. The form
opens in place; the database's refusals (no `perform_work`, a sealed engagement, planning not signed off)
are shown inline.

- **Route:** Audit File window, view "Testing workspace" (`audit-file-workspace`).
- **Rights:** `perform_work` to create.
- **Data:** `createWorkpaper` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `workpaper-create-cancel`, `workpaper-create-error`, `workpaper-create-open`, `workpaper-create-panel`, `workpaper-create-reason`, `workpaper-create-submit`, `workpaper-title`
- **States:** closed; open; busy; error inline; denied (`workpaper-create-reason`).
- **Tutorial key:** —

## AF-07 — Row testing panel (S1)

Record each sampled row's result and rationale, mark an exception, sign off the workpaper with a reason, and reopen it.

- **Route:** Audit File window, view "Row testing" (`audit-file-view-rowtesting`).
- **Rights:** `perform_work` to record; `review_and_approve` to sign off; `can_reopen` to reopen.
- **Data:** `RowResult`, `WorkpaperRowRow`, `getWorkpaper`, `recordRow`, `reopenWorkpaper`, `signOffWorkpaper` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `rowtesting-empty`, `rowtesting-error`, `rowtesting-justification`, `rowtesting-loading`, `rowtesting-no-workpaper`, `rowtesting-panel`, `rowtesting-preflight`, `rowtesting-reopen`, `rowtesting-signed-off`, `rowtesting-signoff`, `rowtesting-signoff-reason`
- **States:** loading; no workpaper (`rowtesting-no-workpaper`); empty; signed-off; preflight note; error inline.
- **Tutorial key:** —

## AF-08 — Conclusion panel (S1)

Pull the testing exceptions, read the pulled-at stamp and the pre-flight state, and sign the conclusion (hold-to-confirm) with a reason; a locked conclusion is immutable.

- **Route:** Audit File window, view "Conclusion" (`audit-file-view-conclusion`).
- **Rights:** `review_and_approve`.
- **Data:** `ConclusionRecord`, `pullExceptions`, `signConclusion`, `testingSignedOff` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `conclusion-error`, `conclusion-exceptions`, `conclusion-exceptions-empty`, `conclusion-loading`, `conclusion-locked`, `conclusion-panel`, `conclusion-preflight`, `conclusion-pull`, `conclusion-pulled-at`, `conclusion-sign`, `conclusion-sign-reason`
- **States:** loading; exceptions empty; locked; error inline.
- **Tutorial key:** —

## AF-09 — Ethics panel (S1)

The ethics independence declaration: every listed member acknowledges; the panel shows who is still pending.

- **Route:** Audit File window, view "Ethics" (`audit-file-view-ethics`); also the `ethics` inspector.
- **Rights:** `perform_work` to acknowledge.
- **Data:** `ethicsStatus` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `ethics-empty`, `ethics-error`, `ethics-members`, `ethics-panel`
- **States:** loading; empty; pending members; ready.
- **Tutorial key:** —

## AF-10 — Findings panel (S1)

Turn observations into findings: create an observation, promote it to a finding, and raise an issue; the severity legend is shown.

- **Route:** Audit File window, views "Findings"/"Documents" (`audit-file-view-findings`, `audit-file-view-documents`).
- **Rights:** `perform_work`.
- **Data:** `IssueRow`, `MANDATORY_SECTIONS`, `ObservationRow`, `SeverityLevelRow`, `createIssue`, `listIssues`, `listSeverityLevels`, `missingReadabilitySections`, `promoteToFinding` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `findings-empty`, `findings-error`, `findings-loading`, `findings-panel`, `issue-create`, `issue-title`, `issues-empty`, `severity-legend`
- **States:** loading; empty (`issues-empty`); ready; error inline.
- **Tutorial key:** —

## AF-11 — Document viewer (S1)

Search the engagement's evidence documents, extract text on request, and read the extraction hits.

- **Route:** Audit File window, view "Documents" (`audit-file-view-documents`).
- **Rights:** any member reads.
- **Data:** `DocumentHit`, `DocumentStage`, `EvidenceFileRow`, `isDocumentStage`, `listEvidenceFiles`, `requestExtraction`, `searchDocuments` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `document-empty`, `document-error`, `document-list`, `document-list-empty`, `document-list-toggle`, `document-loading`, `document-results`, `document-search`, `document-viewer`
- **States:** loading; empty; search results; error inline.
- **Tutorial key:** —

## AF-15 — Evidence vault (workpaper) (S20)

The evidence vault inside a workpaper's workbench: upload a file, see every stored artifact with its
SHA-256, re-derive the hash from the stored bytes to verify, and download through a short-lived
signed URL. When no storage bucket is wired the screen says "session only" honestly rather than
claiming a hash-lock it cannot keep.

- **Route:** the `workbench` inspector window, sub-tab "Evidence Vault".
- **Rights:** `perform_work` to upload; any member of the org reads.
- **Data:** `EVIDENCE_MAX_BYTES`, `EvidenceFileRow`, `evidenceSignedUrl`, `evidenceStorageReady`, `listEvidenceFiles`, `uploadEvidence`, `verifyEvidenceFile` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `evidence-error`, `evidence-storage-note`, `evidence-upload`
- **States:** loading; session-only (no bucket); empty; stored; verifying; verified; mismatch.
- **Tutorial key:** —

## AF-16 — Systeligon rule run (S1, S6, S13)

Run the deterministic forensic rules over a locked population or the organisation's own
configuration, read every finding with the rule id, its version, its scope, its severity and the
exact source rows it flagged, and record the run to the ledger so the findings sit inside the
report's tamper-evident root. Nothing is generated and nothing is guessed: a missing amount is
reported as missing, not as zero, a draft rule is skipped until a qualified human releases it, and a
scope with no input yields no findings rather than an invented one.

The run is sealed with its **scope** (spec §5): the surface offers the scopes the shipped rule base
covers (population, config, …), and each finding records the scope it was found under, so a
population finding and a config finding of the same rule can never be conflated in a sealed report.

Below the findings sits the **accepted/declined testing flow and Mode A/B verification** (S3/S4/S5/
S12, spec §2.2/§2.3/§6): the rows the findings named are the rows that *require* evidence; the
accepted flow builds exactly those, the declined flow fixes a floor that is a minimum and never a
ceiling; verification under Mode A (completeness) or Mode B (evidence vs remark) fails closed on an
open row, a blank remark or a missing piece of evidence, and an override — a row closed despite a
failed verification and carrying a remark — is carried forward and shown.

- **Route:** the `workbench` inspector window, sub-tab "Rule Run".
- **Rights:** `perform_work` to run, to record, to build the tested set and to verify; any member of
  the org reads.
- **Data:** `PopulationRow`, `PopulationRecordRead`, `ConfigSource`, `EvidenceRecord`,
  `RuleFinding`, `RuleInput`, `RuleRunResult`, `TestedRow`, `RowVerification`, `CarriedOverride`,
  `listPopulationRecords`, `listPopulations`, `listConfigSources`, `listEvidenceRecords`,
  `recordSysteligonFindings`, `runRules`, `systeligonRuleLibrary`, `systeligonScopes`,
  `buildAcceptedTestingSet`, `applyFloor`, `parsePastedBlock`, `verifyRows`, `carriedOverrides` —
  through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `rule-run`, `rule-run-empty`, `rule-run-error`, `rule-run-finding-<i>`, `rule-run-findings`, `rule-run-findings-empty`, `rule-run-loading`, `rule-run-pack-note`, `rule-run-population`, `rule-run-record`, `rule-run-recorded`, `rule-run-rights-note`, `rule-run-run`, `rule-run-scope`, `rule-run-scope-note`, `rule-run-skipped`, `rule-run-summary`, `flow-verify`, `flow-verify-rights-note`, `flow-verify-error`, `flow-verify-flow`, `flow-verify-floor`, `flow-verify-mode`, `flow-verify-build`, `flow-verify-note`, `flow-verify-paste`, `flow-verify-paste-apply`, `flow-verify-rows`, `flow-verify-row-<i>`, `flow-verify-verify`, `flow-verify-result`, `flow-verify-failed`, `flow-verify-fail-<ref>`, `flow-verify-overrides`
- **States:** loading; no population (`rule-run-empty`); reading rows; running; findings; none flagged (`rule-run-findings-empty`); recorded; error inline; the flow's empty set, its verified and not-verified counts, and the carried overrides.
- **Tutorial key:** —

## AF-12 — Deployment gate (S1)

Run the deployment gate for an engagement: the ordered steps, each outcome, the required right, and the next action.

- **Route:** The `deployment_gate` inspector window.
- **Rights:** `manage_engagements`.
- **Data:** `GateResult` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `deployment-gate`, `deployment-gate-empty`, `deployment-gate-run`, `gate-deploy`, `gate-deploy-error`, `gate-go-plan`, `gate-go-universe`, `gate-next-action`, `gate-open-combined`, `gate-outcome`, `gate-required-right`, `gate-step`, `gate-view-engagement`
- **States:** loading; empty (`deployment-gate-empty`); running; outcome; error inline.
- **Tutorial key:** —

## AF-13 — Analyst engine (S1)

Run the deterministic analytics checks over the population and raise a finding from a result.

- **Route:** The `analytics` inspector window.
- **Rights:** `perform_work`.
- **Data:** `AnalysisResultRow`, `raiseFinding` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `analyst-empty`, `analyst-error`, `analyst-loading`, `analyst-panel`
- **States:** loading; empty (`analyst-empty`); result per check; error inline.
- **Tutorial key:** —

## AF-14 — Report editor (S1)

Compose the engagement report from its sections and blocks, comment on a block, incorporate or reject each comment, read the central pre-flight (comments, CAPs, acknowledgements), acknowledge a blocker with a reason, freeze the report and render the PDF/DOCX files, preview the frozen footer line, and drill into the committed evidence-bound claim graph.

- **Route:** Audit File window, view "Report" (`audit-file-view-report`).
- **Rights:** `perform_work` to compose/comment; `approve_plan` to freeze.
- **Data:** `CapRow`, `ReportBlockRow`, `ReportCommentRow`, `ReportFileInput`, `ReportGraphView`, `ReportVersionRow`, `StoredReportFiles`, `acknowledgePreflight`, `addReportComment`, `checkCapReconciliation`, `commitReportGraph`, `freezeReport`, `getActiveReportLayout`, `getReportGraph`, `issueReport`, `listCaps`, `listPreflightAcknowledgements`, `listPreflightBlocking`, `listPreflightItems`, `listReportBlocks`, `listReportComments`, `listReportVersions`, `openReportCommentCount`, `renderAndStoreReportFiles`, `reportFooterPreview`, `resolveReportComment` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `report-caps-note`, `report-comment-add`, `report-comment-input`, `report-comments`, `report-comments-empty`, `report-compose`, `report-editor`, `report-empty`, `report-error`, `report-file-docx`, `report-file-pdf`, `report-files`, `report-footer-preview`, `report-freeze`, `report-freeze-blocked`, `report-freeze-panel`, `report-graph-close`, `report-graph-empty`, `report-graph-open`, `report-graph-panel`, `report-issue`, `report-loading`, `report-notice`, `report-open-comments`, `report-placeholder-count`, `report-preflight-ack-check`, `report-preflight-ack-form`, `report-preflight-ack-item`, `report-preflight-ack-reason`, `report-preflight-ack-submit`, `report-preflight-acks`, `report-preflight-blocking`, `report-preflight-caps`, `report-preflight-comments`, `report-preflight-item-list`, `report-rights-note`, `report-section-empty`, `report-versions`
- **States:** loading; empty; comments; pre-flight; freeze blocked; frozen; error inline.
- **Tutorial key:** —

## IR-01 — Issues & CAP Register (S1)

The issue register: the heat matrix (severity by age, by department), the CAP register section, and the view switch to Patterns.

- **Route:** Tab `issues` (nav strip "Issues & CAP Register"); views via `issues-view-<view>`.
- **Rights:** any member reads; patterns configuration needs `edit_config`.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `cap-engagement-picker`, `cap-no-engagement`, `issues-cap-register-section`
- **States:** loading; empty; ready; per-view states.
- **Tutorial key:** oa.patterns-config (the Patterns view)

## IR-02 — CAP register panel (S1)

Read every corrective action for an engagement: its status, the action to transition it, the evidence attachment and the reconciliation check.

- **Route:** Inside the Issues & CAP Register, the CAP register section (`issues-cap-register-section`).
- **Rights:** `perform_work` to act; `review_and_approve` to close.
- **Data:** `CapRow`, `CapStatus`, `closeCap`, `updateCap` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `cap-empty`, `cap-error`, `cap-loading`, `cap-register`
- **States:** loading; empty; no-engagement picker; ready; error inline.
- **Tutorial key:** —

## IR-03 — Finding drilldown (S1)

The full finding: severity, title, entity, and the links back to the department, the audit and the workpaper.

- **Route:** The `finding` inspector window.
- **Rights:** any member reads.
- **Data:** `FindingDetailRow`, `getFindingDetail` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `finding-drilldown`, `finding-drilldown-entity`, `finding-drilldown-error`, `finding-drilldown-loading`, `finding-drilldown-severity`, `finding-drilldown-title`, `finding-drilldown-unavailable`
- **States:** loading; unavailable; ready.
- **Tutorial key:** —

## IR-04 — Observation drilldown (S1)

The observation drill-down: the department, the audit and the workpaper behind it.

- **Route:** The `observation` inspector window.
- **Rights:** any member reads.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `finding-audit`, `finding-department`, `finding-workpaper`, `observation-form-error`
- **States:** loading; ready.
- **Tutorial key:** —

## IR-05 — CAP inspector (S1)

Inspect a single CAP: attach evidence and edit it, with the form error surfaced inline.

- **Route:** The `cap_inspector` inspector window.
- **Rights:** `perform_work`.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `cap-confirm-close`, `cap-evidence-file`, `cap-form-error`
- **States:** ready; form error.
- **Tutorial key:** —

## AX-01 — Sign-in screen (S1)

The single sign-in form for every audience; a session with no org lands on the no-tenant screen instead.

- **Route:** The unauthenticated shell (any route with no session).
- **Rights:** none (unauthenticated).
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `signin-error`, `signin-form`, `signin-screen`
- **States:** ready; submitting; error inline.
- **Tutorial key:** —

## AX-02 — No-tenant screen (S1)

Shown to a signed-in account that belongs to no organisation: it explains the state and offers a refresh.

- **Route:** The authenticated shell when the session has no org.
- **Rights:** any signed-in account with no org.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `no-tenant-refresh`, `no-tenant-screen`
- **States:** ready; refreshing.
- **Tutorial key:** —

## CH-01 — Navigation strip (S1)

The primary tab bar: Dashboard, Work Queue, Audit Universe, Audit Plan, SIRA, Audit Files, Issues & CAP Register; tabs are reorderable and collapse to icons at narrow widths.

- **Route:** Rendered on every authenticated screen below the header.
- **Rights:** each tab is shown only when the session has the right for it.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `nav-draggable-pill`, `nav-strip-track`
- **States:** ready; tabs filtered by rights.
- **Tutorial key:** —

## CH-02 — Header bar (S1)

The header: the compact search that opens the command palette, the profile menu (activity log, import, org control, people admin, shared with me), the notification bell, the calendar and the universe switcher.

- **Route:** Rendered on every authenticated screen.
- **Rights:** menu entries appear only with the matching right.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `header-search-compact`, `menu-activity-log`, `menu-import`, `menu-org-control`, `menu-people-admin`, `menu-shared-with-me`, `mobile-universe-switcher`
- **States:** ready; menu closed/open; badge hidden at zero unread.
- **Tutorial key:** —

## CH-03 — Command palette (S1)

The keyboard palette for jumping to a screen, a record, an action or an explain entry. Cmd/Ctrl-K
opens it anywhere.

- **Route:** A non-blocking dropdown anchored below the header, never a modal.
- **Rights:** any signed-in member; actions that need a right are hidden from a caller who lacks it
  (`visibleCommands`).
- **Data:** the caller's already-scoped records only (`useScopedData`, filtered through
  `src/lib/access.ts`). The palette performs no access decision of its own (Law L2); it indexes
  screens, actions and explain entries from the pure `src/lib/commandPalette.ts`.
- **Testids:** `command-palette`, `command-palette-input`, `command-palette-close`,
  `command-palette-empty`, `command-palette-explain`, `command-palette-item-<id>`,
  `command-palette-option-<id>`, `command-palette-group-<kind>`.
- **States:** hidden; open with results (screens, then actions, then explain, then records); no
  results ("No matches within your permissions."); an explain row opened inline, non-modally.
- **Tutorial key:** —


## CH-04 — Floating windows and dock (S1)

The non-modal record window (drag, resize, pop out, dock) that hosts every inspector; the dock lists minimised windows.

- **Route:** Rendered above the shell; a pop-out uses the `/view/:recordType/:id` route.
- **Rights:** the hosted inspector enforces its own right.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `floating-window-dock`
- **States:** open; docked; popped out; revision/refresh indicators.
- **Tutorial key:** —

## CH-05 — Presentation primitives (S1)

The shared presentation primitives: the hover preview popover, the hold-to-confirm control, the inline error and the labelled select.

- **Route:** Not a screen; used inside many screens.
- **Rights:** inherited from the host screen.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `hover-preview-popover`, `hover-preview-trigger`
- **States:** trigger; popover shown.
- **Tutorial key:** —

## CH-06 — Calendar (S1)

The audit calendar: the day detail panel opened from the header calendar.

- **Route:** The header calendar panel (not a tab).
- **Rights:** any member reads.
- **Data:** none (pure/UI only) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `calendar-day-detail`
- **States:** loading; day detail; empty.
- **Tutorial key:** —

## CH-07 — Review comment history and popout (S21)

The live review-comment surface: one comment's dialogue, or the full review trail across cycles. Each row carries the access-filtered hover/focus popout (author, age, workpaper, engagement, status, resolution path) and the open/cleared counts drill to the exact comments behind them. Non-blocking throughout.

- **Route:** The `comment_history` inspector window, opened from the review dock ("View full comment history") and the Work Queue.
- **Rights:** any member that may read audit working records; an observer (read-only with `view_all_scopes`) and a configuration-only principal see the redacted popout, never the text.
- **Data:** `commentPopout`, `commentAgeDays`, `ageLabel`, `canViewComment` (`src/lib/commentPopout.ts`) — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `CH-07-comment-empty`, `CH-07-comment-list`, `CH-07-comment-popout-<id>`, `CH-07-comment-search`, `CH-07-comment-cycle-filter`, `CH-07-comment-status-all`, `CH-07-comment-status-open`, `CH-07-comment-status-cleared`, `CH-07-comment-<id>`, `CH-07-comment-age-<id>`, `CH-07-comment-state-<id>`, `CH-07-comment-resolution-<id>`, `CH-07-comment-open-<id>`, `CH-07-comment-reply-input-<id>`, `CH-07-comment-reply-<id>`, `CH-07-bubble-mine`, `CH-07-bubble-other`
- **States:** single comment; full history; search; cycle filter; open/cleared filter; redacted (viewer may not read); empty ("no comments match"); drilldown open.
- **Drilldown (E5/U1):** the open/cleared counts open the exact comments behind them in the non-blocking `DrilldownPanel` (testid prefix `CH-07-drilldown`), deep-linkable via `#drill=comments`.
- **Tutorial key:** —

## CH-08 — Keyboard shortcut sheet (U8)

The `?` sheet: every shortcut the caller may use, grouped, with its key sequence. Non-blocking.

- **Route:** A `role="complementary"` panel anchored below the header, opened by `?`; never a modal.
- **Rights:** the sheet lists only the shortcuts whose right the caller holds (`groupedShortcuts`); a configuration-only principal sees no navigation rows.
- **Data:** `SHORTCUTS`, `shortcutsFor`, `groupedShortcuts`, `formatChord`, `formatSequence`, `matchShortcut`, `matchSequence` (`src/lib/keyboardShortcuts.ts`) — pure; the sheet reads no tenant data.
- **Testids:** `shortcut-sheet`, `shortcut-sheet-close`, `shortcut-sheet-list`, `shortcut-sheet-empty`, `shortcut-sheet-group-<group>`, `shortcut-sheet-item-<id>`
- **States:** closed; open with the caller's shortcuts grouped; empty (no shortcut available to the caller).
- **Tutorial key:** —

## OA-25 — Cross-universe view-only sharing (SCALE-1, §2)

Grant, view and revoke an intra-organisation, view-only share of a universe to a same-tenant member, and (in grantee mode) read the universes shared with me.

- **Route:** The Assurance control plane (`org_control` inspector), tab `sharing`; the grantee view is the `shared_with_me` inspector from `menu-shared-with-me`.
- **Rights:** `edit_config` (or a Level-1/Level-2 Head) to grant; any member to read what is shared with them.
- **Data:** `MemberRow`, `ShareRow`, `ShareWithMeRow`, `SharedUniverseView`, `UniverseRow`, `grantShare`, `listMembers`, `listShares`, `listSharesWithMe`, `listUniverses`, `revokeShare`, `setHeadLevel`, `viewSharedUniverse` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `share-grant-expiry`, `share-grant-grantee`, `share-grant-submit`, `share-grant-universe`, `share-granted-empty`, `share-panel`, `share-panel-error`, `share-panel-grant`, `share-panel-granted`, `share-panel-loading`, `share-panel-result`, `share-panel-retry`, `share-panel-view`, `share-panel-with-me`, `share-view-engagements`, `share-view-entities`, `share-view-not-live`, `share-with-me-empty`
- **States:** loading; empty (`share-granted-empty`, `share-with-me-empty`); ready; result; not-live (`share-view-not-live`); error with retry.
- **Tutorial key:** —

## OA-26 — Activity log and export (S1)

Read and filter the activity log, run an archive by period, and export a record set (with the export confirmation hash and the export history).

- **Route:** The `activity_log` inspector window and the export panel.
- **Rights:** `manage_engagements`/`perform_work`; the export panel refuses without the right.
- **Data:** `ActivityLogRow`, `ArchiveJobRow`, `ExportFormat`, `ExportLogRow`, `PopulationArchiveRow`, `archivePopulation`, `exportActivityLog`, `exportCapRegister`, `exportEngagementBundle`, `exportFullTenant`, `exportLedger`, `exportSiraResults`, `exportWorkpaper`, `listActivityLog`, `listArchiveJobs`, `listExports`, `listPopulationArchiveDue`, `listPopulationArchives`, `logExport`, `uploadArchiveJob` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `activity-archive`, `activity-archived-notice`, `activity-empty`, `activity-error`, `activity-export`, `activity-filter`, `activity-filters`, `activity-loading`, `activity-log-panel`, `activity-since`, `activity-table`, `activity-until`, `archive-jobs`, `archive-jobs-empty`, `archive-upload-<id>`, `export-confirmation`, `export-confirmation-hash`, `export-controls`, `export-denied`, `export-error`, `export-history`, `export-history-empty`, `export-history-loading`, `export-no-right`, `export-panel`, `export-run`, `population-archive-<id>`, `population-archive-row-<id>`, `population-archived-notice`, `population-archives`, `population-due-<id>`, `population-due-empty`, `population-due-list`, `population-retention`
- **States:** loading; empty; table; export confirmation; history loading/empty; no-right; population retention due/empty/archived; pending upload.
- **Tutorial key:** —

## OA-27 — Import wizard (S1)

Import a workpaper source (upload, choose file, DOCX tables), map it, validate it, preview the valid/invalid counts, and commit it; the job history is listed. The file's format is decided by its MAGIC BYTES, not its extension: a file whose bytes disagree with its name is imported under its true kind and the disagreement is shown, or refused with the real kind named.

- **Route:** The `import_wizard` inspector window.
- **Rights:** `manage_engagements`; a caller without it sees `import-no-right`.
- **Data:** `ImportJobRow`, `ImportType`, `ImportValidation`, `listImportJobs`, `startImport`, `validateImport` — through `src/data/*.ts`; components never import the database client (rule M8). The file inventory (S17) is read by `buildInventory` (`src/lib/recognition`), which sniffs magic bytes, unpacks archives under the safety limits, reads document metadata, and returns the counts the operator confirms.
- **Testids:** `import-choose-file`, `import-commit`, `import-confirm`, `import-denied`, `import-docx-tables`, `import-done`, `import-error`, `import-errors`, `import-file-input`, `import-history`, `import-history-empty`, `import-invalid-count`, `import-inventory`, `import-inventory-archive`, `import-inventory-counts`, `import-inventory-metadata`, `import-inventory-note`, `import-mapping`, `import-no-right`, `import-preview`, `import-recognised`, `import-recognition-note`, `import-steps`, `import-upload`, `import-valid-count`, `import-validate`, `import-wizard`
- **States:** no-right; upload; recognised (kind, size, SHA-256); inventory (metadata, archive members + compression ratio, refusal reason); bytes/name disagreement; mapping; validated; preview; done; history loading/empty.
- **Tutorial key:** —

## OA-28 — Org settings inspector (S1)

The organisation settings inspector: sampling, severity levels and email provider tabs.

- **Route:** The `org_settings` inspector window, from the profile menu.
- **Rights:** `edit_config`; a caller without it sees `org-settings-no-right`.
- **Data:** `EMAIL_PROVIDERS`, `EmailSettingsRow`, `SEVERITY_COLOR_TOKENS`, `SamplingRuleRow`, `SeverityLevelRow`, `deleteSeverityLevel`, `getEmailSettings`, `listSamplingRules`, `listSeverityLevels`, `setEmailProvider`, `upsertSamplingRule`, `upsertSeverityLevel` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `org-settings-denied`, `org-settings-email`, `org-settings-error`, `org-settings-loading`, `org-settings-no-right`, `org-settings-panel`, `org-settings-result`, `org-settings-sampling`, `org-settings-severity`, `org-settings-tabs`
- **States:** no-right; loading; tabs; ready.
- **Tutorial key:** —

## OA-29 — Integrity alarm (T7, §11.3a)

The tamper alarm: read the organisation's integrity alerts (severity-split by the database rule), acknowledge one, and re-verify the ledger chain on demand. A single object that fails to verify is a warning; a broken ledger chain, an invalid signature or a failed timestamp is an incident. This is tamper-evidence, never tamper-prevention: it proves that a change happened and preserves the before and after hashes.

- **Route:** The Assurance control plane (`org_control` inspector), tab `integrity`; the DB-01 dashboard banner (`DB-01-integrity-banner`) opens it.
- **Rights:** an integrity owner — `review_and_approve` or `edit_config`, or a Level-1/Level-2 Head; the database RPC re-checks the right and a caller without it is refused.
- **Data:** `IntegrityAlertRow`, `acknowledgeIntegrityAlert`, `ledgerContinuityCheck`, `listIntegrityAlerts` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `DB-01-integrity-banner`, `DB-01-integrity-banner-text`, `OA-29-alert-acknowledge-<id>`, `OA-29-alert-acknowledged-<id>`, `OA-29-alert-actual-<id>`, `OA-29-alert-expected-<id>`, `OA-29-alert-kind-<id>`, `OA-29-alert-raised-<id>`, `OA-29-alert-sentence-<id>`, `OA-29-alert-severity-<id>`, `OA-29-empty`, `OA-29-error`, `OA-29-headline`, `OA-29-icon-incident`, `OA-29-icon-ok`, `OA-29-list`, `OA-29-load-error`, `OA-29-loading`, `OA-29-panel`, `OA-29-verify-ledger`, `OA-29-verify-result`
- **States:** loading; empty (no alerts — the verified state); ready with incidents/warnings; acknowledged; verify result; error.
- **Tutorial key:** —

## OA-30 — Attestation (T3/T4/T5, §11.3)

The portable attestation package: list the organisation's signed subjects, build a self-contained package for one (roots, signatures, timestamps, the versions that scored it, the Merkle leaves and the verification instructions), export it as JSON, and verify a package — one built here or one dropped in from elsewhere — against its own contents and its embedded public keys. The verification is the same procedure the standalone verifier (`scripts/verify-attestation.mjs`) implements, so an outsider can re-derive the root without trusting the producer. This is tamper-evidence: it proves structure and provenance, not the truth of the underlying claims.

- **Route:** The Assurance control plane (`org_control` inspector), tab `attestation`.
- **Rights:** an integrity owner — `review_and_approve` or `edit_config`, or a Level-1/Level-2 Head; the database RPCs (`attestation_subjects_list`, `attestation_input_get`) re-check the right and a caller without it is refused.
- **Data:** `AttestationSubjectRow`, `listAttestationSubjects`, `loadAttestationInput`, `buildAttestationPackage`, `parseAttestationPackage`, `verifyAttestationPackage` — through `src/data/*.ts` and `src/lib/*.ts`; components never import the database client (rule M8).
- **Testids:** `OA-30-build-<id>`, `OA-30-empty`, `OA-30-error`, `OA-30-explain-attestation`, `OA-30-export`, `OA-30-headline`, `OA-30-icon`, `OA-30-leaf-count`, `OA-30-load-error`, `OA-30-loading`, `OA-30-merkle-root`, `OA-30-package`, `OA-30-package-root`, `OA-30-package-title`, `OA-30-panel`, `OA-30-problems`, `OA-30-signature-count`, `OA-30-subject-<id>`, `OA-30-subjects`, `OA-30-timestamp-count`, `OA-30-verdict`, `OA-30-verify-drop`, `OA-30-verify-drop-label`, `OA-30-versions`
- **States:** loading; empty (nothing signed yet); ready with signed subjects; package built and verified; package built and NOT verified; error.
- **Tutorial key:** —

## OA-31 — Integrity incident wizard (T6, §11.3a)

The guided response to a detected tamper. It shows, in plain words, what changed, when and by whom, and what it affects (which engagement, archive, population or the ledger chain), then offers restore / re-derive and re-seal / freeze the engagement / escalate — each requiring a reason — and re-runs verification at the end so the incident closes on proof rather than assertion. Every step is appended to the incident's own append-only trail, so an incident cannot be quietly closed. This is tamper-evidence, never tamper-prevention.

- **Route:** The Assurance control plane (`org_control` inspector), tab `incidents`.
- **Rights:** an integrity owner — `review_and_approve` or `edit_config`, or a Level-1/Level-2 Head; every `integrity_incident_*` RPC re-checks the right and a caller without it is refused.
- **Data:** `IntegrityIncidentRow`, `IncidentActionRow`, `incidentModel`, `incidentStatus`, `availableActions`, `listIntegrityIncidents`, `openIntegrityIncident`, `incidentAction`, `verifyIntegrityIncident` — through `src/data/*.ts` and `src/lib/*.ts`; components never import the database client (rule M8).
- **Testids:** `OA-31-actual`, `OA-31-affects`, `OA-31-boundary`, `OA-31-denied`, `OA-31-detail`, `OA-31-empty`, `OA-31-error`, `OA-31-expected`, `OA-31-headline`, `OA-31-icon`, `OA-31-incident-<id>`, `OA-31-incident-status-<id>`, `OA-31-list`, `OA-31-load-error`, `OA-31-loading`, `OA-31-open-<alertId>`, `OA-31-openable`, `OA-31-openable-<alertId>`, `OA-31-opened`, `OA-31-outcome`, `OA-31-panel`, `OA-31-reason`, `OA-31-step-annotate`, `OA-31-step-escalate`, `OA-31-step-freeze`, `OA-31-step-rederive`, `OA-31-step-restore`, `OA-31-trail`, `OA-31-trail-<n>`, `OA-31-unconfigured`, `OA-31-verify`, `OA-31-what-changed`
- **States:** denied (not an integrity owner); loading; not configured (no database connection — never shown as an empty healthy panel); empty (no incidents); alerts with no incident yet (the entry point); ready with a selected incident and its trail; a step's computed outcome; error.
- **Tutorial key:** —

## SA-16 — Guided provisioning (SCALE-1, WP3)

The guided zero-to-first-report path: create an organisation, set its entitlements and invite cap, configure the platform email sender, read the readiness checks (roles, status, invite, sender, engagement) and activate the tenant.

- **Route:** `/superadmin`, tab `provisioning`; the setup wizard is `sa-setup`.
- **Rights:** platform admin (`is_platform_admin()`), re-checked by every `platform_*` RPC.
- **Data:** `FeatureRow`, `ProvisioningStatus`, `TenantRow`, `configurePlatformEmailSender`, `createTenant`, `listFeatureCatalogue`, `listTenants`, `provisioningStatus`, `seedOrgRoles`, `setEntitlement`, `setInviteCap`, `setTenantStatus` — through `src/data/*.ts`; components never import the database client (rule M8).
- **Testids:** `sa-provisioning`, `sa-provisioning-activate`, `sa-provisioning-admin-email`, `sa-provisioning-cap`, `sa-provisioning-cap-input`, `sa-provisioning-cap-reason`, `sa-provisioning-cap-submit`, `sa-provisioning-check-engagement`, `sa-provisioning-check-invite`, `sa-provisioning-check-ready`, `sa-provisioning-check-roles`, `sa-provisioning-check-sender`, `sa-provisioning-check-status`, `sa-provisioning-create`, `sa-provisioning-create-error`, `sa-provisioning-create-reason`, `sa-provisioning-create-submit`, `sa-provisioning-created`, `sa-provisioning-done`, `sa-provisioning-entitlement-disable`, `sa-provisioning-entitlement-enable`, `sa-provisioning-entitlement-reason`, `sa-provisioning-entitlements`, `sa-provisioning-error`, `sa-provisioning-feature-select`, `sa-provisioning-finish`, `sa-provisioning-loading`, `sa-provisioning-org-name`, `sa-provisioning-readiness`, `sa-provisioning-recheck`, `sa-provisioning-repair-roles`, `sa-provisioning-result`, `sa-provisioning-retry`, `sa-provisioning-sender`, `sa-provisioning-sender-from`, `sa-provisioning-sender-name`, `sa-provisioning-sender-reason`, `sa-provisioning-sender-reply`, `sa-provisioning-sender-submit`, `sa-provisioning-target`, `sa-provisioning-tenant-select`, `sa-setup`
- **States:** loading; empty (no tenant selected); readiness checks; created; done; error with retry.
- **Tutorial key:** —
## SA-17 — Super Admin portal shell (S1)

The shell around every /superadmin tab: it proves the caller is a platform admin before it renders any tab, and shows a checking state, a denied state, or the tab strip.

- **Route:** `/superadmin`.
- **Rights:** platform admin (`is_platform_admin()`); a caller without it sees the denied state.
- **Data:** none beyond the session check.
- **Testids:** `superadmin-checking`, `superadmin-denied`, `superadmin-portal`, `superadmin-tabs`, `superadmin-tab-<tab>`
- **States:** checking; denied; ready.
- **Tutorial key:** —

## SA-18 — integrity anchoring (SCALE-1, Phase 3.5, §17)

The platform integrity catalogue: the RFC 3161 timestamp authorities that stamp a sealed report's
root hash, the trust anchors their certificates are verified against, and the per-organisation
minimum number of independent authorities a stamp must carry before the seal counts as anchored.

- **Route:** `/superadmin`, tab `Integrity anchoring` (`superadmin-tab-integrity`).
- **Rights:** platform admin (`is_platform_admin()`); every write is a platform-only RPC
  (`admin_save_timestamp_authority`, `admin_save_trust_anchor`, `admin_set_anchoring_min`), re-checked
  in the database.
- **Data:** `listTimestampAuthorities`, `listTrustAnchors`, `saveTimestampAuthority`,
  `saveTrustAnchor`, `setAnchoringMin` (`src/data/integrityAnchoring.ts`), `listTenants`
  (`src/data/platform.ts`).
- **Testids:** `sa-anchoring`, `sa-anchoring-loading`, `sa-anchoring-error`, `sa-anchoring-save-error`,
  `sa-anchoring-result`, `sa-anchoring-authorities`, `sa-anchoring-authority-list`,
  `sa-anchoring-authority-empty`, `sa-anchoring-authority-<id>`, `sa-anchoring-authority-name`,
  `sa-anchoring-authority-url`, `sa-anchoring-authority-order`, `sa-anchoring-authority-add`,
  `sa-anchoring-anchors`, `sa-anchoring-anchor-list`, `sa-anchoring-anchor-empty`,
  `sa-anchoring-anchor-<id>`, `sa-anchoring-anchor-name`, `sa-anchoring-anchor-cert`,
  `sa-anchoring-anchor-add`, `sa-anchoring-min`, `sa-anchoring-min-list`, `sa-anchoring-min-empty`,
  `sa-anchoring-min-<id>`, `sa-anchoring-min-<id>-<n>`
- **States:** loading; error (with Retry); ready; empty authority list; empty anchor list; empty
  tenant list; an inline result or refusal after a write.
- **Tutorial key:** `sa.integrity-anchoring`


## SA-19 — audit domains and rule packs (D11, docs/AUDIT-DOMAINS-MODEL.md)

The platform view of the three audit universes: each organisation's universes with the discipline each
one runs, the seed that creates the three defaults, a reasoned change of a universe's discipline, and
the rule base each discipline resolves to. The discipline set is closed but extensible — a fourth
discipline is a data change, never a code change — so an unknown or legacy domain is shown as unset
and never silently mapped onto a default.

- **Route:** `/superadmin`, tab `Audit domains` (`superadmin-tab-domains`).
- **Rights:** platform admin (`require_platform_admin()`); every write is a platform-only RPC
  (`seed_default_universes`, `set_universe_domain`), re-checked in the database.
- **Data:** `listUniversesWithDiscipline`, `seedDefaultUniverses`, `setUniverseDomain`,
  `universeDiscipline` (`src/data/platformDomains.ts`), `listTenants` (`src/data/platform.ts`),
  `DISCIPLINE_PROFILES`/`selectableDisciplines` (`src/lib/risk/domains.ts`), `disciplineRuleBase`
  (`src/lib/systeligon/disciplinePacks.ts`).
- **Testids:** `sa-domains`, `sa-domains-loading`, `sa-domains-retry`, `sa-domains-target`,
  `sa-domains-org-select`, `sa-domains-seed`, `sa-domains-empty`, `sa-domains-list`,
  `sa-domains-row-<id>`, `sa-domains-unset-<id>`, `sa-domains-readback-<id>`, `sa-domains-base-<id>`,
  `sa-domains-edit-<id>`, `sa-domains-editor`, `sa-domains-domain-input`, `sa-domains-reason`,
  `sa-domains-save`, `sa-domains-cancel`, `sa-domains-notice`, `sa-domains-bases`,
  `sa-domains-basecard-<discipline>`, `sa-domains-basecount-<discipline>`,
  `sa-domains-basestandards-<discipline>`.
- **States:** loading; error (with Retry); no organisation chosen; an empty universe list; ready; an
  inline notice after a seed or a set, and the exact refusal (an empty reason is refused before
  anything is sent) otherwise.
- **Tutorial key:** none recorded yet.

## SA-20 — readiness signals, complaints and self-diagnostic (D12/D13, docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md)

The livid traffic-signal surface. Every readiness check is a deterministic verdict with a reason in
words, computed in the database, never in the browser: a check that cannot be evaluated is amber and
says so, and is never green by default. Every signal that is not green carries its fix — a "Fix this"
deep-link to the exact screen, a "Contact Super Admin" action that raises a coded complaint with the
whole issue attached, and a "Re-check" that re-runs that one signal in isolation and records the
result without changing any inspected state. Below the signals, the complaint register lists the coded
issues with their assignment, comment trail and reasoned resolution.

- **Route:** `/superadmin`, tab `Readiness` (`superadmin-tab-readiness`).
- **Rights:** platform admin (`require_platform_admin()`); the complaint writes are platform-only RPCs,
  re-checked in the database. `platform_list_admins` (the assignment picker) is platform-only.
- **Data:** `platformReadiness`, `listComplaints`, `listPlatformAdmins`, `runDiagnostic`,
  `createComplaint`, `listComplaintEvents`, `resolveComplaint` (`src/data/readiness.ts`), `listTenants`
  (`src/data/platform.ts`). RPCs `platform_readiness_signals`, `run_readiness_diagnostic`,
  `complaint_create`, `complaint_list`, `complaint_events_list`, `complaint_assign`, `complaint_comment`,
  `complaint_resolve`, `platform_list_admins` (migrations 0160/0161).
- **Testids:** `sa-readiness`, `sa-readiness-loading`, `sa-readiness-error`, `sa-readiness-retry`,
  `sa-readiness-target`, `sa-readiness-org-select`, `sa-readiness-refresh`, `sa-readiness-empty`,
  `sa-readiness-signals`, `sa-readiness-summary`, `sa-readiness-signal-<signalId>`,
  `sa-readiness-verdict-<signalId>`, `sa-readiness-reason-<signalId>`, `sa-readiness-diag-<signalId>`,
  `sa-readiness-fix-<signalId>`, `sa-readiness-recheck-<signalId>`, `sa-readiness-contact-<signalId>`,
  `sa-readiness-layers`, `sa-readiness-layer-<layer>`, `sa-readiness-layer-verdict-<layer>`,
  `sa-readiness-runbook-note`, `sa-readiness-notice`, `sa-readiness-action-error`, `complaints`,
  `complaints-filter`, `complaints-empty`, `complaints-admin-count`, `complaint-<code>`,
  `complaint-code-<code>`, `complaint-trail-<code>`, `complaint-events-<code>`,
  `complaint-assign-<code>`, `complaint-comment-<code>`, `complaint-comment-send-<code>`,
  `complaint-assign-save-<code>`, `complaint-resolve-reason-<code>`, `complaint-resolve-<code>`.
- **States:** loading; error (with Retry); no organisation chosen; an empty signal set; ready; the
  three deployment layers (platform / environment / organisation) with a per-layer verdict; an empty
  complaint filter; an inline notice after a raise or a resolve, and the exact refusal (an empty
  resolution reason is refused before anything is sent) otherwise.
- **Tutorial key:** none recorded yet.

## SA-21 — standards distribution (D16, docs/STANDARDS-DISTRIBUTION.md)

The platform standards catalogue: every rule base the product ships as a signed, versioned **standards
pack**, a publish action that signs the shipped rule library with the platform key, a rollout to
entitled tenants that shows the per-tenant outcome, and a pin action that freezes a tenant on the
version it currently runs. A tenant that does not pay for a pack is skipped and recorded, never
silently applied; a pin needs a reason and is never moved forward by a later rollout.

- **Route:** `/superadmin`, tab `Standards` (`superadmin-tab-standards`).
- **Rights:** platform admin (`is_platform_admin()`); every write is a platform-only RPC
  (`platform_signing_key_register`, `standards_pack_publish`, `standards_rollout`), re-checked in the
  database. `standards_pin` is a tenant action gated on `edit_config` or a Head.
- **Data:** `listStandardsCatalogue`, `listStandardsSubscriptions`, `registerPlatformSigningKey`,
  `publishStandardsPack`, `rolloutStandardsPack`, `pinStandardsVersion`, `buildSignedStandardsPack`
  (`src/data/standards.ts`), `listTenants` (`src/data/platform.ts`), `STANDARDS_CATALOGUE`,
  `SHIPPED_RULES`.
- **Testids:** `superadmin-standards`, `superadmin-standards-loading`, `superadmin-standards-error`,
  `superadmin-standards-result`, `superadmin-standards-empty`, `superadmin-standards-catalogue`,
  `standards-catalogue-<packId>`, `standards-publish-pack`, `standards-publish-version`,
  `standards-publish`, `standards-shipped-rules`, `standards-rollout-tenants`,
  `standards-rollout-<orgId>`, `standards-rollout`, `standards-pin-pack`, `standards-pin-version`,
  `standards-pin-reason`, `standards-pin`, `standards-subscriptions`,
  `standards-subscriptions-empty`, `standards-subscription-<packId>`.
- **States:** loading; error (with Retry); ready; empty tenant list; an inline result listing the
  per-tenant outcome after a rollout, the pinned version after a pin, or the exact refusal after a
  publish or a pin (an empty reason and a version below 1 are refused before anything is sent).
- **Tutorial key:** none recorded yet.

## Tutorials regenerated

`npm run tutorials:record` regenerates every GIF (S12). The recorder binds only to the testids listed
above. `docs/ACP-TUTORIALS.md` lists every key and its steps.
## SA-03 — tenant hub (S2)

- **Purpose:** the platform's per-tenant register: every tenant with its status, feature flags, AI
  enablement and the invitation cap, plus the controls to change them.
- **Route:** `/superadmin`, tab `Tenants` (`superadmin-tab-tenants`).
- **Rights:** platform admin (`is_platform_admin()`); every write is a platform-only RPC.
- **Data:** `listTenants()`, `setTenantStatus(orgId, status)`, `setFeatureFlag(orgId, key, enabled)`,
  `enableAi(orgId, enabled)`, `listInviteCaps()`, `setInviteCap(orgId, perUserDaily)`
  (`src/data/platform.ts`).
- **Testids:** `superadmin-tenants`, `superadmin-tenants-loading`, `superadmin-tenants-error`,
  `superadmin-tenants-result`, `superadmin-tenants-empty`, `tenant-<id>`,
  `tenant-allow-<id>`, `tenant-deny-<id>`.
- **States:** loading, error (with Retry), empty (no tenants), ready; an inline result when a write
  is refused.
- **Tutorial key:** `sa.tenant-hub`.

## SA-13 — tutorial library (S12)

- **Purpose:** the registry health view for the guided recordings: every Appendix A key, its
  audience, whether its media file exists and whether the recorded `ui_hash` is stale.
- **Route:** `/superadmin`, tab `Tutorials` (`superadmin-tab-tutorials`).
- **Rights:** platform admin (`is_platform_admin()`); read-only.
- **Data:** `listTutorials()` (`src/data/tutorials.ts`), `tutorialHealth(rows, liveHashes)`.
- **Testids:** `superadmin-tutorials`, `superadmin-tutorials-loading`,
  `superadmin-tutorials-error`, `superadmin-tutorials-empty`, `tutorial-<key>`.
- **States:** loading, error, empty (registry empty), ready.
- **Tutorial key:** `sa.tutorials`.

## SA-15 — platform trail (S12, F20)

- **Purpose:** the append-only platform audit trail: every platform action with its actor, action,
  target and time. Read-only, no filter that could hide a row.
- **Route:** `/superadmin`, tab `Trail` (`superadmin-tab-trail`).
- **Rights:** platform admin (`is_platform_admin()`); read-only.
- **Data:** `listTrail()` (`src/data/platform.ts`).
- **Testids:** `superadmin-trail`, `superadmin-trail-loading`, `superadmin-trail-error`,
  `superadmin-trail-empty`.
- **States:** loading, error (with Retry), empty, ready.
- **Tutorial key:** `sa.trail`.

## OA-05 — roles and rights (S3)

- **Purpose:** the role register and the rights matrix. A role is a named bundle of the 15 closed
  rights keys; the app and the database both check rights, never role names.
- **Route:** Org Admin control plane, tab `People` (`org-control-tab-people`) — the roles section of
  the people panel.
- **Rights:** `edit_config` to write; `manage_people` for membership changes.
- **Data:** `listRoles()` (`src/data/admin.ts`), `rightsOfRoleRow(row)`, `createRole(name, slug,
  rights)`, `updateRoleRights(slug, rights)`, `deleteRole(slug)`; `RIGHTS` (`src/lib/rights.ts`).
- **Testids:** `people-admin-panel`, `admin-roles`, `admin-roles-readonly`, `admin-create-role`,
  `role-<slug>`., `admin-loading`, `admin-people-empty`, `admin-provision`, `admin-scopes`, `admin-grant-scope`, `admin-set-cap`
- **States:** loading, load error (`admin-load-error`), read-only without `edit_config`
  (`admin-roles-readonly`), ready; an inline error on a refused write (`admin-error`).
- **Tutorial key:** `oa.roles`.

## OA-40 — scoped roles and access (owner 2026-10-30)

- **Purpose:** make every role configurable at every level. Two things the flat membership role
  cannot express: the DEFAULT roles an organisation applies at the org, at a universe and at one
  engagement, and the ASSIGNMENTS a person holds at a scope (the same person is a Reviewer on one
  engagement and the Preparer on another). The resolution — the most specific scope with a grant wins,
  the rights of every role at that scope are unioned, and with no scoped grant the membership role
  stands — is shown on screen and re-derived by the database, so a drift is visible rather than hidden.
- **Route:** Org Admin control plane → People & Roles (`people-admin-panel`), tab `Scoped access`
  (`admin-tab-scoped`).
- **Rights:** `manage_roles` to configure a default; `manage_users` to assign a role. The resolution is
  read with either.
- **Data:** `listScopeDefaults()`, `listRoleAssignments()`, `setScopeDefault(...)`,
  `clearScopeDefault(id)`, `assignRole(userId, scopeKind, universeId, engagementId, roleSlug, reason)`,
  `unassignRole(id)`, `effectiveAccess(userId, engagementId)`, `listScopeTargets()`
  (`src/data/roleScope.ts`); the pure model `resolveAccess`, `rolesAt`, `unionRights`,
  `applicableDefaults`, `explainAccess`, `rightsForSlug`, `rightsInOrder` (`src/lib/roleAccess.ts`).
  RPCs `role_scope_default_set`, `role_scope_default_clear`, `role_assign`, `role_unassign`,
  `role_effective`, `role_effective_has_right`, `role_scope_defaults_list`, `role_assignments_list`
  (migration 0199).
- **Testids:** `admin-tab-scoped`, `rolescope-panel`, `rolescope-loading`, `rolescope-load-error`,
  `rolescope-readonly`, `rolescope-error`, `rolescope-defaults`, `rolescope-defaults-empty`,
  `rolescope-default-<id>`, `rolescope-default-state-<id>`, `rolescope-default-clear-<id>`,
  `rolescope-default-form`, `rolescope-default-scope`, `rolescope-default-universe`,
  `rolescope-default-engagement`, `rolescope-default-role`, `rolescope-default-save`,
  `rolescope-assignments`, `rolescope-assignments-empty`, `rolescope-assignment-<id>`,
  `rolescope-assignment-default-<id>`, `rolescope-assignment-remove-<id>`, `rolescope-assign-form`,
  `rolescope-assign-user`, `rolescope-assign-scope`, `rolescope-assign-universe`,
  `rolescope-assign-engagement`, `rolescope-assign-role`, `rolescope-assign-save`, `rolescope-preview`,
  `rolescope-preview-none`, `rolescope-preview-roles`, `rolescope-preview-rights`,
  `rolescope-effective-user`, `rolescope-effective-engagement`, `rolescope-effective-result`,
  `rolescope-effective-reason`, `rolescope-effective-rights`, `rolescope-effective-agrees`.
- **States:** loading, load error (`rolescope-load-error`), read-only without `manage_roles`/
  `manage_users` (`rolescope-readonly`), ready; an inline error on a refused write (`rolescope-error`);
  empty defaults (`rolescope-defaults-empty`) and empty assignments (`rolescope-assignments-empty`).
- **Tutorial key:** none (no key is claimed until the media exists — `tutorialRegistryCoverage.test.ts`).

## OA-41 — archived-file custodian role (owner 2026-10-30)

An archived file outlives the person who owned it, so its custodian is a ROLE the organisation
chooses, not a person. This surface makes that choice. The choice is permanent in two senses: every
change is versioned and appended to the ledger, and the configuration itself can never be deleted, so
there is always someone accountable for an archive. The lower half lists every archived file with its
custodian role and the person who owned it, so the setting is visibly in force.

- **Route:** the Org Admin control panel, tab "Archived files" (`org-control-tab-archived-role`).
- **Rights:** `manage_roles` to change the custodian role; any member of the org reads it.
- **Data:** `getArchivedFileRole()`, `setArchivedFileRole(roleSlug, reason)`,
  `listArchivedFileCustodians()`, `listCustodianRoles()` (`src/data/fileOwnership.ts`). The picker is
  fed the organisation's REAL roles (read from `roles` via `listRoles`, `src/data/admin.ts`), so an
  offered role is always one the database will accept; the draft defaults to the role in force.
  RPCs `archived_file_role_get`,
  `archived_file_role_set`, `archived_file_custodians`, `archived_file_role_effective`,
  `archived_file_role_default` (migration 0203).
- **Testids:** `archived-role-panel`, `archived-role-loading`, `archived-role-load-error`,
  `archived-role-current`, `archived-role-value`, `archived-role-version`, `archived-role-reason`,
  `archived-role-readonly`, `archived-role-form`, `archived-role-select`, `archived-role-reason-input`,
  `archived-role-why`, `archived-role-save`, `archived-role-error`, `archived-role-notice`,
  `archived-role-archives`, `archived-role-archives-empty`, `archived-role-archive-<id>`.
- **States:** loading; load error (`archived-role-load-error`); read-only without `manage_roles`
  (`archived-role-readonly`); the platform default before the org chooses; an inline error on a refused
  write (`archived-role-error`); no archived file yet (`archived-role-archives-empty`).
- **Tutorial key:** none (no key is claimed until the media exists — `tutorialRegistryCoverage.test.ts`).

## OA-42 — readiness and complaints (D12, docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md)

The tenant half of the D12 traffic-signal work. The same deterministic verdicts for the organisation's
own checks — what is ready, what is not evaluated and what is broken — each with its reason in words.
The environment signals are the platform's and never cross to a tenant (L2); this panel reads only the
organisation view. A signal that is not green carries its fix and a "Contact Super Admin" action, which
raises a coded complaint about this organisation and emails the platform administrators. Raising a
complaint needs `edit_config`, which the database re-checks; the refusal is surfaced with its exact
reason. Below, this organisation's own complaints with their reasoned resolution.

- **Route:** the Org Admin control panel, tab `Readiness` (`org-control-tab-readiness`).
- **Rights:** `edit_config` to raise a complaint; any member reads the signals. The right is re-checked
  in the database (`org_complaint_create`), never only in the browser.
- **Data:** `orgReadiness`, `listOrgComplaints`, `runOrgDiagnostic`, `createOrgComplaint`,
  `resolveComplaint` (`src/data/readiness.ts`). RPCs `org_readiness_signals`,
  `org_run_readiness_diagnostic`, `org_complaint_create`, `org_complaint_list`, `complaint_resolve`
  (migrations 0160/0161).
- **Testids:** `org-readiness`, `org-readiness-loading`, `org-readiness-error`, `org-readiness-retry`,
  `org-readiness-signals`, `org-readiness-summary`, `org-readiness-all-clear`, `org-readiness-refresh`,
  `org-readiness-signal-<signalId>`, `org-readiness-verdict-<signalId>`, `org-readiness-reason-<signalId>`,
  `org-readiness-diag-<signalId>`, `org-readiness-recheck-<signalId>`, `org-readiness-contact-<signalId>`,
  `org-readiness-contact-readonly-<signalId>`, `org-readiness-notice`, `org-readiness-action-error`,
  `org-complaints`, `org-complaints-empty`, `org-complaint-<code>`, `org-complaint-resolve-reason-<code>`,
  `org-complaint-resolve-<code>`, `org-complaint-resolve-readonly-<code>`.
- **States:** loading; error (with Retry); ready with a summary; an all-clear note when every
  organisation check is ready; an empty complaint list; a read-only state when the caller lacks
  `edit_config` (the raise and resolve controls are disabled with the missing right named); an inline
  notice after a raise or a resolve, and the exact refusal (an empty resolution reason is refused
  before anything is sent) otherwise.
- **Tutorial key:** none recorded yet.

## OA-32 — team directory (spec §4.2, §5, §9)

- **Purpose:** the resourcing view — every member with their working profile (picture, capacity,
  role), their workload, their home base and where they are on a date. Selecting a member opens their
  detail: the workload band, the engagements assigned to them, their upcoming trips, their travel
  preferences (home base, willingness, preferred regions, blackout dates), and a resourcing form that
  ranks who should take a given engagement and explains each verdict. A manager can also tag an
  engagement as requiring travel.
- **Route:** Org Admin control plane, tab `Team directory` (`admin-tab-team`) on the People & Roles
  panel (`people-admin-panel`).
- **Rights:** `manage_team` or `manage_users` to see every member's travel and to write; a member sees
  and edits only their own travel and profile. The engagement travel tag needs `manage_engagements`.
- **Data:** `listTeamDirectory(rightsByUser)`, `listDirectoryEngagements()`,
  `saveTeamProfile(userId, avatarUrl, capacityHours)`,
  `saveTeamTravel(userId, homeBase, willingness, regions, blackouts)`,
  `addTeamTrip(...)`/`removeTeamTrip(id)`, `addTeamAssignment(...)`/`removeTeamAssignment(id)`,
  `tagEngagementTravel(id, requiresTravel, location, from, to)` (`src/data/teamDirectory.ts`); the
  pure model `profileWorkload`, `recommendAssignee`, `summariseTeam`, `availabilityOn`,
  `generatedAvatar` (`src/lib/teamDirectory.ts`).
- **Testids:** the panel is prefix-parameterised (prefix default `team`), so each id is
  `<prefix>-<element>`: `admin-tab-team`, `team-directory`, `team-grid`, `team-summary`,
  `team-resourcing`, `team-detail`, `team-detail-name`, `team-detail-close`, `team-profile-edit`,
  `team-avatar-url`, `team-capacity`, `team-travel-edit`, `team-home-base`, `team-regions`,
  `team-trips`, `team-trip-add`, `team-assignments`, `team-assignment-add`, `team-member-<userId>`,
  `team-avatar-<userId>`, `team-hover-<userId>`, `team-recommendations`, `team-rec-<userId>`,
  `team-req-engagement`, `team-req-travel`, `team-travel-tag`, `team-tag-engagement`,
  `team-tag-location`, `team-tag-save`, `team-empty`, `team-readonly`, `team-notice`, `team-loading`,
  `team-error`. Per-row ids are `team-trip-<i>` / `team-trip-<i>-remove` and
  `team-assignment-<i>` / `team-assignment-<i>-remove`.
- **States:** loading, error, ready; an inline notice on a saved or refused write.
- **Tutorial key:** — (no key; `oa.team` is not registered, so none is claimed here).

## OA-08 — templates hub (S2)

- **Purpose:** the notification-template hub: every catalogue event, the tenant template that
  overrides the platform default, and the blocks each template is built from.
- **Route:** Org Admin control plane, tab `Automation` (`org-control-tab-automation`) — the templates
  section of the automation panel.
- **Rights:** `edit_config`.
- **Data:** `listTemplates(orgId)`, `saveTemplate(...)` (`src/data/automation.ts`).
- **Testids:** `org-automation`, `org-template-list`, `org-template-<eventKey>`,
  `template-<eventKey>`, `template-list`, `template-event`, `template-subject`, `template-blocks`,
  `template-block-<i>`, `template-block-text-<i>`, `template-block-up-<i>`, `template-block-down-<i>`,
  `template-block-remove-<i>`, `template-add-<type>`, `template-save`.
- **States:** loading, error, empty (no templates), ready; an inline saved/failure result.
- **Tutorial key:** `oa.templates`.

## OA-10 — certificate configuration (S8)

- **Purpose:** the certificate template: which fields a public certificate shows, in order, and
  whether the certificate is enabled at all.
- **Route:** Org Admin control plane, tab `Branding` (`org-control-tab-branding`) — the certificate
  section beside the Board Pack configuration.
- **Rights:** `edit_config` to save; `approve_plan` is required to issue.
- **Data:** `getCertificateConfig()`, `saveCertificateConfig(fields)`
  (`src/data/certificate.ts`); `enabledFields(config)`, `certificateVerifyUrl(id)`
  (`src/lib/certificate.ts`).
- **Testids:** `oa-certificate-config`, and per field `oa-certificate-field-<key>` and
  `oa-certificate-enabled-<key>`, where the seeded keys are `engagement_id`, `engagement_title`,
  `organisation`, `engagement_root_hash`, `issued_at`, `sealed_workpapers`, `findings_count`,
  `sealing_actors`, `verification` and `free_text`; e.g. `oa-certificate-field-engagement_id`,
  `oa-certificate-enabled-verification`.
- **States:** loading, error, ready; the read-only view without `edit_config`.
- **Tutorial key:** `oa.certificate-config`.

## OA-18 — tutorial library (tenant view) (S12)

- **Purpose:** the same registry health as SA-13, scoped to the keys an Org Admin owns, so the
  organisation can see which of its own screens have a current recording.
- **Route:** Org Admin control plane, tab `Tutorials` (`org-control-tab-tutorials`).
- **Rights:** any signed-in org member; read-only.
- **Data:** `listTutorials()` (`src/data/tutorials.ts`), `tutorialHealth(rows, liveHashes)`.
- **Testids:** `org-tutorials`, `tutorial-<key>`.
- **States:** loading, error, empty, ready.
- **Tutorial key:** `oa.tutorials` (its step target is OA-18's own `org-tutorials`, not the
  super-admin library's `superadmin-tutorials`).

OA-18 renders `SuperAdminTutorials audience="org_admin"`, so the `superadmin-tutorials*` testids
*are* in the DOM here. They are deliberately **not** listed above: this list is what
`scripts/gen-tutorial-steps.mjs` draws step targets from, and `src/guards/tutorialTargets.test.ts`
(T1) forbids an org-admin key from driving a control that only the super-admin portal renders.
Listing them made `oa.tutorials` target `superadmin-tutorials` on every regeneration, which failed
that guard. SA-13 owns those testids in the contract; the tenant view owns `org-tutorials`.

## OA-19 — Go Live health check (S1)

- **Purpose:** the last wizard step: a short, deterministic readiness check with a plain-language
  line per item and a Go Live button that only enables when nothing blocking is outstanding.
- **Route:** Org Admin control plane, tab `Setup` (`org-control-tab-setup`), step `org.golive`.
- **Rights:** `edit_config`.
- **Data:** `listSetupSteps('org_admin')`, `saveSetupStep('org_admin','org.golive',…)`,
  `setupProgress(steps, total)` (`src/data/setup.ts`).
- **Testids:** `org_admin-wizard`, `org_admin-wizard-step-org.golive`,
  `org_admin-wizard-content-org.golive`, `org_admin-wizard-save`, `org_admin-wizard-next`.
- **States:** loading, error, empty, ready; a resume banner when a later step is open.
- **Tutorial key:** `oa.golive`.

## WK-02 — Board Pack generator (S7)

- **Purpose:** build a Board Pack snapshot for a scope and a boundary, then take it away as a web
  view, a PDF or a PPTX. The pack is a frozen snapshot: every figure points at the record behind it.
- **Route:** WK-01 Board Pack panel (`wk-boardpack`), tab `Generate` (`wk-boardpack-tab-generator`).
- **Rights:** `approve_plan` to generate; the pack shows only what the caller may read.
- **Data:** `buildBoardPackPdf(...)`, `buildBoardPackPptx(...)`, `capAgingRows(...)`
  (`src/lib/boardPackDocuments.ts`); `getBranding()` (`src/data/branding.ts`);
  `renderPdf(...)`, `renderPptx(...)`, `renderQrDataUrl(...)`, `verificationUrl(...)`.
- **Testids:** `wk-boardpack`, `wk-boardpack-loading`, `wk-boardpack-error`, `wk-boardpack-result`,
  `wk-boardpack-tab-generator`, `wk-boardpack-generator`, `wk-boardpack-scope`, `wk-boardpack-from`,
  `wk-boardpack-to`, `wk-boardpack-boundary`, `wk-boardpack-generate`, `wk-boardpack-no-generate`,
  `wk-boardpack-pdf`, `wk-boardpack-pptx`, `wk-boardpack-url-missing`,
  `wk-boardpack-missing-refs`.
- **States:** loading, error, ready; generate disabled until a scope and boundary are chosen; an
  inline refusal when the database rejects the call.
- **Tutorial key:** `oa.boardpack-generate`.

## WK-03 — Board Pack web view (S7)

- **Purpose:** read a generated pack: the scope, the boundary, the delta against the previous pack,
  every section, and the sources index that traces each figure back to its record.
- **Route:** WK-01 Board Pack panel (`wk-boardpack`), tab `View` (`wk-boardpack-tab-view`), then a
  pack from the history (`wk-boardpack-open-<id>`).
- **Rights:** `approve_plan`; a figure the caller may not read is shown sealed
  (`wk-boardpack-figure-sealed`), not silently omitted.
- **Data:** the pack snapshot read through `src/data/boardPack.ts`.
- **Testids:** `wk-boardpack`, `wk-boardpack-tab-view`, `wk-boardpack-view`, `wk-boardpack-history`,
  `wk-boardpack-open-<id>`, `wk-boardpack-verify-chip`, `wk-boardpack-delta`,
  `wk-boardpack-section-sira`, `wk-boardpack-section-issues`, `wk-boardpack-section-changes`,
  `wk-boardpack-section-sealed`, `wk-boardpack-section-sources`,
  `wk-boardpack-figure-sira-<i>`, `wk-boardpack-figure-cap-<band>`,
  `wk-boardpack-figure-sealed`, `wk-boardpack-source-<path>`.
- **States:** loading, error, empty (no packs yet), ready; sealed figures.
- **Tutorial key:** `oa.boardpack-view`.

## EX-02 — portal home (S9)

- **Purpose:** the external auditor's landing view: the engagements they may read, the summary of
  each, and the downloads available to them. No tenant application shell, no write path.
- **Route:** `/external` (`ex-portal`), outside the tenant shell but behind the auth gate.
- **Rights:** the `external_auditor` access status plus a live, unexpired, unrevoked grant; the
  portal reads only the granted objects.
- **Data:** `getMyAccess()`, `listMyEngagements()` (`src/data/externalAuditors.ts`);
  `describeExpiry(...)`, `SIGNUP_DISABLED_HINT` (`src/lib/externalAuditors.ts`).
- **Testids:** `ex-portal`, `ex-portal-loading`, `ex-portal-error`, `ex-portal-inactive`,
  `ex-portal-empty`, `ex-portal-engagements`, `ex-portal-engagement-<id>`, `ex-portal-summary`,
  `ex-portal-downloads`, `ex-portal-cert-hash`, `ex-portal-pack-hash`, `ex-portal-verify`,
  `ex-portal-verify-result`, `external-portal-wrong-principal`.
- **States:** loading, error, inactive (no live grant, with the reason), empty (no engagements),
  ready.
- **Tutorial key:** `ex.home`.

## EX-03 — engagement view (S9)

- **Purpose:** one engagement as the external auditor sees it: the summary, the certificate hash and
  the pack hash, and the drop zone where the auditor returns a document whose SHA-256 must match the
  hash on record.
- **Route:** `/external`, engagement card (`ex-portal-engagement-<id>`).
- **Rights:** as EX-02; read-only plus the return-a-document action.
- **Data:** `getEngagementSummary(id)`, `getLatestCertificate(id)`, `getLatestPack(id)`,
  `verifyExternalCertificate(...)` (`src/data/externalAuditors.ts`); `matchesHash(...)`,
  `parseDroppedDocument(...)` (`src/lib/certificate.ts`).
- **Testids:** `ex-portal`, `ex-portal-summary`, `ex-portal-cert-hash`, `ex-portal-pack-hash`,
  `ex-portal-drop`, `ex-portal-drop-input`, `ex-portal-drop-result`, `ex-portal-drop-error`,
  `ex-portal-verify`, `ex-portal-verify-result`.
- **States:** loading, error, ready; a returned document that does not match the recorded hash is
  refused with the plain reason.
- **Tutorial key:** `ex.engagement`.

## OA-22 — governance settings (C3.2-B)

- **Purpose:** the remaining Org Admin configuration in one portal, never in code or JSON: one-stage
  or two-stage testing with the sign-off role per stage (§10), the finding structure — section names
  and role tags — (§14.2), methodology scales and FSLI mapping (§23), workflow, SLA and escalation
  (§7.1, §23), notification rules by role with a supervisor copy (§22), the BI check parameters
  within fixed platform ranges (§12), the evidence size cap and accepted formats (§20), and export
  and retention settings (§23, §25.4). Every save writes a versioned, logged configuration change.
- **Route:** Org Admin control plane, tab `Governance` (`org-control-tab-governance`).
- **Rights:** `edit_config`.
- **Data:** `getLifecycleSettings()`, `saveLifecycleSettings(s)`, `getWorkflowSettings()`,
  `saveWorkflowSettings(s)`, `getExportRetention()`, `saveExportRetention(s)`, `getUploadLimits()`,
  `saveUploadLimits(mb, exts)`, `listFindingSections()`, `upsertFindingSection(...)`,
  `deleteFindingSection(id)`, `listMethodologyScales()`, `upsertMethodologyScale(...)`,
  `listFsliMappings()`, `upsertFsliMapping(...)`, `listNotificationRules()`,
  `upsertNotificationRule(...)`, `listBiParameters()`, `setBiParameter(key, value)`
  (`src/data/governance.ts`).
- **Testids:** `oa-governance`, `oa-governance-loading`, `oa-governance-error`, `oa-governance-empty`,
  `oa-governance-result`, `oa-governance-lifecycle`, `oa-governance-testing-mode`,
  `oa-governance-signoff-planning`, `oa-governance-signoff-testing`, `oa-governance-signoff-conclusion`,
  `oa-governance-opinion-required`, `oa-governance-lifecycle-save`, `oa-governance-findings`,
  `oa-governance-findings-list`, `oa-governance-findings-empty`, `oa-governance-section-<roleTag>`,
  `oa-governance-section-delete-<roleTag>`, `oa-governance-section-tag`, `oa-governance-section-label`,
  `oa-governance-section-position`, `oa-governance-section-add`, `oa-governance-methodology`,
  `oa-governance-scales-list`, `oa-governance-scale-<key>`, `oa-governance-scale-key`,
  `oa-governance-scale-label`, `oa-governance-scale-add`, `oa-governance-fsli-list`,
  `oa-governance-fsli-<code>`, `oa-governance-fsli-code`, `oa-governance-fsli-label`,
  `oa-governance-fsli-category`, `oa-governance-fsli-add`, `oa-governance-workflow`,
  `oa-governance-sla-hours`, `oa-governance-escalation-hours`, `oa-governance-escalation-role`,
  `oa-governance-workflow-save`, `oa-governance-notifications`, `oa-governance-rules-list`,
  `oa-governance-rules-empty`, `oa-governance-rule-<eventKey>`, `oa-governance-rule-event`,
  `oa-governance-rule-roles`, `oa-governance-rule-supervisor`, `oa-governance-rule-add`,
  `oa-governance-bi`, `oa-governance-bi-list`, `oa-governance-bi-<checkKey>`,
  `oa-governance-bi-value-<checkKey>`, `oa-governance-bi-save-<checkKey>`, `oa-governance-uploads`,
  `oa-governance-max-file-mb`, `oa-governance-ext-<ext>`, `oa-governance-uploads-save`,
  `oa-governance-retention`, `oa-governance-export-schedule`, `oa-governance-activity-retention`,
  `oa-governance-population-retention`, `oa-governance-retention-save`., `oa-governance-grace-hours`,
  `oa-governance-stage-section`, `oa-governance-stage-machine`, `oa-governance-stage-loading`,
  `oa-governance-stage-error`, `oa-governance-stage-result`, `oa-governance-stage-custom`,
  `oa-governance-stage-list`, `oa-governance-stage-<key>`, `oa-governance-stage-label-<key>`,
  `oa-governance-stage-inuse-<key>`, `oa-governance-stage-remove-<key>`, `oa-governance-stage-add-row`,
  `oa-governance-stage-new-key`, `oa-governance-stage-new-label`, `oa-governance-stage-new-anchor`,
  `oa-governance-stage-add`, `oa-governance-stage-save`, `oa-governance-stage-reset`,
  `oa-governance-stage-saved`
- **States:** loading, error, empty, ready; an inline result line reports a saved change or the plain
  refusal (a value outside the platform range, an unknown role tag, an unsupported format).

## OA-22b — report template (Phase 3.4, §15.2)

- **Purpose:** the organisation's report template — which of the five report sections a composed
  report contains, and in what order. Saving writes a new versioned, logged template (0088's
  hash chain) and the next `compose_report` follows it; with nothing saved the default five-section
  order applies. The section ids are a closed set, so a template can never name a section the
  product cannot render.
- **Route:** Org Admin control plane, tab `Report template` (`org-control-tab-templates`).
- **Rights:** `edit_config`.
- **Data:** `listReportTemplates()`, `saveReportTemplate(modelId, title, sections)`,
  `REPORT_SECTION_IDS` (`src/data/governance.ts`).
- **Testids:** `report-template-panel`, `report-template-loading`, `report-template-error`,
  `report-template-no-right`, `report-template-denied`, `report-template-version`,
  `report-template-result`, `report-template-save-error`, `report-template-sections`,
  `report-template-empty`, `report-template-section-<id>`, `report-template-up-<id>`,
  `report-template-down-<id>`, `report-template-remove-<id>`, `report-template-add-row`,
  `report-template-add-<id>`, `report-template-save`.
- **States:** loading, error, empty (no sections chosen), ready; an inline result line reports the
  saved change or the plain refusal (an unknown section id, an empty template).
- **Tutorial key:** `oa.governance`.

## OA-23 — connectors and continuous monitoring (WRITE-1, W11.6)

The connector catalogue and instance setup (mapping through dropdowns, never raw JSON), the run
history and health, the staged-record browser with drill-through, the monitor rules, and the alert
triage queue with a detail pane showing the alert's lineage. Credentials are a stored reference the
platform holds, never a value this screen sees.

- **Route:** Org Admin control plane, tab `Connectors` (`org-control-tab-connectors`).
- **Rights:** `edit_config` to save an instance, rule or triage; `view_insights` to read.
- **Data:** `listConnectorInstances(orgId)`, `saveConnectorInstance(...)`, `listConnectorRuns(orgId)`,
  `listStagedRecords(orgId)`, `listMonitorRules(orgId)`, `saveMonitorRule(...)`,
  `releaseMonitorRule(id, expectedCells)`, `listAlerts(orgId)`, `triageAlert(...)`,
  `connectorEgressAllowed(orgId, host)` (`src/data/writing.ts`).
- **Testids:** `wk-connectors-loading`, `wk-connectors-error`, `wk-connectors-retry`,
  `wk-connectors-panel`, `wk-connectors-tab-<id>`, `wk-connectors-catalogue`, `wk-connectors-label`,
  `wk-connectors-credential`, `wk-connectors-save`, `wk-connectors-saved`, `wk-connectors-instances`,
  `wk-connectors-instance-<id>`, `wk-connectors-runs`, `wk-connectors-runs-empty`,
  `wk-connectors-instance-<id>-run`, `wk-connectors-run-result`,
  `wk-connectors-run-<id>`, `wk-connectors-staged`, `wk-connectors-staged-empty`,
  `wk-connectors-staged-<id>`, `wk-connectors-rules`, `wk-connectors-rules-empty`,
  `wk-connectors-rule-id`, `wk-connectors-rule-description`, `wk-connectors-rule-save`,
  `wk-connectors-alerts`, `wk-connectors-alerts-empty`, `wk-connectors-alerts-list`,
  `wk-connectors-alert-detail`, `wk-connectors-alert-detail-reason`,
  `wk-connectors-alert-detail-lineage`, `wk-connectors-alert-triage-form`,
  `wk-connectors-alert-triage-reason`, `wk-connectors-alert-triage-snooze`,
  `wk-connectors-alert-triage-save`, `wk-connectors-egress`, `wk-connectors-egress-host`,
  `wk-connectors-egress-check`, `wk-connectors-egress-result`, `wk-connectors-new`,
  `wk-connectors-rule-new`, `wk-connectors-empty`.
- **States:** loading, error, empty, ready; an inline result line reports a saved change or the plain
  refusal. The egress check shows whether a host is on the tenant's allow-list.
- **Tutorial key:** `oa.connectors`.

## OA-24 — report format editor (WRITE-1, owner instruction 2026-10-26)

The interactive format editor. A format is held per client (one tenant organisation) and versioned.
The editor works on a live draft: reorder blocks, hide them, give a block its own register from the
set the model allows, and change the print layout, watching the page preview update as the controls
change. A format is presentation only, so the graph root is identical whatever the format and only
the render hash moves. The audience tab maps each of the client's own roles to view or edit; the
database still decides by right at call time. No screen accepts JSON.

- **Route:** Org Admin control plane, tab `Report formats` (`org-control-tab-formats`).
- **Rights:** `edit_config` to save, publish or set audiences; `view_reports` to read.
- **Data:** `listReportFormats(orgId)`, `saveReportFormat(...)`, `publishReportFormat(id, issueCount)`,
  `listFormatAudiences(formatId)`, `setFormatAudiences(formatId, audiences)` (`src/data/writing.ts`).
- **Testids:** `wk-format-loading`, `wk-format-error`, `wk-format-retry`, `wk-format-panel`,
  `wk-format-controls`, `wk-format-format-pick`, `wk-format-model-pick`, `wk-format-locale-pick`,
  `wk-format-label-input`, `wk-format-status`, `wk-format-version`, `wk-format-status-value`,
  `wk-format-issues`, `wk-format-published-note`, `wk-format-pane-tabs`, `wk-format-pane-<pane>`,
  `wk-format-blocks`, `wk-format-block-<key>`, `wk-format-block-<key>-key`, `wk-format-block-<key>-role`,
  `wk-format-block-<key>-register`, `wk-format-block-<key>-visible`, `wk-format-block-<key>-up`,
  `wk-format-block-<key>-down`, `wk-format-add-missing`, `wk-format-issue-list`,
  `wk-format-issue-<code>`, `wk-format-layout`, `wk-format-layout-page-size`,
  `wk-format-layout-marginTopMm`, `wk-format-layout-marginRightMm`, `wk-format-layout-marginBottomMm`,
  `wk-format-layout-marginLeftMm`, `wk-format-layout-font-heading`, `wk-format-layout-font-body`,
  `wk-format-layout-footer`, `wk-format-layout-tokens`, `wk-format-block-<key>-label`,
  `wk-format-contents`, `wk-format-contents-note`, `wk-format-contents-enabled`,
  `wk-format-contents-title`, `wk-format-contents-depth`, `wk-format-contents-title-scale`,
  `wk-format-contents-numbered`, `wk-format-contents-dot-leaders`, `wk-format-contents-indent`,
  `wk-format-audiences`,
  `wk-format-audiences-note`, `wk-format-audiences-empty`, `wk-format-audience-<slug>`,
  `wk-format-audience-<slug>-view`, `wk-format-audience-<slug>-edit`, `wk-format-audiences-save`,
  `wk-format-versions`, `wk-format-version-<n>`, `wk-format-version-<n>-load`, `wk-format-preview`,
  `wk-format-preview-summary`, `wk-format-preview-blocks`, `wk-format-preview-<key>`,
  `wk-format-preview-hidden`, `wk-format-preview-registers`, `wk-format-save`, `wk-format-publish`,
  `wk-format-result`, `wk-format-readonly`, `wk-format-create-default`, `wk-format-empty`.
- **States:** loading, error, empty, ready; an inline result line reports a saved change, a publish,
  or the plain refusal; the editor lists every validation issue precisely.
- **Tutorial key:** `oa.formats`.

## WK-11 — report builder (WRITE-1, W12)

The deterministic report builder, mounted as the "Report builder" view inside the existing Audit File
window (never a new tab, spec §28). It composes a report from the frozen fixture claim graph through
the real engine, so the screen and the library agree: choose a model, formality, tone, voice and
locale; read each claim with its phrase version, claim level and reference count; open "Why this
sentence" for the provenance trace and the counterfactual; read the coverage reconciliation, the
contradictions and the excluded observations; compare two versions; and run the freeze-and-issue
flow, which names every blocker precisely. The graph root is identical for every register and locale;
only the render hash moves (W1, W2.2, W4, W5, W6, W8, W12).

- **Route:** the Audit File window, view "Report builder" (`audit-file-view-builder`).
- **Rights:** `review_and_approve` or `approve_plan` to compose; a caller without either sees the
  plain refusal, never the panel.
- **Data:** the pure engine in `src/lib/writing/` — `composeReport` (`compose.ts`),
  `reconcileCoverage`, `findContradictions`, `checkReferenceIntegrity` (`verify.ts`),
  `compareReportVersions`, `compareRenders` (`versioning.ts`), `applyApprovalGate`, `checkStaleness`
  (`observations.ts`), `provenanceTrace`, `counterfactualRegister`, `verifyTrace` (`explain.ts`),
  `lineagePanel` (`lineagePanel.ts`), `FIGURE_FUNCTIONS` (`figures.ts`), `REPORT_MODELS`,
  `modelById` (`models.ts`), `FORMALITY_DEFINITIONS`, `TONE_DEFINITIONS`, `VOICES`,
  `DEFAULT_REGISTER` (`registers.ts`), the frozen fixtures (`fixtures.ts`), and the figure bridge
  (`src/lib/render/figure.ts`: `figureChart`, `figureSvg`, `figurePng`, `figureError`) that draws a
  formula figure with the one pure engine used by the PDF and the DOCX.
- **Testids:** `audit-file-builder`, `audit-file-view-builder`, `wk-report-builder-panel`,
  `wk-report-builder-loading`, `wk-report-builder-error`, `wk-report-builder-error-message`,
  `wk-report-builder-retry`, `wk-report-builder-denied`, `wk-report-builder-denied-error`,
  `wk-report-builder-controls`, `wk-report-builder-model`, `wk-report-builder-formality`,
  `wk-report-builder-tone`, `wk-report-builder-voice`, `wk-report-builder-locale`,
  `wk-report-builder-hashes`, `wk-report-builder-graph-root`, `wk-report-builder-render-hash`,
  `wk-report-builder-model-name`, `wk-report-builder-pane-claims`, `wk-report-builder-pane-coverage`,
  `wk-report-builder-pane-contradictions`, `wk-report-builder-pane-excluded`,
  `wk-report-builder-pane-compare`, `wk-report-builder-pane-figures`, `wk-report-builder-claims`, `wk-report-builder-claim-<id>`,
  `wk-report-builder-claim-<id>-text`, `wk-report-builder-claim-<id>-phrase`,
  `wk-report-builder-claim-<id>-provenance`, `wk-report-builder-claim-<id>-lineage`,
  `wk-report-builder-claim-<id>-provenance-panel`, `wk-report-builder-claim-<id>-trace-ok`,
  `wk-report-builder-claim-<id>-counterfactual`, `wk-report-builder-lineage-<figureId>`,
  `wk-report-builder-lineage-<figureId>-description`, `wk-report-builder-lineage-<figureId>-count`,
  `wk-report-builder-lineage-<figureId>-records`, `wk-report-builder-coverage`,
  `wk-report-builder-coverage-status`, `wk-report-builder-coverage-missing`,
  `wk-report-builder-coverage-duplicated`, `wk-report-builder-coverage-orphaned`,
  `wk-report-builder-contradictions`, `wk-report-builder-contradictions-empty`,
  `wk-report-builder-contradiction-<ruleId>`, `wk-report-builder-excluded`,
  `wk-report-builder-excluded-empty`, `wk-report-builder-excluded-<observationId>`,
  `wk-report-builder-compare`, `wk-report-builder-compare-summary`,
  `wk-report-builder-compare-changed-<claimId>`, `wk-report-builder-compare-registers`,
  `wk-report-builder-figure-studio`, `wk-report-builder-figure-note`,
  `wk-report-builder-figure-presets`, `wk-report-builder-figure-preset-<name>`,
  `wk-report-builder-figure-expression`, `wk-report-builder-figure-help`,
  `wk-report-builder-figure-min-x`, `wk-report-builder-figure-max-x`,
  `wk-report-builder-figure-title`, `wk-report-builder-figure-label`,
  `wk-report-builder-figure-colours`, `wk-report-builder-figure-colour-<name>`,
  `wk-report-builder-figure-preview`, `wk-report-builder-figure-preview-svg`,
  `wk-report-builder-figure-error`, `wk-report-builder-figure-add`,
  `wk-report-builder-figure-added`, `wk-report-builder-figure-limits`,
  `wk-report-builder-figures-added`, `wk-report-builder-figure-added-<i>`,
  `wk-report-builder-freeze`, `wk-report-builder-freeze-run`, `wk-report-builder-freeze-result`.
- **States:** loading ("Composing the report…"); an inline error with a retry; a denied state for a
  caller without the right; ready, with the five panes and the freeze panel. The coverage pane names
  each missing, duplicated and orphaned item; the freeze panel lists every blocker or states that the
  freeze is allowed with the graph root and render hash.
- **Tutorial key:** `oa.report-builder`.

## OA-25 — methodology library (Phase 4, §10.1, §11.3)

The organisation's methodology library: every audit type's current procedure, its version, and its
ordered test steps (a label, a kind, and whether evidence is required). Editing writes a new version;
publishing makes a version current. An engagement snapshots the current procedure, so a later edit
never rewrites a workpaper already in progress. The step kinds are a closed set the database enforces.

- **Route:** `/admin`, tab `Methodology` (`org-control-tab-methodology`).
- **Rights:** `edit_config`; a caller without it sees the plain refusal, never the panel.
- **Data:** `listProcedureTemplates`, `getProcedureTemplate`, `saveProcedureTemplate`,
  `publishProcedureTemplate`, `applyTemplateToWorkpaper`, `listWorkpaperSteps`, `STEP_KINDS`,
  `STEP_KIND_LABELS` (`src/data/methodology.ts`).
- **Testids:** `methodology-panel`, `methodology-no-right`, `methodology-denied`,
  `methodology-loading`, `methodology-error`, `methodology-version`, `methodology-list`,
  `methodology-empty`, `methodology-template-<model>`, `methodology-save-error`,
  `methodology-result`, `methodology-title`, `methodology-description`, `methodology-steps`,
  `methodology-steps-empty`, `methodology-step-<key>`, `methodology-step-label-<key>`,
  `methodology-step-kind-<key>`, `methodology-step-evidence-<key>`, `methodology-step-up-<key>`,
  `methodology-step-down-<key>`, `methodology-step-remove-<key>`, `methodology-add-step`,
  `methodology-save`, `methodology-publish`.
- **States:** loading; error; a denied state; ready with the template list and the step editor; an
  inline result or refusal after a save or publish.
- **Tutorial key:** `oa.governance`

## WK-09 — procedure steps on a workpaper (Phase 4, §11.3)

The steps a workpaper follows, snapshotted from the organisation's methodology library. A preparer
chooses a procedure for the engagement's audit type and applies it; the steps appear with their kind
and whether evidence is required. Ticking a step persists through `set_test_step_state`, and
`finalize_testing` refuses to close fieldwork while an applied step is open. A workpaper with no
applied procedure shows the legacy seed steps instead, so nothing that worked before regresses.

- **Route:** the workpaper window, sub-tab "Testing" (`wk-subtab-testing`).
- **Rights:** `perform_work`; the write is refused in the database without it.
- **Data:** `listWorkpaperSteps`, `listProcedureTemplates`, `applyTemplateToWorkpaper`,
  `STEP_KIND_LABELS` (`src/data/methodology.ts`).
- **Testids:** `procedure-steps-panel`, `procedure-model`, `procedure-apply`,
  `procedure-steps-message`, `procedure-steps-empty`, `procedure-step-<key>`.
- **States:** loading; empty (no procedure applied); ready with the applied steps; an inline refusal
  after a failed apply or tick.
- **Tutorial key:** `wk.testing`

## OA-33 — Systeligon rule packs (S10/S11, spec §4/§8)

The configuration surface for the signed rule packs the forensic engine runs. List the packs this
organisation can run, see a pack's version and content hash, save a signed pack, release a draft so
the engine may run it, and read the refusal log — a save the server cannot verify is refused and
logged, and the log is shown here so a rejection is never silent. The ad-hoc rule builder turns a
source attribute, a condition and a threshold into a versioned rule, previewed over fixed sample rows
before it is saved.

The signature is the control (§8): whoever can push a pack can change what the engine concludes, so
a pack is signed over its content hash with the organisation's signing key. The keypair is generated
in the browser; only the public half is registered, and registering retires the previous live key.

- **Route:** the Org Admin control panel, tab "Rule packs" (`org-control-tab-packs`).
- **Rights:** `edit_config` to generate a key, register it, save a pack and release one; any member of
  the org reads the pack list and the refusal log.
- **Data:** `listRulePacks`, `listRulePackRefusals`, `saveSignedRulePackArtifact`, `releaseRulePack`,
  `registerSigningKey`, `generateSigningKey` (`src/data/rulePacks.ts`); `definePack`, `runAdhocRule`,
  `justBelowThreshold`, `AdhocRuleSpec`, `RulePack`, `SysteligonRule` (`src/lib/systeligon`).
- **Testids:** `rule-pack-panel`, `rule-pack-loading`, `rule-pack-load-error`, `rule-pack-error`,
  `rule-pack-notice`, `rule-pack-rights-note`, `rule-pack-key`, `rule-pack-key-id`,
  `rule-pack-key-generate`, `rule-pack-key-register`, `rule-pack-key-fingerprint`,
  `rule-pack-list-section`, `rule-pack-empty`, `rule-pack-registry`, `rule-pack-row-<i>`,
  `rule-pack-draft-<i>`, `rule-pack-released-<i>`, `rule-pack-release-<i>`, `rule-pack-save`,
  `rule-pack-adhoc`,
  `rule-pack-adhoc-id`, `rule-pack-adhoc-source`, `rule-pack-adhoc-condition`,
  `rule-pack-adhoc-threshold`, `rule-pack-adhoc-severity`, `rule-pack-adhoc-preview`,
  `rule-pack-adhoc-result`, `rule-pack-refusals`, `rule-pack-refusals-empty`, `rule-pack-refusal-list`,
  `rule-pack-refusal-<id>`.
- **States:** loading; error; a denied state (no `edit_config`); ready with the pack list, the key
  controls and the refusal log; empty (`rule-pack-empty`); an inline result or refusal after a save or
  release.
- **Tutorial key:** `oa.governance`

## OA-34 — assurance capabilities (S2: D5 / D7 / D8 / D9)

The screen surface for the four owner-approved assurance capabilities of docs/ASSURANCE-RULEBOOKS.md.
Each capability has a pure engine under `src/lib/assurance/**`; this screen loads its inputs through
`src/data/assurance.ts`, hands them to the engine, shows the result, and records the findings through
the capability's writer. Nothing is generated text and nothing calls out.

- **D5 — ICFR continuous control monitoring.** Monitors a configured internal-control system over COSO
  ICIF-2013 and classifies a failing control by the PCAOB AS 2201 ladder (deficiency / significant
  deficiency / material weakness). A control with no rule is shown unmonitored and a control with no
  evidence is shown as no evidence — neither is ever a pass. A compensating control caps the severity
  at a deficiency, and every breach names its control id, the rule id and version, and the basis.
- **D7 — population-level forensic analytics.** Runs the named forensic rules (Benford first and second
  digit, the AS 2401 journal-entry family, ISA 530) over a whole locked population; each finding names
  its rule, version and source. An empty population is not clean.
- **D8 — policy-to-control gap analysis.** Maps a regulation's obligations to the controls that satisfy
  them and reports every gap by its clause. A clause that cannot be interpreted is reported as such,
  never as compliant.
- **D9 — assurance over assurance.** Measures the audit function against the IIA Global Internal Audit
  Standards (2024); a metric whose input is missing is "unknown", never 0.

- **Route:** the assurance capabilities work surface (inspector `assurance_caps`; also reachable from
  the command palette action "Assurance capabilities").
- **Rights:** `perform_work` or `review_and_approve` to run a capability and record its findings;
  `view_insights` to read.
- **Data:** `listIcfrConfig`, `runIcfrMonitoring`, `runForensicAnalytics`, `runGapAnalysis`,
  `runAssuranceOverAssurance` (`src/data/assurance.ts`); the pure engines
  `monitorControls`, `classifySeverity`, `SEVERITY_LADDER`, `TAXONOMIES` (`src/lib/assurance/controlMonitoring.ts`),
  `FORENSIC_RULES` (`src/lib/assurance/forensicAnalytics.ts`).
- **Testids:** `assurance-panel`, `assurance-loading`, `assurance-error`, `assurance-error-message`,
  `assurance-retry`, `assurance-tab-d5`, `assurance-tab-d7`, `assurance-tab-d8`, `assurance-tab-d9`,
  `assurance-notice`, `assurance-run-error`, `assurance-d5`, `assurance-d5-run`,
  `assurance-d5-needs-right`, `assurance-d5-result`, `assurance-d5-complete`, `assurance-d5-breaches`,
  `assurance-d5-breach-<id>`, `assurance-d5-no-evidence`, `assurance-d5-unmonitored`,
  `assurance-d5-empty`, `assurance-d5-ladder`, `assurance-d7`, `assurance-d7-population`,
  `assurance-d7-run`, `assurance-d7-result`, `assurance-d7-empty`, `assurance-d7-findings`,
  `assurance-d7-finding-<id>`, `assurance-d8`, `assurance-d8-run`, `assurance-d8-result`,
  `assurance-d8-coverage`, `assurance-d8-gaps`, `assurance-d8-gap-<id>`, `assurance-d8-unknown`,
  `assurance-d9`, `assurance-d9-run`, `assurance-d9-result`, `assurance-d9-summary`,
  `assurance-d9-metric-<id>`, `assurance-d5-config`, `assurance-d5-control-id`,
  `assurance-d5-component`, `assurance-d5-assertion`, `assurance-d5-owner`, `assurance-d5-procedure`,
  `assurance-d5-save-control`, `assurance-d5-tolerance`, `assurance-d5-save-rule`,
  `assurance-d5-population`, `assurance-d5-deviations`, `assurance-d5-save-evidence`,
  `assurance-d9-config`, `assurance-d9-metric-id`, `assurance-d9-standard`, `assurance-d9-label`,
  `assurance-d9-value`, `assurance-d9-save-metric`.
- **States:** loading; error with retry; ready with the four tabs; a denied state (no work right shows
  `assurance-d5-needs-right`); empty (`assurance-d5-empty` when no control is configured); an inline
  result or the plain refusal after a run.

## OA-36 — Documents, minutes and policy review (S7)

The document-review surface: the auditor attaches the engagement's documents, declares what each one
IS, and chooses which reviews to run. The engine runs every option selected over the whole set — the
declared-type check, the structural document rules, the minutes action register, the policy/procedure
comparison and the structural pattern rules — and reports each finding with its rule id, version and
the clauses it cited. The engine asks; it does not assume.

Two verdicts are shown before any finding, because everything else depends on them. The declared-type
check compares the auditor's claim against the document's own declared shape (a fixed marker table,
never a model): a document filed as minutes whose text reads as a regulation is flagged `discrepant`
before its "missing quorum" is trusted, and a document the check cannot recognise is reported
`unconfirmable`, never a fabricated disagreement. The coverage lines report what the structure parser
and the comparison parsed and what they could not interpret, so an unparsed clause is never presented
as a clean one. A scan (an extraction with no text layer) is reported as a scan and routed to the
bundled OCR seam, which refuses a remote engine so nothing leaves the tenant.

- **Route:** the engagement's document review (the documents work surface).
- **Rights:** `perform_work` to run a review and to record the findings; any member of the org reads
  the documents and their extraction.
- **Data:** `listEvidenceFiles`, `loadExtractionText`, `recordDocumentReviewFindings`
  (`src/data/documentReview.ts`); `runRules`, `parseDocumentStructure`, `buildActionRegister`,
  `compareDocuments`, `assessDocType`, `REVIEW_OPTIONS`, `resolveReviewOptions`, `rulesForOptions`,
  `ALL_REVIEW_OPTIONS`, `DOC_KINDS` (`src/lib/systeligon`).
- **Testids:** `docreview-panel`, `docreview-rights-note`, `docreview-error`, `docreview-loading`,
  `docreview-load-error`, `docreview-no-engagement`, `docreview-empty`, `docreview-options`,
  `docreview-option-toggle-all`, `docreview-option-<id>`, `docreview-file-list`, `docreview-file-<i>`,
  `docreview-file-include-<i>`, `docreview-declared-<i>`, `docreview-run`, `docreview-verdicts`,
  `docreview-verdict-discrepant-note`, `docreview-verdict-<ref>`, `docreview-verdict-state-<ref>`,
  `docreview-coverage`, `docreview-coverage-<ref>`, `docreview-results`, `docreview-summary`,
  `docreview-skipped`, `docreview-findings`, `docreview-findings-empty`, `docreview-finding-<i>`,
  `docreview-record`, `docreview-recorded`, `minutes-register`, `minutes-register-empty`,
  `minutes-item-<i>`, `policydiff`, `policydiff-coverage`, `policydiff-findings`,
  `policydiff-finding-<i>`, `policydiff-empty`.
- **States:** loading; error; no engagement selected; empty (no documents); ready with the option
  picker and the document list; a denied state (no `perform_work`); a run with the declared-type
  verdicts, the coverage lines, the findings table, the action register and the comparison; an inline
  result after recording.
- **Tutorial key:** —

## OA-39 — Global document search (S7)

One box that full-text-searches the text of every extracted document in the organisation and returns
only the documents the caller's rights let them see. Where the Document Viewer (OA-35) searches inside
one engagement, this surface answers "where in this organisation does this phrase appear?" — always
within the caller's scope.

The search, the organisation filter and the scope filter are all the database's
(`global_document_search`, migration `0190`): it reads `document_extractions.extracted_text` and applies
the same access predicate the `engagements` RLS policy uses (`can_read_all_scopes()` or
`has_scope(universe_id, entity_id, engagement_id)`). A document outside the caller's scope, or in
another tenant, is simply absent — the screen cannot surface it and does not learn that it exists. A
blank query is refused by name, so the screen shows the reason rather than an unbounded list. Every hit
names the file, its stage, and the engagement, entity and universe it belongs to, so a result is never
an unplaceable snippet.

- **Route:** the "Search all documents" action in the command palette (`Cmd/Ctrl-K`), opening the
  search surface.
- **Rights:** any read right — `perform_work`, `review_and_approve`, `read_only` or `view_all_scopes`.
  A configuration-only principal sees the reason it cannot search and no search box.
- **Data:** `searchDocumentsGlobal` (`src/data/globalSearch.ts`) → `global_document_search` (0190).
- **Testids:** `globalsearch-panel`, `globalsearch-rights-note`, `globalsearch-input`,
  `globalsearch-loading`, `globalsearch-refusal`, `globalsearch-error`, `globalsearch-idle`,
  `globalsearch-empty`, `globalsearch-count`, `globalsearch-results`, `globalsearch-hit-<fileId>`,
  `globalsearch-snippet-<fileId>`, `globalsearch-place-<fileId>`.
- **States:** denied (no read right); idle (no query yet); searching; a named refusal (a blank query);
  a load error; empty (nothing within the caller's access matches); ready with the count and the
  ranked hits, each naming its place.
- **Tutorial key:** —

## OA-38 — Ad-hoc review builder (S7)

The auditor's own condition builder — a SEPARATE module from the document-review screen (OA-36). The
system's review flow runs unprompted; this screen exists only when the auditor asks for it. They
describe ONE condition of their own (a source attribute, an operator and a threshold), see a
deterministic preview over a fixed sample, and release it as a normal versioned rule. The built rule
runs through the same runner and its findings carry its id and version like any shipped rule. It is a
declared condition over the data, not a model: nothing is inferred and nothing is generated.

- **Route:** the "Build an ad-hoc rule" action in the command palette (`Cmd/Ctrl-K`).
- **Rights:** `perform_work` to build and preview a rule; a principal without it sees the reason and
  no builder.
- **Data:** pure — `buildAdhocRule`, `runAdhocRule` (`src/lib/systeligon`). The preview runs over a
  fixed sample, so it reads no tenant row and no clock (the run instant is captured at Run and passed
  in).
- **Testids:** `adhoc-review-panel`, `adhoc-review-rights-note`, `adhoc-review-form`,
  `adhoc-review-title`, `adhoc-review-source`, `adhoc-review-condition`, `adhoc-review-threshold`,
  `adhoc-review-threshold2`, `adhoc-review-severity`, `adhoc-review-result`, `adhoc-review-summary`,
  `adhoc-review-preview`, `adhoc-review-findings`, `adhoc-review-finding-<i>`, `adhoc-review-empty`.
- **States:** denied (no `perform_work`); ready (the builder form); an invalid spec (a named refusal,
  nothing previewed); a preview with its findings, or an honest empty preview.
- **Tutorial key:** —

## OA-37 — client classification and the standards library (S3: D10)

The screen surface for the C1–C8 classification of docs/PAKISTAN-ASSURANCE-REGIMES.md and the
configurable framework/standard library it selects. The classification is a switch, not a label: it
decides whether internal audit and ICFR are mandatory and at what rigour, the frameworks and artifacts
the regime requires, the regulator's numbering the product cites, and the audit disciplines offered.
A classification the matrix does not name is refused, never guessed; every obligation it creates names
its clause.

- **Route:** the audit-universe surface (inspector `classification`; also reachable from the command
  palette action "Client classification").
- **Rights:** `edit_config` to set the classification, configure the library and derive risks; a
  principal without it sees a read-only notice and disabled actions.
- **Data:** `readClassification`, `listClassificationObligations`, `setClassification`,
  `listStandards`, `updateStandard`, `deriveRisks`, `listDerivedRisks` (`src/data/risk.ts`); the pure
  matrix `CLASSIFICATIONS`, `classifyClient`, `obligationsFor` (`src/lib/risk/classification.ts`) and
  the discipline set `selectableDisciplines` (`src/lib/risk/domains.ts`). Writers:
  `classification_set`, `standards_update_scope`, `risk_library_derive` (`0149`).
- **Configurability:** the standards library is updatable for one organisation (`This org`), for every
  organisation at once (`All orgs`, platform administrator only), or as the platform default. An
  all-orgs update writes one version and one ledger entry per org in a single transaction.
- **Testids:** `classification-panel`, `classification-loading`, `classification-error`,
  `classification-empty`, `classification-current`, `classification-version`, `classification-regulator`,
  `classification-ia`, `classification-icfr`, `classification-numbering`, `classification-disciplines`,
  `classification-frameworks`, `classification-artifacts`, `classification-obligations`,
  `classification-obligation-<id>`, `classification-set`, `classification-pick`, `classification-islamic`,
  `classification-it`, `classification-save`, `classification-standards`, `classification-standard-<key>`,
  `classification-standard-scope-<key>`, `classification-standard-org-<key>`,
  `classification-standard-platform-<key>`, `classification-standard-all-<key>`, `classification-derive`,
  `classification-derive-run`, `classification-derived-count`, `classification-derived-empty`,
  `classification-notice`, `classification-denied`.
- **States:** denied (no `edit_config`); empty (no classification set); ready (the current
  classification, its obligations and the library); a named refusal from a writer, surfaced not
  swallowed; an error reading the classification.
- **Tutorial key:** —

## SR-04 — risk library and dynamic risk assessment (S3: D14 / D15)

The screen surface for the D14 auto-adjusted risk factors and the D15 dynamic risk assessment
(docs/RISK-ASSESSMENT-MODEL.md §8, docs/ASSURANCE-RULEBOOKS.md §6). Every auto-derived value is a
proposal that names its rule and version; an input the facts do not carry is "unknown", never 0, and
the factor weights normalise to exactly 100. Nothing is inferred and nothing is generated text.

- **D14 — auto-adjusted factors.** The panel derives the risk's factors from the entity's facts and
  writes them through `risk_factor_write`, which resolves the override over the auto value and
  recomputes the score over the normalised weights. A manual override carries a mandatory reason and
  keeps the auto value for provenance; it can be reverted.
- **D15 — the dynamic assessment.** The ERM theme map gives each enterprise risk theme a coverage
  verdict (direct / limited / monitoring / none); a top risk with no coverage is a gap. A KRI with no
  value or no tolerance is "unknown", never within. A trigger (KRI breach, incident, management
  request, strategic change) produces a plan-change proposal (track / defer / cancel / rescope) with a
  rationale.

- **Route:** the risk surface (inspector `risk_library`; also reachable from the command palette action
  "Risk library & dynamic assessment").
- **Rights:** `manage_engagements` or `edit_config` to auto-compute, override or propose; a principal
  without either sees a read-only notice and disabled actions.
- **Data:** `listRiskLibrary`, `readRiskScore`, `writeRiskFactors`, `setRiskOverride`,
  `revertRiskOverride`, `listCycles`, `listErmThemes`, `listKris`, `listPlanChanges`, `setErmTheme`,
  `setKriValue`, `proposePlanChange` (`src/data/risk.ts`); the pure engines
  `deriveFactors` (`src/lib/risk/derivation.ts`), `ermMap`, `kriState`, `planChangeFor`,
  `riskToCoverageNarrative`, `RISK_TAXONOMY_THEMES` (`src/lib/risk/dynamicAssessment.ts`) and
  `normalizeWeights` (`src/lib/siraEngine.ts`). Writers: `risk_factor_write`, `risk_override_set`,
  `risk_override_revert` (`0150`), `erm_theme_set`, `kri_value_set`, `plan_change_propose` (`0151`).
- **Testids:** `risk-panel`, `risk-loading`, `risk-error`, `risk-notice`, `risk-denied`, `risk-tabs`,
  `risk-tab-library`, `risk-tab-autocompute`, `risk-tab-erm`, `risk-tab-planning`, `risk-library`,
  `risk-library-row-<id>`, `risk-library-derived-count`, `risk-autocompute`, `risk-pick`, `risk-cycle`,
  `risk-autocompute-run`, `risk-factor-values`, `risk-factor-<key>`, `risk-weights`, `risk-override-factor`,
  `risk-override-value`, `risk-override-reason`, `risk-override-save`, `risk-override-revert`,
  `risk-erm`, `risk-erm-<theme>`, `risk-erm-gaps`, `risk-erm-empty`, `risk-kri-<id>`, `risk-kri-empty`,
  `risk-kri-add`, `risk-planning`, `risk-trigger-kind`, `risk-trigger-entity`, `risk-propose`,
  `risk-proposal-<id>`, `risk-proposals-empty`.
- **States:** denied (neither right); empty (no library rows); ready; a named refusal from a writer,
  surfaced not swallowed; an error reading the library.
- **Tutorial key:** —

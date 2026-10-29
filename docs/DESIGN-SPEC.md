# Design spec — screens, flows and design tokens

> **Auto-generated — do not edit by hand.** Run `npm run gen:design` to regenerate. The
> `designSpec` guard fails if this file drifts from its sources.

Derived from `docs/UI-INVENTORY.md` (the per-screen catalogue), `docs/ACP-UI-CONTRACT.md`
(authored routes), `src/lib/tutorialKeys.json` (every flow), `public/tutorials/` (recorded media)
and `src/styles/tokens.css` (the design tokens). It is the designer's catalogue: what exists
today, what each screen and flow is, and the design-language decisions the owner has **not** yet
settled. Nothing here is invented — where a value is a placeholder or a decision is open, it says
so.

## Summary

- **Screens:** 105 (each with purpose, route, rights, testids and states).
- **Flows (tutorial keys):** 81; 81 have recorded media in `public/tutorials/`, 0 have none.
- **Design presets:** `bone`, `ledger`, `porcelain`; **themes:** light, dark — 6 combinations.
- **Design tokens:** 25 unique variables across 6 preset/theme blocks in `src/styles/tokens.css`.
- **Open design decisions:** 9 (the design language below). Do not draw these yet.

## Open design decisions — the design language the owner holds

These rows are **DEFERRED by instruction**. Building on an unsettled design means rebuilding it,
so they are listed here as the boundary, not as work. Everything else on this branch is fair game.

| Row | What it is | Where it would land |
|---|---|---|
| E8 | PencilGuide — pencil-style guided pointers and guidance data | `src/lib/guidance/` (shared with A's U1/U3 — one module, not two) |
| U5 | Motion that signals a state change only | universal `prefers-reduced-motion` |
| U7 | Density toggle, remembered per user | comfortable / compact |
| U9 | Three themes `prism`, `bloom`, `slate` | new preset blocks in `src/styles/tokens.css` |
| U10 | Four audience profiles | which surfaces each profile sees |
| U11 | Time-of-day phases | lighting / tone by hour |
| U12 | Motion system | durations, easing, reduced-motion fallbacks |
| U13 | Animated headers | the header bar transition |
| A-U1 | Pencil-pointer surface | same surface as E8 |

## Screens

Every screen the product carries, with the facts a redesign must preserve. The testids are the
stable contract — a Playwright spec and the tutorial recorder bind only to them, so a redesign
keeps every testid.

### `GL-01` — consultation banner (S1)

- **Purpose:** a persistent, non-blocking strip shown to BOTH parties while a Dual Session is active: who, which tier, time left, and an End button (F4).
- **Route / location:** rendered inside the authenticated shell, below the header, on every screen. Not a route.
- **Rights required:** none to view (both parties see it). `edit_config` is required to *end* it as a tenant.
- **Testids (5):** `consultation-banner`, `consultation-banner-time`, `consultation-banner-end`, `consultation-banner-dismiss`, `consultation-banner-error`
- **States:** hidden when there is no active session or when dismissed; visible strip otherwise. Delivered live: a Supabase Realtime subscription on the published tables, with a 5 s poll as the documented fallback when Realtime is unavailable (`src/lib/liveSync.ts` decides the transport).
- **Flows that touch this screen:** `oa.dual-session`, `sa.dual-session`
- **Connection candidates (same route):** — (route is unique to this screen)

### `GL-02` — in-app notifications and pop-out live sync (§17.1, §22)

- **Purpose:** (a) the header bell lists the signed-in member's own in-app notifications and counts the unread ones; (b) a record opened as a same-origin pop-out (`/view/:recordType/:id`) stays in sync with the window that opened it through the shared origin storage.
- **Route / location:** the bell sits in the header on every authenticated screen (not a route). The pop-out is the `/view/:recordType/:id` route, opened by the floating-window pop-out button.
- **Rights required:** none beyond an authenticated session. A member sees only its own notifications; the `notifications_list` RPC and the `notifications` RLS policy bound the read to `org_id = jwt_org_id() and user_id = auth.uid()`.
- **Testids (17):** `notification-bell`, `notification-bell-count`, `notification-panel`, `notification-transport`, `notification-empty`, `notification-list`, `notification-<id>`, `notification-mark-read-<id>`, `wk-notifications`, `wk-notifications-transport`, `wk-notifications-unread`, `wk-notifications-empty`, `wk-notifications-list`, `wk-notification-<id>`, `wk-notification-mark-read-<id>`, `record-page-revision`, `record-page-refresh`
- **States:** bell badge hidden at zero unread; the panel shows `Live` or `Polling` from the chosen transport; an empty list renders "Nothing new."; the pop-out shows its current revision and a refresh control that publishes a new revision to the parent window.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `TUT-01` — tutorial drawer (S1)

- **Purpose:** the non-blocking player for a recorded tutorial: the GIF, numbered steps, "Copy steps" and "Did this help?" (F18).
- **Route / location:** a side drawer opened from any screen's "Show me how".
- **Rights required:** any signed-in user.
- **Testids (9):** `tutorial-drawer`, `tutorial-drawer-close`, `tutorial-drawer-media`, `tutorial-drawer-missing`, `tutorial-drawer-steps`, `tutorial-drawer-copy`, `tutorial-drawer-feedback`, `tutorial-drawer-yes`, `tutorial-drawer-no`
- **States:** media present (`tutorial-drawer-media`) or missing (`tutorial-drawer-missing`). `role="complementary"`, never a modal, never a scrim.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AX-01` — Sign-in screen (S1)

- **Purpose:** The single sign-in form for every audience; a session with no org lands on the no-tenant screen instead.
- **Route / location:** The unauthenticated shell (any route with no session).
- **Rights required:** none (unauthenticated).
- **Testids (3):** `signin-error`, `signin-form`, `signin-screen`
- **States:** ready; submitting; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AX-02` — No-tenant screen (S1)

- **Purpose:** Shown to a signed-in account that belongs to no organisation: it explains the state and offers a refresh.
- **Route / location:** The authenticated shell when the session has no org.
- **Rights required:** any signed-in account with no org.
- **Testids (2):** `no-tenant-refresh`, `no-tenant-screen`
- **States:** ready; refreshing.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-09` — Dual Session console (S1)

- **Purpose:** the platform side of the two-tier consultation: request a session for a tenant, acknowledge an invitation, end a session (F4).
- **Route / location:** `/superadmin`, tab `Dual Session`.
- **Rights required:** platform admin (`is_platform_admin()`); a session never grants audit content.
- **Testids (10):** `superadmin-consultation`, `superadmin-consultation-loading`, `superadmin-consultation-error`, `superadmin-consultation-result`, `superadmin-consultation-hours`, `superadmin-consultation-request`, `superadmin-consultation-empty`, `superadmin-consultation-<tenantId>`, `superadmin-consultation-ack-<tenantId>`, `superadmin-consultation-end-<tenantId>`
- **States:** loading, error (with Retry), empty (no tenants), ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-14` — features and plans (S1)

- **Purpose:** the platform feature catalogue with price class and default, and the per-tenant entitlement matrix. A change requires a reason and writes append-only history (F25).
- **Route / location:** `/superadmin`, tab `Features & plans`.
- **Rights required:** platform admin only. A tenant never writes entitlements.
- **Testids (11):** `superadmin-features`, `superadmin-features-loading`, `superadmin-features-error`, `superadmin-features-result`, `superadmin-features-empty`, `superadmin-feature-catalogue`, `feature-catalogue-<key>`, `superadmin-entitlements`, `entitlement-<key>`, `entitlement-reason-<key>`, `entitlement-toggle-<key>`
- **States:** loading, error (with Retry), empty (no tenants), ready. A toggle without a reason shows "A reason is required when you change a feature." and sends nothing.
- **Flows that touch this screen:** `sa.features`, `sa.plans`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-13` — tutorial library (S1)

- **Purpose:** registry health: missing, stale and ok, per Appendix A key (F18).
- **Route / location:** `/superadmin`, tab `Tutorials`.
- **Rights required:** platform admin.
- **Testids (4):** `superadmin-tutorials`, `superadmin-tutorials-loading`, `superadmin-tutorials-empty`, `tutorial-<key>`
- **States:** loading, empty, ready.
- **Flows that touch this screen:** `sa.tutorials`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-05` — platform notification recipients (S1)

- **Purpose:** the list of Super Admin alert addresses used for platform alerts and as the platform half of `config.changed` (F7).
- **Route / location:** `/superadmin`, tab `Recipients`.
- **Rights required:** platform admin.
- **Testids (7):** `superadmin-recipients`, `superadmin-recipients-loading`, `superadmin-recipients-empty`, `superadmin-recipients-input`, `superadmin-recipients-add`, `recipient-<address>`, `recipient-remove-<address>`
- **States:** loading, empty, ready. An invalid address is refused with a plain message.
- **Flows that touch this screen:** `sa.recipients`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-01`, `OA-01` — setup wizards (S1, framework)

- **Purpose:** two linear, persisted wizards with progress, per-step validation, Back, Save and exit, a resume banner and a tutorial on every step (F17).
- **Route / location:** `/superadmin` tab `Setup`; Org Admin control plane tab `Setup`.
- **Rights required:** platform admin for `super_admin`; `edit_config` for `org_admin`.
- **Testids (48):** `org_admin-wizard`, `org_admin-wizard-loading`, `org_admin-wizard-error`, `org_admin-wizard-empty`, `org_admin-wizard-resume`, `org_admin-wizard-progress`, `org_admin-wizard-steps`, `org_admin-wizard-body`, `org_admin-wizard-back`, `org_admin-wizard-skip`, `org_admin-wizard-save`, `org_admin-wizard-next`, `super_admin-wizard`, `super_admin-wizard-loading`, `super_admin-wizard-error`, `super_admin-wizard-resume`, `super_admin-wizard-progress`, `super_admin-wizard-steps`, `super_admin-wizard-body`, `super_admin-wizard-back`, `super_admin-wizard-save`, `super_admin-wizard-next`, `<scope>-wizard-step-<stepKey>`, `<scope>-wizard-show-<stepKey>`, `<scope>-wizard-content-<stepKey>`, `org_admin-wizard-step-org.profile`, `org_admin-wizard-show-org.profile`, `org_admin-wizard-content-org.golive`, `super_admin-wizard-step-sa.readiness`, `super_admin-wizard-show-sa.readiness`, `org.profile`, `org.features`, `org.roles`, `org.ai`, `org.presentation`, `org.escalation`, `org.hosting`, `org.email`, `org.golive`, `sa.readiness`, `sa.email`, `sa.recipients`, `sa.ai`, `sa.hosting`, `sa.rules`, `sa.features`, `sa.tutorials`, `sa.golive`
- **States:** loading, error (with Retry), empty, ready; a resume banner when a later step is open. A step whose `requiresFeature` is not entitled is hidden (F25).
- **Flows that touch this screen:** `sa.setup-wizard`, `sa.setup-1`, `sa.setup-2`, `sa.setup-3`, `sa.setup-4`, `sa.setup-5`, `sa.setup-6`, `sa.setup-7`, `sa.setup-8`, `oa.setup-wizard`, `oa.setup-1`, `oa.setup-2`, `oa.setup-3`, `oa.setup-4`, `oa.setup-5`, `oa.setup-6`, `oa.setup-7`, `oa.setup-8`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-04` — email sender profiles (S2)

- **Purpose:** the platform default sender, the per-tenant override, the fallback switch and a Test button per adapter (F6). A credential is never shown: only set / not set / last tested.
- **Route / location:** `/superadmin`, tab `Email senders`.
- **Rights required:** platform admin.
- **Testids (21):** `superadmin-email`, `superadmin-email-loading`, `superadmin-email-error`, `superadmin-email-result`, `superadmin-email-empty`, `superadmin-email-provider`, `superadmin-email-display-name`, `superadmin-email-from`, `superadmin-email-secret`, `superadmin-email-save`, `superadmin-email-list`, `sender-<id>`, `sender-test-<id>`, `sender-default-<id>`, `superadmin-email-org`, `superadmin-email-tenant-empty`, `superadmin-email-tenant-list`, `tenant-allow-<id>`, `tenant-deny-<id>`, `superadmin-email-saved`, `superadmin-email-connect-graph`
- **States:** loading, error (with Retry), empty ("No platform sender is set yet. Email is queued and not sent."), ready.
- **Flows that touch this screen:** `sa.email-resend`, `sa.email-microsoft`, `sa.email-smtp`, `sa.email-default`, `sa.email-force-tenant`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-07`, `SA-08` — automation rules and message templates (S2)

- **Purpose:** a visual rule editor (event + conditions + actions) and a visual template editor (blocks moved with up and down buttons). No screen accepts JSON (F1). Test with a sample event is a dry run that sends nothing (F7).
- **Route / location:** `/superadmin`, tab `Automation`; sub-tabs `Rules` and `Message templates`.
- **Rights required:** platform admin.
- **Testids (43):** `superadmin-automation`, `superadmin-automation-loading`, `superadmin-automation-error`, `superadmin-automation-result`, `superadmin-automation-saved`, `superadmin-automation-empty`, `superadmin-automation-tabs`, `superadmin-automation-tab-rules`, `superadmin-automation-tab-templates`, `rule-key`, `rule-name`, `rule-event`, `rule-enabled`, `rule-add-condition`, `rule-no-conditions`, `rule-condition-<i>`, `rule-condition-field-<i>`, `rule-condition-op-<i>`, `rule-condition-value-<i>`, `rule-condition-remove-<i>`, `rule-add-action`, `rule-no-actions`, `rule-action-<i>`, `rule-action-type-<i>`, `rule-action-message-<i>`, `rule-action-remove-<i>`, `rule-save`, `rule-list`, `rule-<key>`, `rule-test-<key>`, `rule-test-output`, `template-event`, `template-subject`, `template-blocks`, `template-block-<i>`, `template-block-text-<i>`, `template-block-up-<i>`, `template-block-down-<i>`, `template-block-remove-<i>`, `template-add-<type>`, `template-save`, `template-list`, `template-<eventKey>`
- **States:** loading, error (with Retry), empty (no rules / no platform sender), ready. The test output panel appears only after a test and always says "nothing was sent".
- **Flows that touch this screen:** `sa.automation`, `sa.templates`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-10`, `SA-11` — hosting fit check and hosting rules (S11, F16)

- **Purpose:** a searchable stack catalogue ("RDS", "Aurora", "Azure PG", "Cloud SQL", "Docker", "VMware", "SQL Server", "Oracle", "MySQL" and more) pre-fills a short questionnaire; the deterministic `evaluateFit` returns a verdict (any blocker → Red; else any warning → Amber; else Green), a cost tier, plain reasons and a "what the client must provide" checklist. SA-11 edits the rules visually, one field / operator / value / severity / cost tier per row.
- **Route / location:** `/superadmin`, tabs `Hosting fit` (`sa-hosting-tab-check`) and `Rules` (`sa-hosting-tab-rules`).
- **Rights required:** platform admin only.
- **Testids (26):** `sa-hosting`, `sa-hosting-loading`, `sa-hosting-error`, `sa-hosting-tabs`, `sa-hosting-tab-check`, `sa-hosting-tab-rules`, `sa-hosting-fit`, `sa-hosting-search`, `sa-hosting-search-empty`, `sa-hosting-search-results`, `sa-hosting-stack-<key>`, `sa-hosting-field-<field>`, `sa-hosting-verdict`, `sa-hosting-verdict-value`, `sa-hosting-cost`, `sa-hosting-reasons`, `sa-hosting-checklist`, `sa-hosting-rules`, `sa-hosting-rule-saved`, `sa-hosting-rule-<key>`, `sa-hosting-rule-enabled-<key>`, `sa-hosting-rule-field-<key>`, `sa-hosting-rule-op-<key>`, `sa-hosting-rule-value-<key>`, `sa-hosting-rule-sev-<key>`, `sa-hosting-rule-cost-<key>`
- **States:** loading; error (with Retry); a rule edit that fails reloads the catalogue and shows the error; the verdict region always renders.
- **Flows that touch this screen:** `sa.hosting-fit`, `sa.hosting-rules`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-12` — migration jobs and deployment kit (S11, F16)

- **Purpose:** platform staff pick a tenant and watch its migration job: status, per-step rows and checkpoints, the retention window. The Deployment Kit panel states the env template and hosting steps in plain words. The runner itself is a separate Node package (`tools/migration-runner/`).
- **Route / location:** `/superadmin`, tab `Migration jobs`.
- **Rights required:** platform admin only.
- **Testids (12):** `sa-migration`, `sa-migration-loading`, `sa-migration-error`, `sa-migration-tenant`, `sa-migration-refresh`, `sa-migration-jobs-loading`, `sa-migration-jobs-error`, `sa-migration-empty`, `sa-migration-job-<id>`, `sa-migration-job-error-<id>`, `sa-migration-steps-<id>`, `sa-deployment-kit`
- **States:** loading tenants; loading jobs; an empty jobs list; an inline job error; a failed job is flagged in cinnabar, an awaiting-cutover or retired job in verdigris.
- **Flows that touch this screen:** `sa.migration`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-02` — platform health, support grants and the read-only support session (C2.2, C2.9)

- **Purpose:** the platform's operations surface. It shows every scheduled job and its last run, lists the time-boxed support grants, and opens the tenant-granted, read-only support session that those grants unlock.
- **Route / location:** `/superadmin`, tab `Support access` (`superadmin-tab-support`).
- **Rights required:** platform admin (`is_platform_admin()`, `require_platform_admin()` in the database). The session additionally requires a live, unrevoked, unexpired `content_read` grant for the tenant.
- **Testids (24):** `superadmin-support`, `superadmin-support-loading`, `superadmin-support-error`, `superadmin-support-result`, `superadmin-support-empty`, `superadmin-support-session`, `superadmin-support-session-org`, `superadmin-support-session-open`, `superadmin-support-session-error`, `superadmin-support-session-open-panel`, `superadmin-support-session-count`, `superadmin-support-session-empty`, `superadmin-support-session-list`, `superadmin-support-session-read-result`, `superadmin-support-session-trail`, `support-engagement-<id>`, `support-read-<id>`, `superadmin-job-health`, `superadmin-job-health-error`, `superadmin-job-health-empty`, `superadmin-job-health-list`, `job-<jobName>`, `job-status-<jobName>`, `grant-<grantId>`
- **States:** loading grants; loading jobs; an empty jobs list (the scheduler is absent); an inline job error; a session that stays closed when no live grant exists, with the reason inline; an open session with the granted engagements; an inline refusal when the database rejects the call. No blocking modal.
- **Flows that touch this screen:** `sa.health`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-16` — Guided provisioning (SCALE-1, WP3)

- **Purpose:** The guided zero-to-first-report path: create an organisation, set its entitlements and invite cap, configure the platform email sender, read the readiness checks (roles, status, invite, sender, engagement) and activate the tenant.
- **Route / location:** `/superadmin`, tab `provisioning`; the setup wizard is `sa-setup`.
- **Rights required:** platform admin (`is_platform_admin()`), re-checked by every `platform_*` RPC.
- **Testids (42):** `sa-provisioning`, `sa-provisioning-activate`, `sa-provisioning-admin-email`, `sa-provisioning-cap`, `sa-provisioning-cap-input`, `sa-provisioning-cap-reason`, `sa-provisioning-cap-submit`, `sa-provisioning-check-engagement`, `sa-provisioning-check-invite`, `sa-provisioning-check-ready`, `sa-provisioning-check-roles`, `sa-provisioning-check-sender`, `sa-provisioning-check-status`, `sa-provisioning-create`, `sa-provisioning-create-error`, `sa-provisioning-create-reason`, `sa-provisioning-create-submit`, `sa-provisioning-created`, `sa-provisioning-done`, `sa-provisioning-entitlement-disable`, `sa-provisioning-entitlement-enable`, `sa-provisioning-entitlement-reason`, `sa-provisioning-entitlements`, `sa-provisioning-error`, `sa-provisioning-feature-select`, `sa-provisioning-finish`, `sa-provisioning-loading`, `sa-provisioning-org-name`, `sa-provisioning-readiness`, `sa-provisioning-recheck`, `sa-provisioning-repair-roles`, `sa-provisioning-result`, `sa-provisioning-retry`, `sa-provisioning-sender`, `sa-provisioning-sender-from`, `sa-provisioning-sender-name`, `sa-provisioning-sender-reason`, `sa-provisioning-sender-reply`, `sa-provisioning-sender-submit`, `sa-provisioning-target`, `sa-provisioning-tenant-select`, `sa-setup`
- **States:** loading; empty (no tenant selected); readiness checks; created; done; error with retry.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-17` — Super Admin portal shell (S1)

- **Purpose:** The shell around every /superadmin tab: it proves the caller is a platform admin before it renders any tab, and shows a checking state, a denied state, or the tab strip.
- **Route / location:** `/superadmin`.
- **Rights required:** platform admin (`is_platform_admin()`); a caller without it sees the denied state.
- **Testids (5):** `superadmin-checking`, `superadmin-denied`, `superadmin-portal`, `superadmin-tabs`, `superadmin-tab-<tab>`
- **States:** checking; denied; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-18` — integrity anchoring (SCALE-1, Phase 3.5, §17)

- **Purpose:** The platform integrity catalogue: the RFC 3161 timestamp authorities that stamp a sealed report's
- **Route / location:** `/superadmin`, tab `Integrity anchoring` (`superadmin-tab-integrity`).
- **Rights required:** platform admin (`is_platform_admin()`); every write is a platform-only RPC (`admin_save_timestamp_authority`, `admin_save_trust_anchor`, `admin_set_anchoring_min`), re-checked in the database.
- **Testids (25):** `sa-anchoring`, `sa-anchoring-loading`, `sa-anchoring-error`, `sa-anchoring-save-error`, `sa-anchoring-result`, `sa-anchoring-authorities`, `sa-anchoring-authority-list`, `sa-anchoring-authority-empty`, `sa-anchoring-authority-<id>`, `sa-anchoring-authority-name`, `sa-anchoring-authority-url`, `sa-anchoring-authority-order`, `sa-anchoring-authority-add`, `sa-anchoring-anchors`, `sa-anchoring-anchor-list`, `sa-anchoring-anchor-empty`, `sa-anchoring-anchor-<id>`, `sa-anchoring-anchor-name`, `sa-anchoring-anchor-cert`, `sa-anchoring-anchor-add`, `sa-anchoring-min`, `sa-anchoring-min-list`, `sa-anchoring-min-empty`, `sa-anchoring-min-<id>`, `sa-anchoring-min-<id>-<n>`
- **States:** loading; error (with Retry); ready; empty authority list; empty anchor list; empty tenant list; an inline result or refusal after a write.
- **Flows that touch this screen:** `sa.integrity-anchoring`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-03` — tenant hub (S2)

- **Purpose:** the platform's per-tenant register: every tenant with its status, feature flags, AI enablement and the invitation cap, plus the controls to change them.
- **Route / location:** `/superadmin`, tab `Tenants` (`superadmin-tab-tenants`).
- **Rights required:** platform admin (`is_platform_admin()`); every write is a platform-only RPC.
- **Testids (8):** `superadmin-tenants`, `superadmin-tenants-loading`, `superadmin-tenants-error`, `superadmin-tenants-result`, `superadmin-tenants-empty`, `tenant-<id>`, `tenant-allow-<id>`, `tenant-deny-<id>`
- **States:** loading, error (with Retry), empty (no tenants), ready; an inline result when a write is refused.
- **Flows that touch this screen:** `sa.tenant-hub`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-13` — tutorial library (S12)

- **Purpose:** the registry health view for the guided recordings: every Appendix A key, its audience, whether its media file exists and whether the recorded `ui_hash` is stale.
- **Route / location:** `/superadmin`, tab `Tutorials` (`superadmin-tab-tutorials`).
- **Rights required:** platform admin (`is_platform_admin()`); read-only.
- **Testids (5):** `superadmin-tutorials`, `superadmin-tutorials-loading`, `superadmin-tutorials-error`, `superadmin-tutorials-empty`, `tutorial-<key>`
- **States:** loading, error, empty (registry empty), ready.
- **Flows that touch this screen:** `sa.tutorials`
- **Connection candidates (same route):** — (route is unique to this screen)

### `SA-15` — platform trail (S12, F20)

- **Purpose:** the append-only platform audit trail: every platform action with its actor, action, target and time. Read-only, no filter that could hide a row.
- **Route / location:** `/superadmin`, tab `Trail` (`superadmin-tab-trail`).
- **Rights required:** platform admin (`is_platform_admin()`); read-only.
- **Testids (4):** `superadmin-trail`, `superadmin-trail-loading`, `superadmin-trail-error`, `superadmin-trail-empty`
- **States:** loading, error (with Retry), empty, ready.
- **Flows that touch this screen:** `sa.trail`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-04` — features, read-only (S1)

- **Purpose:** the organisation's effective feature set, read-only, with "Ask QSCorp to add this" for add-ons. Only the Super Admin writes entitlements (F25).
- **Route / location:** Org Admin control plane, tab `Features`.
- **Rights required:** `edit_config` to open the control plane.
- **Testids (11):** `org-control-panel`, `org-control-denied`, `org-control-tabs`, `org-control-tab-features`, `org-features`, `org-features-loading`, `org-features-error`, `org-features-list`, `org-feature-<key>`, `org-control-no-right`, `org-setup`
- **States:** loading, error, ready. No toggle exists on this screen; it is read-only by design.
- **Flows that touch this screen:** `oa.features`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-16` — Dual Session, tenant side (S1)

- **Purpose:** the Org Admin invites QSCorp to tier 2, acknowledges a platform request, and ends a session (F4).
- **Route / location:** Org Admin control plane, tab `Dual Session`.
- **Rights required:** `edit_config`.
- **Testids (5):** `org-consultation`, `org-consultation-session`, `org-consultation-acknowledge`, `org-consultation-invite`, `org-consultation-result`
- **States:** no session (the invite button only), requested (an Acknowledge button when the platform side initiated), active.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-17` — configuration history (S1)

- **Purpose:** one read-only story of every configuration change in the organisation, newest first, hash-chained, with a change made by a QSCorp consultant labelled "Platform consultant" (F4, L5).
- **Route / location:** Org Admin control plane, tab `History`.
- **Rights required:** `edit_config`. A platform admin sees it only while an active consultation session exists; the database refuses everything else.
- **Testids (7):** `org-history`, `org-history-loading`, `org-history-error`, `org-history-empty`, `org-history-table`, `org-history-row-<index>`, `org-history-platform-<index>`
- **States:** loading, error (with Retry), empty ("No configuration has changed yet."), ready. Read-only: the screen exposes no write control.
- **Flows that touch this screen:** `oa.history`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-11` — email sender (S2)

- **Purpose:** the Org Admin's own sender, its Test button, and a plain message when the platform does not allow a tenant sender (F6).
- **Route / location:** Org Admin control plane, tab `Email`.
- **Rights required:** `edit_config`. The database refuses a tenant profile when the platform denies it.
- **Testids (15):** `org-email`, `org-email-loading`, `org-email-error`, `org-email-result`, `org-email-saved`, `org-email-denied`, `org-email-provider`, `org-email-display-name`, `org-email-from`, `org-email-save`, `org-email-empty`, `org-email-list`, `org-sender-<id>`, `org-sender-test-<id>`, `org-email-connect-graph`
- **States:** loading, error (with Retry), denied (the platform sends instead), empty ("You have no sending address yet. Notifications are waiting, not lost."), ready.
- **Flows that touch this screen:** `oa.email-resend`, `oa.email-microsoft`, `oa.email-smtp`, `oa.email-test`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-12`, `OA-13` — notification and escalation rules (S2)

- **Purpose:** the Org Admin copies a platform rule and changes it, or starts a new one. The same editor covers escalation rules, whose recommendation is filled from the event fields (F7, F12).
- **Route / location:** Org Admin control plane, tab `Rules`.
- **Rights required:** `edit_config`.
- **Testids (33):** `org-automation`, `org-automation-loading`, `org-automation-error`, `org-automation-result`, `org-automation-saved`, `org-automation-empty`, `org-automation-new`, `org-automation-editor`, `org-rule-key`, `org-rule-name`, `org-rule-event`, `org-rule-enabled`, `org-rule-add-condition`, `org-rule-condition-<i>`, `org-rule-condition-field-<i>`, `org-rule-condition-op-<i>`, `org-rule-condition-value-<i>`, `org-rule-condition-remove-<i>`, `org-rule-add-action`, `org-rule-action-<i>`, `org-rule-action-type-<i>`, `org-rule-action-message-<i>`, `org-rule-action-remove-<i>`, `org-rule-save`, `org-rule-cancel`, `org-rule-list`, `org-rule-<key>`, `org-rule-copy-<key>`, `org-rule-edit-<key>`, `org-rule-test-<key>`, `org-rule-test-output`, `org-template-list`, `org-template-<eventKey>`
- **States:** loading, error (with Retry), empty (no rules), ready. A platform template offers "Copy and change"; a tenant rule offers "Change".
- **Flows that touch this screen:** `oa.automation`, `oa.templates-email`, `oa.escalation`
- **Connection candidates (same route):** `Org Admin control plane, tab `Rules`.` · `Org Admin control plane, tab `Escalation`.`

### `OA-20` — invite a colleague (S3)

- **Purpose:** the Org Admin invites a colleague by email and role. The invitation is recorded as a single-use row and its acceptance link is queued; the copy says "queued", never "sent", because no account exists until the invitee accepts (D20 defect, F6, S3). The invitee accepts at `/invite/accept?token=…`, which creates their account and applies the invitation.
- **Route / location:** Org Admin control plane, tab `People`, block "Invite a colleague". Acceptance: `/invite/accept?token=…`, outside the tenant shell and outside the auth gate.
- **Rights required:** `manage_users`. The database re-checks it inside `invite_user_capped`.
- **Testids (14):** `people-admin-panel`, `admin-people`, `admin-invite`, `admin-invite-sent`, `admin-error`, `oa-accept`, `oa-accept-token`, `oa-accept-email`, `oa-accept-password`, `oa-accept-submit`, `oa-accept-error`, `oa-accept-hint`, `oa-accept-done`, `oa-accept-continue`
- **States:** ready; the confirmation reads "Invitation queued for <email>". An invalid address keeps the button disabled. A cap breach or a missing right shows the RPC's message in `admin-error`. Acceptance: idle; busy; the token pre-filled from the link; a short password or a missing code is refused inline; email confirmation required is stated plainly; done.
- **Flows that touch this screen:** `oa.invite`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-02`, `OA-03` — branding and report format (S4)

- **Purpose:** the Org Admin sets the organisation's profile, branding and report format (fonts, brand colours, logos, page size, margins, header and footer text, cover style, PPTX theme). The live preview runs through the real `BrandingSpec`, so what the admin sees is what the renderers produce (F9).
- **Route / location:** Org Admin control plane, tab `Branding`.
- **Rights required:** `edit_config` (the database re-checks it in `admin_set_branding`). Feature-gated: `admin_set_branding` needs `branding_custom_fonts`, `admin_upload_pptx_theme` needs `pptx_theme_upload` (F25, D-S4-branding-entitlements).
- **Testids (45):** `oa-branding`, `oa-branding-title`, `oa-branding-loading`, `oa-branding-readonly`, `oa-branding-form`, `oa-branding-font-heading`, `oa-branding-font-body`, `oa-branding-font-heading-licence`, `oa-branding-font-body-licence`, `oa-branding-colour-primary`, `oa-branding-colour-accent`, `oa-branding-colour-text`, `oa-branding-colour-background`, `oa-branding-page-size`, `oa-branding-cover-style`, `oa-branding-margin-0`, `oa-branding-margin-3`, `oa-branding-header`, `oa-branding-footer`, `oa-branding-logo-light`, `oa-branding-logo-input`, `oa-branding-theme-upload`, `oa-branding-theme-note`, `oa-branding-font-upload`, `oa-branding-font-licence-label`, `oa-branding-font-licence-ack`, `oa-branding-font-note`, `oa-branding-detected`, `oa-branding-detected-note`, `oa-branding-detected-heading`, `oa-branding-detected-body`, `oa-branding-detected-colours`, `oa-branding-detected-toupload`, `oa-branding-adopt`, `oa-branding-assets`, `oa-branding-assets-empty`, `oa-branding-assets-list`, `oa-branding-asset-<id>`, `oa-branding-save`, `oa-branding-error`, `oa-branding-saved`, `oa-branding-preview`, `oa-branding-preview-header`, `oa-branding-preview-footer`, `oa-branding-preview-note`
- **States:** loading ("Loading branding…"); ready; error (`InlineError`); read-only (no save button, a plain notice). A save refusal (rights or entitlement) is shown in `oa-branding-error` in the server's own words. An over-size asset is refused by the RPC. A template upload detects the file's own fonts, colours and page setup (F5) and offers to adopt them (F6); a house-font upload is refused until the licence acknowledgement (`oa-branding-font-licence-ack`) is ticked (F4). The stored assets (`oa-branding-assets`) list every logo, font and template the org holds, empty or populated, and refresh after each successful upload.
- **Flows that touch this screen:** `oa.profile`, `oa.branding`, `oa.pptx-theme`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-13` — escalation rules (S6)

- **Purpose:** the Org Admin builds a rule that watches an event, tests conditions, and escalates to configured roles with a DETERMINISTIC recommendation ("Audit required: Yes / No / Needs review") filled from the event fields by a rule-defined template. It can also raise a Work Queue proposal a CIA converts through the normal plan flow. There is no AI in the decision (L1, F12).
- **Route / location:** Org Admin control plane, tab `Escalation`.
- **Rights required:** `edit_config`. Feature-gated: `escalation` (`F25`). The database re-checks both.
- **Testids (28):** `oa-escalation`, `oa-escalation-loading`, `oa-escalation-error`, `oa-escalation-new`, `oa-escalation-editor`, `oa-escalation-name`, `oa-escalation-event`, `oa-escalation-add-condition`, `oa-escalation-condition-<i>`, `oa-escalation-condition-field-<i>`, `oa-escalation-condition-value-<i>`, `oa-escalation-condition-remove-<i>`, `oa-escalation-branch-<i>`, `oa-escalation-branch-field-<i>`, `oa-escalation-branch-equals-<i>`, `oa-escalation-branch-recommend-<i>`, `oa-escalation-branch-remove-<i>`, `oa-escalation-add-branch`, `oa-escalation-preview`, `oa-escalation-save`, `oa-escalation-cancel`, `oa-escalation-saved`, `oa-escalation-result`, `oa-escalation-empty`, `oa-escalation-list`, `oa-escalation-rule-<key>`, `oa-escalation-log`, `oa-escalation-<id>`
- **States:** loading; error (`InlineError`); empty (no rules); ready. A save refusal (for example a feature not in the plan) is shown in `oa-escalation-result`. The editor never shows a JSON box (F1).
- **Flows that touch this screen:** `oa.escalation`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-09` — Board Pack configuration (S7)

- **Purpose:** the Org Admin reorders, enables and disables the pack sections. A section is never deleted, only switched off (configuration, not code).
- **Route / location:** the "Sections" tab inside the Board Pack panel on the Dashboard.
- **Rights required:** `edit_config` (a consultant in a session may reach it through `config_actor_ok`).
- **Testids (13):** `wk-boardpack`, `wk-boardpack-tab-config`, `oa-boardpack-config`, `oa-boardpack-section-<key>`, `oa-boardpack-label-<key>`, `oa-boardpack-up-<key>`, `oa-boardpack-down-<key>`, `oa-boardpack-enabled-<key>`, `oa-boardpack-roles-<key>`, `oa-boardpack-roles-panel-<key>`, `oa-boardpack-role-<key>-<slug>`, `wk-boardpack-error`, `wk-boardpack-result`
- **States:** loading; a section list, or an inline error. The first section's Up button and the last section's Down button are disabled. A section label is editable in place (saved on blur) and a per-section role list is opened with the Roles button; an empty role list means every role with `view_board_pack`.
- **Flows that touch this screen:** `oa.boardpack-config`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-14` — external auditors (S9)

- **Purpose:** invite an external auditor by email and edit the per-engagement permission matrix (F13). An external auditor is a separate read-only principal, never an org role.
- **Route / location:** the Org Control panel, tab "External auditors" (`org-control-tab-auditors`).
- **Rights required:** `edit_config` to invite, edit the matrix or revoke. The `external_auditors` entitlement gates the feature; a refusal from the server is shown in plain words.
- **Testids (21):** `oa-auditors`, `oa-auditors-loading`, `oa-auditors-error`, `oa-auditors-result-error`, `oa-auditors-result-ok`, `oa-auditors-email`, `oa-auditors-expiry-kind`, `oa-auditors-days`, `oa-auditors-permanent-warning`, `oa-auditors-engagements`, `oa-auditors-engagement-<id>`, `oa-auditors-no-engagements`, `oa-auditors-invite`, `oa-auditors-matrix`, `oa-auditors-matrix-empty`, `oa-auditors-row-<userId>`, `oa-auditors-cell-<userId>-<permission>`, `oa-auditors-expiry-<userId>`, `oa-auditors-revoke-<userId>`, `oa-auditors-log`, `oa-auditors-log-empty`
- **States:** loading; an empty matrix ("No external auditors yet."); an empty log; an inline error. Choosing "Permanent" shows a plain warning. Revoking a whole account is a hold-to-confirm. The invitation result is "Invitation queued…", never "sent" (D20).
- **Flows that touch this screen:** `oa.auditors`, `oa.auditor-matrix`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-21` — patterns settings (S10)

- **Purpose:** set the deterministic pattern thresholds (F15). Similarity threshold, minimum group size, years back, included severities and the right that can see the view. No AI is involved and nothing here changes a finding.
- **Route / location:** the Org Control panel, tab "Features" is OA-04; the Patterns settings live in the Issues & CAP Register "Patterns" view, its "Settings" sub-view (`oa-patterns-config`). It needs `edit_config`; a caller without it sees the read-only notice.
- **Rights required:** `edit_config` to read and write the settings. The `patterns` entitlement gates the feature; a refusal from the server is shown in plain words.
- **Testids (9):** `oa-patterns-config`, `oa-patterns-config-readonly`, `oa-patterns-threshold`, `oa-patterns-min-size`, `oa-patterns-years`, `oa-patterns-visibility`, `oa-patterns-save`, `oa-patterns-result`, `oa-patterns-result-error`
- **States:** loading; read-only for a caller without `edit_config`; an inline error; a plain result line after a save. Every control is a slider, a number input or a select — never a JSON box.
- **Flows that touch this screen:** `oa.patterns-config`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-15` — hosting and database (S11, F16)

- **Purpose:** the Org Admin enters the target connection (kind, host, port, database, user, SSL mode; the password goes through the secrets-put Edge Function and is shown only masked — F5), starts a migration job, copies the runner command, and retires the old connection with a hold-to-confirm.
- **Route / location:** `Organisation settings` → tab `Hosting` (`org-control-tab-hosting`).
- **Rights required:** `edit_config`. The `hosting_migration` entitlement gates the RPCs in the database.
- **Testids (27):** `oa-hosting`, `oa-hosting-loading`, `oa-hosting-error`, `oa-hosting-action-error`, `oa-hosting-notice`, `oa-hosting-label`, `oa-hosting-kind`, `oa-hosting-host`, `oa-hosting-port`, `oa-hosting-database`, `oa-hosting-username`, `oa-hosting-ssl`, `oa-hosting-password`, `oa-hosting-save`, `oa-hosting-runner-command`, `oa-hosting-empty`, `oa-hosting-connection-<id>`, `oa-hosting-mask-<id>`, `oa-hosting-test-<id>`, `oa-hosting-test-run-<id>`, `oa-hosting-report-<id>`, `oa-hosting-report-reachable-<id>`, `oa-hosting-report-messages-<id>`, `oa-hosting-report-extensions-<id>`, `oa-hosting-report-roles-<id>`, `oa-hosting-migrate-<id>`, `oa-hosting-retire-<id>`
- **States:** loading; error (with Retry); an incomplete form refused inline before any call; an empty connections list; a runner command panel after a job starts. No blocking modal; retire uses hold-to-confirm.
- **Flows that touch this screen:** `oa.hosting`, `oa.migration`, `oa.deployment-kit`, `oa.retire-old`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-25` — Cross-universe view-only sharing (SCALE-1, §2)

- **Purpose:** Grant, view and revoke an intra-organisation, view-only share of a universe to a same-tenant member, and (in grantee mode) read the universes shared with me.
- **Route / location:** The Assurance control plane (`org_control` inspector), tab `sharing`; the grantee view is the `shared_with_me` inspector from `menu-shared-with-me`.
- **Rights required:** `edit_config` (or a Level-1/Level-2 Head) to grant; any member to read what is shared with them.
- **Testids (18):** `share-grant-expiry`, `share-grant-grantee`, `share-grant-submit`, `share-grant-universe`, `share-granted-empty`, `share-panel`, `share-panel-error`, `share-panel-grant`, `share-panel-granted`, `share-panel-loading`, `share-panel-result`, `share-panel-retry`, `share-panel-view`, `share-panel-with-me`, `share-view-engagements`, `share-view-entities`, `share-view-not-live`, `share-with-me-empty`
- **States:** loading; empty (`share-granted-empty`, `share-with-me-empty`); ready; result; not-live (`share-view-not-live`); error with retry.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-26` — Activity log and export (S1)

- **Purpose:** Read and filter the activity log, run an archive by period, and export a record set (with the export confirmation hash and the export history).
- **Route / location:** The `activity_log` inspector window and the export panel.
- **Rights required:** `manage_engagements`/`perform_work`; the export panel refuses without the right.
- **Testids (34):** `activity-archive`, `activity-archived-notice`, `activity-empty`, `activity-error`, `activity-export`, `activity-filter`, `activity-filters`, `activity-loading`, `activity-log-panel`, `activity-since`, `activity-table`, `activity-until`, `archive-jobs`, `archive-jobs-empty`, `archive-upload-<id>`, `export-confirmation`, `export-confirmation-hash`, `export-controls`, `export-denied`, `export-error`, `export-history`, `export-history-empty`, `export-history-loading`, `export-no-right`, `export-panel`, `export-run`, `population-archive-<id>`, `population-archive-row-<id>`, `population-archived-notice`, `population-archives`, `population-due-<id>`, `population-due-empty`, `population-due-list`, `population-retention`
- **States:** loading; empty; table; export confirmation; history loading/empty; no-right; population retention due/empty/archived; pending upload.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-27` — Import wizard (S1)

- **Purpose:** Import a workpaper source (upload, choose file, DOCX tables), map it, validate it, preview the valid/invalid counts, and commit it; the job history is listed. The file's format is decided by its MAGIC BYTES, not its extension: a file whose bytes disagree with its name is imported under its true kind and the disagreement is shown, or refused with the real kind named.
- **Route / location:** The `import_wizard` inspector window.
- **Rights required:** `manage_engagements`; a caller without it sees `import-no-right`.
- **Testids (27):** `import-choose-file`, `import-commit`, `import-confirm`, `import-denied`, `import-docx-tables`, `import-done`, `import-error`, `import-errors`, `import-file-input`, `import-history`, `import-history-empty`, `import-invalid-count`, `import-inventory`, `import-inventory-archive`, `import-inventory-counts`, `import-inventory-metadata`, `import-inventory-note`, `import-mapping`, `import-no-right`, `import-preview`, `import-recognised`, `import-recognition-note`, `import-steps`, `import-upload`, `import-valid-count`, `import-validate`, `import-wizard`
- **States:** no-right; upload; recognised (kind, size, SHA-256); inventory (metadata, archive members + compression ratio, refusal reason); bytes/name disagreement; mapping; validated; preview; done; history loading/empty.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-28` — Org settings inspector (S1)

- **Purpose:** The organisation settings inspector: sampling, severity levels and email provider tabs.
- **Route / location:** The `org_settings` inspector window, from the profile menu.
- **Rights required:** `edit_config`; a caller without it sees `org-settings-no-right`.
- **Testids (10):** `org-settings-denied`, `org-settings-email`, `org-settings-error`, `org-settings-loading`, `org-settings-no-right`, `org-settings-panel`, `org-settings-result`, `org-settings-sampling`, `org-settings-severity`, `org-settings-tabs`
- **States:** no-right; loading; tabs; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-29` — Integrity alarm (T7, §11.3a)

- **Purpose:** The tamper alarm: read the organisation's integrity alerts (severity-split by the database rule), acknowledge one, and re-verify the ledger chain on demand. A single object that fails to verify is a warning; a broken ledger chain, an invalid signature or a failed timestamp is an incident. This is tamper-evidence, never tamper-prevention: it proves that a change happened and preserves the before and after hashes.
- **Route / location:** The Assurance control plane (`org_control` inspector), tab `integrity`; the DB-01 dashboard banner (`DB-01-integrity-banner`) opens it.
- **Rights required:** an integrity owner — `review_and_approve` or `edit_config`, or a Level-1/Level-2 Head; the database RPC re-checks the right and a caller without it is refused.
- **Testids (21):** `DB-01-integrity-banner`, `DB-01-integrity-banner-text`, `OA-29-alert-acknowledge-<id>`, `OA-29-alert-acknowledged-<id>`, `OA-29-alert-actual-<id>`, `OA-29-alert-expected-<id>`, `OA-29-alert-kind-<id>`, `OA-29-alert-raised-<id>`, `OA-29-alert-sentence-<id>`, `OA-29-alert-severity-<id>`, `OA-29-empty`, `OA-29-error`, `OA-29-headline`, `OA-29-icon-incident`, `OA-29-icon-ok`, `OA-29-list`, `OA-29-load-error`, `OA-29-loading`, `OA-29-panel`, `OA-29-verify-ledger`, `OA-29-verify-result`
- **States:** loading; empty (no alerts — the verified state); ready with incidents/warnings; acknowledged; verify result; error.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-30` — Attestation (T3/T4/T5, §11.3)

- **Purpose:** The portable attestation package: list the organisation's signed subjects, build a self-contained package for one (roots, signatures, timestamps, the versions that scored it, the Merkle leaves and the verification instructions), export it as JSON, and verify a package — one built here or one dropped in from elsewhere — against its own contents and its embedded public keys. The verification is the same procedure the standalone verifier (`scripts/verify-attestation.mjs`) implements, so an outsider can re-derive the root without trusting the producer. This is tamper-evidence: it proves structure and provenance, not the truth of the underlying claims.
- **Route / location:** The Assurance control plane (`org_control` inspector), tab `attestation`.
- **Rights required:** an integrity owner — `review_and_approve` or `edit_config`, or a Level-1/Level-2 Head; the database RPCs (`attestation_subjects_list`, `attestation_input_get`) re-check the right and a caller without it is refused.
- **Testids (24):** `OA-30-build-<id>`, `OA-30-empty`, `OA-30-error`, `OA-30-explain-attestation`, `OA-30-export`, `OA-30-headline`, `OA-30-icon`, `OA-30-leaf-count`, `OA-30-load-error`, `OA-30-loading`, `OA-30-merkle-root`, `OA-30-package`, `OA-30-package-root`, `OA-30-package-title`, `OA-30-panel`, `OA-30-problems`, `OA-30-signature-count`, `OA-30-subject-<id>`, `OA-30-subjects`, `OA-30-timestamp-count`, `OA-30-verdict`, `OA-30-verify-drop`, `OA-30-verify-drop-label`, `OA-30-versions`
- **States:** loading; empty (nothing signed yet); ready with signed subjects; package built and verified; package built and NOT verified; error.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-31` — Integrity incident wizard (T6, §11.3a)

- **Purpose:** The guided response to a detected tamper. It shows, in plain words, what changed, when and by whom, and what it affects (which engagement, archive, population or the ledger chain), then offers restore / re-derive and re-seal / freeze the engagement / escalate — each requiring a reason — and re-runs verification at the end so the incident closes on proof rather than assertion. Every step is appended to the incident's own append-only trail, so an incident cannot be quietly closed. This is tamper-evidence, never tamper-prevention.
- **Route / location:** The Assurance control plane (`org_control` inspector), tab `incidents`.
- **Rights required:** an integrity owner — `review_and_approve` or `edit_config`, or a Level-1/Level-2 Head; every `integrity_incident_*` RPC re-checks the right and a caller without it is refused.
- **Testids (32):** `OA-31-actual`, `OA-31-affects`, `OA-31-boundary`, `OA-31-denied`, `OA-31-detail`, `OA-31-empty`, `OA-31-error`, `OA-31-expected`, `OA-31-headline`, `OA-31-icon`, `OA-31-incident-<id>`, `OA-31-incident-status-<id>`, `OA-31-list`, `OA-31-load-error`, `OA-31-loading`, `OA-31-open-<alertId>`, `OA-31-openable`, `OA-31-openable-<alertId>`, `OA-31-opened`, `OA-31-outcome`, `OA-31-panel`, `OA-31-reason`, `OA-31-step-annotate`, `OA-31-step-escalate`, `OA-31-step-freeze`, `OA-31-step-rederive`, `OA-31-step-restore`, `OA-31-trail`, `OA-31-trail-<n>`, `OA-31-unconfigured`, `OA-31-verify`, `OA-31-what-changed`
- **States:** denied (not an integrity owner); loading; not configured (no database connection — never shown as an empty healthy panel); empty (no incidents); alerts with no incident yet (the entry point); ready with a selected incident and its trail; a step's computed outcome; error.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-05` — roles and rights (S3)

- **Purpose:** the role register and the rights matrix. A role is a named bundle of the 15 closed rights keys; the app and the database both check rights, never role names.
- **Route / location:** Org Admin control plane, tab `People` (`org-control-tab-people`) — the roles section of the people panel.
- **Rights required:** `edit_config` to write; `manage_people` for membership changes.
- **Testids (11):** `people-admin-panel`, `admin-roles`, `admin-roles-readonly`, `admin-create-role`, `role-<slug>`, `admin-loading`, `admin-people-empty`, `admin-provision`, `admin-scopes`, `admin-grant-scope`, `admin-set-cap`
- **States:** loading, load error (`admin-load-error`), read-only without `edit_config` (`admin-roles-readonly`), ready; an inline error on a refused write (`admin-error`).
- **Flows that touch this screen:** `oa.roles`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-08` — templates hub (S2)

- **Purpose:** the notification-template hub: every catalogue event, the tenant template that overrides the platform default, and the blocks each template is built from.
- **Route / location:** Org Admin control plane, tab `Automation` (`org-control-tab-automation`) — the templates section of the automation panel.
- **Rights required:** `edit_config`.
- **Testids (15):** `org-automation`, `org-template-list`, `org-template-<eventKey>`, `template-<eventKey>`, `template-list`, `template-event`, `template-subject`, `template-blocks`, `template-block-<i>`, `template-block-text-<i>`, `template-block-up-<i>`, `template-block-down-<i>`, `template-block-remove-<i>`, `template-add-<type>`, `template-save`
- **States:** loading, error, empty (no templates), ready; an inline saved/failure result.
- **Flows that touch this screen:** `oa.templates`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-10` — certificate configuration (S8)

- **Purpose:** the certificate template: which fields a public certificate shows, in order, and whether the certificate is enabled at all.
- **Route / location:** Org Admin control plane, tab `Branding` (`org-control-tab-branding`) — the certificate section beside the Board Pack configuration.
- **Rights required:** `edit_config` to save; `approve_plan` is required to issue.
- **Testids (15):** `oa-certificate-config`, `oa-certificate-field-<key>`, `oa-certificate-enabled-<key>`, `engagement_id`, `engagement_title`, `organisation`, `engagement_root_hash`, `issued_at`, `sealed_workpapers`, `findings_count`, `sealing_actors`, `verification`, `free_text`, `oa-certificate-field-engagement_id`, `oa-certificate-enabled-verification`
- **States:** loading, error, ready; the read-only view without `edit_config`.
- **Flows that touch this screen:** `oa.certificate-config`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-18` — tutorial library (tenant view) (S12)

- **Purpose:** the same registry health as SA-13, scoped to the keys an Org Admin owns, so the organisation can see which of its own screens have a current recording.
- **Route / location:** Org Admin control plane, tab `Tutorials` (`org-control-tab-tutorials`).
- **Rights required:** any signed-in org member; read-only.
- **Testids (2):** `org-tutorials`, `tutorial-<key>`
- **States:** loading, error, empty, ready.
- **Flows that touch this screen:** `oa.tutorials`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-19` — Go Live health check (S1)

- **Purpose:** the last wizard step: a short, deterministic readiness check with a plain-language line per item and a Go Live button that only enables when nothing blocking is outstanding.
- **Route / location:** Org Admin control plane, tab `Setup` (`org-control-tab-setup`), step `org.golive`.
- **Rights required:** `edit_config`.
- **Testids (5):** `org_admin-wizard`, `org_admin-wizard-step-org.golive`, `org_admin-wizard-content-org.golive`, `org_admin-wizard-save`, `org_admin-wizard-next`
- **States:** loading, error, empty, ready; a resume banner when a later step is open.
- **Flows that touch this screen:** `oa.golive`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-22` — governance settings (C3.2-B)

- **Purpose:** the remaining Org Admin configuration in one portal, never in code or JSON: one-stage or two-stage testing with the sign-off role per stage (§10), the finding structure — section names and role tags — (§14.2), methodology scales and FSLI mapping (§23), workflow, SLA and escalation (§7.1, §23), notification rules by role with a supervisor copy (§22), the BI check parameters within fixed platform ranges (§12), the evidence size cap and accepted formats (§20), and export and retention settings (§23, §25.4). Every save writes a versioned, logged configuration change.
- **Route / location:** Org Admin control plane, tab `Governance` (`org-control-tab-governance`).
- **Rights required:** `edit_config`.
- **Testids (61):** `oa-governance`, `oa-governance-loading`, `oa-governance-error`, `oa-governance-empty`, `oa-governance-result`, `oa-governance-lifecycle`, `oa-governance-testing-mode`, `oa-governance-signoff-planning`, `oa-governance-signoff-testing`, `oa-governance-signoff-conclusion`, `oa-governance-opinion-required`, `oa-governance-lifecycle-save`, `oa-governance-findings`, `oa-governance-findings-list`, `oa-governance-findings-empty`, `oa-governance-section-<roleTag>`, `oa-governance-section-delete-<roleTag>`, `oa-governance-section-tag`, `oa-governance-section-label`, `oa-governance-section-position`, `oa-governance-section-add`, `oa-governance-methodology`, `oa-governance-scales-list`, `oa-governance-scale-<key>`, `oa-governance-scale-key`, `oa-governance-scale-label`, `oa-governance-scale-add`, `oa-governance-fsli-list`, `oa-governance-fsli-<code>`, `oa-governance-fsli-code`, `oa-governance-fsli-label`, `oa-governance-fsli-category`, `oa-governance-fsli-add`, `oa-governance-workflow`, `oa-governance-sla-hours`, `oa-governance-escalation-hours`, `oa-governance-escalation-role`, `oa-governance-workflow-save`, `oa-governance-notifications`, `oa-governance-rules-list`, `oa-governance-rules-empty`, `oa-governance-rule-<eventKey>`, `oa-governance-rule-event`, `oa-governance-rule-roles`, `oa-governance-rule-supervisor`, `oa-governance-rule-add`, `oa-governance-bi`, `oa-governance-bi-list`, `oa-governance-bi-<checkKey>`, `oa-governance-bi-value-<checkKey>`, `oa-governance-bi-save-<checkKey>`, `oa-governance-uploads`, `oa-governance-max-file-mb`, `oa-governance-ext-<ext>`, `oa-governance-uploads-save`, `oa-governance-retention`, `oa-governance-export-schedule`, `oa-governance-activity-retention`, `oa-governance-population-retention`, `oa-governance-retention-save`, `oa-governance-grace-hours`
- **States:** loading / empty / error / ready / denied
- **Flows that touch this screen:** `oa.governance`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-22` — report template (Phase 3.4, §15.2)

- **Purpose:** the organisation's report template — which of the five report sections a composed report contains, and in what order. Saving writes a new versioned, logged template (0088's hash chain) and the next `compose_report` follows it; with nothing saved the default five-section order applies. The section ids are a closed set, so a template can never name a section the product cannot render.
- **Route / location:** Org Admin control plane, tab `Report template` (`org-control-tab-templates`).
- **Rights required:** `edit_config`.
- **Testids (17):** `report-template-panel`, `report-template-loading`, `report-template-error`, `report-template-no-right`, `report-template-denied`, `report-template-version`, `report-template-result`, `report-template-save-error`, `report-template-sections`, `report-template-empty`, `report-template-section-<id>`, `report-template-up-<id>`, `report-template-down-<id>`, `report-template-remove-<id>`, `report-template-add-row`, `report-template-add-<id>`, `report-template-save`
- **States:** loading, error, empty (no sections chosen), ready; an inline result line reports the saved change or the plain refusal (an unknown section id, an empty template).
- **Flows that touch this screen:** `oa.governance`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-23` — connectors and continuous monitoring (WRITE-1, W11.6)

- **Purpose:** The connector catalogue and instance setup (mapping through dropdowns, never raw JSON), the run
- **Route / location:** Org Admin control plane, tab `Connectors` (`org-control-tab-connectors`).
- **Rights required:** `edit_config` to save an instance, rule or triage; `view_insights` to read.
- **Testids (40):** `wk-connectors-loading`, `wk-connectors-error`, `wk-connectors-retry`, `wk-connectors-panel`, `wk-connectors-tab-<id>`, `wk-connectors-catalogue`, `wk-connectors-label`, `wk-connectors-credential`, `wk-connectors-save`, `wk-connectors-saved`, `wk-connectors-instances`, `wk-connectors-instance-<id>`, `wk-connectors-runs`, `wk-connectors-runs-empty`, `wk-connectors-run-<id>`, `wk-connectors-staged`, `wk-connectors-staged-empty`, `wk-connectors-staged-<id>`, `wk-connectors-rules`, `wk-connectors-rules-empty`, `wk-connectors-rule-id`, `wk-connectors-rule-description`, `wk-connectors-rule-save`, `wk-connectors-alerts`, `wk-connectors-alerts-empty`, `wk-connectors-alerts-list`, `wk-connectors-alert-detail`, `wk-connectors-alert-detail-reason`, `wk-connectors-alert-detail-lineage`, `wk-connectors-alert-triage-form`, `wk-connectors-alert-triage-reason`, `wk-connectors-alert-triage-snooze`, `wk-connectors-alert-triage-save`, `wk-connectors-egress`, `wk-connectors-egress-host`, `wk-connectors-egress-check`, `wk-connectors-egress-result`, `wk-connectors-new`, `wk-connectors-rule-new`, `wk-connectors-empty`
- **States:** loading, error, empty, ready; an inline result line reports a saved change or the plain refusal. The egress check shows whether a host is on the tenant's allow-list.
- **Flows that touch this screen:** `oa.connectors`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-24` — report format editor (WRITE-1, owner instruction 2026-10-26)

- **Purpose:** The interactive format editor. A format is held per client (one tenant organisation) and versioned.
- **Route / location:** Org Admin control plane, tab `Report formats` (`org-control-tab-formats`).
- **Rights required:** `edit_config` to save, publish or set audiences; `view_reports` to read.
- **Testids (69):** `wk-format-loading`, `wk-format-error`, `wk-format-retry`, `wk-format-panel`, `wk-format-controls`, `wk-format-format-pick`, `wk-format-model-pick`, `wk-format-locale-pick`, `wk-format-label-input`, `wk-format-status`, `wk-format-version`, `wk-format-status-value`, `wk-format-issues`, `wk-format-published-note`, `wk-format-pane-tabs`, `wk-format-pane-<pane>`, `wk-format-blocks`, `wk-format-block-<key>`, `wk-format-block-<key>-key`, `wk-format-block-<key>-role`, `wk-format-block-<key>-register`, `wk-format-block-<key>-visible`, `wk-format-block-<key>-up`, `wk-format-block-<key>-down`, `wk-format-add-missing`, `wk-format-issue-list`, `wk-format-issue-<code>`, `wk-format-layout`, `wk-format-layout-page-size`, `wk-format-layout-marginTopMm`, `wk-format-layout-marginRightMm`, `wk-format-layout-marginBottomMm`, `wk-format-layout-marginLeftMm`, `wk-format-layout-font-heading`, `wk-format-layout-font-body`, `wk-format-layout-footer`, `wk-format-layout-tokens`, `wk-format-block-<key>-label`, `wk-format-contents`, `wk-format-contents-note`, `wk-format-contents-enabled`, `wk-format-contents-title`, `wk-format-contents-depth`, `wk-format-contents-title-scale`, `wk-format-contents-numbered`, `wk-format-contents-dot-leaders`, `wk-format-contents-indent`, `wk-format-audiences`, `wk-format-audiences-note`, `wk-format-audiences-empty`, `wk-format-audience-<slug>`, `wk-format-audience-<slug>-view`, `wk-format-audience-<slug>-edit`, `wk-format-audiences-save`, `wk-format-versions`, `wk-format-version-<n>`, `wk-format-version-<n>-load`, `wk-format-preview`, `wk-format-preview-summary`, `wk-format-preview-blocks`, `wk-format-preview-<key>`, `wk-format-preview-hidden`, `wk-format-preview-registers`, `wk-format-save`, `wk-format-publish`, `wk-format-result`, `wk-format-readonly`, `wk-format-create-default`, `wk-format-empty`
- **States:** loading, error, empty, ready; an inline result line reports a saved change, a publish, or the plain refusal; the editor lists every validation issue precisely.
- **Flows that touch this screen:** `oa.formats`
- **Connection candidates (same route):** — (route is unique to this screen)

### `OA-25` — methodology library (Phase 4, §10.1, §11.3)

- **Purpose:** The organisation's methodology library: every audit type's current procedure, its version, and its
- **Route / location:** `/admin`, tab `Methodology` (`org-control-tab-methodology`).
- **Rights required:** `edit_config`; a caller without it sees the plain refusal, never the panel.
- **Testids (25):** `methodology-panel`, `methodology-no-right`, `methodology-denied`, `methodology-loading`, `methodology-error`, `methodology-version`, `methodology-list`, `methodology-empty`, `methodology-template-<model>`, `methodology-save-error`, `methodology-result`, `methodology-title`, `methodology-description`, `methodology-steps`, `methodology-steps-empty`, `methodology-step-<key>`, `methodology-step-label-<key>`, `methodology-step-kind-<key>`, `methodology-step-evidence-<key>`, `methodology-step-up-<key>`, `methodology-step-down-<key>`, `methodology-step-remove-<key>`, `methodology-add-step`, `methodology-save`, `methodology-publish`
- **States:** loading; error; a denied state; ready with the template list and the step editor; an inline result or refusal after a save or publish.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-08` — escalation cards and proposals (S6)

- **Purpose:** a role targeted by an escalation sees its card and the deterministic recommendation; a CIA converts a proposal through the normal plan and deployment-gate flow (F12). An optional AI note may sit beside the recommendation, labelled, and never changes it (F8).
- **Route / location:** Work Queue tab, block "Escalations for you".
- **Rights required:** the escalation list is filtered server-side to `view_all_scopes` or a role the caller holds; conversion needs `manage_engagements`.
- **Testids (9):** `wk-escalation`, `wk-escalation-error`, `wk-escalation-result`, `wk-proposal-list`, `wk-proposal-<id>`, `wk-proposal-convert-<id>`, `wk-proposal-dismiss-<id>`, `wk-escalation-list`, `wk-escalation-<id>`
- **States:** the block renders nothing when the caller has no escalation and no proposal; otherwise it lists them. A conversion refusal is shown in `wk-escalation-result`.
- **Flows that touch this screen:** `oa.escalation-cards`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-01`, `WK-04` — Dashboard Board Pack panel (S7)

- **Purpose:** the Dashboard carries the pack history, the generator, the open pack with a drill-down on every figure, and the PDF and PPTX downloads with the verification chip (F10).
- **Route / location:** the Dashboard tab, block "Board Pack".
- **Rights required:** `view_board_pack` to see the panel and open a pack; `generate_board_pack` to generate. The `board_pack` entitlement gates the feature and `board_pack_pptx` gates the PPTX.
- **Testids (44):** `wk-boardpack`, `wk-boardpack-loading`, `wk-boardpack-error`, `wk-boardpack-result`, `wk-boardpack-tab-history`, `wk-boardpack-tab-config`, `wk-boardpack-tab-view`, `wk-boardpack-generator`, `wk-boardpack-scope`, `wk-boardpack-boundary`, `wk-boardpack-from`, `wk-boardpack-to`, `wk-boardpack-generate`, `wk-boardpack-no-generate`, `wk-boardpack-history`, `wk-boardpack-empty`, `wk-boardpack-<id>`, `wk-boardpack-open-<id>`, `wk-boardpack-view`, `wk-boardpack-pdf`, `wk-boardpack-pptx`, `wk-boardpack-url-missing`, `wk-boardpack-missing-refs`, `wk-boardpack-verify-chip`, `wk-boardpack-section-sira`, `wk-boardpack-section-issues`, `wk-boardpack-section-plan`, `wk-boardpack-section-sealed`, `wk-boardpack-section-changes`, `wk-boardpack-section-sources`, `wk-boardpack-figure-sira-<i>`, `wk-boardpack-figure-cap-<band>`, `wk-boardpack-figure-sealed`, `wk-boardpack-delta`, `wk-boardpack-source-<path>`, `wk-boardpack-source-link-<path>`, `wk-boardpack-heatmap`, `wk-boardpack-heatmap-row-<entity>`, `wk-boardpack-heatmap-<entity>-<band>`, `wk-boardpack-gantt`, `wk-boardpack-gantt-window`, `wk-boardpack-gantt-row-<i>`, `wk-boardpack-gantt-bar-<i>`, `wk-boardpack-gantt-legend`
- **States:** a role without `view_board_pack` sees nothing. Loading, an empty history ("No pack yet"), an inline error, and the open pack. The PDF and PPTX buttons are disabled until `app_base_url` is set, with `wk-boardpack-url-missing` shown. The SIRA section renders the entity x band heatmap (migration 0099) and the plan section renders the dated Gantt; a source figure with a resolvable ref becomes a drill-down link.
- **Flows that touch this screen:** `oa.boardpack-use`, `oa.boardpack-download`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-05` — Certificate panel (S8)

- **Purpose:** issue, revoke and download an engagement certificate; configure which fields appear (F11).
- **Route / location:** the Audit File window, view "Certificate" (`audit-file-view-certificate`).
- **Rights required:** `manage_engagements` to issue, `can_reopen` to revoke, `edit_config` to change the field list. The `certificates` entitlement gates the feature.
- **Testids (19):** `wk-certificate`, `wk-certificate-loading`, `wk-certificate-error`, `wk-certificate-issue`, `wk-certificate-no-issue`, `wk-certificate-ok`, `wk-certificate-result`, `wk-certificate-empty`, `wk-certificate-list`, `wk-certificate-<id>`, `wk-certificate-status-<id>`, `wk-certificate-pdf-<id>`, `wk-certificate-revoke-<id>`, `wk-certificate-revoke-form-<id>`, `wk-certificate-revoke-reason-<id>`, `wk-certificate-revoke-confirm-<id>`, `oa-certificate-config`, `oa-certificate-field-<key>`, `oa-certificate-enabled-<key>`
- **States:** loading; an empty list ("No certificate has been issued…"); an inline error. Revoke is refused until the reason is at least five characters. A role without `manage_engagements` sees a disabled issue button and a plain explanation.
- **Flows that touch this screen:** `oa.certificate`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-06` — Public verification page (S8)

- **Purpose:** the ONLY anonymous surface (F11). A visitor checks a certificate or Board Pack by id and may compare a dropped JSON or PDF hash in the browser. It also checks a report graph root (W10.3).
- **Route / location:** `/verify/:id` (certificate), `/pack/:id` (Board Pack) and `/root/:hash` (report graph root), outside the auth guard.
- **Rights required:** none. The page calls exactly one of the three anon-callable RPCs.
- **Testids (20):** `wk-verify`, `wk-verify-loading`, `wk-verify-error`, `wk-verify-status`, `wk-verify-not-found`, `wk-verify-rate-limited`, `wk-verify-organisation`, `wk-verify-title`, `wk-verify-issued`, `wk-verify-workpapers`, `wk-verify-findings`, `wk-verify-hash`, `wk-verify-drop`, `wk-verify-file`, `wk-verify-drop-error`, `wk-verify-drop-result`, `wk-verify-model`, `wk-verify-engine`, `wk-verify-template`, `wk-verify-phrases`
- **States:** loading; valid / superseded / revoked / not found / rate limited. Organisation name and title appear only when the tenant turned `public_verify_show_title` on.
- **Flows that touch this screen:** `oa.verify`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-09` — Time-Travel (S10, F14)

- **Purpose:** reconstruct one engagement as of a past moment from append-only history (F14). The timeline handle snaps to recorded events; the state shows workpapers, findings and seals as they were, or says what history did not record.
- **Route / location:** inside the Audit File window, the "Time-Travel" phase view (`audit-file-as-of`), offered only to a caller holding `view_insights` (`audit-file-view-as_of`). Read-only.
- **Rights required:** `view_insights`. The `time_travel` entitlement gates the database functions; a refusal from the server is surfaced as the state's error, never hidden.
- **Testids (19):** `wk-timetravel`, `wk-timetravel-loading`, `wk-timetravel-banner`, `wk-timetravel-track`, `wk-timetravel-handle`, `wk-timetravel-prev`, `wk-timetravel-next`, `wk-timetravel-date`, `wk-timetravel-now`, `wk-timetravel-compare`, `wk-timetravel-state`, `wk-timetravel-workpapers`, `wk-timetravel-not-recorded`, `wk-timetravel-diff`, `wk-timetravel-diff-empty`, `wk-timetravel-diff-<id>`, `wk-timetravel-event-<action>`, `wk-timetravel-asof`, `wk-timetravel-seal`
- **States:** loading; an as-of state with the banner; "Not recorded before <date>" when the entity kept no history; a diff region that lists added, changed and removed records. Animation respects `prefers-reduced-motion`.
- **Flows that touch this screen:** `oa.timetravel`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-10` — Cross-engagement patterns (S10, F15)

- **Purpose:** group concluded findings across engagements by deterministic text similarity and shared tags (F15). Three views: clusters, a heat map (entity by year, or by category) and a node graph. Clicking a cluster member, a graph node or a heat-map cell opens the original sealed finding.
- **Route / location:** the Issues & CAP Register, a "Patterns" view (`issues-view-patterns`). The view switch is offered to everyone; the data needs `view_insights`.
- **Rights required:** `view_insights` for the data; `edit_config` for the settings sub-view (OA-21). The `patterns` entitlement gates the feature. A caller without `view_insights` sees `wk-patterns-denied`.
- **Testids (25):** `wk-patterns`, `wk-patterns-loading`, `wk-patterns-denied`, `wk-patterns-empty`, `wk-patterns-unclustered`, `wk-patterns-tab-<view>`, `wk-patterns-clusters`, `wk-patterns-cluster-<id>`, `wk-patterns-finding-<id>`, `wk-patterns-node-<id>`, `wk-patterns-graph`, `wk-patterns-graph-empty`, `wk-patterns-heatmap`, `wk-patterns-heat-by`, `wk-patterns-heatmap-cells`, `wk-patterns-cell-<entityId>-<bucket>`, `wk-patterns-cell-count-<entityId>-<bucket>`, `wk-patterns-heatmap-empty`, `finding-drilldown`, `finding-drilldown-title`, `finding-drilldown-severity`, `finding-drilldown-entity`, `finding-drilldown-unavailable`, `finding-drilldown-error`, `/view/finding/:id`
- **States:** loading; a plain refusal for a caller without `view_insights`; an empty clusters list; an empty graph or heat map; an inline error. The graph node is a keyboard-reachable button.
- **Flows that touch this screen:** `oa.patterns`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-02` — Board Pack generator (S7)

- **Purpose:** build a Board Pack snapshot for a scope and a boundary, then take it away as a web view, a PDF or a PPTX. The pack is a frozen snapshot: every figure points at the record behind it.
- **Route / location:** WK-01 Board Pack panel (`wk-boardpack`), tab `Generate` (`wk-boardpack-tab-generator`).
- **Rights required:** `approve_plan` to generate; the pack shows only what the caller may read.
- **Testids (16):** `wk-boardpack`, `wk-boardpack-loading`, `wk-boardpack-error`, `wk-boardpack-result`, `wk-boardpack-tab-generator`, `wk-boardpack-generator`, `wk-boardpack-scope`, `wk-boardpack-from`, `wk-boardpack-to`, `wk-boardpack-boundary`, `wk-boardpack-generate`, `wk-boardpack-no-generate`, `wk-boardpack-pdf`, `wk-boardpack-pptx`, `wk-boardpack-url-missing`, `wk-boardpack-missing-refs`
- **States:** loading, error, ready; generate disabled until a scope and boundary are chosen; an inline refusal when the database rejects the call.
- **Flows that touch this screen:** `oa.boardpack-generate`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-03` — Board Pack web view (S7)

- **Purpose:** read a generated pack: the scope, the boundary, the delta against the previous pack, every section, and the sources index that traces each figure back to its record.
- **Route / location:** WK-01 Board Pack panel (`wk-boardpack`), tab `View` (`wk-boardpack-tab-view`), then a pack from the history (`wk-boardpack-open-<id>`).
- **Rights required:** `approve_plan`; a figure the caller may not read is shown sealed (`wk-boardpack-figure-sealed`), not silently omitted.
- **Testids (16):** `wk-boardpack`, `wk-boardpack-tab-view`, `wk-boardpack-view`, `wk-boardpack-history`, `wk-boardpack-open-<id>`, `wk-boardpack-verify-chip`, `wk-boardpack-delta`, `wk-boardpack-section-sira`, `wk-boardpack-section-issues`, `wk-boardpack-section-changes`, `wk-boardpack-section-sealed`, `wk-boardpack-section-sources`, `wk-boardpack-figure-sira-<i>`, `wk-boardpack-figure-cap-<band>`, `wk-boardpack-figure-sealed`, `wk-boardpack-source-<path>`
- **States:** loading, error, empty (no packs yet), ready; sealed figures.
- **Flows that touch this screen:** `oa.boardpack-view`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-11` — report builder (WRITE-1, W12)

- **Purpose:** The deterministic report builder, mounted as the "Report builder" view inside the existing Audit File
- **Route / location:** the Audit File window, view "Report builder" (`audit-file-view-builder`).
- **Rights required:** `review_and_approve` or `approve_plan` to compose; a caller without either sees the plain refusal, never the panel.
- **Testids (76):** `audit-file-builder`, `audit-file-view-builder`, `wk-report-builder-panel`, `wk-report-builder-loading`, `wk-report-builder-error`, `wk-report-builder-error-message`, `wk-report-builder-retry`, `wk-report-builder-denied`, `wk-report-builder-denied-error`, `wk-report-builder-controls`, `wk-report-builder-model`, `wk-report-builder-formality`, `wk-report-builder-tone`, `wk-report-builder-voice`, `wk-report-builder-locale`, `wk-report-builder-hashes`, `wk-report-builder-graph-root`, `wk-report-builder-render-hash`, `wk-report-builder-model-name`, `wk-report-builder-pane-claims`, `wk-report-builder-pane-coverage`, `wk-report-builder-pane-contradictions`, `wk-report-builder-pane-excluded`, `wk-report-builder-pane-compare`, `wk-report-builder-pane-figures`, `wk-report-builder-claims`, `wk-report-builder-claim-<id>`, `wk-report-builder-claim-<id>-text`, `wk-report-builder-claim-<id>-phrase`, `wk-report-builder-claim-<id>-provenance`, `wk-report-builder-claim-<id>-lineage`, `wk-report-builder-claim-<id>-provenance-panel`, `wk-report-builder-claim-<id>-trace-ok`, `wk-report-builder-claim-<id>-counterfactual`, `wk-report-builder-lineage-<figureId>`, `wk-report-builder-lineage-<figureId>-description`, `wk-report-builder-lineage-<figureId>-count`, `wk-report-builder-lineage-<figureId>-records`, `wk-report-builder-coverage`, `wk-report-builder-coverage-status`, `wk-report-builder-coverage-missing`, `wk-report-builder-coverage-duplicated`, `wk-report-builder-coverage-orphaned`, `wk-report-builder-contradictions`, `wk-report-builder-contradictions-empty`, `wk-report-builder-contradiction-<ruleId>`, `wk-report-builder-excluded`, `wk-report-builder-excluded-empty`, `wk-report-builder-excluded-<observationId>`, `wk-report-builder-compare`, `wk-report-builder-compare-summary`, `wk-report-builder-compare-changed-<claimId>`, `wk-report-builder-compare-registers`, `wk-report-builder-figure-studio`, `wk-report-builder-figure-note`, `wk-report-builder-figure-presets`, `wk-report-builder-figure-preset-<name>`, `wk-report-builder-figure-expression`, `wk-report-builder-figure-help`, `wk-report-builder-figure-min-x`, `wk-report-builder-figure-max-x`, `wk-report-builder-figure-title`, `wk-report-builder-figure-label`, `wk-report-builder-figure-colours`, `wk-report-builder-figure-colour-<name>`, `wk-report-builder-figure-preview`, `wk-report-builder-figure-preview-svg`, `wk-report-builder-figure-error`, `wk-report-builder-figure-add`, `wk-report-builder-figure-added`, `wk-report-builder-figure-limits`, `wk-report-builder-figures-added`, `wk-report-builder-figure-added-<i>`, `wk-report-builder-freeze`, `wk-report-builder-freeze-run`, `wk-report-builder-freeze-result`
- **States:** loading ("Composing the report…"); an inline error with a retry; a denied state for a caller without the right; ready, with the five panes and the freeze panel. The coverage pane names each missing, duplicated and orphaned item; the freeze panel lists every blocker or states that the freeze is allowed with the graph root and render hash.
- **Flows that touch this screen:** `oa.report-builder`
- **Connection candidates (same route):** — (route is unique to this screen)

### `WK-09` — procedure steps on a workpaper (Phase 4, §11.3)

- **Purpose:** The steps a workpaper follows, snapshotted from the organisation's methodology library. A preparer
- **Route / location:** the workpaper window, sub-tab "Testing" (`wk-subtab-testing`).
- **Rights required:** `perform_work`; the write is refused in the database without it.
- **Testids (6):** `procedure-steps-panel`, `procedure-model`, `procedure-apply`, `procedure-steps-message`, `procedure-steps-empty`, `procedure-step-<key>`
- **States:** loading; empty (no procedure applied); ready with the applied steps; an inline refusal after a failed apply or tick.
- **Flows that touch this screen:** `oa.timetravel`
- **Connection candidates (same route):** — (route is unique to this screen)

### `EX-01`, `EX-04` — the external auditor portal (S9)

- **Purpose:** the read-only portal an external auditor sees (F13). It lists the engagements the auditor is granted, shows an engagement summary, exposes the latest Board Pack and certificate hashes, and verifies a dropped document in the browser.
- **Route / location:** `/external` (portal), `/external/accept?token=…` (accept an invitation). Both are outside the tenant shell; the portal needs a session, the acceptance page is where the session is first used. A tenant member who opens `/external` sees a plain notice, never the portal.
- **Rights required:** none from the closed list (F13: the list is unaffected). Access is decided by the database through the security-definer `ext_*` family, which checks an active, unexpired grant.
- **Testids (25):** `ex-accept`, `ex-accept-token`, `ex-accept-submit`, `ex-accept-error`, `ex-accept-done`, `ex-accept-continue`, `ex-accept-hint`, `ex-portal`, `ex-portal-loading`, `ex-portal-inactive`, `ex-portal-error`, `ex-portal-empty`, `ex-portal-engagements`, `ex-portal-engagement-<id>`, `ex-portal-summary`, `ex-portal-downloads`, `ex-portal-pack-hash`, `ex-portal-cert-hash`, `ex-portal-verify`, `ex-portal-verify-result`, `ex-portal-drop`, `ex-portal-drop-input`, `ex-portal-drop-error`, `ex-portal-drop-result`, `external-portal-wrong-principal`
- **States:** loading; inactive ("Your access is not active"); an empty engagement list; an inline error; a drop that matches or does not match. There is no write control anywhere.
- **Flows that touch this screen:** `ex.accept`, `ex.verify`
- **Connection candidates (same route):** — (route is unique to this screen)

### `EX-02` — portal home (S9)

- **Purpose:** the external auditor's landing view: the engagements they may read, the summary of each, and the downloads available to them. No tenant application shell, no write path.
- **Route / location:** `/external` (`ex-portal`), outside the tenant shell but behind the auth gate.
- **Rights required:** the `external_auditor` access status plus a live, unexpired, unrevoked grant; the portal reads only the granted objects.
- **Testids (14):** `ex-portal`, `ex-portal-loading`, `ex-portal-error`, `ex-portal-inactive`, `ex-portal-empty`, `ex-portal-engagements`, `ex-portal-engagement-<id>`, `ex-portal-summary`, `ex-portal-downloads`, `ex-portal-cert-hash`, `ex-portal-pack-hash`, `ex-portal-verify`, `ex-portal-verify-result`, `external-portal-wrong-principal`
- **States:** loading, error, inactive (no live grant, with the reason), empty (no engagements), ready.
- **Flows that touch this screen:** `ex.home`
- **Connection candidates (same route):** — (route is unique to this screen)

### `EX-03` — engagement view (S9)

- **Purpose:** one engagement as the external auditor sees it: the summary, the certificate hash and the pack hash, and the drop zone where the auditor returns a document whose SHA-256 must match the hash on record.
- **Route / location:** `/external`, engagement card (`ex-portal-engagement-<id>`).
- **Rights required:** as EX-02; read-only plus the return-a-document action.
- **Testids (10):** `ex-portal`, `ex-portal-summary`, `ex-portal-cert-hash`, `ex-portal-pack-hash`, `ex-portal-drop`, `ex-portal-drop-input`, `ex-portal-drop-result`, `ex-portal-drop-error`, `ex-portal-verify`, `ex-portal-verify-result`
- **States:** loading, error, ready; a returned document that does not match the recorded hash is refused with the plain reason.
- **Flows that touch this screen:** `ex.engagement`
- **Connection candidates (same route):** — (route is unique to this screen)

### `DB-01` — Executive Dashboard (S1)

- **Purpose:** The landing tab: portfolio tiles (engagements, CAPs, findings, seals), a CAP radial tracker, the CAP table, the engagement Gantt and the Board Pack block, all scoped to the session's universes.
- **Route / location:** Tab `executive` (nav strip "Dashboard"). Not a route.
- **Rights required:** any signed-in member; each tile degrades to its empty state when the scope holds no records.
- **Testids (11):** `gantt-approve-shift`, `gantt-shift-error`, `DB-01-cap-hub-drilldown`, `DB-01-tile-entities`, `DB-01-tile-engagements`, `DB-01-tile-issues`, `DB-01-tile-workpapers`, `DB-01-activity-spine`, `DB-01-activity-spine-transport`, `DB-01-activity-spine-empty`, `DB-01-activity-spine-list`
- **States:** loading (skeleton tiles); empty (no engagements in scope); ready; the Board Pack block carries its own loading/empty/error states. The activity spine carries its own quiet empty state ("Nothing has happened yet").
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `DB-02` — Deterministic capability library (D1-D4)

- **Purpose:** The screen surface for the twenty deterministic capabilities across four families (risk and control, population and evidence, process and governance, assurance operations). Each is a pure function under `src/lib/capabilities/`; the panel hands one call site (`evaluateCapability`) the rows the caller may see, the organisation's thresholds and the current day.
- **Route / location:** The capability block on the Dashboard tab (`executive`), below the Board Pack block.
- **Rights required:** any signed-in member reads the families their scope allows; `edit_config` to change the thresholds.
- **Testids (27):** `DB-02-panel`, `DB-02-unconfigured`, `DB-02-record`, `DB-02-kind-risk_control`, `DB-02-kind-population_evidence`, `DB-02-kind-process_governance`, `DB-02-kind-assurance_ops`, `DB-02-kind-summary`, `DB-02-list`, `DB-02-cap-<id>`, `DB-02-cap-<id>-toggle`, `DB-02-cap-<id>-headline`, `DB-02-cap-<id>-status`, `DB-02-cap-<id>-rule`, `DB-02-cap-<id>-needs`, `DB-02-cap-<id>-rows`, `DB-02-cap-<id>-refs-<i>`, `DB-02-tolerance`, `DB-02-sample`, `DB-02-ageing`, `DB-02-save`, `DB-02-save-denied`, `DB-02-runs`, `DB-02-runs-empty`, `DB-02-message`, `DB-02-error`, `DB-02-explain`
- **States:** loading; unconfigured (no tenant database — says so, never a wall of zeros); ready; per-capability `ready` (findings), `empty` (an honest clean result) and `awaiting_input` (names the missing input).
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `WQ-01` — Work Queue (S1)

- **Purpose:** The user-specific queue: my workpapers, what awaits my sign-off, what awaits my approval and (for a manager) the team's open work, built by the pure `src/lib/workQueue.ts` module.
- **Route / location:** Tab `pending` (nav strip "Work Queue").
- **Rights required:** any signed-in member; each section is filtered by the caller's rights.
- **Testids (7):** `pending-comments`, `tab-pending`, `WQ-01-front-door`, `WQ-01-front-door-count`, `WQ-01-front-door-summary`, `WQ-01-front-door-empty`, `WQ-01-front-door-list`
- **States:** loading; empty per section ("Nothing awaiting you"); ready; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AU-01` — Audit Universe (S1)

- **Purpose:** The universe and entity heatmap (spec §6): every entity card shows its approval status and opens the entity-approval inspector.
- **Route / location:** Tab `universe` (nav strip "Audit Universe").
- **Rights required:** any member reads; `edit_config` to add an entity.
- **Testids (3):** `add-entity-form`, `add-entity-open`, `db-entities`
- **States:** loading; empty (no universes/entities); ready; denied on the add form without `edit_config`.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AU-02` — Entity approval inspector (S1)

- **Purpose:** Submit an entity for approval, approve or reject it, and read its append-only approval history; the decision is re-checked in the database.
- **Route / location:** The `entity_approval` inspector window, opened from an entity card.
- **Rights required:** `perform_work` to submit; `manage_engagements`/`approve_plan`/`review_and_approve` to decide.
- **Testids (11):** `entity-approval`, `entity-approval-error`, `entity-approve`, `entity-check-status`, `entity-history`, `entity-history-empty`, `entity-history-loading`, `entity-pending-waiting`, `entity-reject`, `entity-status`, `entity-submit`
- **States:** loading; waiting (`entity-pending-waiting`); ready; history loading/empty; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AP-01` — Audit Plan (S1)

- **Purpose:** The plan register for a universe: items, versions, gate outcomes, and the entry points to the planning panel, the plan-items inspector, the combined-approval inspector and the ethics sign-off.
- **Route / location:** Tab `plan` (nav strip "Audit Plan").
- **Rights required:** any member reads; the open buttons appear only with the matching right.
- **Testids (11):** `engagement-signoff`, `plan-action-error`, `plan-open-combined`, `plan-open-ethics`, `plan-open-gate`, `plan-open-items`, `plan-records`, `plan-records-error`, `plan-records-gates`, `plan-records-items`, `plan-records-versions`
- **States:** loading; empty; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AP-02` — Plan items inspector (S1)

- **Purpose:** Add a plan item with a justification, see each item's approval status, and read the plan version history.
- **Route / location:** The `plan_items` inspector window.
- **Rights required:** `manage_engagements` to add; `approve_plan` to approve an ad-hoc item.
- **Testids (8):** `plan-add`, `plan-add-button`, `plan-item-list`, `plan-items`, `plan-items-empty`, `plan-justification-hint`, `plan-versions`, `plan-versions-empty`
- **States:** loading; empty (`plan-items-empty`, `plan-versions-empty`); ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AP-03` — Combined approval inspector (S1)

- **Purpose:** Raise a combined deployment request across an entity's engagements, decide it, and see the SLA and escalation state.
- **Route / location:** The `combined_approval` inspector window.
- **Rights required:** `perform_work` to raise; `approve_plan` to decide.
- **Testids (15):** `combined-approval`, `combined-approval-error`, `combined-approve`, `combined-decide-reason`, `combined-entity-empty`, `combined-entity-picker`, `combined-escalated`, `combined-escalated-next`, `combined-next-action`, `combined-raise`, `combined-raised`, `combined-reject`, `combined-request`, `combined-sla`, `combined-status`
- **States:** loading; empty entity picker; ready; escalated banner; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AP-04` — Planning panel (S1)

- **Purpose:** The planning phase of an engagement: deterministic suggestions, accept/reject each, the reconciliation check, discrepancy acknowledgement with a reason, and the planning sign-off.
- **Route / location:** The planning view inside the Audit File window.
- **Rights required:** `review_and_approve` to sign off; a caller without it sees the refusal.
- **Testids (14):** `planning-ack`, `planning-ack-reason`, `planning-error`, `planning-go-sira`, `planning-import-rcm`, `planning-loading`, `planning-mismatch`, `planning-mismatch-item`, `planning-panel`, `planning-reconciliation`, `planning-signed-off`, `planning-signoff`, `planning-signoff-reason`, `planning-suggestions-empty`
- **States:** loading; suggestions empty; mismatch list; signed-off; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AP-05` — Prior-year import inspector (S1)

- **Purpose:** Bring last year's findings forward: confirm or revert each unconfirmed prior-year item, each with its own status.
- **Route / location:** The `import_wizard`/prior-year inspector window.
- **Rights required:** `manage_engagements`.
- **Testids (7):** `prior-year-controls`, `prior-year-empty`, `prior-year-error`, `prior-year-import`, `prior-year-loading`, `prior-year-panel`, `prior-year-unconfirmed`
- **States:** loading; empty; unconfirmed list; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SR-01` — SIRA (S1)

- **Purpose:** The Strategic Internal Risk Assessment (spec §7): the risk table, the persisted model/cycles/plan snapshot, and the entry points to the model editor and cycle inspector.
- **Route / location:** Tab `sira` (nav strip "SIRA").
- **Rights required:** any member reads; the open buttons gate on the matching right.
- **Testids (9):** `sira-load-error`, `sira-open-cycles`, `sira-open-model`, `sira-persisted`, `sira-persisted-cycles`, `sira-persisted-model`, `sira-persisted-plan`, `sira-table`, `tab-sira`
- **States:** loading; empty; persisted/not-persisted banner; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SR-02` — SIRA model editor (S1)

- **Purpose:** Edit the SIRA model: aggregation, factors and bands; a locked model is read-only.
- **Route / location:** The `sira_model` inspector window.
- **Rights required:** `edit_config`.
- **Testids (7):** `sira-aggregation`, `sira-bands`, `sira-factors`, `sira-model`, `sira-model-empty`, `sira-model-locked`, `sira-model-version`
- **States:** loading; empty (`sira-model-empty`); locked (`sira-model-locked`); ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `SR-03` — SIRA cycles inspector (S1)

- **Purpose:** Create a SIRA cycle, score it, publish the cycle, decide emergent risks with a reason, and close
- **Route / location:** The `sira_cycles` inspector window.
- **Rights required:** `manage_engagements` to create/publish/endorse/score; `review_and_approve` to decide an emergent risk and to accept.
- **Testids (28):** `emergent-empty`, `emergent-risks`, `emergent-submit`, `emergent-submit-description`, `emergent-submit-locked`, `emergent-submit-title`, `sira-carry-forward-chain`, `sira-carry-forward-`, `sira-create-cycle`, `sira-cycle-panel`, `sira-cycles`, `sira-cycles-empty`, `sira-cycles-inspector`, `sira-cycles-unscoped`, `sira-pack-`, `sira-record-score`, `sira-remind`, `sira-score-entity`, `sira-score-list`, `sira-score-preview`, `sira-score-risk`, `sira-scoring-frozen`, `sira-scoring-locked`, `sira-scoring-no-cycle`, `sira-scoring-no-model`, `sira-scoring-panel`, `sira-scoring-summary`, `sira-seed-`
- **States:** loading; empty (`sira-cycles-empty`, `emergent-empty`); unscoped (`sira-cycles-unscoped`); ready; publish blocked; awaiting acceptance; pack built; the persisted carry-forward chain (`sira-carry-forward-chain`); scoring with no draft cycle (`sira-scoring-no-cycle`), a frozen cycle (`sira-scoring-frozen`), no model (`sira-scoring-no-model`), locked (`sira-scoring-locked`).
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-01` — Audit File window (S1)

- **Purpose:** The engagement workspace: a floating, non-modal window whose view switch opens Planning, Execution, Review, Population, Sampling, Row testing, Conclusion, Ethics, Findings, Documents, the Deployment gate, the Analyst engine, the Certificate, the Report editor, the Report builder, the CAPs and the Time-Travel/As-of view.
- **Route / location:** The `audit_file` floating window, opened from an engagement card; the tab is `audit_file`.
- **Rights required:** any member reads; each view gates on its own right and shows the refusal otherwise.
- **Testids (18):** `audit-file`, `audit-file-advance-stage`, `audit-file-as-of`, `audit-file-builder`, `audit-file-caps`, `audit-file-certificate`, `audit-file-conclusion`, `audit-file-documents`, `audit-file-export`, `audit-file-findings`, `audit-file-report`, `audit-file-stage`, `audit-file-stage-error`, `audit-file-unavailable`, `audit-file-workspace`, `tab-audit-file`, `workbench-action-error`, `workbench-signoff`
- **States:** loading; unavailable (`audit-file-unavailable`); ready; per-view empty states.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-02` — Audit File — Planning view (S1)

- **Purpose:** The planning view: the RCM rows, SIRA coverage and any coverage gap.
- **Route / location:** Audit File window, view "Planning" (`audit-file-view-planning`).
- **Rights required:** any member reads.
- **Testids (5):** `audit-file-planning`, `planning-coverage-summary`, `planning-empty`, `planning-no-entity`, `planning-sira`
- **States:** loading; no-entity (`planning-no-entity`); empty; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-03` — Audit File — Execution view (S1)

- **Purpose:** The execution view: workpaper rows and their status.
- **Route / location:** Audit File window, view "Execution" (`audit-file-view-execution`).
- **Rights required:** any member reads.
- **Testids (2):** `audit-file-execution`, `execution-empty`
- **States:** loading; empty (`execution-empty`); ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-04` — Audit File — Review view (S1)

- **Purpose:** The review view: the sign-off gate count, the signed-off note, the sign-off reason, the report-pack placeholder and the change-control panel.
- **Route / location:** Audit File window, view "Review" (`audit-file-view-review`).
- **Rights required:** `review_and_approve`.
- **Testids (8):** `audit-file-review`, `gate-count`, `report-pack-placeholder`, `signed-off-note`, `signoff-button`, `signoff-error`, `signoff-reason`, `wk-changes`
- **States:** loading; ready; the change-control panel carries its own states.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-05` — Population panel (S1)

- **Purpose:** Register a population file, show its SHA-256 hash, and lock the population (hold-to-confirm); a locked population is immutable.
- **Route / location:** Audit File window, view "Population" (`audit-file-view-population`).
- **Rights required:** `perform_work`.
- **Testids (21):** `population-browse`, `population-dropzone`, `population-empty`, `population-error`, `population-file-input`, `population-hash`, `population-loading`, `population-panel`, `population-register`, `population-gate`, `population-status`, `population-profile-<id>`, `population-profile-view-<id>`, `population-profile-summary-<id>`, `population-profile-flags-<id>`, `control-total`, `population-errors`, `gate-message`, `finalize-test`, `header-confirm`, `header-confirm-0`
- **States:** loading; empty; hashed; locked; profile loading; profile ready (row count, value coverage, duplicate density, period, flags); error inline; header detected and awaiting confirmation (S2 — the engine proposes the header row, the auditor confirms it, rows above it are ignored and the header row is not counted).
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-06` — Sampling panel (S1)

- **Purpose:** Compute a deterministic sample (seed preview, mode, floor), paste an id list, and lock the sample; a locked sample is read-only.
- **Route / location:** Audit File window, view "Sampling" (`audit-file-view-sampling`).
- **Rights required:** `perform_work`.
- **Testids (20):** `sampling-calculation`, `sampling-compute`, `sampling-coverage`, `sampling-coverage-status`, `sampling-current`, `sampling-error`, `sampling-floor`, `sampling-loading`, `sampling-lock`, `sampling-locked`, `sampling-method`, `sampling-no-workpaper`, `sampling-panel`, `sampling-paste`, `sampling-paste-count`, `sampling-precision`, `sampling-rules-empty`, `sampling-seed-preview`, `sampling-tested-rows`, `sampling-waive-reason`
- **States:** loading; no workpaper (`sampling-no-workpaper`); no rules (`sampling-rules-empty`); computed (`sampling-method`, `sampling-calculation`); high-value coverage (`sampling-coverage`, `sampling-coverage-status`; a missing item can be waived with a reason, `sampling-waive-reason`); exact interval (`sampling-precision`); tested rows from the sample (`sampling-tested-rows`); locked (`sampling-locked`); error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-06` — Working-paper creation (S1)

- **Purpose:** Create the working paper the testing workspace runs against. Before migration 0116 no path created one, so
- **Route / location:** Audit File window, view "Testing workspace" (`audit-file-workspace`).
- **Rights required:** `perform_work` to create.
- **Testids (7):** `workpaper-create-cancel`, `workpaper-create-error`, `workpaper-create-open`, `workpaper-create-panel`, `workpaper-create-reason`, `workpaper-create-submit`, `workpaper-title`
- **States:** closed; open; busy; error inline; denied (`workpaper-create-reason`).
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-07` — Row testing panel (S1)

- **Purpose:** Record each sampled row's result and rationale, mark an exception, sign off the workpaper with a reason, and reopen it.
- **Route / location:** Audit File window, view "Row testing" (`audit-file-view-rowtesting`).
- **Rights required:** `perform_work` to record; `review_and_approve` to sign off; `can_reopen` to reopen.
- **Testids (11):** `rowtesting-empty`, `rowtesting-error`, `rowtesting-justification`, `rowtesting-loading`, `rowtesting-no-workpaper`, `rowtesting-panel`, `rowtesting-preflight`, `rowtesting-reopen`, `rowtesting-signed-off`, `rowtesting-signoff`, `rowtesting-signoff-reason`
- **States:** loading; no workpaper (`rowtesting-no-workpaper`); empty; signed-off; preflight note; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-08` — Conclusion panel (S1)

- **Purpose:** Pull the testing exceptions, read the pulled-at stamp and the pre-flight state, and sign the conclusion (hold-to-confirm) with a reason; a locked conclusion is immutable.
- **Route / location:** Audit File window, view "Conclusion" (`audit-file-view-conclusion`).
- **Rights required:** `review_and_approve`.
- **Testids (11):** `conclusion-error`, `conclusion-exceptions`, `conclusion-exceptions-empty`, `conclusion-loading`, `conclusion-locked`, `conclusion-panel`, `conclusion-preflight`, `conclusion-pull`, `conclusion-pulled-at`, `conclusion-sign`, `conclusion-sign-reason`
- **States:** loading; exceptions empty; locked; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-09` — Ethics panel (S1)

- **Purpose:** The ethics independence declaration: every listed member acknowledges; the panel shows who is still pending.
- **Route / location:** Audit File window, view "Ethics" (`audit-file-view-ethics`); also the `ethics` inspector.
- **Rights required:** `perform_work` to acknowledge.
- **Testids (4):** `ethics-empty`, `ethics-error`, `ethics-members`, `ethics-panel`
- **States:** loading; empty; pending members; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-10` — Findings panel (S1)

- **Purpose:** Turn observations into findings: create an observation, promote it to a finding, and raise an issue; the severity legend is shown.
- **Route / location:** Audit File window, views "Findings"/"Documents" (`audit-file-view-findings`, `audit-file-view-documents`).
- **Rights required:** `perform_work`.
- **Testids (8):** `findings-empty`, `findings-error`, `findings-loading`, `findings-panel`, `issue-create`, `issue-title`, `issues-empty`, `severity-legend`
- **States:** loading; empty (`issues-empty`); ready; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-11` — Document viewer (S1)

- **Purpose:** Search the engagement's evidence documents, extract text on request, and read the extraction hits.
- **Route / location:** Audit File window, view "Documents" (`audit-file-view-documents`).
- **Rights required:** any member reads.
- **Testids (9):** `document-empty`, `document-error`, `document-list`, `document-list-empty`, `document-list-toggle`, `document-loading`, `document-results`, `document-search`, `document-viewer`
- **States:** loading; empty; search results; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-15` — Evidence vault (workpaper) (S20)

- **Purpose:** The evidence vault inside a workpaper's workbench: upload a file, see every stored artifact with its
- **Route / location:** the `workbench` inspector window, sub-tab "Evidence Vault".
- **Rights required:** `perform_work` to upload; any member of the org reads.
- **Testids (3):** `evidence-error`, `evidence-storage-note`, `evidence-upload`
- **States:** loading; session-only (no bucket); empty; stored; verifying; verified; mismatch.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-12` — Deployment gate (S1)

- **Purpose:** Run the deployment gate for an engagement: the ordered steps, each outcome, the required right, and the next action.
- **Route / location:** The `deployment_gate` inspector window.
- **Rights required:** `manage_engagements`.
- **Testids (13):** `deployment-gate`, `deployment-gate-empty`, `deployment-gate-run`, `gate-deploy`, `gate-deploy-error`, `gate-go-plan`, `gate-go-universe`, `gate-next-action`, `gate-open-combined`, `gate-outcome`, `gate-required-right`, `gate-step`, `gate-view-engagement`
- **States:** loading; empty (`deployment-gate-empty`); running; outcome; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-13` — Analyst engine (S1)

- **Purpose:** Run the deterministic analytics checks over the population and raise a finding from a result.
- **Route / location:** The `analytics` inspector window.
- **Rights required:** `perform_work`.
- **Testids (4):** `analyst-empty`, `analyst-error`, `analyst-loading`, `analyst-panel`
- **States:** loading; empty (`analyst-empty`); result per check; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `AF-14` — Report editor (S1)

- **Purpose:** Compose the engagement report from its sections and blocks, comment on a block, incorporate or reject each comment, read the central pre-flight (comments, CAPs, acknowledgements), acknowledge a blocker with a reason, freeze the report and render the PDF/DOCX files, preview the frozen footer line, and drill into the committed evidence-bound claim graph.
- **Route / location:** Audit File window, view "Report" (`audit-file-view-report`).
- **Rights required:** `perform_work` to compose/comment; `approve_plan` to freeze.
- **Testids (38):** `report-caps-note`, `report-comment-add`, `report-comment-input`, `report-comments`, `report-comments-empty`, `report-compose`, `report-editor`, `report-empty`, `report-error`, `report-file-docx`, `report-file-pdf`, `report-files`, `report-footer-preview`, `report-freeze`, `report-freeze-blocked`, `report-freeze-panel`, `report-graph-close`, `report-graph-empty`, `report-graph-open`, `report-graph-panel`, `report-issue`, `report-loading`, `report-notice`, `report-open-comments`, `report-placeholder-count`, `report-preflight-ack-check`, `report-preflight-ack-form`, `report-preflight-ack-item`, `report-preflight-ack-reason`, `report-preflight-ack-submit`, `report-preflight-acks`, `report-preflight-blocking`, `report-preflight-caps`, `report-preflight-comments`, `report-preflight-item-list`, `report-rights-note`, `report-section-empty`, `report-versions`
- **States:** loading; empty; comments; pre-flight; freeze blocked; frozen; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `IR-01` — Issues & CAP Register (S1)

- **Purpose:** The issue register: the heat matrix (severity by age, by department), the CAP register section, and the view switch to Patterns.
- **Route / location:** Tab `issues` (nav strip "Issues & CAP Register"); views via `issues-view-<view>`.
- **Rights required:** any member reads; patterns configuration needs `edit_config`.
- **Testids (3):** `cap-engagement-picker`, `cap-no-engagement`, `issues-cap-register-section`
- **States:** loading; empty; ready; per-view states.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `IR-02` — CAP register panel (S1)

- **Purpose:** Read every corrective action for an engagement: its status, the action to transition it, the evidence attachment and the reconciliation check.
- **Route / location:** Inside the Issues & CAP Register, the CAP register section (`issues-cap-register-section`).
- **Rights required:** `perform_work` to act; `review_and_approve` to close.
- **Testids (4):** `cap-empty`, `cap-error`, `cap-loading`, `cap-register`
- **States:** loading; empty; no-engagement picker; ready; error inline.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `IR-03` — Finding drilldown (S1)

- **Purpose:** The full finding: severity, title, entity, and the links back to the department, the audit and the workpaper.
- **Route / location:** The `finding` inspector window.
- **Rights required:** any member reads.
- **Testids (7):** `finding-drilldown`, `finding-drilldown-entity`, `finding-drilldown-error`, `finding-drilldown-loading`, `finding-drilldown-severity`, `finding-drilldown-title`, `finding-drilldown-unavailable`
- **States:** loading; unavailable; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `IR-04` — Observation drilldown (S1)

- **Purpose:** The observation drill-down: the department, the audit and the workpaper behind it.
- **Route / location:** The `observation` inspector window.
- **Rights required:** any member reads.
- **Testids (4):** `finding-audit`, `finding-department`, `finding-workpaper`, `observation-form-error`
- **States:** loading; ready.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `IR-05` — CAP inspector (S1)

- **Purpose:** Inspect a single CAP: attach evidence and edit it, with the form error surfaced inline.
- **Route / location:** The `cap_inspector` inspector window.
- **Rights required:** `perform_work`.
- **Testids (3):** `cap-confirm-close`, `cap-evidence-file`, `cap-form-error`
- **States:** ready; form error.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-01` — Navigation strip (S1)

- **Purpose:** The primary tab bar: Dashboard, Work Queue, Audit Universe, Audit Plan, SIRA, Audit Files, Issues & CAP Register; tabs are reorderable and collapse to icons at narrow widths.
- **Route / location:** Rendered on every authenticated screen below the header.
- **Rights required:** each tab is shown only when the session has the right for it.
- **Testids (2):** `nav-draggable-pill`, `nav-strip-track`
- **States:** ready; tabs filtered by rights.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-02` — Header bar (S1)

- **Purpose:** The header: the compact search that opens the command palette, the profile menu (activity log, import, org control, people admin, shared with me), the notification bell, the calendar and the universe switcher.
- **Route / location:** Rendered on every authenticated screen.
- **Rights required:** menu entries appear only with the matching right.
- **Testids (7):** `header-search-compact`, `menu-activity-log`, `menu-import`, `menu-org-control`, `menu-people-admin`, `menu-shared-with-me`, `mobile-universe-switcher`
- **States:** ready; menu closed/open; badge hidden at zero unread.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-03` — Command palette (S1)

- **Purpose:** The keyboard palette for jumping to a screen, a record, an action or an explain entry. Cmd/Ctrl-K
- **Route / location:** A non-blocking dropdown anchored below the header, never a modal.
- **Rights required:** any signed-in member; actions that need a right are hidden from a caller who lacks it (`visibleCommands`).
- **Testids (8):** `command-palette`, `command-palette-input`, `command-palette-close`, `command-palette-empty`, `command-palette-explain`, `command-palette-item-<id>`, `command-palette-option-<id>`, `command-palette-group-<kind>`
- **States:** hidden; open with results (screens, then actions, then explain, then records); no results ("No matches within your permissions."); an explain row opened inline, non-modally.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-04` — Floating windows and dock (S1)

- **Purpose:** The non-modal record window (drag, resize, pop out, dock) that hosts every inspector; the dock lists minimised windows.
- **Route / location:** Rendered above the shell; a pop-out uses the `/view/:recordType/:id` route.
- **Rights required:** the hosted inspector enforces its own right.
- **Testids (1):** `floating-window-dock`
- **States:** open; docked; popped out; revision/refresh indicators.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-05` — Presentation primitives (S1)

- **Purpose:** The shared presentation primitives: the hover preview popover, the hold-to-confirm control, the inline error and the labelled select.
- **Route / location:** Not a screen; used inside many screens.
- **Rights required:** inherited from the host screen.
- **Testids (2):** `hover-preview-popover`, `hover-preview-trigger`
- **States:** trigger; popover shown.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-06` — Calendar (S1)

- **Purpose:** The audit calendar: the day detail panel opened from the header calendar.
- **Route / location:** The header calendar panel (not a tab).
- **Rights required:** any member reads.
- **Testids (1):** `calendar-day-detail`
- **States:** loading; day detail; empty.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-07` — Review comment history and popout (S21)

- **Purpose:** The live review-comment surface: one comment's dialogue, or the full review trail across cycles. Each row carries the access-filtered hover/focus popout (author, age, workpaper, engagement, status, resolution path) and the open/cleared counts drill to the exact comments behind them. Non-blocking throughout.
- **Route / location:** The `comment_history` inspector window, opened from the review dock ("View full comment history") and the Work Queue.
- **Rights required:** any member that may read audit working records; an observer (read-only with `view_all_scopes`) and a configuration-only principal see the redacted popout, never the text.
- **Testids (17):** `CH-07-comment-empty`, `CH-07-comment-list`, `CH-07-comment-popout-<id>`, `CH-07-comment-search`, `CH-07-comment-cycle-filter`, `CH-07-comment-status-all`, `CH-07-comment-status-open`, `CH-07-comment-status-cleared`, `CH-07-comment-<id>`, `CH-07-comment-age-<id>`, `CH-07-comment-state-<id>`, `CH-07-comment-resolution-<id>`, `CH-07-comment-open-<id>`, `CH-07-comment-reply-input-<id>`, `CH-07-comment-reply-<id>`, `CH-07-bubble-mine`, `CH-07-bubble-other`
- **States:** single comment; full history; search; cycle filter; open/cleared filter; redacted (viewer may not read); empty ("no comments match"); drilldown open.
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

### `CH-08` — Keyboard shortcut sheet (U8)

- **Purpose:** The `?` sheet: every shortcut the caller may use, grouped, with its key sequence. Non-blocking.
- **Route / location:** A `role="complementary"` panel anchored below the header, opened by `?`; never a modal.
- **Rights required:** the sheet lists only the shortcuts whose right the caller holds (`groupedShortcuts`); a configuration-only principal sees no navigation rows.
- **Testids (6):** `shortcut-sheet`, `shortcut-sheet-close`, `shortcut-sheet-list`, `shortcut-sheet-empty`, `shortcut-sheet-group-<group>`, `shortcut-sheet-item-<id>`
- **States:** closed; open with the caller's shortcuts grouped; empty (no shortcut available to the caller).
- **Flows that touch this screen:** — (no flow)
- **Connection candidates (same route):** — (route is unique to this screen)

## Flows

A flow is a recorded tutorial: an ordered walk over one screen's testids. It is the closest thing
to a "user journey" the product carries, and it is the designer's best description of how a screen
is actually used. Each step names a testid or is a free instruction (a step with no testid is an
instruction the recorder performs without clicking).

### `ex.accept` — Accept invite and sign in (EX-01)

- **Audience:** both
- **Media:** `public/tutorials/ex.accept.gif`
- **Steps (7):**
  1. Open EX-01 (Accept invite and sign in). — _no testid_
  2. Read Accept done in EX-01. — `ex-accept-done`
  3. Click Accept in EX-01. — `ex-accept`
  4. Click Accept submit in EX-01. — `ex-accept-submit`
  5. Click Accept continue in EX-01. — `ex-accept-continue`
  6. Fill in Accept token in EX-01. — `ex-accept-token`
  7. Read Accept hint in EX-01. — `ex-accept-hint`

### `ex.engagement` — Engagement view (EX-03)

- **Audience:** both
- **Media:** `public/tutorials/ex.engagement.gif`
- **Steps (6):**
  1. Open EX-03 (Engagement view). — _no testid_
  2. Read Portal summary in EX-03. — `ex-portal-summary`
  3. Click Portal verify in EX-03. — `ex-portal-verify`
  4. Click Portal drop in EX-03. — `ex-portal-drop`
  5. Read Portal drop result in EX-03. — `ex-portal-drop-result`
  6. Read Portal verify result in EX-03. — `ex-portal-verify-result`

### `ex.home` — Portal home (EX-02)

- **Audience:** both
- **Media:** `public/tutorials/ex.home.gif`
- **Steps (4):**
  1. Open EX-02 (Portal home). — _no testid_
  2. Read Portal summary in EX-02. — `ex-portal-summary`
  3. Click Portal verify in EX-02. — `ex-portal-verify`
  4. Read Portal verify result in EX-02. — `ex-portal-verify-result`

### `ex.verify` — Hash verification (EX-04)

- **Audience:** both
- **Media:** `public/tutorials/ex.verify.gif`
- **Steps (7):**
  1. Open EX-04 (Hash verification). — _no testid_
  2. Read Portal verify result in EX-04. — `ex-portal-verify-result`
  3. Click Portal verify in EX-04. — `ex-portal-verify`
  4. Click Accept in EX-04. — `ex-accept`
  5. Click Accept submit in EX-04. — `ex-accept-submit`
  6. Click Accept continue in EX-04. — `ex-accept-continue`
  7. Click Portal drop in EX-04. — `ex-portal-drop`

### `oa.auditor-matrix` — External auditor permission matrix (OA-14)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.auditor-matrix.gif`
- **Steps (7):**
  1. Open OA-14 (External auditor permission matrix). — _no testid_
  2. Read Auditors matrix in OA-14. — `oa-auditors-matrix`
  3. Click Auditors invite in OA-14. — `oa-auditors-invite`
  4. Find the first Auditors engagement in OA-14. — `oa-auditors-engagement-<id>`
  5. Read Auditors result OK in OA-14. — `oa-auditors-result-ok`
  6. Read Auditors in OA-14. — `oa-auditors`
  7. Fill in Auditors email in OA-14. — `oa-auditors-email`

### `oa.auditors` — External auditors (OA-14)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.auditors.gif`
- **Steps (7):**
  1. Open OA-14 (External auditors). — _no testid_
  2. Read Auditors in OA-14. — `oa-auditors`
  3. Click Auditors invite in OA-14. — `oa-auditors-invite`
  4. Find the first Auditors engagement in OA-14. — `oa-auditors-engagement-<id>`
  5. Read Auditors result OK in OA-14. — `oa-auditors-result-ok`
  6. Fill in Auditors email in OA-14. — `oa-auditors-email`
  7. Read Auditors days in OA-14. — `oa-auditors-days`

### `oa.automation` — Notification rules (OA-12)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.automation.gif`
- **Steps (7):**
  1. Open OA-12 (Notification rules). — _no testid_
  2. Read Automation in OA-12. — `org-automation`
  3. Click Rule save in OA-12. — `org-rule-save`
  4. Read Automation result in OA-12. — `org-automation-result`
  5. Read Automation saved in OA-12. — `org-automation-saved`
  6. Read Automation new in OA-12. — `org-automation-new`
  7. Read Automation editor in OA-12. — `org-automation-editor`

### `oa.boardpack-config` — Board Pack configuration (OA-09)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.boardpack-config.gif`
- **Steps (7):**
  1. Open OA-09 (Board Pack configuration). — _no testid_
  2. Open the Board Pack config tab in OA-09. — `wk-boardpack-tab-config`
  3. Read Board Pack in OA-09. — `wk-boardpack`
  4. Find the first Board Pack section in OA-09. — `oa-boardpack-section-<key>`
  5. Read Board Pack result in OA-09. — `wk-boardpack-result`
  6. Read Board Pack config in OA-09. — `oa-boardpack-config`
  7. Find the first Board Pack up in OA-09. — `oa-boardpack-up-<key>`

### `oa.boardpack-download` — Board Pack downloads and verify (WK-04)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.boardpack-download.gif`
- **Steps (7):**
  1. Open WK-04 (Board Pack downloads and verify). — _no testid_
  2. Open the Board Pack history tab in WK-04. — `wk-boardpack-tab-history`
  3. Read Board Pack in WK-04. — `wk-boardpack`
  4. Click Board Pack generate in WK-04. — `wk-boardpack-generate`
  5. Find the first Board Pack in WK-04. — `wk-boardpack-<id>`
  6. Click Board Pack heatmap in WK-04. — `wk-boardpack-heatmap`
  7. Click Board Pack gantt legend in WK-04. — `wk-boardpack-gantt-legend`

### `oa.boardpack-generate` — Board Pack generator (WK-02)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.boardpack-generate.gif`
- **Steps (7):**
  1. Open WK-02 (Board Pack generator). — _no testid_
  2. Open the Board Pack generator tab in WK-02. — `wk-boardpack-tab-generator`
  3. Read Board Pack in WK-02. — `wk-boardpack`
  4. Click Board Pack generate in WK-02. — `wk-boardpack-generate`
  5. Read Board Pack result in WK-02. — `wk-boardpack-result`
  6. Read Board Pack generator in WK-02. — `wk-boardpack-generator`
  7. Fill in Board Pack scope in WK-02. — `wk-boardpack-scope`

### `oa.boardpack-use` — Dashboard Board Pack panel (WK-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.boardpack-use.gif`
- **Steps (7):**
  1. Open WK-01 (Dashboard Board Pack panel). — _no testid_
  2. Open the Board Pack history tab in WK-01. — `wk-boardpack-tab-history`
  3. Read Board Pack in WK-01. — `wk-boardpack`
  4. Click Board Pack generate in WK-01. — `wk-boardpack-generate`
  5. Find the first Board Pack in WK-01. — `wk-boardpack-<id>`
  6. Click Board Pack heatmap in WK-01. — `wk-boardpack-heatmap`
  7. Click Board Pack gantt legend in WK-01. — `wk-boardpack-gantt-legend`

### `oa.boardpack-view` — Board Pack web view (WK-03)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.boardpack-view.gif`
- **Steps (7):**
  1. Open WK-03 (Board Pack web view). — _no testid_
  2. Open the Board Pack view tab in WK-03. — `wk-boardpack-tab-view`
  3. Read Board Pack in WK-03. — `wk-boardpack`
  4. Find the first Board Pack open in WK-03. — `wk-boardpack-open-<id>`
  5. Read Board Pack view in WK-03. — `wk-boardpack-view`
  6. Read Board Pack history in WK-03. — `wk-boardpack-history`
  7. Read Board Pack verify chip in WK-03. — `wk-boardpack-verify-chip`

### `oa.branding` — Branding and report format (OA-03)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.branding.gif`
- **Steps (7):**
  1. Open OA-03 (Branding and report format). — _no testid_
  2. Read Branding in OA-03. — `oa-branding`
  3. Click Branding theme upload in OA-03. — `oa-branding-theme-upload`
  4. Click Branding save in OA-03. — `oa-branding-save`
  5. Click Branding preview in OA-03. — `oa-branding-preview`
  6. Fill in Branding title in OA-03. — `oa-branding-title`
  7. Read Branding form in OA-03. — `oa-branding-form`

### `oa.certificate` — Certificate panel (WK-05)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.certificate.gif`
- **Steps (7):**
  1. Open WK-05 (Certificate panel). — _no testid_
  2. Read Certificate in WK-05. — `wk-certificate`
  3. Click Certificate issue in WK-05. — `wk-certificate-issue`
  4. Find the first Certificate in WK-05. — `wk-certificate-<id>`
  5. Read Certificate result in WK-05. — `wk-certificate-result`
  6. Read Certificate list in WK-05. — `wk-certificate-list`
  7. Read Certificate OK in WK-05. — `wk-certificate-ok`

### `oa.certificate-config` — Certificate configuration (OA-10)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.certificate-config.gif`
- **Steps (6):**
  1. Open OA-10 (Certificate configuration). — _no testid_
  2. Read Certificate config in OA-10. — `oa-certificate-config`
  3. Find the first Certificate field in OA-10. — `oa-certificate-field-<key>`
  4. Read Certificate field engagement ID in OA-10. — `oa-certificate-field-engagement_id`
  5. Read Certificate enabled verification in OA-10. — `oa-certificate-enabled-verification`
  6. Find the first Certificate enabled in OA-10. — `oa-certificate-enabled-<key>`

### `oa.connectors` — Connectors and monitoring (OA-23)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.connectors.gif`
- **Steps (7):**
  1. Open OA-23 (Connectors and monitoring). — _no testid_
  2. Read Connectors panel in OA-23. — `wk-connectors-panel`
  3. Click Connectors save in OA-23. — `wk-connectors-save`
  4. Find the first Connectors tab in OA-23. — `wk-connectors-tab-<id>`
  5. Click Connectors retry in OA-23. — `wk-connectors-retry`
  6. Click Connectors rule save in OA-23. — `wk-connectors-rule-save`
  7. Click Connectors alert triage save in OA-23. — `wk-connectors-alert-triage-save`

### `oa.deployment-kit` — Deployment Kit (OA-15)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.deployment-kit.gif`
- **Steps (4):**
  1. Open OA-15 (Deployment Kit). — _no testid_
  2. Click Hosting save in OA-15. — `oa-hosting-save`
  3. Check the values shown on OA-15 and confirm they are correct. — _no testid_
  4. Save the change, then read the confirmation on OA-15. — _no testid_

### `oa.dual-session` — Dual Session banner (GL-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.dual-session.gif`
- **Steps (4):**
  1. Open GL-01 (Dual Session banner). — _no testid_
  2. Click Consultation banner end in GL-01. — `consultation-banner-end`
  3. Click Consultation banner dismiss in GL-01. — `consultation-banner-dismiss`
  4. Check the values shown on GL-01 and confirm they are correct. — _no testid_

### `oa.email-microsoft` — Email: Microsoft (OA-11)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.email-microsoft.gif`
- **Steps (7):**
  1. Open OA-11 (Email: Microsoft). — _no testid_
  2. Read Email result in OA-11. — `org-email-result`
  3. Click Email save in OA-11. — `org-email-save`
  4. Fill in Email in OA-11. — `org-email`
  5. Read Email list in OA-11. — `org-email-list`
  6. Read Email saved in OA-11. — `org-email-saved`
  7. Read Email provider in OA-11. — `org-email-provider`

### `oa.email-resend` — Email: Resend (OA-11)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.email-resend.gif`
- **Steps (7):**
  1. Open OA-11 (Email: Resend). — _no testid_
  2. Read Email result in OA-11. — `org-email-result`
  3. Click Email save in OA-11. — `org-email-save`
  4. Fill in Email in OA-11. — `org-email`
  5. Read Email list in OA-11. — `org-email-list`
  6. Read Email saved in OA-11. — `org-email-saved`
  7. Read Email provider in OA-11. — `org-email-provider`

### `oa.email-smtp` — Email: SMTP (OA-11)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.email-smtp.gif`
- **Steps (7):**
  1. Open OA-11 (Email: SMTP). — _no testid_
  2. Read Email result in OA-11. — `org-email-result`
  3. Click Email save in OA-11. — `org-email-save`
  4. Fill in Email in OA-11. — `org-email`
  5. Read Email list in OA-11. — `org-email-list`
  6. Read Email saved in OA-11. — `org-email-saved`
  7. Read Email provider in OA-11. — `org-email-provider`

### `oa.email-test` — Email: Test button (OA-11)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.email-test.gif`
- **Steps (7):**
  1. Open OA-11 (Email: Test button). — _no testid_
  2. Read Email result in OA-11. — `org-email-result`
  3. Click Email save in OA-11. — `org-email-save`
  4. Find the first Sender test in OA-11. — `org-sender-test-<id>`
  5. Fill in Email in OA-11. — `org-email`
  6. Read Email list in OA-11. — `org-email-list`
  7. Read Email saved in OA-11. — `org-email-saved`

### `oa.escalation` — Escalation rules (OA-13)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.escalation.gif`
- **Steps (7):**
  1. Open OA-13 (Escalation rules). — _no testid_
  2. Read Escalation in OA-13. — `oa-escalation`
  3. Click Escalation save in OA-13. — `oa-escalation-save`
  4. Find the first Escalation condition in OA-13. — `oa-escalation-condition-<i>`
  5. Click Escalation preview in OA-13. — `oa-escalation-preview`
  6. Click Escalation cancel in OA-13. — `oa-escalation-cancel`
  7. Read Escalation result in OA-13. — `oa-escalation-result`

### `oa.escalation-cards` — Escalation cards and proposals (WK-08)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.escalation-cards.gif`
- **Steps (6):**
  1. Open WK-08 (Escalation cards and proposals). — _no testid_
  2. Read Escalation in WK-08. — `wk-escalation`
  3. Find the first Escalation in WK-08. — `wk-escalation-<id>`
  4. Read Escalation result in WK-08. — `wk-escalation-result`
  5. Read Escalation list in WK-08. — `wk-escalation-list`
  6. Read Proposal list in WK-08. — `wk-proposal-list`

### `oa.features` — Features (read-only) (OA-04)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.features.gif`
- **Steps (5):**
  1. Open OA-04 (Features (read-only)). — _no testid_
  2. Open the Control features tab in OA-04. — `org-control-tab-features`
  3. Read Features in OA-04. — `org-features`
  4. Read Features list in OA-04. — `org-features-list`
  5. Read Control panel in OA-04. — `org-control-panel`

### `oa.formats` — Report format editor (OA-24)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.formats.gif`
- **Steps (7):**
  1. Open OA-24 (Report format editor). — _no testid_
  2. Read Format panel in OA-24. — `wk-format-panel`
  3. Click Format audiences save in OA-24. — `wk-format-audiences-save`
  4. Click Format retry in OA-24. — `wk-format-retry`
  5. Click Format preview in OA-24. — `wk-format-preview`
  6. Click Format save in OA-24. — `wk-format-save`
  7. Click Format publish in OA-24. — `wk-format-publish`

### `oa.golive` — Go Live health check (OA-19)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.golive.gif`
- **Steps (5):**
  1. Open OA-19 (Go Live health check). — _no testid_
  2. Open the Admin wizard org.golive tab in OA-19. — `org_admin-wizard-step-org.golive`
  3. Read Admin wizard content org.golive in OA-19. — `org_admin-wizard-content-org.golive`
  4. Click Admin wizard save in OA-19. — `org_admin-wizard-save`
  5. Click Admin wizard next in OA-19. — `org_admin-wizard-next`

### `oa.governance` — Governance settings (OA-22)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.governance.gif`
- **Steps (7):**
  1. Open OA-22 (Governance settings). — _no testid_
  2. Read Governance in OA-22. — `oa-governance`
  3. Click Governance lifecycle save in OA-22. — `oa-governance-lifecycle-save`
  4. Find the first Governance scale in OA-22. — `oa-governance-scale-<key>`
  5. Click Governance section add in OA-22. — `oa-governance-section-add`
  6. Click Governance scale add in OA-22. — `oa-governance-scale-add`
  7. Click Governance FSLI add in OA-22. — `oa-governance-fsli-add`

### `oa.history` — Configuration history (OA-17)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.history.gif`
- **Steps (5):**
  1. Open OA-17 (Configuration history). — _no testid_
  2. Read History in OA-17. — `org-history`
  3. Find the first History row in OA-17. — `org-history-row-<index>`
  4. Read History table in OA-17. — `org-history-table`
  5. Find the first History platform in OA-17. — `org-history-platform-<index>`

### `oa.hosting` — Hosting and database (OA-15)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.hosting.gif`
- **Steps (7):**
  1. Open OA-15 (Hosting and database). — _no testid_
  2. Read Hosting in OA-15. — `oa-hosting`
  3. Click Hosting save in OA-15. — `oa-hosting-save`
  4. Find the first Hosting connection in OA-15. — `oa-hosting-connection-<id>`
  5. Fill in Hosting host in OA-15. — `oa-hosting-host`
  6. Fill in Hosting port in OA-15. — `oa-hosting-port`
  7. Read Hosting database in OA-15. — `oa-hosting-database`

### `oa.invite` — Invite a colleague (OA-20)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.invite.gif`
- **Steps (7):**
  1. Open OA-20 (Invite a colleague). — _no testid_
  2. Read Invite sent in OA-20. — `admin-invite-sent`
  3. Click Invite in OA-20. — `admin-invite`
  4. Click Accept in OA-20. — `oa-accept`
  5. Click Accept submit in OA-20. — `oa-accept-submit`
  6. Click Accept continue in OA-20. — `oa-accept-continue`
  7. Read Admin panel in OA-20. — `people-admin-panel`

### `oa.migration` — Migration (OA-15)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.migration.gif`
- **Steps (4):**
  1. Open OA-15 (Migration). — _no testid_
  2. Click Hosting save in OA-15. — `oa-hosting-save`
  3. Check the values shown on OA-15 and confirm they are correct. — _no testid_
  4. Save the change, then read the confirmation on OA-15. — _no testid_

### `oa.patterns` — Patterns (WK-10)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.patterns.gif`
- **Steps (7):**
  1. Open WK-10 (Patterns). — _no testid_
  2. Read Patterns in WK-10. — `wk-patterns`
  3. Click Patterns heatmap in WK-10. — `wk-patterns-heatmap`
  4. Find the first Patterns tab in WK-10. — `wk-patterns-tab-<view>`
  5. Read Patterns unclustered in WK-10. — `wk-patterns-unclustered`
  6. Read Patterns clusters in WK-10. — `wk-patterns-clusters`
  7. Read Patterns Microsoft Graph in WK-10. — `wk-patterns-graph`

### `oa.patterns-config` — Patterns settings (OA-21)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.patterns-config.gif`
- **Steps (7):**
  1. Open OA-21 (Patterns settings). — _no testid_
  2. Read Patterns result in OA-21. — `oa-patterns-result`
  3. Click Patterns save in OA-21. — `oa-patterns-save`
  4. Read Patterns config in OA-21. — `oa-patterns-config`
  5. Fill in Patterns threshold in OA-21. — `oa-patterns-threshold`
  6. Fill in Patterns min size in OA-21. — `oa-patterns-min-size`
  7. Read Patterns years in OA-21. — `oa-patterns-years`

### `oa.pptx-theme` — PPTX theme upload (OA-03)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.pptx-theme.gif`
- **Steps (5):**
  1. Open OA-03 (PPTX theme upload). — _no testid_
  2. Click Branding theme upload in OA-03. — `oa-branding-theme-upload`
  3. Fill in Branding theme note in OA-03. — `oa-branding-theme-note`
  4. Click Branding save in OA-03. — `oa-branding-save`
  5. Click Branding preview in OA-03. — `oa-branding-preview`

### `oa.profile` — Organisation profile (OA-02)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.profile.gif`
- **Steps (4):**
  1. Open OA-02 (Organisation profile). — _no testid_
  2. Click Branding theme upload in OA-02. — `oa-branding-theme-upload`
  3. Click Branding save in OA-02. — `oa-branding-save`
  4. Click Branding preview in OA-02. — `oa-branding-preview`

### `oa.report-builder` — Report builder (WK-11)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.report-builder.gif`
- **Steps (7):**
  1. Open WK-11 (Report builder). — _no testid_
  2. Read Report builder panel in WK-11. — `wk-report-builder-panel`
  3. Click Report builder freeze run in WK-11. — `wk-report-builder-freeze-run`
  4. Find the first Report builder claim in WK-11. — `wk-report-builder-claim-<id>`
  5. Click Report builder retry in WK-11. — `wk-report-builder-retry`
  6. Click Report builder figure preview in WK-11. — `wk-report-builder-figure-preview`
  7. Click Report builder figure add in WK-11. — `wk-report-builder-figure-add`

### `oa.retire-old` — Retire the old connection (OA-15)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.retire-old.gif`
- **Steps (4):**
  1. Open OA-15 (Retire the old connection). — _no testid_
  2. Click Hosting save in OA-15. — `oa-hosting-save`
  3. Find the first Hosting retire in OA-15. — `oa-hosting-retire-<id>`
  4. Check the values shown on OA-15 and confirm they are correct. — _no testid_

### `oa.roles` — Roles and rights (OA-05)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.roles.gif`
- **Steps (4):**
  1. Open OA-05 (Roles and rights). — _no testid_
  2. Read Roles in OA-05. — `admin-roles`
  3. Click Provision in OA-05. — `admin-provision`
  4. Read Admin panel in OA-05. — `people-admin-panel`

### `oa.setup-1` — Organisation profile and branding (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-1.gif`
- **Steps (6):**
  1. Open OA-01, setup step 1: the organisation profile and branding. — `org_admin-wizard`
  2. Select step 1 (the organisation profile and branding) in the step list. — `org_admin-wizard-step-org.profile`
  3. Open the the organisation profile and branding step. — `org_admin-wizard-show-org.profile`
  4. Fill in the organisation profile and branding. — `org_admin-wizard-content-org.profile`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-2` — Feature enablement (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-2.gif`
- **Steps (6):**
  1. Open OA-01, setup step 2: feature enablement. — `org_admin-wizard`
  2. Select step 2 (feature enablement) in the step list. — `org_admin-wizard-step-org.features`
  3. Open the feature enablement step. — `org_admin-wizard-show-org.features`
  4. Fill in feature enablement. — `org_admin-wizard-content-org.features`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-3` — Roles and permission defaults (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-3.gif`
- **Steps (6):**
  1. Open OA-01, setup step 3: roles and permission defaults. — `org_admin-wizard`
  2. Select step 3 (roles and permission defaults) in the step list. — `org_admin-wizard-step-org.roles`
  3. Open the roles and permission defaults step. — `org_admin-wizard-show-org.roles`
  4. Fill in roles and permission defaults. — `org_admin-wizard-content-org.roles`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-4` — Presentation and certificate templates (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-4.gif`
- **Steps (6):**
  1. Open OA-01, setup step 4: the presentation and certificate templates. — `org_admin-wizard`
  2. Select step 4 (the presentation and certificate templates) in the step list. — `org_admin-wizard-step-org.presentation`
  3. Open the the presentation and certificate templates step. — `org_admin-wizard-show-org.presentation`
  4. Fill in the presentation and certificate templates. — `org_admin-wizard-content-org.presentation`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-5` — Escalation and automation rules (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-5.gif`
- **Steps (6):**
  1. Open OA-01, setup step 5: the escalation and automation rules. — `org_admin-wizard`
  2. Select step 5 (the escalation and automation rules) in the step list. — `org_admin-wizard-step-org.escalation`
  3. Open the the escalation and automation rules step. — `org_admin-wizard-show-org.escalation`
  4. Fill in the escalation and automation rules. — `org_admin-wizard-content-org.escalation`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-6` — Hosting (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-6.gif`
- **Steps (6):**
  1. Open OA-01, setup step 6: hosting. — `org_admin-wizard`
  2. Select step 6 (hosting) in the step list. — `org_admin-wizard-step-org.hosting`
  3. Open the hosting step. — `org_admin-wizard-show-org.hosting`
  4. Fill in hosting. — `org_admin-wizard-content-org.hosting`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-7` — Email (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-7.gif`
- **Steps (6):**
  1. Open OA-01, setup step 7: email. — `org_admin-wizard`
  2. Select step 7 (email) in the step list. — `org_admin-wizard-step-org.email`
  3. Open the email step. — `org_admin-wizard-show-org.email`
  4. Fill in email. — `org_admin-wizard-content-org.email`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-8` — Health check and Go Live (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-8.gif`
- **Steps (6):**
  1. Open OA-01, setup step 8: the health check and Go Live. — `org_admin-wizard`
  2. Select step 8 (the health check and Go Live) in the step list. — `org_admin-wizard-step-org.golive`
  3. Open the the health check and Go Live step. — `org_admin-wizard-show-org.golive`
  4. Fill in the health check and Go Live. — `org_admin-wizard-content-org.golive`
  5. Click Save this step. — `org_admin-wizard-save`
  6. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.setup-wizard` — Setup wizard (OA-01)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.setup-wizard.gif`
- **Steps (5):**
  1. Open OA-01 (Setup wizard). — `org_admin-wizard`
  2. Read the progress bar to see which steps are already done. — `org_admin-wizard-progress`
  3. Select the step to work on: the first is the organisation profile and branding. — `org_admin-wizard-step-org.profile`
  4. Fill in that step and click Save this step. — `org_admin-wizard-save`
  5. Click Next to move to the following step. — `org_admin-wizard-next`

### `oa.templates` — Templates hub (OA-08)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.templates.gif`
- **Steps (4):**
  1. Open OA-08 (Templates hub). — _no testid_
  2. Read Template list in OA-08. — `org-template-list`
  3. Click Template save in OA-08. — `template-save`
  4. Read Template list in OA-08. — `template-list`

### `oa.templates-email` — Email templates (OA-12)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.templates-email.gif`
- **Steps (6):**
  1. Open OA-12 (Email templates). — _no testid_
  2. Read Automation result in OA-12. — `org-automation-result`
  3. Click Rule save in OA-12. — `org-rule-save`
  4. Click Rule cancel in OA-12. — `org-rule-cancel`
  5. Read Rule list in OA-12. — `org-rule-list`
  6. Read Template list in OA-12. — `org-template-list`

### `oa.timetravel` — Time-Travel (WK-09)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.timetravel.gif`
- **Steps (7):**
  1. Open WK-09 (Time-Travel). — _no testid_
  2. Read Timetravel in WK-09. — `wk-timetravel`
  3. Click Procedure apply in WK-09. — `procedure-apply`
  4. Find the first Timetravel diff in WK-09. — `wk-timetravel-diff-<id>`
  5. Click Timetravel next in WK-09. — `wk-timetravel-next`
  6. Read Timetravel banner in WK-09. — `wk-timetravel-banner`
  7. Read Timetravel track in WK-09. — `wk-timetravel-track`

### `oa.tutorials` — Tutorial library (OA-18)

- **Audience:** org_admin
- **Media:** `public/tutorials/oa.tutorials.gif`
- **Steps (4):**
  1. Open OA-18 (Tutorial library). — _no testid_
  2. Read Tutorials in OA-18. — `org-tutorials`
  3. Check the values shown on OA-18 and confirm they are correct. — _no testid_
  4. Save the change, then read the confirmation on OA-18. — _no testid_

### `oa.verify` — Public verification page (WK-06)

- **Audience:** both
- **Media:** `public/tutorials/oa.verify.gif`
- **Steps (7):**
  1. Open WK-06 (Public verification page). — _no testid_
  2. Read Verify status in WK-06. — `wk-verify-status`
  3. Click Verify in WK-06. — `wk-verify`
  4. Click Verify drop in WK-06. — `wk-verify-drop`
  5. Read Verify drop result in WK-06. — `wk-verify-drop-result`
  6. Read Verify organisation in WK-06. — `wk-verify-organisation`
  7. Fill in Verify title in WK-06. — `wk-verify-title`

### `sa.automation` — Automation templates (SA-07)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.automation.gif`
- **Steps (7):**
  1. Open SA-07 (Automation templates). — _no testid_
  2. Open the Automation rules tab in SA-07. — `superadmin-automation-tab-rules`
  3. Read Automation in SA-07. — `superadmin-automation`
  4. Click Rule save in SA-07. — `rule-save`
  5. Open the Automation templates tab in SA-07. — `superadmin-automation-tab-templates`
  6. Read Automation result in SA-07. — `superadmin-automation-result`
  7. Read Automation saved in SA-07. — `superadmin-automation-saved`

### `sa.dual-session` — Dual Session banner (GL-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.dual-session.gif`
- **Steps (4):**
  1. Open GL-01 (Dual Session banner). — _no testid_
  2. Click Consultation banner end in GL-01. — `consultation-banner-end`
  3. Click Consultation banner dismiss in GL-01. — `consultation-banner-dismiss`
  4. Check the values shown on GL-01 and confirm they are correct. — _no testid_

### `sa.email-default` — Email: platform default profile (SA-04)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.email-default.gif`
- **Steps (7):**
  1. Open SA-04 (Email: platform default profile). — _no testid_
  2. Read Email result in SA-04. — `superadmin-email-result`
  3. Click Email save in SA-04. — `superadmin-email-save`
  4. Find the first Sender default in SA-04. — `sender-default-<id>`
  5. Fill in Email in SA-04. — `superadmin-email`
  6. Read Email list in SA-04. — `superadmin-email-list`
  7. Read Email tenant list in SA-04. — `superadmin-email-tenant-list`

### `sa.email-force-tenant` — Email: force a profile for one tenant (SA-04)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.email-force-tenant.gif`
- **Steps (7):**
  1. Open SA-04 (Email: force a profile for one tenant). — _no testid_
  2. Read Email result in SA-04. — `superadmin-email-result`
  3. Click Email save in SA-04. — `superadmin-email-save`
  4. Find the first Tenant allow in SA-04. — `tenant-allow-<id>`
  5. Fill in Email in SA-04. — `superadmin-email`
  6. Read Email list in SA-04. — `superadmin-email-list`
  7. Read Email tenant list in SA-04. — `superadmin-email-tenant-list`

### `sa.email-microsoft` — Email: Microsoft (SA-04)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.email-microsoft.gif`
- **Steps (7):**
  1. Open SA-04 (Email: Microsoft). — _no testid_
  2. Read Email result in SA-04. — `superadmin-email-result`
  3. Click Email save in SA-04. — `superadmin-email-save`
  4. Fill in Email in SA-04. — `superadmin-email`
  5. Read Email list in SA-04. — `superadmin-email-list`
  6. Read Email tenant list in SA-04. — `superadmin-email-tenant-list`
  7. Read Email provider in SA-04. — `superadmin-email-provider`

### `sa.email-resend` — Email: Resend (SA-04)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.email-resend.gif`
- **Steps (7):**
  1. Open SA-04 (Email: Resend). — _no testid_
  2. Read Email result in SA-04. — `superadmin-email-result`
  3. Click Email save in SA-04. — `superadmin-email-save`
  4. Fill in Email in SA-04. — `superadmin-email`
  5. Read Email list in SA-04. — `superadmin-email-list`
  6. Read Email tenant list in SA-04. — `superadmin-email-tenant-list`
  7. Read Email provider in SA-04. — `superadmin-email-provider`

### `sa.email-smtp` — Email: SMTP (SA-04)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.email-smtp.gif`
- **Steps (7):**
  1. Open SA-04 (Email: SMTP). — _no testid_
  2. Read Email result in SA-04. — `superadmin-email-result`
  3. Click Email save in SA-04. — `superadmin-email-save`
  4. Fill in Email in SA-04. — `superadmin-email`
  5. Read Email list in SA-04. — `superadmin-email-list`
  6. Read Email tenant list in SA-04. — `superadmin-email-tenant-list`
  7. Read Email provider in SA-04. — `superadmin-email-provider`

### `sa.features` — Features and plans (SA-14)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.features.gif`
- **Steps (4):**
  1. Open SA-14 (Features and plans). — _no testid_
  2. Read Features in SA-14. — `superadmin-features`
  3. Read Features result in SA-14. — `superadmin-features-result`
  4. Check the values shown on SA-14 and confirm they are correct. — _no testid_

### `sa.health` — Platform health (SA-02)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.health.gif`
- **Steps (7):**
  1. Open SA-02 (Platform health). — _no testid_
  2. Read Job health in SA-02. — `superadmin-job-health`
  3. Click Support session open in SA-02. — `superadmin-support-session-open`
  4. Read Job health list in SA-02. — `superadmin-job-health-list`
  5. Read Support result in SA-02. — `superadmin-support-result`
  6. Read Support session open panel in SA-02. — `superadmin-support-session-open-panel`
  7. Read Support session list in SA-02. — `superadmin-support-session-list`

### `sa.hosting-fit` — Hosting fit check (SA-10)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.hosting-fit.gif`
- **Steps (7):**
  1. Open SA-10 (Hosting fit check). — _no testid_
  2. Open the Hosting check tab in SA-10. — `sa-hosting-tab-check`
  3. Read Hosting in SA-10. — `sa-hosting`
  4. Find the first Hosting stack in SA-10. — `sa-hosting-stack-<key>`
  5. Open the Hosting rules tab in SA-10. — `sa-hosting-tab-rules`
  6. Read Hosting search results in SA-10. — `sa-hosting-search-results`
  7. Read Hosting checklist in SA-10. — `sa-hosting-checklist`

### `sa.hosting-rules` — Hosting rules editor (SA-11)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.hosting-rules.gif`
- **Steps (7):**
  1. Open SA-11 (Hosting rules editor). — _no testid_
  2. Open the Hosting check tab in SA-11. — `sa-hosting-tab-check`
  3. Read Hosting in SA-11. — `sa-hosting`
  4. Find the first Hosting stack in SA-11. — `sa-hosting-stack-<key>`
  5. Open the Hosting rules tab in SA-11. — `sa-hosting-tab-rules`
  6. Read Hosting search results in SA-11. — `sa-hosting-search-results`
  7. Read Hosting checklist in SA-11. — `sa-hosting-checklist`

### `sa.integrity-anchoring` — Integrity anchoring (SA-18)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.integrity-anchoring.gif`
- **Steps (7):**
  1. Open SA-18 (Integrity anchoring). — _no testid_
  2. Read Anchoring in SA-18. — `sa-anchoring`
  3. Click Anchoring authority add in SA-18. — `sa-anchoring-authority-add`
  4. Find the first Anchoring authority in SA-18. — `sa-anchoring-authority-<id>`
  5. Click Anchoring anchor add in SA-18. — `sa-anchoring-anchor-add`
  6. Read Anchoring result in SA-18. — `sa-anchoring-result`
  7. Read Anchoring authority list in SA-18. — `sa-anchoring-authority-list`

### `sa.migration` — Migration jobs (SA-12)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.migration.gif`
- **Steps (7):**
  1. Open SA-12 (Migration jobs). — _no testid_
  2. Read Migration in SA-12. — `sa-migration`
  3. Click Migration refresh in SA-12. — `sa-migration-refresh`
  4. Find the first Migration job in SA-12. — `sa-migration-job-<id>`
  5. Read Migration tenant in SA-12. — `sa-migration-tenant`
  6. Find the first Migration job error in SA-12. — `sa-migration-job-error-<id>`
  7. Find the first Migration steps in SA-12. — `sa-migration-steps-<id>`

### `sa.plans` — Plans editor (SA-14)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.plans.gif`
- **Steps (4):**
  1. Open SA-14 (Plans editor). — _no testid_
  2. Read Features result in SA-14. — `superadmin-features-result`
  3. Check the values shown on SA-14 and confirm they are correct. — _no testid_
  4. Save the change, then read the confirmation on SA-14. — _no testid_

### `sa.recipients` — Notification recipients (SA-05)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.recipients.gif`
- **Steps (4):**
  1. Open SA-05 (Notification recipients). — _no testid_
  2. Read Recipients in SA-05. — `superadmin-recipients`
  3. Click Recipients add in SA-05. — `superadmin-recipients-add`
  4. Fill in Recipients input in SA-05. — `superadmin-recipients-input`

### `sa.setup-1` — Platform readiness check (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-1.gif`
- **Steps (6):**
  1. Open SA-01, setup step 1: the platform readiness check. — `super_admin-wizard`
  2. Select step 1 (the platform readiness check) in the step list. — `super_admin-wizard-step-sa.readiness`
  3. Open the the platform readiness check step. — `super_admin-wizard-show-sa.readiness`
  4. Fill in the platform readiness check. — `super_admin-wizard-content-sa.readiness`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-2` — Platform email (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-2.gif`
- **Steps (6):**
  1. Open SA-01, setup step 2: the platform email sender. — `super_admin-wizard`
  2. Select step 2 (the platform email sender) in the step list. — `super_admin-wizard-step-sa.email`
  3. Open the the platform email sender step. — `super_admin-wizard-show-sa.email`
  4. Fill in the platform email sender. — `super_admin-wizard-content-sa.email`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-3` — Platform notification recipients (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-3.gif`
- **Steps (6):**
  1. Open SA-01, setup step 3: the platform notification recipients. — `super_admin-wizard`
  2. Select step 3 (the platform notification recipients) in the step list. — `super_admin-wizard-step-sa.recipients`
  3. Open the the platform notification recipients step. — `super_admin-wizard-show-sa.recipients`
  4. Fill in the platform notification recipients. — `super_admin-wizard-content-sa.recipients`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-4` — Hosting catalogue review (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-4.gif`
- **Steps (6):**
  1. Open SA-01, setup step 4: the hosting catalogue review. — `super_admin-wizard`
  2. Select step 4 (the hosting catalogue review) in the step list. — `super_admin-wizard-step-sa.hosting`
  3. Open the the hosting catalogue review step. — `super_admin-wizard-show-sa.hosting`
  4. Fill in the hosting catalogue review. — `super_admin-wizard-content-sa.hosting`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-5` — Platform default rules and templates (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-5.gif`
- **Steps (6):**
  1. Open SA-01, setup step 5: the platform default rules and templates. — `super_admin-wizard`
  2. Select step 5 (the platform default rules and templates) in the step list. — `super_admin-wizard-step-sa.rules`
  3. Open the the platform default rules and templates step. — `super_admin-wizard-show-sa.rules`
  4. Fill in the platform default rules and templates. — `super_admin-wizard-content-sa.rules`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-6` — Feature catalogue and plans (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-6.gif`
- **Steps (6):**
  1. Open SA-01, setup step 6: the feature catalogue and plans. — `super_admin-wizard`
  2. Select step 6 (the feature catalogue and plans) in the step list. — `super_admin-wizard-step-sa.features`
  3. Open the the feature catalogue and plans step. — `super_admin-wizard-show-sa.features`
  4. Fill in the feature catalogue and plans. — `super_admin-wizard-content-sa.features`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-7` — Tutorial library check (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-7.gif`
- **Steps (6):**
  1. Open SA-01, setup step 7: the tutorial library check. — `super_admin-wizard`
  2. Select step 7 (the tutorial library check) in the step list. — `super_admin-wizard-step-sa.tutorials`
  3. Open the the tutorial library check step. — `super_admin-wizard-show-sa.tutorials`
  4. Fill in the tutorial library check. — `super_admin-wizard-content-sa.tutorials`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-8` — New-tenant defaults and Go Live (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-8.gif`
- **Steps (6):**
  1. Open SA-01, setup step 8: the new-tenant defaults and Go Live. — `super_admin-wizard`
  2. Select step 8 (the new-tenant defaults and Go Live) in the step list. — `super_admin-wizard-step-sa.golive`
  3. Open the the new-tenant defaults and Go Live step. — `super_admin-wizard-show-sa.golive`
  4. Fill in the new-tenant defaults and Go Live. — `super_admin-wizard-content-sa.golive`
  5. Click Save this step. — `super_admin-wizard-save`
  6. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.setup-wizard` — Platform setup wizard (SA-01)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.setup-wizard.gif`
- **Steps (5):**
  1. Open SA-01 (Platform setup wizard). — `super_admin-wizard`
  2. Read the progress bar to see which steps are already done. — `super_admin-wizard-progress`
  3. Select the step to work on: the first is the platform readiness check. — `super_admin-wizard-step-sa.readiness`
  4. Fill in that step and click Save this step. — `super_admin-wizard-save`
  5. Click Next to move to the following step. — `super_admin-wizard-next`

### `sa.templates` — Notification templates (SA-08)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.templates.gif`
- **Steps (7):**
  1. Open SA-08 (Notification templates). — _no testid_
  2. Open the Automation templates tab in SA-08. — `superadmin-automation-tab-templates`
  3. Read Automation result in SA-08. — `superadmin-automation-result`
  4. Click Rule save in SA-08. — `rule-save`
  5. Click Template save in SA-08. — `template-save`
  6. Read Rule list in SA-08. — `rule-list`
  7. Read Template list in SA-08. — `template-list`

### `sa.tenant-hub` — Tenant hub (SA-03)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.tenant-hub.gif`
- **Steps (6):**
  1. Open SA-03 (Tenant hub). — _no testid_
  2. Read Tenants result in SA-03. — `superadmin-tenants-result`
  3. Find the first Tenant in SA-03. — `tenant-<id>`
  4. Find the first Tenant allow in SA-03. — `tenant-allow-<id>`
  5. Find the first Tenant deny in SA-03. — `tenant-deny-<id>`
  6. Read Tenants in SA-03. — `superadmin-tenants`

### `sa.trail` — Platform trail (SA-15)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.trail.gif`
- **Steps (4):**
  1. Open SA-15 (Platform trail). — `superadmin-trail`
  2. Read the trail: each row is one platform action. — `superadmin-trail`
  3. Check the actor, the action and the time on every row. — `superadmin-trail`
  4. The trail is append-only, so nothing here can be edited or removed. — `superadmin-trail`

### `sa.tutorials` — Tutorial library (SA-13)

- **Audience:** super_admin
- **Media:** `public/tutorials/sa.tutorials.gif`
- **Steps (4):**
  1. Open SA-13 (Tutorial library). — _no testid_
  2. Read Tutorials in SA-13. — `superadmin-tutorials`
  3. Check the values shown on SA-13 and confirm they are correct. — _no testid_
  4. Save the change, then read the confirmation on SA-13. — _no testid_

## Design tokens

Every token currently defined, per preset and theme, straight from `src/styles/tokens.css`. A
redesign replaces the *values*; the *names* are the interface the components already read, so a
token name stays and only its value changes.

**25 unique tokens.** Not every token is defined in every block; each table
below is one block exactly as the stylesheet writes it.

### Preset `ledger` — light (25 tokens)

| Token | Value |
|---|---|
| `--accent-brass` | `#C9A227` |
| `--accent-brass-subtle` | `rgba(201, 162, 39, 0.12)` |
| `--accent-brass-text` | `#8A6A12` |
| `--accent-cinnabar` | `#C2410C` |
| `--accent-cinnabar-subtle` | `rgba(194, 65, 12, 0.12)` |
| `--accent-primary` | `#2F6F5E` |
| `--accent-primary-subtle` | `rgba(47, 111, 94, 0.12)` |
| `--accent-verdigris` | `#2F6F5E` |
| `--accent-verdigris-subtle` | `rgba(47, 111, 94, 0.12)` |
| `--border-hairline` | `rgba(20,22,27, 0.09)` |
| `--border-strong` | `rgba(20,22,27, 0.16)` |
| `--btn-primary-bg` | `#14161B` |
| `--btn-primary-text` | `#FFFFFF` |
| `--canvas` | `#F6F5F2` |
| `--glass-bg` | `rgba(246,245,242, 0.85)` |
| `--glass-border` | `rgba(20,22,27, 0.08)` |
| `--shadow-soft` | `0 4px 20px -2px rgba(20,22,27, 0.06), 0 2px 6px -1px rgba(20,22,27, 0.03)` |
| `--surface` | `#FFFFFF` |
| `--surface-active` | `rgba(20,22,27, 0.08)` |
| `--surface-elevated` | `#FFFFFF` |
| `--surface-hover` | `rgba(20,22,27, 0.04)` |
| `--surface-sunken` | `#EFEDE8` |
| `--text-primary` | `#14161B` |
| `--text-secondary` | `#5F6573` |
| `--text-tertiary` | `#666B78` |

### Preset `ledger` — dark (25 tokens)

| Token | Value |
|---|---|
| `--accent-brass` | `#D4B04A` |
| `--accent-brass-subtle` | `rgba(212, 176, 74, 0.16)` |
| `--accent-brass-text` | `#D4B04A` |
| `--accent-cinnabar` | `#E2683A` |
| `--accent-cinnabar-subtle` | `rgba(226, 104, 58, 0.16)` |
| `--accent-primary` | `#58A08C` |
| `--accent-primary-subtle` | `rgba(88, 160, 140, 0.16)` |
| `--accent-verdigris` | `#58A08C` |
| `--accent-verdigris-subtle` | `rgba(88, 160, 140, 0.16)` |
| `--border-hairline` | `rgba(255,255,255, 0.08)` |
| `--border-strong` | `rgba(255,255,255, 0.16)` |
| `--btn-primary-bg` | `#ECECEE` |
| `--btn-primary-text` | `#141518` |
| `--canvas` | `#141518` |
| `--glass-bg` | `rgba(20,21,24, 0.85)` |
| `--glass-border` | `rgba(255,255,255, 0.08)` |
| `--shadow-soft` | `0 8px 30px -4px rgba(0, 0, 0, 0.45), 0 2px 8px -2px rgba(0, 0, 0, 0.3)` |
| `--surface` | `#1C1D21` |
| `--surface-active` | `rgba(255,255,255, 0.09)` |
| `--surface-elevated` | `#25272C` |
| `--surface-hover` | `rgba(255,255,255, 0.05)` |
| `--surface-sunken` | `#101113` |
| `--text-primary` | `#ECECEE` |
| `--text-secondary` | `#9497A0` |
| `--text-tertiary` | `#82858F` |

### Preset `porcelain` — light (25 tokens)

| Token | Value |
|---|---|
| `--accent-brass` | `#C9A227` |
| `--accent-brass-subtle` | `rgba(201, 162, 39, 0.12)` |
| `--accent-brass-text` | `#8A6A12` |
| `--accent-cinnabar` | `#C2410C` |
| `--accent-cinnabar-subtle` | `rgba(194, 65, 12, 0.12)` |
| `--accent-primary` | `#2F6F5E` |
| `--accent-primary-subtle` | `rgba(47, 111, 94, 0.12)` |
| `--accent-verdigris` | `#2F6F5E` |
| `--accent-verdigris-subtle` | `rgba(47, 111, 94, 0.12)` |
| `--border-hairline` | `rgba(15,17,21, 0.09)` |
| `--border-strong` | `rgba(15,17,21, 0.16)` |
| `--btn-primary-bg` | `#0F1115` |
| `--btn-primary-text` | `#FFFFFF` |
| `--canvas` | `#F4F5F7` |
| `--glass-bg` | `rgba(244,245,247, 0.85)` |
| `--glass-border` | `rgba(15,17,21, 0.08)` |
| `--shadow-soft` | `0 4px 20px -2px rgba(15,17,21, 0.06), 0 2px 6px -1px rgba(15,17,21, 0.03)` |
| `--surface` | `#FFFFFF` |
| `--surface-active` | `rgba(15,17,21, 0.08)` |
| `--surface-elevated` | `#FFFFFF` |
| `--surface-hover` | `rgba(15,17,21, 0.04)` |
| `--surface-sunken` | `#EBEDF0` |
| `--text-primary` | `#0F1115` |
| `--text-secondary` | `#5C6370` |
| `--text-tertiary` | `#626875` |

### Preset `porcelain` — dark (25 tokens)

| Token | Value |
|---|---|
| `--accent-brass` | `#D4B04A` |
| `--accent-brass-subtle` | `rgba(212, 176, 74, 0.16)` |
| `--accent-brass-text` | `#D4B04A` |
| `--accent-cinnabar` | `#E2683A` |
| `--accent-cinnabar-subtle` | `rgba(226, 104, 58, 0.16)` |
| `--accent-primary` | `#58A08C` |
| `--accent-primary-subtle` | `rgba(88, 160, 140, 0.16)` |
| `--accent-verdigris` | `#58A08C` |
| `--accent-verdigris-subtle` | `rgba(88, 160, 140, 0.16)` |
| `--border-hairline` | `rgba(255,255,255, 0.08)` |
| `--border-strong` | `rgba(255,255,255, 0.16)` |
| `--btn-primary-bg` | `#ECEDEF` |
| `--btn-primary-text` | `#0C0D0F` |
| `--canvas` | `#0C0D0F` |
| `--glass-bg` | `rgba(12,13,15, 0.85)` |
| `--glass-border` | `rgba(255,255,255, 0.08)` |
| `--shadow-soft` | `0 8px 30px -4px rgba(0, 0, 0, 0.45), 0 2px 8px -2px rgba(0, 0, 0, 0.3)` |
| `--surface` | `#16171A` |
| `--surface-active` | `rgba(255,255,255, 0.09)` |
| `--surface-elevated` | `#1F2023` |
| `--surface-hover` | `rgba(255,255,255, 0.05)` |
| `--surface-sunken` | `#08090A` |
| `--text-primary` | `#ECEDEF` |
| `--text-secondary` | `#9497A0` |
| `--text-tertiary` | `#82858F` |

### Preset `bone` — light (25 tokens)

| Token | Value |
|---|---|
| `--accent-brass` | `#C9A227` |
| `--accent-brass-subtle` | `rgba(201, 162, 39, 0.12)` |
| `--accent-brass-text` | `#8A6A12` |
| `--accent-cinnabar` | `#C2410C` |
| `--accent-cinnabar-subtle` | `rgba(194, 65, 12, 0.12)` |
| `--accent-primary` | `#2F6F5E` |
| `--accent-primary-subtle` | `rgba(47, 111, 94, 0.12)` |
| `--accent-verdigris` | `#2F6F5E` |
| `--accent-verdigris-subtle` | `rgba(47, 111, 94, 0.12)` |
| `--border-hairline` | `rgba(26,23,18, 0.09)` |
| `--border-strong` | `rgba(26,23,18, 0.16)` |
| `--btn-primary-bg` | `#1A1712` |
| `--btn-primary-text` | `#FFFFFF` |
| `--canvas` | `#F3F0E8` |
| `--glass-bg` | `rgba(243,240,232, 0.85)` |
| `--glass-border` | `rgba(26,23,18, 0.08)` |
| `--shadow-soft` | `0 4px 20px -2px rgba(26,23,18, 0.06), 0 2px 6px -1px rgba(26,23,18, 0.03)` |
| `--surface` | `#FBFAF6` |
| `--surface-active` | `rgba(26,23,18, 0.08)` |
| `--surface-elevated` | `#FBFAF6` |
| `--surface-hover` | `rgba(26,23,18, 0.04)` |
| `--surface-sunken` | `#EAE6DB` |
| `--text-primary` | `#1A1712` |
| `--text-secondary` | `#645E52` |
| `--text-tertiary` | `#675F54` |

### Preset `bone` — dark (25 tokens)

| Token | Value |
|---|---|
| `--accent-brass` | `#D4B04A` |
| `--accent-brass-subtle` | `rgba(212, 176, 74, 0.16)` |
| `--accent-brass-text` | `#D4B04A` |
| `--accent-cinnabar` | `#E2683A` |
| `--accent-cinnabar-subtle` | `rgba(226, 104, 58, 0.16)` |
| `--accent-primary` | `#58A08C` |
| `--accent-primary-subtle` | `rgba(88, 160, 140, 0.16)` |
| `--accent-verdigris` | `#58A08C` |
| `--accent-verdigris-subtle` | `rgba(88, 160, 140, 0.16)` |
| `--border-hairline` | `rgba(255,255,255, 0.08)` |
| `--border-strong` | `rgba(255,255,255, 0.16)` |
| `--btn-primary-bg` | `#EDEBE6` |
| `--btn-primary-text` | `#1A1814` |
| `--canvas` | `#1A1814` |
| `--glass-bg` | `rgba(26,24,20, 0.85)` |
| `--glass-border` | `rgba(255,255,255, 0.08)` |
| `--shadow-soft` | `0 8px 30px -4px rgba(0, 0, 0, 0.45), 0 2px 8px -2px rgba(0, 0, 0, 0.3)` |
| `--surface` | `#23211C` |
| `--surface-active` | `rgba(255,255,255, 0.09)` |
| `--surface-elevated` | `#2D2A24` |
| `--surface-hover` | `rgba(255,255,255, 0.05)` |
| `--surface-sunken` | `#15130F` |
| `--text-primary` | `#EDEBE6` |
| `--text-secondary` | `#9C978B` |
| `--text-tertiary` | `#928D83` |

## Typography

The fonts are **self-hosted** (bundled via `@fontsource`), so the app makes no request to any
external font host — it works offline and inside the tenant boundary. A redesign keeps the
self-hosted constraint: a new typeface ships as a bundle, never a remote link.

- **Body family:** `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Mono family (hashes, ref codes, figures):** `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- **Bundled families (7):** `ibm-plex-sans`, `inter`, `jetbrains-mono`, `libre-baskerville`, `lora`, `merriweather`, `source-serif-4`
- **Bundled faces (16):** `inter 400`, `inter 500`, `inter 600`, `inter 700`, `source-serif-4 400`, `source-serif-4 600`, `lora 400`, `lora 600`, `merriweather 400`, `merriweather 700`, `libre-baskerville 400`, `ibm-plex-sans 400`, `ibm-plex-sans 600`, `jetbrains-mono 400`, `jetbrains-mono 500`, `jetbrains-mono 600`

## Coverage cross-check

- Screens documented: 105.
- Flows documented: 81; with media: 81.
- Flows whose screen has no inventory entry: 0.
- Screens with no flow: 58.
- Design tokens: 25 unique, 6 preset/theme blocks.

Regenerate with `npm run gen:design`. The `designSpec` guard holds this file to its sources.


# Provio: Complete Product Specification

**Version:** 10 (supersedes v9 and the Requirements document)
**Owner:** QSCorp (platform owner and sole operator of the platform)
**Precedence:** Laws (§1) → this specification → implementation. Anything not specified here is decided by the simplest option that obeys the Laws, and recorded as a decision.

---

## 0. Product Summary

Provio is a multi-tenant audit management platform. Organisations of different sizes, regulatory environments and methodologies run their internal audit function in it: universes and entities, risk assessment, audit planning, engagement lifecycle (Planning, Testing, Conclusion), deterministic analytics, findings, reports and corrective action plans (CAPs).

Its differentiators:
- **Deterministic analytics.** Testing, sampling, scoring, gating and reconciliation are code that can be tested and explained. AI is optional and advisory only.
- **One interconnected record.** Every object links to every other, statuses are live, and filters apply across views.
- **Configuration, not code.** Almost every rule, field, role, workflow, scale and template is configurable visually and versioned.
- **Auditable by design.** Sign-offs and issuance are hash-chained. Every action is logged.

Provio is sold as a subscription per organisation. Clients log in to their own isolated workspace and can export everything they own.

---

## 1. Laws

- **L1 Deterministic analytics.** All testing logic (sample size, selection, anomalies, scoring, gating, reconciliation, document checks) is deterministic code. AI never executes, determines or influences that logic. Where an organisation has enabled AI, it may produce advisory summaries and suggestions. That AI runs only on tenant-hosted infrastructure, is labelled as AI-generated, and never changes a test result, score, sample, finding status or gate.
- **L2 Data stays tenant-side.** Raw financial data and personal data never leave the tenant's hosting boundary, and never go to an external AI service or model. The platform owner has no interface path to tenant business content.
- **L3 No path around the population gate.** No population-based test proceeds without a verified population, enforced in the database. Non-population tests (inquiry, observation, document review) are documented procedures mapped to a control.
- **L4 One interconnected record.** Statuses update in real time. Every object is drillable. Filters apply across views.
- **L5 Accountability.** Every action is logged. Sign-offs, freezes, plan versions, report issuance and ledger verification are hash-chained. Configuration changes are versioned and logged.

---

## 2. Structure and Tenancy

- **Hierarchy:** Tenant → Universe → Entity (approved) → Engagement.
- An **engagement belongs to exactly one Universe.**
- An **Entity** can be audited in many engagements over time and can be linked to many Findings.
- **Sharing outside a Universe** is view-only, granted by a Level-1 or Level-2 Head, with in-app and email notification.
- A **tenant** is one client organisation. Each tenant's data is isolated from every other tenant's data.
- **Platform owner:** QSCorp. The platform owner operates the platform and the platform portal but has no access to tenant business content (§24).

---

## 3. Hosting and Client Access

- **Clients log in** to their own tenant workspace over the web and desktop. Phone access covers ethics sign-off, simple approvals and report viewing.
- **Hosting (initial):** one Supabase project hosts all tenants, isolated by `org_id` and row-level security. Each tenant's data is separated at the database level by policy and verified by isolation tests.
- **Hosting (option):** a client can require a dedicated Supabase project or a self-hosted deployment. The data module is designed to target either without changes to the application.
- **Exports:** every client can export everything it owns (§18, §25).

---

## 4. Roles, Teams and Access

### 4.1 Roles
Roles are data. Seed roles:

- **Org Admin:** configures the organisation.
- **CIA (Chief Internal Auditor):** governs the audit function, approves plans and CIA-level decisions.
- **Audit Manager:** manages engagements and teams.
- **Reviewer:** reviews and approves work.
- **Preparer:** performs and documents work.
- **Observer:** read-only, for Board or Audit Committee.
- **Auditee:** link access only, for responding to findings.

"Level-1 Head" and "Level-2 Head" are org-hierarchy attributes that rights can reference.

Roles, their rights and their scopes are editable by CIA and Org Admin.

### 4.2 Audit Teams
- Every engagement has an **Audit Team**. Each member holds a **team role** in that engagement.
- Team roles are configurable per organisation. Defaults: Lead, Preparer, Reviewer, Observer.
- Team membership is set at deployment and changed under change control (§21).
- **Testing sign-off** is configurable per organisation: the organisation chooses which team role signs off each stage (Planning, Testing, Conclusion).

### 4.3 Visibility and enforcement
- Users see only their Universes, Entities, Engagements and everything beneath them.
- Out-of-scope links show a neutral "Not available."
- Top-level heads see everything within the tenant.
- **Enforcement is by row-level security.** Hiding buttons is not a control.

### 4.4 Fixed invariants
These cannot be configured away:
- Four-eyes review (the preparer cannot review their own work).
- Sealed means read-only.
- The business ledger is append-only.

### 4.5 Identity
- Login resolves identity only from the authenticated session.
- A user without a provisioned role gets no access. There is no default role.
- No persona simulation or persona switching exists anywhere in the product.

### 4.6 Identity and test data decisions (owner, 2026-10-14)
- Sign-in is real in production from Phase 1. The browser bundle contains only the Supabase project URL and the publishable key. The secret key is never in src/ or dist/.
- After sign-in, the user's organisation, role, universe scopes and entity scopes are read through the data module from org_members and user_scopes, under row-level security. user_metadata is never used for authorisation.
- Test data in provio-test is synthetic only, created by the end-to-end setup. It holds two test organisations, both flagged is_demo=true: one with a single universe, and one with two universes. It never holds client data.
- One login belongs to one organisation. Users do not switch between organisations.

---

## 5. Navigation and Home

**Primary navigation:** Dashboard · Work Queue · Audit Universe · Audit Plan · SIRA · Audit Files · Issues & CAP Register.

Tabs the role or scope disallows are hidden.

- **Dashboard (scoped):** counts, open CAPs by department, overdue CAPs, plan delivery, top SIRA risks, ledger status.
- **Work Queue (personal):** my open tasks, my overdue items, engagements I'm on, items awaiting my sign-off, my review comments. Managers also see team workload, engagements needing attention, overdue CAPs and pending approvals.
- **Audit Files:** lists the engagements the user may open. Opening one creates the Audit File window (§17).
- **Global:** command palette (Ctrl/⌘ K), keyboard shortcuts and a review-comments dock. All are scope-filtered.

---

## 6. Universes and Entities

- **Universes** group entities under a common audit domain (for example, IT Audit, Shari'ah Audit, Management Audit).
- **Entities** are the auditable units: departments, processes, systems, branches.
- **Entity approval:** a new entity must be populated and approved before it can be used in any engagement. The initiator, required fields and approver are organisation-configured.
- Each Entity keeps its history: engagements, findings, CAPs and SIRA results.

---

## 7. Deployment Gate

Deploying an audit file is a controlled gate, never a "create" button.

1. **Select an Entity.**
2. **Entity not in the Universe's approved list →** deployment is blocked. The approver is notified and the user is linked to the New Entity flow. Continue only after approval.
3. **Entity not in the approved Audit Plan →** adding it requires special permission, because first-time addition is a CIA-level decision.
4. **Plan period does not match the deployment period →** routed to someone authorised to change the plan.
5. **Deployer not authorised →** approval request to the configured approver. Rejection returns a reason to the requester, who can revise and resubmit.
6. **Team members** added at deployment must each complete the ethics and independence acknowledgement. This is a hard block until complete. The acknowledgement is an authenticated digital signature, recorded in the ledger.

### 7.1 Combined approval
When a deployment needs a plan change (deploy-before-plan, or a plan moved forward):

- One request carries both the plan change and the deployment.
- One decision applies both atomically, or neither.
- Approval creates a new plan version linked to the request and deploys the file.
- Rejection leaves both the plan and the deployment untouched.
- The decision is revalidated against the current plan at decision time.
- Requests have an SLA with escalation to a configured senior role.
- No audit file exists until approval.
- The plan-change approver's decision also satisfies deployer authorisation.

Deployment never asks for a population. SIRA and the plan are upstream.

---

## 8. SIRA (Universe-Level Risk Assessment)

SIRA is an annual exercise per Universe. It sits outside individual engagements and feeds the Audit Plan and Planning.

### 8.1 Risk library
- A **universal risk library** holds risks reusable across entities and universes.
- Within a Universe, the organisation selects which risks apply to which Entity.
- Totals update automatically when selections or scores change. Each change records its cause.

### 8.2 Risk model (configurable per organisation)
Each organisation uses the QSCorp default model or defines its own:

- **Factors:** the dimensions scored. Default six: inherent risk, complexity, regulatory exposure, prior findings, time since last audit, materiality. Organisations can add, rename or remove factors.
- **Scales:** default 1–5. Organisations define the label for each point.
- **Weights:** set per factor.
- **Bands:** threshold ranges that map the 0–100 score to ratings (default Low, Medium, High, Critical). Names and thresholds are configurable.
- **Aggregation:** chosen from a fixed library of named methods: weighted sum, maximum, weighted average, weighted average with a floor, and similar. No free-form formulas.

All scores are normalised to 0–100 and recorded with the factor values and method used.

### 8.3 Cycle and outputs
- A **cycle** is one annual run for a Universe. Publishing a cycle is logged and hash-chained.
- Outputs: inherent risks and the overall risk environment per Entity and Universe.
- **Emergent risks:** concluded engagements write emergent risks to a queue for the next cycle. Each is accepted or rejected, with a reason.

---

## 9. Audit Plan

- Built from the Universe and the SIRA ranking.
- Creation and approval authority are configurable per organisation.
- **Full version history.** Every change creates a version, linked to its approval where one is needed.
- After approval, **rescheduling** is easy. **Adding or removing engagements** is CIA-level.
- **Ad-hoc engagements** require a mandatory justification and CIA approval. They show as pending until decided.
- **Gantt view** with draggable proposals. A proposal never changes dates silently. The user sees the proposed change and accepts or rejects it.
- **Resourcing** view: people, time and travel by engagement.
- **Plan-vs-actual** view: planned dates and resources against actuals.

### 9.1 Prior-year material
- Never carried forward automatically.
- **Viewing** and **importing** are separate actions, reachable from Planning and from plan creation at any time.
- Import is per item: risk and control mapping, scope, procedures or structure, resource estimates.
- Populations, samples, results, conclusions and evidence are never importable.
- Imported items arrive as **"Imported – confirm"** and do not count toward sign-off until reconfirmed.
- Every import is logged.
- Importing after Planning sign-off requires a reopen with justification.

---

## 10. Engagement Lifecycle

Three formal stages, each with a consolidated sign-off:

**Planning → Testing → Conclusion**

- **Report generation** is an action available after Conclusion sign-off (§15).
- **CAP closure** is a lifecycle that starts after the report is frozen (§16).
- **SIRA is not an audit stage.**

### 10.1 Planning
Sections are configurable per organisation. Required content:

- **Risk and control mapping:** risks and controls with descriptions, inherent risk and residual risk.
- **Control selection:** every control in the RCM shows as **Selected** or **Not in scope**. Every Selected control must produce test records.
- **Scope**, and **resources** (people, time, travel).
- **SIRA pre-fill (required behaviour):** when Planning begins, everything already available from SIRA for the Entity appears as **smart suggestions and pre-filled options**. This includes risks, inherent ratings, suggested controls, prior-finding counts and risk bands. The auditor accepts, edits or rejects each suggestion. Each decision is logged.
- **Reconciliation:** if the risks in Planning do not match the current SIRA, a reconciliation error blocks Planning sign-off until resolved.

Testing is locked until Planning sign-off. The organisation can allow limited overlap with a configurable grace period before the hard lock.

### 10.2 Testing
- Every Selected control produces test records.
- **Two-stage testing:** DEA (design effectiveness) and OET (operating effectiveness). Each stage has independent conclusions and evidence.
- **One-stage testing:** OET only.
- The organisation chooses one-stage or two-stage (§23).

### 10.3 Conclusion
- Auto-pulls all exceptions from Testing.
- The auditor finalises wording, rationale and supporting evidence.
- Removing an item requires a mandatory comment.
- An overall opinion or rating is optional, and is configurable as required or optional.

### 10.4 Sign-off and locking
- Every stage sign-off requires review by a role configured for that stage.
- After sign-off the file is **locked and read-only**, with a cumulative hash.
- **Reopening** requires the reopen capability and a justification of at least 10 characters. The reopen is logged.

---

## 11. Testing

### 11.1 Population-based tests

1. **Upload** a CSV or Excel population. Headers are identified automatically. The population is calculated.
2. **Verification.** SHA-256 hashing, integrity checks and a control-total reconciliation run. Only then is the population marked **VERIFIED** and the test unlocked. The database rejects any sample or test row that lacks a verified population hash.
3. **Control type.** The auditor selects the control type. The organisation's Org Sampling Table (§11.3) gives the minimum sample size.
4. **Sample mode**, configurable per organisation:
   - **System selects** rows. Selection is seeded and reproducible, never random.
   - **Auditor pastes a sample.** The engine verifies every item against the population. Items not found in the population are rejected.
5. **Floor.** The computed size is the minimum. Finalisation is hard-blocked below it.
6. **Locking.** A locked sample is immutable by default. Replacement is allowed with a recorded rationale and counts as a material change (§21).
7. **Additional rows.** After lock, auditors can add rows. The system re-syncs deterministically.
8. **Per row:** Tick, Cross or Unverifiable, each with a rationale. Exceptions require a rationale. The combination becomes the observation.
9. **Workpapers.** A workpaper can be marked **Prepared**. Reviewers review or revert individually or by multi-select. Row conclusions roll up into a workpaper conclusion, which is proposed by rule and confirmed by the preparer.

### 11.2 Non-population tests
Document review, inquiry and observation. Each must map to a control. Configurable fields typically include: document name and attachment, what was tested, exceptions noted and emerging risks.

### 11.3 Sampling methods and the Org Sampling Table
- **All sampling methods are built into the product.** Organisations do not write methods.
- **Methods:** Random and Systematic (Clopper-Pearson with finite-population correction), MUS (monetary unit sampling), Stratified, High value, Low value, Haphazard.
- **Org Sampling Table:** the organisation selects which approved methods apply to which controls or activities, by control type, frequency and population band. It is configured visually by CIA or Org Admin. Only mapped combinations can be used.
- All methods use a seeded Mulberry32 PRNG derived from the population hash and the workpaper ID. Each sample shows **"how this was calculated,"** with the formula, inputs and result.

### 11.4 Pre-flight before submission
Checks: exceptions without rationale, unresolved flags, missing evidence, sample below floor, reviewer equals preparer, incomplete findings, unanswered comments. Submission is blocked until the checks are clean, or each open item is acknowledged with a logged reason.

---

## 12. Analyst Engine

All checks are deterministic, parameterised within admin-set ranges, and unit-tested. Every result row has **"Raise finding,"** which stores the rule ID, the parameters used and references to the input rows.

- **Population checks:** duplicates and near-duplicates; sequence gaps; outliers (z-score, IQR); Benford first digit (chi-square and MAD); round-number clustering; split payments below thresholds; weekend, holiday and after-hours postings; same-user create and approve; missing mandatory attributes; date-range, blank and invalid-value checks.
- **Financial checks:** variance (period or budget) with percentage and absolute thresholds; trend (slope, R², residual outliers); GL variance; TB variance and balance; GL-to-TB reconciliation per account; financial-statement ratios with movement flags.
- **Reconciliations:** population vs sample; SIRA vs Planning; selected controls vs test records; findings vs evidence; final report vs CAP register; CAP due dates vs report.
- **Completeness and consistency:** mandatory-field checks on workpapers and findings; cross-workpaper consistency; unsigned ethics forms; missing evidence; overdue CAPs; stale reviews.
- **Cross-engagement:** thematic issue detection by control, entity and category; repeat-finding detection; suggestions from SIRA and prior related work. Suggestions are never applied automatically.
- **Risk helpers:** inherent and residual risk surfaced from SIRA and compared with test results.

---

## 13. Document Review and AI

### 13.1 Rule-based document review (deterministic)
- **Text extraction:** DOCX, PPTX, XLSX, CSV and text-based PDF.
- **Fact extraction:** dates, totals, references, signatures.
- **Structure checks:** placeholders and empty sections; table cross-footing; template and checklist conformance.
- **Consistency checks:** numeric inconsistencies across sections and documents; matching document facts to sample rows.

Legacy binary formats (.doc, .ppt, .xls) are stored as evidence but not extracted (§20).

### 13.2 Optional AI assistance
- **Deployment:** a self-hosted model (for example, Ollama) installed per client. QSCorp packages the installer, installs it and maintains it. No data leaves the client's environment.
- **Off by default.** QSCorp enables it per organisation.
- **Scope:** advisory summaries of documents, suggestions for wording, and key-point extraction from long documents.
- **Labelling:** all AI output is labelled as AI-generated and kept separate from the deterministic record until a user accepts it.
- **Restrictions (L1):** AI output never changes a test result, score, sample, finding status, gate or deterministic check.
- **Excluded:** vendor-hosted AI models. These would breach L2.
- **Hardware guidance** (indicative, confirmed in a spike before release): a quantised 7–8B-parameter model needs about 16 GB of RAM for CPU-only operation, and a GPU with about 8 GB of VRAM for reasonable speed. Summarisation runs asynchronously, so slower responses are acceptable. Clients must meet this guidance to use AI.

---

## 14. Findings, Observations and Issues

### 14.1 Terminology
- **Observation:** a draft. It is the working record from testing.
- **Finding:** concluded. An observation becomes a finding only when the readability checks pass (§14.3).
- **Issue:** reported. An issue may be thematic and group several findings.

### 14.2 Structure
- **Sections are fully configurable per organisation.** Each section can be renamed, added, removed or reordered.
- **Defaults:** Condition, Criteria, Cause, Consequence, Corrective action.
- **Role tags:** every section carries one role tag. Role tags are the basis of all checks, so sections can be renamed freely without breaking the logic.
- **Role tags:** Context, Condition, Effect, Risk, Criteria, Cause, Recommendation, Other.
- **Links:** a finding can link to many controls, many sample exceptions and many entities. Each section links to its controls, test rows and evidence.
- **Missing content stays visibly incomplete.** The product never inserts boilerplate.

### 14.3 Readability rule (enforced)
A deterministic completeness check requires the following roles to be present and filled before an observation can become a finding:

- **Context:** the area and why it matters.
- **Condition:** what was found.
- **Effect:** what it leads to.
- **Risk:** what could go wrong.

**Criteria, Cause and Recommendation** are required only where the organisation's methodology requires them.

Readability is checked by completeness, not by AI. Plain-language quality is reviewed by people.

### 14.4 Severity
- **Default levels:** High, Medium, Low.
- **Organisation-configurable:** rename levels, change how many there are, and set each level's colour and cinnabar intensity (§27).
- **Every severity level** is shown with its text label, never by colour alone.

### 14.5 Linking
- A finding can be linked to many controls, sample exceptions and entities.
- Issues group findings. An issue can span several entities and controls.

---

## 15. Conclusion, Report and Drafting

### 15.1 Report availability
The report becomes available only after Conclusion sign-off.

### 15.2 Drafting method (deterministic, no AI)
The report is drafted from structured data in six steps.

1. **Assemble.** The system collects the issues and their findings, the Planning scope and resources, the Conclusion opinion (if configured), the list of workpapers and the sample tables.
2. **Pre-compute.** The system calculates the figures for the executive summary: counts of findings and issues by severity, by control and by entity, plus the proportion of tests passed and failed. Each figure is computed from the records, not typed.
3. **Compose.** Each report section is a template of blocks. Placeholders are filled from the structured data (for example, "The engagement tested {n} controls, of which {m} produced exceptions"). If a value is missing, the block shows **"Missing: [field]"** highlighted, and issuance is blocked until it is supplied.
4. **Order and tailor.** Sections can be reordered, toggled on or off, and edited. Editable block types: text, tables, images (external images need a source and rationale) and page breaks. Edits are tracked.
5. **Consult.** The draft goes out for management comments. Each comment is attached to a block, and each is resolved as incorporated or rejected with a reason. The report cannot be frozen while any comment is unresolved.
6. **Version and freeze.** The draft is issued as version 1 (for comments). The final version is issued after comments are incorporated. Versions are compared side by side. Freezing requires CAP reconciliation (§16.3).

**Default template sections:** Executive Summary · Scope and Objectives · Findings and Issues · Overall Opinion · Appendices (workpaper index, sample tables, evidence index, management responses).

**Templates:** each tenant has 1–3 templates. Each template defines section order, block types and branding.

### 15.3 Outputs
- **Frozen PDF:** generated from the block model, with the hash and the freeze date in the footer.
- **Editable DOCX:** generated from the same block model. Formatting is consistent between the two.
- **Branding per tenant:** logo, colours, fonts, header and footer, cover page.

### 15.4 Issuance
Issuance:
- generates the frozen PDF and the DOCX,
- changes the report status,
- emails the final report to the audit team (§22),
- updates the CAP register,
- writes a hash-chained entry to the business ledger.

### 15.5 Freeze
The freeze happens only after:
- management comments are resolved,
- CAP content and due dates are reconciled with the final report,
- the issued report and the CAP register match exactly.

---

## 16. Corrective Action Plans (CAPs)

### 16.1 Creation
CAPs are created from the final report. Each carries:
- the originating report and version,
- the issue number and issue detail,
- the responsible department or departments,
- the due date, taken from the report.

### 16.2 Updating and closure
- Updates are made mainly by auditors. This is configurable.
- **Remediation evidence** and an **action description** are mandatory.
- An authorised reviewer approves closure.
- **Statuses:** Verified and closed · Verified and closed with delay · Unverified · Overdue and unverified.
- **No in-system retest.** Verification is documented through the action description, rationale and supporting evidence.

### 16.3 Reconciliation
The CAP register and the issued report must match exactly (§15.5). Any mismatch blocks the freeze.

---

## 17. Audit File Window and Document Viewer

### 17.1 Audit File window
- Each open engagement appears as an in-app **floating window** with distinct "Audit File" chrome, so it is clearly separate from the main application.
- It can be **minimised** to a dock, **moved**, and **dragged out** as its own browser window. A pop-out window shares the origin and session, and stays in sync through Realtime.
- It is opened by a click, so popup blockers do not interfere.
- It is **non-blocking.** Records open inside the window as a full-page view or a floating window (the two-mode record view, §27.5).

### 17.2 Document Viewer
- Reachable from anywhere in the engagement, as a right-side slide-in or a popup.
- A **toggleable left list** and a main viewer.
- **Stage-aware:** Planning shows Planning documents; Testing shows Planning and Testing documents; Conclusion shows all documents.
- Organised by phase, then by engagement.
- Thumbnails and previews.
- **Full-text search** over extracted text from supported documents. The schema is designed now, and the feature is built as part of the analyst work.

---

## 18. Export

**Principle:** any view can be exported. Exports respect scope and permissions, are logged, and include the filters applied, the timestamp, the user and a content hash. Exported PDFs carry a footer with the engagement, export time, user and hash.

| Object | Formats |
|---|---|
| Working papers (any stage) | PDF, XLSX, DOCX |
| Sample and population tables | CSV, XLSX, PDF |
| Findings, observations and issues | PDF, DOCX, XLSX |
| Any table or list view (with applied filters) | CSV, XLSX, PDF |
| Charts and graphs | PNG, SVG, PDF |
| Dashboard and any other view | PNG, PDF |
| Audit File (full engagement bundle) | ZIP with PDFs, XLSX, a manifest and hashes |
| SIRA results | PDF, XLSX, PNG |
| Audit Plan (including the Gantt) | PDF, XLSX, PNG |
| Report | Frozen PDF, editable DOCX |
| CAP register | XLSX, CSV, PDF |
| Business ledger | JSON, CSV, with verification report |
| Activity log (tenant's own history) | CSV, JSON |
| Full tenant export (data, configuration, logs) | JSON and CSV in a ZIP |

Every export is recorded in the activity log.

---

## 19. Import

| Source | Format | Mapping step |
|---|---|---|
| RCM and control library | CSV, XLSX, DOCX tables | Yes |
| Entities | CSV, XLSX, DOCX tables | Yes |
| Users | CSV, XLSX | Yes |
| Populations (for testing) | CSV, XLSX | Yes (with verification, §11.1) |
| Prior-year material | CSV, XLSX, DOCX tables | Yes (per item, §9.1) |

Every import has a **parser per format** and a **mapping step**: the user maps source columns to product fields, reviews a preview, and confirms. Every import is logged. Imports are validated and rejected with a clear error on invalid rows.

Migration from TeamMate, AuditBoard and similar tools is not committed in this version. Export is complete.

---

## 20. Evidence and Uploads

- **Accepted formats:** XLS, XLSX, CSV, DOC, DOCX, PPT, PPTX and PDF. Validation is by extension and content sniffing. Every file is SHA-256 hashed on ingest.
- **Size:** evidence files are capped at 10 MB by default. The cap is configurable per organisation within limits set by the platform.
- **Legacy binary formats (XLS, DOC, PPT):** stored as evidence and linked to the objects that cite them. They are **not extracted and not used for population sampling.**
- **Modern formats:** full extraction and analysis (§13.1), and population use for XLSX and CSV.

---

## 21. Change Control (After Deployment)

- **Routine change** (applied immediately, with notification): reassigning a workpaper to someone already on the team.
- **Material change** (formal approval required): anything meaningfully affecting audit quality. This includes planned dates, adding or removing team members, scope, tested controls, and replacing a locked sample. Approvers are configurable.
- Every change is logged, and approved changes are hash-chained.

---

## 22. Notifications and Email

- **All important events** generate in-app and email notifications.
- **Recipients are role-based.** The engagement supervisor (a configurable role) can be copied on notifications.
- **Control is at organisation level only.** Users cannot switch notifications off.
- **In-app notifications** are delivered through Realtime and are visible in the Work Queue.
- **Email** is sent through **Microsoft Graph with OAuth.** Each client tenant grants consent for Provio to send mail on its behalf, using a sender mailbox that the client chooses. Basic-auth SMTP is not used, because Microsoft is retiring it.
- Email is sent from an edge function, so credentials are never exposed to the browser.
- Each email is logged, with its delivery status.

---

## 23. Administration (Org Admin Portal)

The Org Admin portal is visual. It requires no code or JSON.

- **People:** users, roles, scopes, reporting lines, team roles.
- **Organisation:** settings, including one-stage or two-stage testing, and sign-off roles per stage.
- **Structure:** Universes, Entities and the new-entity process.
- **Controls:** RCM and control library.
- **Methodology:** severity levels and colours, scales, FSLI mapping, the Org Sampling Table (§11.3).
- **Risk:** SIRA model (§8.2), including factors, scales, weights, bands and aggregation method.
- **Workflow:** approval chains, SLA and escalation settings.
- **Finding structure:** section names, roles and order (§14.2).
- **Notifications:** rules and recipients.
- **BI parameters:** within fixed ranges for each check.
- **Templates and branding:** report templates and tenant branding (§15).
- **Rights:** the rights matrix.
- **Configuration history:** every change, versioned and logged.
- **Export and retention:** export schedules and activity-log archival settings.
- **AI:** shown read-only, with a status message. Enabling AI is done by QSCorp (§13.2).

**Every save** passes through a confirmation panel and writes a versioned, logged change.

---

## 24. Platform Portal (/superadmin)

Used by QSCorp only.

- **Separate login with mandatory MFA.**
- **Data-blind:** it has no read access to tenant business tables. This is proven by SQL tests.
- **Functions:** tenant management, provisioning, feature flags, usage and quotas, health monitoring, platform trail (metadata only), announcements, and AI enablement per tenant.
- **Support access** to tenant content is off by default. A tenant administrator can create a time-boxed, read-only grant.

---

## 25. Data, Security and Infrastructure

### 25.1 Backend
- **Supabase:** Postgres, Auth, Storage, Edge Functions and Realtime.
- **Free tier** until revenue; paid tier after.
- All access goes through one data module. Components never import the database client.
- No public `USING (true)` policies.

### 25.2 Tenancy and isolation
- Every business table carries `org_id`, with row-level security derived from the JWT.
- Scope is mirrored in a `user_scopes` table.
- SQL tests prove tenant isolation, scope isolation, and that the platform role reads no tenant tables.

### 25.3 Security
- Encryption in transit and at rest.
- Multi-factor authentication for platform administrators.
- Secrets are held in the platform's secret store and never sent to the browser.
- Access logs and the activity log record access to sensitive objects.

### 25.4 Storage and limits
- **Current Supabase free-tier limits** (database size, file storage, project inactivity pause) must be verified on Supabase's pricing page before any production use, since they change.
- **Database:** activity-log rows are kept compact.
- **Archival:** older activity is exported to Storage files in a defined format, and each archive is hashed and logged. The live database keeps a rolling window.
- **Population archival:** six months after an engagement is finalised (the platform default; each organisation may set its own period), a population's working rows are removed from the live database. The original uploaded file is kept compressed in Storage. Its SHA-256 hash is recorded in the business ledger at archive time and re-checked in the background on each download. A mismatch raises an integrity alert and is never silently accepted.
- **Archived access:** archived populations remain available at any time: viewable (paginated, on demand) and downloadable (the original file, streamed). Access does not re-run verification, analytics or sampling. Nothing is deleted without a hash record.
- **Evidence:** size-capped (§20). Large files can be stored in an external bucket later without changing the product model.
- **Full export** (§18) is always available, so clients are never locked in.

### 25.5 Compliance
- **Initial focus:** Pakistan's requirements.
- **Design readiness:** SOC 2, ISO 27001 and GDPR practices.

### 25.6 Scale
- **Per tenant:** 10–30 concurrent users.
- **Acceptance testing:** populations of **50,000 rows**.
- **Design capacity:** exceeds 50,000 rows per population. Figures beyond that are measured, not assumed.

### 25.7 Platform
- **Desktop first.**
- **Phones** support ethics sign-off, simple approvals and report viewing.

---

## 26. Logging

Every meaningful action is logged: create, edit, view, approve, sign-off, status change, configuration change, export, import, deployment and AI enablement. Navigation and object interactions (open, expand, filter, download, search) are batched in the background. Pointer movement is not logged.

- **Business ledger:** hash-chained. It records sign-offs, freezes, plan versions, report issuance, SIRA publication, approvals, ethics acknowledgements and ledger verification. Sequence numbers, timestamps and hashes are computed by the database. The ledger is append-only and verifiable.
- **Activity log:** append-only and **kept permanently.** The tenant sees and exports its own history. The platform trail is metadata only.
- **Archival:** archived activity is recorded in the ledger. Archival never deletes data without a hash record of what was archived.

---

## 27. Design System

### 27.1 Colour
- **Verdigris:** pass, clean, sealed.
- **Cinnabar:** exception, flag, overdue or action.
- **Brass:** money only.
- **Departments:** neutral ramp, with labels.
- **Severity and tag levels:** an expanded palette is available. Organisations choose colours for their own severity and tag levels from this palette. Every colour must meet WCAG AA contrast. Every coloured level also carries a text label, so colour is never the only signal.
- **Presets:** Ledger (default), Porcelain and Bone, each in light and dark. Colours are held as CSS variables. Components contain no hex values.

### 27.2 Typography
- **Source Serif 4:** titles, numerals and money.
- **Inter:** interface text.
- **JetBrains Mono:** hashes and identifiers.

### 27.3 Iconography
Bespoke 17px inline SVG icons at stroke 1.3. No icon fonts. No third-party icon libraries.

### 27.4 Motion
- Springs at 300/30 for navigation.
- Heavy settle with hold-to-confirm for consequential actions.
- A two-second ambient pulse.
- No linear easing.
- Respects `prefers-reduced-motion`.

### 27.5 Interaction
- **No blocking modals.** A **two-mode record view** replaces the old sliding inspector panel: a record opens either as a **full page** (its own `/view/:recordType/:id` route with a breadcrumb) or in a **floating window** (draggable, minimisable, pop-out — the Audit File window chrome). The mode is the user's stored `record_view_mode` preference. The Audit File window and the confirmation panel are also used. No surface renders a backdrop scrim or `aria-modal`.
- Every screen has designed empty, loading and error states.
- WCAG AA contrast is verified.

---

## 28. Out of Scope and Discarded

Never reintroduce:

- AI in testing, scoring, gating or any deterministic check.
- Vendor-hosted AI models.
- Mock or persona login, and "simulate viewpoint."
- Hardcoded or demo data in production tenants.
- Five- or six-stage lifecycles.
- A Reports tab or a Workbench tab.
- Blocking modals.
- Icon fonts and lucide-react.
- Unlabelled manual-sampling overrides.
- A retest workflow and "proposed" CAP due dates.
- Observation, Finding and Issue used interchangeably.
- A free-form SIRA formula builder.
- Red Thread and the 4D scrub bar.
- Automatic carry-forward of prior-year material.
- Migration commitments from TeamMate or AuditBoard.

---

## 29. Build and Verification

Each task closes only after the following checks.

- **Type check, unit tests and build:** `tsc --noEmit`, `vitest run` and `vite build` must pass. One commit per task. Stop at the first failed check.
- **Engine logic:** every deterministic function has unit tests.
- **Interactive flows:** every flow marked for end-to-end testing has a Playwright test.
- **Priority tests:** SQL isolation tests (tenant, scope and platform role) and population gate tests are built first and must always pass.
- **Parity:** `docs/PARITY.md` maps every section of this specification to Present, Partial or Missing, with evidence.
- **Screenshots:** every changed screen is captured in all three presets, in light and dark, on each task. A full sweep of every screen in every variant is run at each gate boundary.
- **Per-gate report:** files changed, real test counts, parity status, screenshots, decisions made, and an explicit NOT DONE list.
- **Caution:** code is verified through the tests above, not by reading it alone.

## 30. Phase 2 decisions

Phase 2 built the access layer: identity, rights, RLS, the audit team, the role configuration log, the invite cap, and the org administration portal. This section records the decisions taken, so the specification matches what was built. Each decision is dated and marked. Nothing in §§1–29 was rewritten; where a decision needed a change to the text, the change is listed here and applied in place.

### 30.1 Rights, not role names

- **D1 (2026-10-14). A role is a bag of rights.** Every permission decision, in the database and in the app, is a test of a right (`caller_has_right` / `hasRight`). No policy or component compares a role name. The closed vocabulary is eleven keys: `manage_users`, `manage_roles`, `edit_config`, `manage_engagements`, `approve_plan`, `review_and_approve`, `perform_work`, `can_reopen`, `view_all_scopes`, `read_only`, `manage_team`. Enforced by migration `0012_rights_closed.sql` (`rights_keys_valid`) and by the guard test `src/guards/noRoleStrings.test.ts`.
- **D2 (2026-10-14). The seed matrix implements §4.1.** The matrix is declared in migration `0012_rights_closed.sql` and mirrored in `src/lib/rights.ts`. `src/lib/rightsMatrix.test.ts` fails if the two drift. `is_cia()`, `is_org_admin()` and `can_read_all_scopes()` keep their names because policies reference them; their bodies read rights.
- **D3 (2026-10-14). The JWT carries identity, not permission.** The auth hook (`0010`) stamps `org_id` and `user_role`. A permission decision resolves the right from the role named by the claim, in the caller's organisation. This matters only for a forged token; a real login is membership-checked. Recorded as B1 in `docs/ROLE-CHECKS.md`.

### 30.2 Tenancy, RLS and the team

- **D4 (2026-10-14). Every business table carries `org_id` and a select policy `org_id = jwt_org_id()`.** There are no direct write policies: writes go through a function that re-checks the right. `roles` and `user_scopes` are the only tables a tenant writes directly, and each is guarded by a trigger and a rights check.
- **D5 (2026-10-14). Team roles are data, separate from organisation roles.** An engagement has an audit team (§4.2). A team role maps to a set of rights in `team_role_rights` (`0013_engagement_team.sql`); the permission to assign a team role is the `manage_team` or `manage_engagements` right.
- **D6 (2026-10-14). Scope is mirrored in `user_scopes`.** Scope is an id, never a role name. A read-only principal with `view_all_scopes` reads the whole tenant; without it, only its scoped universes, entities and engagements.

### 30.3 Configuration, history and the ledger

- **D7 (2026-10-14). A role change is guarded, versioned and logged.** `0014_roles_config.sql` adds `role_config_log` (append-only) and a guard that rejects a key outside the closed list. The business ledger (§26) stays the single hash-chained record: sign-offs, freezes, plan versions, issuances, SIRA publication, approvals, ethics acknowledgements and ledger verification.
- **D8 (2026-10-14). The invite cap is data and events.** `0015_invite_cap.sql` adds `invite_cap_settings` and `invite_cap_events`; `invite_user_capped` counts events per user per day. A new organisation is seeded with a default cap.

### 30.4 Administration portal (§23)

- **D9 (2026-10-15). The Org Admin portal is visual and rights-gated.** `0017_admin_rpcs.sql` provides the administration functions (provision a member, set a role, set a reporting line, grant and revoke a scope, create and delete a role, edit rights, set the invite cap). Each function re-checks the right (`manage_users` / `manage_roles`) in the database. The UI (`src/components/admin/PeopleAdminPanel.tsx`) is a sliding inspector, reached from the profile menu, never a new tab (§28) and never a blocking modal (§27.5). The menu entry shows only when the session holds `manage_users` or `manage_roles`.
- **D10 (2026-10-15). The rights matrix is editable in the portal.** A role's rights are edited against the same closed list the guard enforces. A change takes effect on the next request, because every decision reads the right at decision time.

### 30.5 Test data and the harness

- **D11 (2026-10-15). Test data is synthetic and carries the real matrix.** The end-to-end setup creates two demo organisations with the seed roles and the seed rights. It previously seeded an empty rights map, which made a live session rightless; this is fixed. The setup deletes `invite_cap_events` on each run, so a run leaves no residue (M5).
- **D12 (2026-10-15). The local harness mirrors the hosted project.** The hosted test project has Supabase's `ensure_rls` event trigger, so any new public table without RLS fails `13_rls_enabled.sql`. The local harness reproduces `ensure_rls`, so a local red matches CI.

### 30.6 Where a decision changed the text

- **§4.1.** No change: the seed matrix now implements it.
- **§4.4.** No change: four-eyes is an id comparison, not a role name; sealed means read-only; the ledger is append-only.
- **§23.** The portal is now built; its scope is the list in §23. Items not yet built (organisation settings, structure, controls, methodology, risk model, workflow, notifications, BI, templates, export, AI) are recorded as not done in `docs/NOT-DONE.md`.
- **§25.2.** No change: tenancy and scope are enforced by RLS, proven by SQL tests.
- **§28.** No change: no blocking modal, no Reports tab, no Workbench tab. The admin panel is an inspector.

---

## 31. Changes from v9

| Change | Source |
|---|---|
| All beta labels removed. The specification describes the complete product. | Instruction |
| Report drafting method defined (six steps, deterministic) | Instruction |
| Clients log in to their own tenant workspace; hosting model defined | Decision |
| Email through Microsoft Graph with OAuth; client-chosen sender mailbox | Decision |
| Legacy binary formats stored as evidence only, not extracted or sampled | Decision |
| Activity log archival to Storage export files | Decision |
| Ollama installed and maintained by QSCorp; hardware guidance required | Decision |
| Readability roles: Context, Condition, Effect and Risk mandatory; Criteria, Cause and Recommendation optional; section names renameable | Decision |
| Screenshot policy: changed screens per task, full sweep at gate boundaries | Decision |
| Severity palette amendment (text labels always shown) | Decision |
| Supabase limits flagged for verification before use | Decision |

---

## 32. Open Items

1. **Supabase limits.** I have not checked the current free-tier figures. Verify them on Supabase's pricing page before the build starts, and update §25.4.
2. **Microsoft status.** Confirm current Microsoft guidance on basic-auth SMTP retirement and the Graph consent process before Gate 5.
3. **Schedule.** This specification is the full product. Delivering it on 30 November 2026 would require a much larger team or a much later date. Confirm whether that date is fixed, or whether it moves to match the full scope.

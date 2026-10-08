# Provio v7 requirement parity — 2026-10-08

Present means the bounded requirement is supported, not enterprise release acceptance. Partial and Missing remain open. Current authenticated pilot and explicitly synthetic legacy UI have different coverage. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for dependencies and [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) for validation. No full phase gate is declared passed.

| Guide section | Status | Requirement | Current evidence and gap |
|---|---|---|---|
| 0.2 | Partial | Build audit trail and honest parity | Current ledger below; source line counts and validation in docs/IMPLEMENTATION_REPORT.md. Full legacy visual/interaction gates remain incomplete. |
| 0.3 | Partial | Feature definition of done | Authenticated procurement vertical slice verified through independent closure; full enterprise definition of done remains open. |
| 1.1-L1 | Partial | Deterministic audit math | Mulberry32 and pure numeric helpers present; most specified engines/sizing absent. |
| 1.1-L2 | Present | No raw data sent to LLM in current code | No AI transmission; minimized aggregate preview and independent validator tested in trust.test.ts. Template reports need no inference. |
| 1.1-L3 | Partial | Unbypassable population gate | SQL rejects results without verified population; census all-row gates pass trust.sql. Legacy simulated verification removed; statistical sampling remains absent. |
| 1.1-L4 | Partial | Interconnected ledger and cross-filters | Local stores, filtered lists and drill links exist; no realtime; mixed scope/CAP models. |
| 1.1-L5 | Missing | Config changes signed | No durable config documents or CONFIG_CHANGED workflow. |
| 1.2 | Missing | Kernel executes graph data | Hardcoded access/sampling/SIRA; CAP designation object is a useful partial precursor. |
| 1.3 | Partial | Canonical lifecycle and persistent CAPs | Authenticated case uses planning/testing/conclusion and linked issued issues/retests. Legacy demonstration CAP arrays remain separate. |
| 1.4 | Partial | Discarded concepts absent | No lucide or AI testing found; old Reports components remain unmounted; native blocking dialogs remain. |
| 1.5 | Missing | Right-side inspectors, no modals | InspectorPanel centers aria-modal dialog with backdrop; alert/prompt calls found. |
| 2.1 | Partial | Required stack | Supabase SDK/Auth/Postgres and original stack present; Storage/Edge Functions/Realtime integration still absent. |
| 2.2 | Partial | Single data-access layer | Single Supabase SDK module src/lib/data/index.ts and scoped authenticated context. Legacy browser-only demo remains explicitly separate. |
| 2.3 | Partial | Client-side BI worker | CSV parsed locally; authoritative procurement checks recomputed in tenant Postgres. Large-file worker absent; pilot limited to 1,000 rows. |
| 2.4 | Partial | Free-tier mitigations | Verified per-case export and 10MB private evidence cap in authenticated mode; storage quotas/idle warnings absent. |
| 2.5 | Partial | Server-confirmed consequential actions | Authenticated seal/issuance/closure await committed RPC; stale versions rejected. Legacy demonstration is not an authenticated workflow. |
| 2.6 | Partial | Required backend/config/admin directories | Data module, migration and SQL tests present. Storage functions/admin/config/kernel directories still absent. |
| 2.7 | Partial | Lazy tabs and 500kB chunks | Lazy tabs and inspectors; largest chunk below 500kB. Separate admin routes absent. |
| 3.1 | Partial | Tenant org_id plus RLS | Pilot tenant-consistent FKs, membership/entity scopes and RLS tested on two tenants. Full original domain not yet migrated. |
| 3.2 | Partial | Role set | Seven local roles; no platform super-admin identity/auth; auditee treated as selectable user. |
| 3.3 | Partial | Capability matrix | Reviewer preparation denied; engagement uses audit_sign_off; SQL independent review/retest gates pass. Enterprise rights graphs remain absent. |
| 3.4 | Partial | Scoped views everywhere | Authenticated RLS and scoped projections tested; demo CIA CAP universe and observer draft leakage fixed. Demo raw-ledger/historical projection issues remain. |
| 3.5 | Partial | Multi-universe fixture coverage | Legacy two-universe fixtures plus two-tenant SQL negatives. Full required golden dataset absent. |
| 4.1 | Present | Seven primary tabs in order | Chromium smoke passed; screenshots reviewed; role-specific cases need expansion. |
| 4.2 | Partial | Profile and admin entry | Authenticated password login/local-session logout implemented; demo switcher is explicitly synthetic; administration absent. |
| 4.3 | Partial | Palette, shortcuts, history, dock | Palette/dock present; no panel route stack; inspector focus escapes. |
| 4.4 | Partial | Audit File from every entry point | Several entries work; workbench fallback can select first available paper. |
| 5.1 | Partial | Executive Summary | Cards/Gantt/CAP radial visible; required KPI set/SIRA top5/velocity/Boardroom incomplete. |
| 5.2 | Partial | Pending Tasks | Authenticated Pending Tasks derives required next actions; assignment rollups/time-machine still absent. |
| 5.3 | Partial | Audit Universe | Entity cards and RCM view; no full hierarchy or durable edits/import. |
| 5.4 | Partial | Audit Plan | Engagement list/Gantt and local sign-off; no annual-plan transaction, resource planning or approval workflow. |
| 5.5 | Missing | Annual SIRA | Page stub; helper formula differs from six-dimension yearly specification. |
| 5.6 | Partial | Audit File workspace | Authenticated census/evidence/findings/review/report/remediation implemented; full eight-tab/FSLI/DEA-OET workspace absent. |
| 5.7 | Partial | Issued-only Issues Register | Authenticated issued-only projection and independent retest closure verified end-to-end. Full action owner/due-date workflow absent. |
| 6A.1 | Missing | Users and Access portal | Demo viewpoints and read-only people UI are not auth/invites/scopes administration. |
| 6A.2 | Missing | Organization settings portal | Local boolean for two-stage organization, no versioned settings. |
| 6A.3 | Missing | Universes and Entities editor | No durable hierarchy/RCM import or framework map. |
| 6A.4 | Missing | Methodology editor | No saved sampling/severity/FSLI methodology documents. |
| 6A.5 | Missing | SIRA configuration | No weights/bands editor and preview. |
| 6A.6 | Missing | Workflow Editor | No Behavior Graph editor/schema. |
| 6A.7 | Missing | Notification Editor | No notification rule documents. |
| 6A.8 | Missing | BI Rule Editor | Workbench exposes local parameters; no bounded fixed-registry admin editor. |
| 6A.9 | Partial | Rights configuration | CAP designation/capability helper exists; no portal/rights graph/invariant validator. |
| 6A.10 | Partial | Templates | Frozen procurement-v1 template with no AI dependency; template admin/editor absent. |
| 6A.11 | Missing | Config Ledger | No durable config events, verify or revert. |
| 6A.12 | Partial | Data and Retention | Per-case history/evidence export and local backup restoration verified; retention/storage accounting absent. |
| 6A.13 | Missing | Save confirmation and CONFIG_CHANGED | No shared consequential confirmation or config command. |
| 6B.0 | Missing | Separate platform route/MFA | No superadmin route/shell/claim/MFA integration. |
| 6B.1 | Missing | Tenant administration | No tenant CRUD/suspension. |
| 6B.2 | Missing | Provisioning | No seed/invite transaction. |
| 6B.3 | Missing | Feature flags | No tenant flag store. |
| 6B.4 | Missing | Usage and quotas | No per-tenant accounting. |
| 6B.5 | Missing | Platform health | No idle/migration/function/ledger status service. |
| 6B.6 | Missing | Versioned registries | No fixed node/BI registry release interface. |
| 6B.7 | Missing | Support grants | No expiring read-only audited support access. |
| 6B.8 | Missing | Platform ledger | No platform_signatures. |
| 6B.9 | Missing | Platform tenant export | No backup export. |
| 6B.10 | Missing | Announcements | No platform banner publishing. |
| 7.1 | Missing | Versioned config documents | No table/getConfig/schema/save validation. |
| 7.2 | Missing | Behavior Graph contract | No shared schema/node registry; v12 master not supplied. |
| 7.3 | Missing | Rights Graph contract | Role functions and CAP configuration differ from required graph shape. |
| 7.4 | Missing | Illegal graph validator | No invariant/reachability validator. |
| 7.5 | Missing | Runtime Kernel | Intentionally deferred pending Gates A–C and v12. |
| 8.1 | Partial | Audit testing sequence | Persisted population/census testing/findings/pre-flight/review flow verified; FSLI/statistical sampling missing. |
| 8.2 | Partial | Verified population ingest | Strict CSV rows/dates/keys/positive amounts, source digest attestation, server row hash and exact total reconciliation. XLS/XLSX and broader populations absent. |
| 8.3 | Partial | Two-axis sampling | Seeded random helper; synthetic <=500 rows; no statistical floor/methods/manual validation. |
| 8.4 | Missing | Sample BI pre-analysis | BI tab runs hardcoded data unrelated to selected sample. |
| 8.5 | Partial | Glassbox workpaper | Real row outcomes, mandatory notes/evidence in pilot; advanced sample badges and DEA/OET conclusions remain absent. |
| 8.6 | Partial | Deterministic engines | Server procurement rules have exact identity oracle; legacy reconciliation/half-cent/variance boundaries repaired. Broader engines still missing. |
| 8.7 | Partial | Pre-flight | Server requires population, every census result with note/evidence and five-part findings for exceptions. Full OET/BI dispositions and review-comment gates absent. |
| 8.8 | Partial | Auditee evidence link | Pilot stores immutable actual evidence bytes privately. Public one-use uploads absent; legacy token expiry boundary fixed but legacy link persistence remains broken. |
| 8.9 | Partial | Red Thread | Five UI nodes with fallback text/title matching; missing metric/rule/raw row/evidence chain. |
| 8.10 | Partial | 4D history | Complete pilot snapshots exported; historical reconstruction UI absent. Demo finalization fails closed. |
| 9.1 | Partial | Database ledger authority | Database-generated immutable per-case chain, atomic commands and concurrent tests. Per-organization chain/verify_ledger API/external anchor not implemented. |
| 9.2 | Partial | Complete ledger action vocabulary | Pilot events cover create/import/evidence/results/finding/submit/return/seal/issue/remediation/retest/closure. Config/SIRA/support actions absent. |
| 9.3 | Partial | Canonical SHA-256 payload | Exact committed UTF-8 strings normative in SQL/export; demo canonical JSON rejects ambiguous values and fails without WebCrypto. Full versioned signed domain projection pending. |
| 9.4 | Partial | Seal and integrity UI | All displayed demo event fields hashed; pilot report frozen; export/offline integrity verifier tested. Full seal-integrity UI and external anchoring absent. |
| 9.5 | Partial | Report-only AI stub and flag | Explicit disabled report-only adapter and no-inference template. Configurable provider/tenant policy remains blocked. |
| 9.6 | Partial | Allow-list/k-anonymity/architecture guard | Strict allow-list, k=10 complementary partition suppression, preview and import-boundary tests. Egress authorization/logging absent; transmission disabled. |
| 10 | Partial | Postgres schema and migrations | Pilot migration/schema with tenant-consistent FKs and RLS. Full normalized control/population/sample/config/platform schema remains missing. |
| 11.1 | Partial | Visual hierarchy | Neutral presets improve foundation; contrast, mobile issue table and modal behavior remain. |
| 11.2 | Partial | Semantic color law | Tokens exist; green primary buttons and dark text on saturated fills deviate. |
| 11.3 | Partial | Token enforcement | Script reports zero, but permits white/black/neutral classes; InspectorPanel has bg-black/40. |
| 11.4 | Partial | Six variants and AA | Six tokens tested; real dashboard axe contrast fails; /dev/palette uses swatches, not dashboard. |
| 11.5 | Partial | Typography | Serif numerals exist; executive title appears sans, application typography inconsistent. |
| 11.6 | Partial | Layout system | Cards/gutters/radii present; overlapping mobile register and centered backdrop dialog. |
| 11.7 | Present | Shared SVG icons | No lucide dependency/import; token script passes. |
| 11.8 | Partial | Motion and confirmation | Springs present; no shared hold-confirm; reduced-motion validation outstanding. |
| 11.9 | Partial | Responsive and view states | 390px nav fits; issues columns overlap; stubs/loading spinner; error recovery incomplete. |
| 11.10 | Partial | Keyboard accessibility | Inspector Esc works but Shift+Tab escapes; slider unnamed; full a11y certification absent. |
| 12.1 | Partial | Header | Original demo header preserved; authenticated mode has real sign-out. Full enterprise header/admin integration absent. |
| 12.2 | Partial | Calendar panel | Visible 340px panel and legend; top 74.5 overlaps nav bottom 107; no portal; wheel scrolled page without changing month; Escape closed. |
| 12.3 | Missing | Time-machine calendar | Pending page stub; no historical data reconstruction. |
| 12.4 | Partial | CAP radial | Legacy CIA CAP now respects selected universe; full radial filters/closed-item semantics still require validation. |
| 12.5 | Partial | Gantt | Bars visible; demo clock fixed; date proposals local; full E2E interactions absent. |
| 12.6 | Partial | Navigation drag | Seven tabs and component tests; dedicated pointer/keyboard E2E absent. |
| 12.7 | Partial | Review dock | UI/replies/attachment names present; mutates arrays; no durable files or unread semantics. |
| 12.8 | Partial | Hover previews | Component tests pass; not every drillable target/integration checked. |
| 12.9 | Missing | Right-side confirmation panels | Centered modal/backdrop, native prompt, no hold confirmation and history stack. |
| 12.10 | Partial | Global cross-filter | Zustand present; dateRange unused; stats use unfiltered scoped collections. |
| 12.11 | Partial | Command palette and shortcuts | Palette present; complete keyboard/action/recent/scope acceptance outstanding. |
| 13 | Partial | Synthetic acceptance fixtures | Small synthetic CSV + exact procurement SQL oracle. Full 1,400-payment Meridian anomaly set/evidence package absent. |
| 14 | Partial | Legacy defect list closure | Core integrity defects corrected; calendar/admin/manual/public-link and legacy UI gaps remain. |
| 15 | Missing | Boardroom Studio | No feature route/toggle/deck implemented. |
| 16 | Partial | Future hooks only | Deferral appropriate; data map/observer scaffolding incomplete; avoid ERP/OCR/audio expansion now. |
| 17-A | Partial | Gate A | TypeScript/unit/build/token/shrink and browser smoke pass; complete legacy accessibility/widget matrix remains open. |
| 17-B | Partial | Gate B | Authenticated bounded procurement path passes real Auth/API/browser and SQL gates. Full statistical methods/golden fixture/OET/report scope incomplete. |
| 17-C | Missing | Gate C | Pilot RLS passes; admin/graphs/support grants absent. Gate C is not satisfied. |
| 17-D | Missing | Phase D prerequisites | Do not start Kernel until A–C pass and verbatim v12 provided. |

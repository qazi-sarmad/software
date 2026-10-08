# Provio — implementation and acceptance ledger

## Product promise

Every important audit conclusion is explainable, reproducible and traceable to evidence. Deterministic BI owns calculations and gates. Humans own judgments, review, issuance and closure. Optional AI is restricted to report writing, disabled by default. Template reports require no model or paid inference.

This change delivers a **bounded procurement pilot**, not the full enterprise release. November 30, 2026 remains a target, not a production-readiness claim. Existing demo screens are explicitly labeled synthetic. The full original vision remains in scope through the milestones below; a screen, fixture or stub is not a completed capability.

## Implemented scope and acceptance status

Statuses: **V** implemented and verified; **U** implemented but not yet verified; **B** blocked by a dependency; **N** not implemented. Verification is limited to the evidence stated; hosted deployment remains unverified.

| Capability | Status | Evidence / boundary |
|---|---|---|
| Supabase Auth + sole SDK module | V | Real local GoTrue + PostgREST browser flow across preparer/reviewer/CIA/observer; hosted deployment unverified |
| Entity/tenant RLS and scoped commands | V | `supabase/tests/trust.sql`: two tenants, unassigned entity, observer, admin, denied raw writes |
| Transactional revisions, version conflicts, idempotency | V | PostgreSQL state + event commit together; failures roll back; retry key payload checked |
| Concurrent commands | V | Two concurrent duplicate creates produce one event; stale concurrent evidence mutation rolls back with VERSION_CONFLICT |
| Immutable evidence bytes and server SHA-256 | V | Private Postgres evidence table, 10 MB cap; original bytes hashed server-side; direct mutations denied |
| CSV population import, exact reconciliation | V | Positive payments, integer minor units, unique row IDs, dates, mandatory fields, 1–1,000 rows; exact total required |
| Reproducible procurement BI | V | Exact flagged row/rule sets for duplicate invoice, same-user creation/approval, missing tax ID, split-payment candidates |
| Real row testing and pre-flight | V | Census of all imported rows; notes + evidence for every result; exceptions require five-part findings |
| Independent review, sealing, issuance | V | Different reviewer/preparer; sealed/submitted testing immutable; CIA issues frozen report |
| Issued-only register and linked remediation | V | Draft findings do not enter register; failed/passed retests retained; independent successful retest required for closure |
| Complete per-case export | V | Browser downloads history + original evidence, verifies exact byte hashes and frozen report; standalone offline verifier included |
| Optional AI payload preparation | V | Allow-listed aggregate labels, strict independent schema, partition suppression; unit tests; no outbound adapter |
| AI authorization/destination policy and operation logging | B | Provider/policy not selected; transmission fails closed. Preview is local only, no claim of anonymity |
| Existing UI preservation and bundle splitting | V | Seven tabs retained, inspectors lazy loaded; build below 500 kB; synthetic demo is distinct from authenticated records |
| Statistical sampling, MUS, strata/manual floors | N | Pilot uses explicitly disclosed census; no claim of statistical inference |
| XLS/XLSX parser and browser worker ingestion | N | Pilot accepts UTF-8 CSV only |
| Supabase Storage/public one-use evidence requests | N | Pilot uses private DB bytes; no external auditee route in authenticated mode |
| Production onboarding, invitations, MFA/SSO | N | Operator provisions users/assignments; production recovery flows and enterprise identity still required |
| Reopening sealed work / post-issuance report corrections | N | Fail closed; amendments need a new linked version workflow |
| Full historical reconstruction UI | N | Complete snapshots are exported; existing demo scrubber is not a production replay system |
| Backup restoration and disaster recovery | V | Local pg_dump/pg_restore into separate DB preserves event/evidence hashes; hosted recovery, retention and SLA remain unverified |
| Annual SIRA, annual plan, admin/config, Boardroom | N | Existing demo prototypes do not count as authenticated modules |
| Phase D Kernel | B | Gates A–C incomplete; verbatim v12 node registry absent; no invented registry |

## Pilot operating boundaries

- One engagement is one scoped audit case. All child rows, findings, report and remediation reference that case. Immutable revisions preserve every committed snapshot; replacing a draft population clears current results/findings but preserves old revisions.
- Evidence is stored in a private Postgres table for the bounded pilot. This is Supabase persistence, not a browser cache. It increases database/backup usage; migrate to private Storage with server verification and retention controls before scaling. MIME labels are not malware scans. Treat downloaded files as untrusted.
- Population source-file digest is a **preparer attestation**. The server independently validates and hashes parsed rows and evidence bytes. Neither hash proves the source is complete/truthful; reconciliation uses an independently obtained total entered by the preparer, and the reviewer must examine provenance.
- Currency supports a two-decimal minor-unit model only; no FX, negative/credit amounts, mixed currencies or zero-/three-decimal currencies. Do not use this pilot on unsupported populations. Split-payment rule is fixed at 1,000,000 minor units per vendor/date, and generates candidates, not proven violations.
- Pilot queries page events, cases, entities and memberships. Add server-side search, summary projections and capacity limits before large deployments. Full snapshots multiply storage with each mutation; normalize/version population and result sets before large-volume monitoring.
- Per-case chains preserve scoped confidentiality. They are not a single organization-wide chain. Exact `committed_text` UTF-8 bytes are normative for SHA-256; do not reserialize to verify. Preserve a separately trusted head to detect tail deletion. Database operators remain privileged; external anchoring/WORM retention is future work.
- Report template `procurement-v1` freezes findings, population manifest, conclusion, reviewer/issuer and source version. Later remediation does not rewrite it. Export includes source history and evidence bytes; retain it securely.
- Commands use Auth-derived actor, entity assignments, expected version and UUID retry keys. No caller-provided role or `verified=true` is accepted. Unknown command responses may safely retry the identical payload/key. Reload after version conflicts.
- Membership/entity provisioning is intentionally operator-only. There is no self-service elevation or customer provisioning UI. Document and audit production access administration before onboarding customers.

## Next engineering milestones (dependency ordered)

1. Finish the pilot's observed acceptance failures and production Auth/recovery gates. Add automated CI gates and test fixtures for two-tenant API traffic; preserve required token/shrink/unit/browser checks.
2. Normalize immutable population/sample/result revisions; implement specification-correct statistical floors, MUS, strata and manual selection validation. Add versioned control/risk/obligation links and independent financial oracles. Broaden import formats only with parser/worker limits and exact reconciliation.
3. Private Storage + one-use public evidence requests, server byte verification, request quotas, malware handling, expiry/revocation, cleanup and accessible keyboard flows. Preserve all existing evidence references during migration.
4. Access administration, MFA/SSO, retention/deletion/legal hold, backup/restore rehearsal, tenant quotas and organization configuration. Every configuration change needs the same actor/version/event discipline. Production cloud identity/network/storage integration must pass real checks.
5. Annual SIRA, plan approvals, resource/task scheduling and executive drilldowns using persisted scoped records. Shared versioned graph/config schemas precede editors; Kernel remains blocked until Gates A–C and v12 input exist.
6. Reopen/amendment workflow, historical views, export/import compatibility and independently anchored ledger heads. Ensure original issued versions remain immutable.
7. Add only customer-validated expansion modules after these acceptance gates.

## Seven expansion capabilities

| Capability | Model and acceptance gate | Commercial evidence needed |
|---|---|---|
| Connected evidence and conclusions | Versioned obligations → risks → controls → populations → tests → findings → reports → remediation; impact queries return exact dependants | Customers repeatedly use provenance during review/regulator requests |
| Continuous control monitoring | Approved source credentials, deterministic scheduled jobs, idempotent runs, versioned rules, exception owner/due date, deduplication and retry recovery | Demonstrated year-round usage and willingness to pay |
| Evidence reuse across frameworks | Reviewer-approved applicability covering scope, period, method, control and assurance level; validity expiry and exceptions; invalidate dependants on change | Measured reduction in duplicate requests; never promise “test once satisfies all” |
| Industry packages | Versioned controls/procedures/BI/templates/regulatory maps, jurisdiction/effective dates and qualified content review | One repeatable segment-specific paid implementation |
| Verified remediation | Extend pilot with action owners/due dates, recurring-failure linkage and retest windows; measure recurrence | Management uses validated closure as an operating metric |
| Enterprise integration and migration | Stable scoped API/exports, import mapping/reconciliation, selected ERP connectors and SSO; permissions, retry and rollback tests | Design partners name required systems and migration acceptance |
| Customer AI-system governance | Later inventory, control reviews, evaluation evidence and remediation; keep Provio decisions deterministic | Named funded buyer and explicit assurance use cases |

## Commercial execution (no outreach performed)

Start with internal-audit teams in **one reachable regulated industry and one jurisdiction**. Procurement/payments is the first demonstrable workflow. Large banks can inform design; avoid making every procurement requirement a first-release dependency.

Recruit 3–5 design partners. Record workflow, buyer, deployment/security constraints and paid-pilot terms. Each pilot requires a baseline and agreed acceptance thresholds for hours spent chasing evidence, audit completion time, reproducibility, review rework and remediation validation. Measure improvement before marketing claims. A free trial without an identified buyer or success criteria is weak demand evidence.

Packaging hypotheses: core subscription (audits, deterministic tests, evidence, reports, remediation); expansion modules (monitoring, mappings, industry packs, integrations); enterprise complexity/deployment/support; separately scoped migration/training. Make occasional evidence providers/action owners easy to include. Validate pricing with buyers; do not rely exclusively on auditor seats.

Illustrative ARR arithmetic: 100 × $20k = $2m; 1,000 × $100k = $100m; 10,000 × $100k = $1bn. These are not market forecasts or validated prices. Revenue, valuation and founder wealth differ. Track paid conversions, retention, expansion, gross margin and acquisition effort together with product quality.

Use free allowances for development; production contracts must cover hosting, storage, backups, support and optional inference. Customer-managed deployments require upgrade/support budgets even when AI is off. Keep complete exports and documented APIs. Expand globally by supported jurisdiction/industry with validated terms, currencies, dates, accessibility and support capacity.

## Release definition

Never mark a module complete from its screen alone. Require useful happy/failure paths, server-enforced authorization/invariants, durable data, accessible interaction, reproducible outputs, acceptance evidence and accurate limitations. No billion-dollar, zero-cost, global-compliance or production-readiness guarantee follows from this implementation.

## Change preservation

The pre-edit line-count inventory is retained in task validation context. `AppContext.tsx` changed from 586 to 566 lines (3.4% smaller) because the unsafe demo finalization, auto-created draft issues and unrestricted CAP setter were removed. The authenticated transaction implements the supported finalization/issuance path. No existing tab or archive was removed. The repository's original shrink baseline check still passes. Ledger edits replace the non-cryptographic fallback and incomplete field hashing with fail-closed hashing of all displayed committed fields.

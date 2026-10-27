# Full-codebase audit against git, all branches and all remotes

Date: 2026-10-27 (sandbox clock; the brief said 2026-10-26 — the brief is stale by ~1 day).
Method: every claim below was checked against a real ref with `git show` / `git grep` /
`git ls-tree`. Where a claim is about a hosted/CI-only state, the run id is named.

## 0. The brief's own premises were stale. Read this first.

| Brief said | Reality (verified) |
|---|---|
| Branch tip `ea9044d`; commits not in main = `ea9044d`, `2390875` | `origin/main` has moved to **`491bd4a`**. PR **#13 merged the whole branch into main on 2026-10-26T05:30Z**. Branch tips are irrelevant now. |
| Only branches are the feature branch, `main`, `fix/tutorial-recorder-fixtures` | **Three branches the brief never mentioned exist and are large**: `feature/writing-engine` (+26), `feature/scale-harden-v1` (+59), `feature/security-harden-v1` (+70). Plus `docs/continuous-monitoring-in-scope` (PR #14 open). |
| "No work since 2026-10-25" | **False.** `main` received 4 commits on 2026-10-26/27, and **another agent is working right now** — CI run `40537536027` on `feature/scale-harden-v1` was `in_progress` at 16:05Z today. |
| "`src/components/writing/` does NOT exist", "`docs/SCALE-PLAN.md` was never created" | **True for `main`, false for the repo.** Both exist on `feature/scale-harden-v1` / `feature/security-harden-v1`. |

Branch topology (verified with `git merge-base --is-ancestor`):

```
feature/writing-engine (c45bb81)
  └── feature/scale-harden-v1 (c898269)        # SCALE-1, 59 ahead of main
        └── feature/security-harden-v1 (7749484)  # 70 ahead of main — superset of scale-harden
main (491bd4a)  ← PR #13 merged feature/board-ai-control-plane (f8d4cd3) on 10-26
```

## 1. False flags — rows the repo's own audit marks "Present" that do not exist

Source of the claims: `docs/COMPLETION-SPEC-AUDIT.md` on `origin/main` (160 `Present`, 9 `Partial`,
1 `Present (documented)`, 1 `**Missing**`). The `**Missing**` row is real: §2 "Sharing outside a
Universe". (An earlier count of "31 Missing" was a false positive — it matched the table's column
*header* `| Missing |`.)

| # | Audit row (claimed Present) | Verdict | Evidence |
|---|---|---|---|
| F1 | §24 **Separate login with mandatory MFA** | **FALSE** | Cited evidence `0031_platform_control_plane.sql` and `40_platform_control_plane.sql` contain **no** `mfa`/`totp`/`aal` token. `git grep -i "mfa\|totp\|aal2"` over `main` migrations+`src/` returns nothing. |
| F2 | §25.3 **MFA for platform admins** | **FALSE** | Same as F1. The other half of the row (encryption, secrets, access logs) is real (`0054` AES-256-GCM, `0005_logging`). |
| F3 | §25.6 **50,000-row acceptance** | **FALSE** | No 50,000-row generation on **any** branch. Largest `generate_series` on `main` is `100` (test 22). Cited `38_phase4_acceptance.sql` tests RLS isolation, not row volume. Cited "`src/lib/` + perf test" — **no perf test exists**. |
| F4 | §13.2 **AI self-hosted, off by default, …** | **FALSE** | `0087_remove_ai.sql` drops every AI table, function, trigger, cron job, registry row and right. Cited `supabase/tests/69_ai.sql`, `supabase/tests/76_ai_gateway_authorise.sql`, `src/components/admin/OrgAiPanel.tsx` are all **ABSENT** from `main`. |
| F5 | **AI shown read-only with a status message** | **FALSE** | Same removal. `OrgAiPanel.tsx` is gone. |
| F6 | §11.3 **Random/Systematic (Clopper-Pearson + FPC)** | **FALSE** | No Clopper-Pearson / beta-inverse / FPC maths anywhere. `0027_sampling_engine.sql` `get_sample_size` is `least(pop, greatest(base, ceil(pop*pct)))` — plain arithmetic. |
| F7 | §13.2 **hardware guidance documented** | **FALSE** | Cited evidence is `docs/NOT-DONE.md / docs`. `NOT-DONE.md` contains **no** mention of hardware; no hardware document exists on any branch. |
| F8 | §15.2 **1–3 templates per tenant** | **FALSE** | No `report_templates` table and no 1–3 limit anywhere. |
| F9 | §27.4 **reduced-motion** | **FALSE as cited** | Cited `src/index.css` and `src/styles/tokens.css` — neither contains `prefers-reduced-motion`. The only match is one `matchMedia` in `CapRadialTracker.tsx`. (Motion *springs* are real; reduced-motion is not a system rule.) |
| F10 | §25.5 **SOC 2/ISO/GDPR design readiness** | **Thin** | A single sentence in `SPEC-v10.md §25.5`; no artefact. Marked `Present (documented)`, which is at least honest about being observer-level. |
| F11 | §24 **Data-blind; proven by SQL tests** | Real | `60_platform_admin_blind.sql` etc. exist. |

Citation-integrity defect: of the file paths the audit names as evidence, four do not exist on
`main` — `supabase/tests/69_ai.sql`, `supabase/tests/76_ai_gateway_authorise.sql`,
`src/components/admin/OrgAiPanel.tsx`, and `0078_hosting_fit_migration.sql` (the real file is
`0069_hosting_fit_migration.sql`; `0078` is `0078_document_extraction.sql`). The audit also fails to
record the AI removal in the *other* direction: it still shows AI rows as Present after `0087`.

The audit is not updated when `main` changes. It was authored against the pre-`0087` tree and never
re-run. Treat its `Present` column as unverified.

## 2. Agreed-but-missing items recovered from memory

`.openhands/memory/` contains **nothing** about SCALE-PLAN, Canva-like UX, external timestamping,
50,000-user scale testing, or "best-in-class". The memory files cover only the tutorial recorder and
CI runs (2026-10-23/24/25). So these agreements are **not** recoverable from agent memory — but they
**are** being delivered on the parallel branches, which is where the agreement lives in practice.

| Agreement | Status | Where |
|---|---|---|
| **Security** | **BUILT, not merged** | `feature/security-harden-v1`: MFA gate `0100_platform_security.sql` (`require_platform_admin` refuses until `aal2`), SSO enforcement in the access-token hook, erasure `0101_data_lifecycle_crypto.sql`, crypto agility + key rotation `0101`, `docs/SECURITY-THREAT-MODEL.md` + `src/guards/threatModel.test.ts`, `docs/DR-RUNBOOK.md`, CSP + `public/_headers`, `scripts/load-test.mjs`, `docs/COMMERCIAL-MODEL.md`. **Zero of this is on `main`.** |
| **External timestamping (sha256)** | **BUILT, not merged** | `feature/security-harden-v1` `0096_integrity_anchoring.sql`: RFC 3161 timestamp authorities (FreeTSA, DigiCert, Sectigo), Ed25519 signing keys, signatures, `timestamp_queue`, trust anchors, `timestamp_dual` feature. `src/lib/anchoring.ts` builds the TimeStampReq parts and verifies the token. Only the SHA-256 hash leaves the tenant (L2). **Not on `main`.** |
| **Rigorous testing to 50,000 clients/users** | **PARTIAL — the headline gap** | What exists: `scripts/load-test.mjs` (8 orgs × 4 sessions concurrent RLS soak, **not wired into CI**), `src/lib/writing/scale.test.ts` (500-claim fixture, 63 ms), `103_scale_isolation.sql` (≥3 concurrent orgs). What does **not** exist: any 50,000-row or 50,000-user test, on any branch. The §25.6 acceptance figure is unbuilt everywhere. |
| **"Best-in-class"** | **Absent** | The phrase appears nowhere in any branch or in `git log --all --grep`. No artefact claims or delivers it. |

## 3. UX gap analysis

### 3.1 Canva-like human read/edit surfaces
- On `main`: **nothing**. `src/components/writing/` and `src/lib/writing/` have **0** files.
- On `feature/scale-harden-v1` / `feature/security-harden-v1`: **a real design canvas exists** —
  `src/components/writing/DesignCanvas.tsx`, `FormatCanvas.tsx`, `DesignPane.tsx`,
  `ReportFormatPanel.tsx`, `ReportBuilderPanel.tsx`, `FigureStudio.tsx`, plus the pure model
  `src/lib/writing/{canvas,designCanvas,colourMath}.ts` and `src/lib/render/designedPdf.ts`.
  Commits `d290a24` (page-design model), `f122f2c` (live page canvas with drag-reorder, colour
  pickers, undo/redo), `853c4b0` (PDF/DOCX print the designed page), `c5ff8de` (interactive design
  canvas). This is the "Canva-like" surface — it exists, it is just not on `main`.
- Functional-surface discipline: the repo does enforce data-testid + contract (not styling):
  `docs/ACP-UI-CONTRACT.md`, `scripts/check-ui-contract.mjs`, `src/guards/uiInventory.test.ts` +
  `uiContractDrift.test.ts`, and `docs/UI-INVENTORY.md` (93 screens, 107 RPCs) on the scale branch.

### 3.2 Self-hosting
- **No deployment artefact exists on any branch**: no `Dockerfile`, no `docker-compose.yml`, no Helm
  chart, no `k8s/`.
- What exists is a **configuration surface only**: `src/components/admin/OrgHostingPanel.tsx` offers a
  dropdown with `managed_postgres | self_managed | supabase_self_hosted | other`, and `SPEC-v10.md §3`
  states "the data module is designed to target either without changes to the application".
- So self-hosting is **claim-plus-dropdown, not a deliverable**. The spec sentence is plausible
  (one data module, `src/data/client.ts` is the single client), but nothing demonstrates a
  self-hosted deploy.

### 3.3 Screens
- Real: `docs/ACP-UI-CONTRACT.md` + `scripts/check-ui-contract.mjs` (48 Appendix A screens on main;
  the scale branch reports 48 and an inventory of 93 screens), `SuperAdminPortal` and its 13
  components, all routed in `App.tsx`, exercised by Playwright specs.
- The stale `docs/NOT-DONE.md` line 43 still says "Superadmin UI is Phase 8.1, owner-designed" —
  that is **wrong**; the Super Admin UI is built and tested. `NOT-DONE.md` is stale on `main`.

## 4. Live defect on `main` (not asked for, but it is red)

`main` @ `491bd4a` CI run **`40519338554` = failure**. Step "gates" fails at type-check:

```
src/lib/analytics.ts(68,5): error TS2353: Object literal may only specify known properties,
  and 'period' does not exist in type 'AnalysisResultRow'.
src/lib/analytics.ts(381,9): error TS2353: ... 'period' ...
```

Introduced by the owner's own commit `7b9bc07` ("Upgrade the analytics layer to support month-named
financial statements"). The new `period` / `periodLabel` fields are written into result rows but the
`AnalysisResultRow` type was never widened. `main` does not type-check.

Also on `main`: `docs/ACP-FEATURES.md` is tracked but **0 bytes**. `docs/REMAINING-BLOCKERS.md` says
"(No blockers recorded yet.)".

## 5. Branch/remote cross-reference (everything, including the unmentioned)

| Branch | Ahead of main | Behind | State | Notes |
|---|---|---|---|---|
| `feature/security-harden-v1` | **70** | 4 | unmerged, no PR | Most advanced. Superset of scale-harden. |
| `feature/scale-harden-v1` | **59** | 4 | unmerged, CI running now | SCALE-1; ⊂ security-harden. |
| `feature/writing-engine` | **26** | 4 | unmerged, no PR | Deterministic writing engine, W1–W15. |
| `docs/continuous-monitoring-in-scope` | 1 | 4 | **PR #14 OPEN** | docs only. |
| `fix/tutorial-recorder-fixtures` | 4 | 163 | **PR #12 OPEN** | Superseded — `main` already contains its fixes (`recorderFixtures.test.ts`, registry re-seed in `global-setup.ts`). |
| `feature/board-ai-control-plane` | 0 | 155 | **MERGED (PR #13)** | Local copy is 1 commit behind (`6f784ea` vs `f8d4cd3`). |
| `merge/coderabbit-pilot` | 8 | 340 | unmerged, Oct 12 | ancient |
| `feature/cap-due-date-change` | 2 | 374 | unmerged, Oct 5 | ancient |
| `coderabbit/application-qa-audit/56ea96a0` | 1 | 344 | **PR #4 CLOSED** | rejected |
| `feature/config-control-plane`, `phase-0…4`, `docs/phase1-decisions`, `docs/population-archival`, `feature/*-cap-*`, `feature/audit-file-v1`, `feature/radial-hover-fix`, `feature/batch-a-*` | 0 | — | fully merged | no unique content |

PRs: #1–#3, #5–#11, #13 merged; #4 closed; **#12 and #14 open**.
Repository visibility: **public** (`gh api` confirms `"private": false`).

## 6. Corrections to the brief's own "verified findings"

- "**No work since 2026-10-25**" — false. `main` moved twice (PR #13 on 10-26, four commits through
  10-27), and a live CI run was in progress today on a branch the brief did not know about.
- "**Audit counts: 160 Present, 1 Missing, 9 Partial**" — correct.
- "**Pasted UX doc is largely fabricated**" — half-right. `src/components/writing/` and
  `docs/SCALE-PLAN.md` do **not** exist on `main`, but they **do** exist on the unmerged branches, so
  the doc describes real work that simply is not on `main`.
- "**SuperAdmin UI is REAL**" — correct.
- "**Ledger hash chain is real**" — correct (`0005_logging.sql` `prev_hash`, `0006_invariants.sql`).
- "**No Clopper-Pearson math found**" — correct, and it is a false flag (F6).

## 7. Bottom line

1. Ten `Present` rows in the repo's audit are false or unverifiable, four of them security/scale
   claims (MFA ×2, 50,000-row, AI ×2, Clopper-Pearson, hardware guidance, templates, reduced-motion).
2. The "agreed-but-missing" security and external-timestamping work is **built on
   `feature/security-harden-v1` and never merged**. The 50,000-user scale requirement is **not built
   anywhere**.
3. "Canva-like" and self-hosting: the canvas is **built on the scale/security branches**; self-hosting
   is a **dropdown plus a spec sentence**, with no deployment artefact.
4. `main` is **red** (type error in `analytics.ts`) and its audit document is **stale in both
   directions**.
5. The brief understated the repo by three branches and one active agent. Any decision taken from the
   brief alone would have been wrong.

No secrets were printed, logged or written. No force push was used. Nothing was merged to `main`.

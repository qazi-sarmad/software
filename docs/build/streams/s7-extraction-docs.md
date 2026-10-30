# Stream S7 — extraction + document/minutes/policy surfaces (`feature/build-extraction`)

Cut from the trunk after the mount points. Owns the extraction module at its final path
`src/lib/systeligon/extract/**` (the module is already there; no move remains),
`src/components/documents/**`, and the `docreview-` / `minutes-` / `policydiff-` / `extract-` testids.
Migrations `0189`–`0198`.

## Scope
Mount the S7/S8/S9/S14/S15 engine surfaces (F130–F136 are S1's rule data; S7 owns the SCREENS that
reach them), so a document / minutes / policy run is reachable. Coordinate with S1 on the scope
selector (S1 owns `RuleRunTab`; S7 owns the document surfaces).

## Rows
F130 (structured extraction tier 3 — mount `parseDocumentStructure`), F131 (OCR seam tier 2 — mount
`runOcr`), F133 (structural document rules screen), F135 (minutes action register screen),
F136 (policy/procedure comparison screen), F92 (guided zero-to-first-report wizard, if in scope here).

## Queue
1. Baseline + tree whole.
2. Mount `parseDocumentStructure` (F130) and `runOcr` (F131) behind a document-review screen; the OCR
   engine stays bundled and REFUSES a remote engine (nothing leaves the tenant).
3. Mount the document rules (F133), the minutes register (F135) and the policy diff (F136).
4. The zero-to-first-report wizard path (F92) if the mount points give it a slot.
5. Scale: a document run over a large document set (SCALE-PROGRAMME §5 flow 7, document scope).

## Flows (happy + bad)
- Extraction: happy — a parsed document reports its coverage; bad — a document with no text layer
  routes to OCR; a `.rar` is recognised and reported as unlistable, never silently dropped.
- Document rules: happy — a finding cites the rule + the clause; bad — an unparsed clause is reported
  as could-not-interpret, never as clean.
- Minutes register: happy — carried/vanished/closed-no-evidence tracked; bad — a closed item with no
  evidence is a finding.
- Policy diff: happy — matched clauses shown; bad — an unmatched clause is not a pass.

## Acceptance
- F130/F131/F133/F135/F136 each reachable from a screen with a test.
- The OCR engine refuses a remote engine; no data leaves the tenant.

## Status
| Row | Was | Now | Call site | Test | Migration | Commit |
|---|---|---|---|---|---|---|
| OA-39 global document search | Absent | Wired | `src/components/documents/GlobalSearchPanel.tsx` mounted via `RecordContent.tsx` inspector `global_search`, reached from the palette action `action.global_search` (`src/lib/commandPalette.ts`) | `src/components/documents/GlobalSearchPanel.test.tsx` (8), `supabase/tests/136_global_document_search.sql` | `0190_global_document_search.sql` | `d300cac` |
| OA-36 documents/minutes/policy review | Built, unmounted | Wired | `src/components/documents/DocumentReviewPanel.tsx` mounted in `AuditFileModal.tsx` `phaseView === 'documents'` (engagement id) | `src/components/documents/DocumentReviewPanel.test.tsx` | `0189_document_review.sql` | _this commit_ |
| OA-38 ad-hoc review builder | Built, unmounted | Wired | `src/components/documents/AdhocReviewPanel.tsx` mounted via `RecordContent.tsx` inspector `adhoc_review`, reached from the palette action `action.adhoc_review` | `src/components/documents/AdhocReviewPanel.test.tsx` | — | _this commit_ |
| F130 structured extraction tier 3 | Inert | Wired | `DocumentReviewPanel.tsx` calls `parseDocumentStructure` (mounted OA-36) | `DocumentReviewPanel.test.tsx` | — | _this commit_ |
| F131 OCR seam tier 2 | Inert | Wired | `DocumentReviewPanel.tsx` calls `needsOcr`/`runOcr` (mounted OA-36) | `DocumentReviewPanel.test.tsx` | — | _this commit_ |
| F135 minutes action register | Inert | Wired | `DocumentReviewPanel.tsx` calls `buildActionRegister` (mounted OA-36) | `DocumentReviewPanel.test.tsx` | — | _this commit_ |
| F136 policy comparison | Inert | Wired | `DocumentReviewPanel.tsx` calls `compareDocuments` (mounted OA-36) | `DocumentReviewPanel.test.tsx` | — | _this commit_ |
| F133 structural document rules (S8) | Inert | Wired | `DocumentReviewPanel.tsx` runs the `structural` review option, whose `documentRules` reach the engine via `src/lib/systeligon/extract/reviewOptions.ts` (mounted OA-36) | `DocumentReviewPanel.test.tsx` ('runs the structural document rules when that option is selected') | — | _this commit_ |
| F92 guided zero-to-first-report wizard | Absent | Absent (out of S7 scope) | — the mount points give it no slot; it is SA-01's (S4) surface | — | — | — |

## D16 standards distribution — Super Admin rollout to paying tenants

Owner instruction 2026-10-30: *"for all the standards now incorporated, make it so that such updates
can be rolled out through the super admin (for all those that pay)."* Spec: `docs/STANDARDS-DISTRIBUTION.md`.
Every rule base the product ships becomes a signed, versioned, distributable **pack**; the platform
rolls a pack version out to entitled tenants; a tenant that does not pay is skipped and recorded.

| Row | Was | Now | Call site | Test that proves it | Migration | Commit |
|---|---|---|---|---|---|---|
| D16 standards pack build/sign/verify (pure) | Absent | Built | `src/lib/systeligon/standards.ts` (`buildStandardsPack`, `standardsPackContentHash`, `signStandardsPack`, `verifyStandardsPack`, `STANDARDS_CATALOGUE`) | `src/lib/systeligon/standards.test.ts` (14) | — | _this commit_ |
| D16 publish + rollout + pin (data) | Absent | Built | `src/data/standards.ts` (`publishStandardsPack`, `rolloutStandardsPack`, `pinStandardsVersion`, `buildSignedStandardsPack`) | `supabase/tests/137_standards_distribution.sql` (37), `src/lib/systeligon/standards.test.ts` | `0191_standards_distribution.sql` | _this commit_ |
| SA-21 Super Admin standards surface | Absent | Wired | `src/components/superadmin/SuperAdminStandards.tsx`, tab `standards` in `SuperAdminPortal.tsx` | `src/components/superadmin/SuperAdminStandards.test.tsx` (10) | — | _this commit_ |

### What the surface does (SA-21, contract §SA-21)

- The catalogue lists every pack the spec names with its discipline, sources and published version;
  a pack with no released rules reads `not published` (the forensic core is the only shipped one).
- **Publish** signs the shipped rule library with a fresh platform key (`generateSigningKey` →
  `registerPlatformSigningKey` → `buildSignedStandardsPack` → local `verifyStandardsPack` →
  `publishStandardsPack`). A pack that does not verify locally, or has no released rules, is refused
  with its reason and never published.
- **Roll out** sends the chosen pack version to the chosen tenants and shows the per-tenant outcome
  (`applied` / `skipped-not-entitled` / `skipped-pinned`), never a green tick that is not true.

### The paying gate (spec §3.2)

`standards_rollout` asks `feature_enabled_internal(org, pack_id)` per tenant: a published pack is a
`feature_catalogue` row (`price_class = 'add_on'`, seeded by the publish RPC), and a tenant without the
entitlement is `skipped-not-entitled` with a `standards_rollout_log` row and **no** subscription row
(no partial write). The internal entitlement function is used because this is a platform RPC asking
about another org; `has_feature` is the request-scoped wrapper around exactly that function
(0084 §3 / 0094 precedent). That also keeps the `featureMapCompleteness` guard total, since the pack
key is a tenant-chosen catalogue key and cannot be a static map entry.

## Branch counts (locked, this session)

- vitest: **291 files / 3,359 tests green** (`npx vitest run`).
- SQL harness (`bash scripts/local-sql-harness-docker.sh`): green — "migrations applied twice /
  all SQL tests passed twice"; **131 migrations / 137 SQL test files**.
- Guards: **30** (`src/guards/*.test.ts`), 1,002 tests.
- `tsc --noEmit` clean.
- Gates PASS: check-wiring, check-dead-code, check-ui-contract, check-two-sources, check-tokens,
  check-shrink, check-config-effect, check-rpc-parity, check-function-deploy-list, check-tutorials,
  check-feature-register (145 features: 118 Wired / 6 Inert / 21 Absent).
- `docs/UI-INVENTORY.md` regenerated: **112 screens / 148 RPCs**.

### Register rows moved (integrator action — done this session)

`docs/FEATURE-REGISTER.md` rows F130/F131/F133/F134/F135/F136 moved `Inert` → `Wired` with real call
sites, and §14 counts updated to **100 Wired / 21 Inert / 24 Absent** (145 total). `check-feature-register`
now PASSES (it was the only RED gate). F133's staleness was invisible to the gate's rule (6) because the
screen reaches `documentRules` through `reviewOptions.ts` (a lib module), not by a direct call; it is
corrected here on the same evidence.

### Old blocker note (superseded)

`node scripts/check-feature-register.mjs` was RED with 9 problems, all rule (6): the register rows
F130/F131/F135/F136 still say `Inert` with the evidence "**No screen calls `parseDocumentStructure`**"
(and `needsOcr`/`runOcr`, `buildActionRegister`, `compareDocuments`), but the now-mounted OA-36 screen
calls each. `docs/FEATURE-REGISTER.md` is the integrator's file (§6), so the fix is the integrator's:
flip F130/F131/F135/F136 to `Wired` with the call site `src/components/documents/DocumentReviewPanel.tsx`
and the test `src/components/documents/DocumentReviewPanel.test.tsx`, then update the §14 counts. The
gate was already red before this session's commits (proved: `git stash -u` → PASS; with the untracked
S7 panel → FAIL), so the red is the S7 stream's own unmounted work, now mounted, awaiting the register
row move.

F133 (structural document rules) is **also** stale-Inert but the gate does not flag it: the screen
reaches `documentRules` through `src/lib/systeligon/extract/reviewOptions.ts`, and the gate's rule (6)
only inspects UI files for a direct reference. The row should move to `Wired` on the same evidence —
the new panel test `runs the structural document rules when that option is selected` proves a
`doc.absent_follow_through` finding reaches the screen.


## Scale
- `src/lib/systeligon/extract/documentScale.test.ts` — the document-scope run at volume (SCALE-PROGRAMME
  §5 flow 7): 2,000 documents from a fixed-seed LCG, both paths. Proves (a) determinism — two runs are
  byte-identical; (b) coverage is reported, never rounded (`parsed + uninterpreted == lines` for every
  document); (c) the declared-type check catches every filed-as-minutes-reads-as-regulation document;
  (d) the bad path — a scan (no text) is `unconfirmable`, never a clean document; (e) a budget ceiling
  with the measured value logged. Green: 5 tests.

## Decisions
- **OA-36/OA-38/OA-39 mount path.** The seven-tab NavStrip is fixed by SPEC-v10 §5 and the trunk owns
  it, so the S7 screens are mounted without adding a tab: OA-36 joins the engagement's `documents`
  phase inside `AuditFileModal`; OA-38 and OA-39 are reached from the command palette
  (`Cmd/Ctrl-K`) through the `global_search` / `adhoc_review` inspector surfaces in `RecordContent.tsx`.
  Each is registered in `src/nav/registry.ts` as `mounted`.

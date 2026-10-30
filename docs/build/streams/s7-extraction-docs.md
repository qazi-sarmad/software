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

## Branch counts (locked, this session)

- vitest: **289 files / 3,329 tests green** (`npx vitest run`).
- SQL harness (`bash scripts/local-sql-harness-docker.sh`): green — "migrations applied twice /
  all SQL tests passed twice"; **130 migrations / 136 SQL test files**.
- Guards: **30** (`src/guards/*.test.ts`).
- `tsc --noEmit` clean.
- Gates PASS: check-wiring, check-dead-code, check-ui-contract, check-two-sources, check-tokens,
  check-shrink, check-config-effect, check-rpc-parity, check-function-deploy-list, check-tutorials.
- Gate RED: `check-feature-register` (9 rule-(6) problems) — integrator's file, see the blocker above.

### Blocker for the integrator (owner action)

`node scripts/check-feature-register.mjs` is RED with 9 problems, all rule (6): the register rows
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

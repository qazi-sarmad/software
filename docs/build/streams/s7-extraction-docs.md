# Stream S7 — extraction + document/minutes/policy surfaces (`feature/build-extraction`)

Cut from the trunk after the mount points. Owns the extraction module (moving `src/lib/extract/**` to
`src/lib/systeligon/extract/**`), `src/components/documents/**`, and the `docreview-` / `minutes-` /
`policydiff-` / `extract-` testids. Migrations `0189`–`0198`.

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

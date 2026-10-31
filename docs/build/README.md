# The concurrent build — index

Owner instruction 2026-10-30: prepare everything for the builder, on separate branches with separate
documents, covering all flows (happy and bad), 50,000 users / 5,000 entities, plus a design branch.

## The documents, and who reads what

| Document | Who reads it | Who edits it |
|---|---|---|
| `docs/build/BUILD-PROMPT.md` | **every** build session (paste it in) | the integrator |
| `docs/build/OWNERSHIP.md` | every session (the concurrency rule) | the integrator |
| `docs/build/SCALE-PROGRAMME.md` | every session (the scale rigour) | the integrator |
| `docs/build/streams/<stream>.md` | **one** session — that stream's | that stream only |
| `docs/design/CONTRACT.md` | the build streams (read-only) | the design agent |
| the per-topic specs (`RISK-ASSESSMENT-MODEL.md`, `STANDARDS-DISTRIBUTION.md`, `AUDIT-DOMAINS-MODEL.md`, `ASSURANCE-RULEBOOKS.md`, `PAKISTAN-ASSURANCE-REGIMES.md`, `SYSTELIGON-REMAINDER-BUILDER-PROMPT.md`) | the stream that needs it | the integrator |
| the verified sources (`Shariah Standards-AAOIFI.pdf`, `COMPENDIUM … SBP.pdf`, `SHARIAH GOVERNANCE FRAMEWORK.pdf`, `Risk Assessment, reimagined.pdf`) | read-only | nobody |

## The concurrency rule, in one line

**Two branches never write the same file.** `OWNERSHIP.md` assigns every file, migration range and
`data-testid` prefix to exactly one stream; a stream that needs another stream's file reads it and
requests a change, never edits it. The shared ledgers (`FEATURE-REGISTER.md`, `SCALE-TASKS.md`,
`SYSTELIGON-GAP-REPORT.md`) are the **integrator's** — a stream writes only to its own
`docs/build/streams/<stream>.md`.

## The one serial step

The integrator creates the **mount points** (`OWNERSHIP.md` §4) on the trunk once, then the streams
branch. Everything after that is parallel.

## The branches

| Branch | Stream |
|---|---|
| `feature/systeligon-builder-continuous` | TRUNK / integrator |
| `design/language-v1` | DESIGN |
| `feature/build-core-engine` | S1 |
| `feature/build-assurance-caps` | S2 |
| `feature/build-risk-planning` | S3 |
| `feature/build-platform-control` | S4 |
| `feature/build-monitor-runtime` | S5 |
| `feature/build-config-honesty` | S6 |
| `feature/build-extraction` | S7 |

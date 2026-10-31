> ## ⚠️ STALE — ARCHIVED, DO NOT TRUST
>
> This document predates the code-verified audit of 2026-10-27/28 and is kept for history only.
> Its status claims are **not** reliable: the audit found the app was not database-backed in
> production, the engagement lifecycle was never persisted, several documented-as-Present features
> were dead code, and many "all Present" claims were false.
>
> **Current sources of truth:**
> - `docs/SPEC-v10.md` — the specification (unchanged, still authoritative)
> - `docs/FUNCTIONALITY-AUDIT.md` — what is actually built (code-verified)
> - `docs/REMEDIATION-PLAN.md` — the plan being executed
> - `docs/SCALE-TASKS.md` — live task ledger
>
> Do not cite this file as evidence that anything works.

# Tutorial recording failures

Date: 2026-10-24

Purpose: record each tutorial recording failure with the key, the timings observed and
the CI run id, so the cause can be found without guessing. The 20-second wait is not
raised to make a failure disappear; a failure is recorded and its cause fixed.

## Failures

| Key | Run id | Commit | Wait before failure (s) | Screenshot reached | Error |
| --- | --- | --- | --- | --- | --- |

## Keys that timed out

| Key | Run id | Timings | Note |
| --- | --- | --- | --- |

## Resolved

| Key | Run id | Cause | Fix commit |
| --- | --- | --- | --- |

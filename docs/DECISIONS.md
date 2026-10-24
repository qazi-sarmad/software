# Decisions

Date: 2026-10-24
Owner: Qazi Sarmad Ali Mahesar

This file records decisions taken while the build was in progress, each with the
reason and the reversal path. It is appended to, never rewritten.

## D-CI-1. CI runs on pushes to the build branch

- Decision: `.github/workflows/ci.yml` triggers on pushes to `main` and
  `feature/board-ai-control-plane`, as well as on pull requests and manual dispatch.
- Reason: the workflow previously triggered only on `main` pushes, pull requests and
  dispatch. Pull request #11 is merged and no pull request is open, so a push to the
  build branch started no run. Every task's rule that "its own CI run is green" could
  not be satisfied.
- Reversal path: remove `feature/board-ai-control-plane` from the `push.branches` list
  once the branch is merged, leaving `main`, `pull_request` and `workflow_dispatch`.

## D-CI-2. Step 9 reads the TEST_ secrets

- Decision: the screenshot sweep reads `TEST_SUPABASE_URL`,
  `TEST_SUPABASE_SECRET_KEY` and `TEST_SUPABASE_PUBLISHABLE_KEY`.
- Reason: step 9 asked for `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and
  `SUPABASE_ANON_KEY`. None of those exist as repository secrets, so all three arrived
  empty, the seed script threw, and the sweep hung until the job timeout cancelled the
  run.
- Reversal path: none needed; the TEST_ names are the ones the rest of the workflow
  already uses.

## D-T6-T12. Identity, plans, security, structure, risk, plan and lifecycle are closed

- Decision: T6 identity and roles, T7 features and plans, T8 security hardening, T9
  structure (except cross-universe sharing), T10 risk, T11 plan and deployment, and T12
  engagement lifecycle are closed as already present.
- Evidence: `docs/PARITY.md` marks the corresponding sections Present, and the migration
  set contains the schema and RPCs for each: identity `0015`, `0017`; features and plans
  `0031`, `0065`; RLS and rights `0008`, `0009`, `0012`, `0016`, `0046`, `0050`; SIRA
  and risk `0019`, `0020`; plan and deployment `0021`, `0022`, `0025`, `0026`; lifecycle
  `0027`, `0034`. There are 86 migrations and 93 SQL test files.
- Consequence: future work on those areas is limited to the real remaining deltas, and
  no duplicate migration is added to the shared hosted test project.
- Reversal path: if a delta is later found, it is opened as its own task with its own
  migration number and test.

## D-AI. The full AI purge is suspended

- Decision: the full AI purge (the earlier T5) is suspended. AI removal requires an
  explicit later owner decision to override §13.
- Reason: §13 "Document Review and AI" is Present in `docs/PARITY.md` and is built
  (`0078`, `0059`, the `doc-extract` function, `src/data/ai.ts`,
  `src/components/common/AiAssist.tsx`). A full purge would remove a shipped section.
- Consequence: no new AI is added by any task; the standing hard ban on AI in new work
  still applies.
- Reversal path: an explicit owner decision to override §13, taken as its own task with
  its own tests.

## D-SPEC. SPEC-v10 ends at §32

- Decision: `docs/SPEC-v10.md` currently ends at §32. Any new decisions section is added
  as §33, or as a dated block, without renumbering §§1–32.
- Reason: the specification's last section is "32. Open Items"; there is no §33.
- Reversal path: none; numbering is append-only.

## D-VOCAB. The vocabulary, phrasing and writing-styles module stays in scope

- Decision: the extensive default Vocabulary, Phrasing and Writing-Styles module remains
  in scope for the report engine.
- Reason: it is a first-class, versioned, hash-chained part of the report engine, and
  ships with every new organisation.
- Reversal path: none recorded; scope was set by the owner.

## D-SHARE. Cross-universe view-only sharing is the highest-priority remaining gap

- Decision: §2 cross-universe view-only sharing is the highest-priority remaining
  functional gap. The shared object is the risk-model layer only (risk library,
  methodology scales, the versioned scoring model, cycles and published results).
  Findings and other engagement work product remain visible only through their
  engagement, and are never shared.
- Reason: `docs/PARITY.md` and `docs/COMPLETION-BLOCKERS.md` record §2 as the only whole
  clause with no implementation.
- Reversal path: the owner may amend §2 to defer the clause instead of building it.

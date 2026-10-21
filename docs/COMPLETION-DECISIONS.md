# Completion build decisions

Numbered, one entry per decision: number, task, point, options, choice, reason, how to reverse.
Classes: FIXED (implemented as written in the task), NEVER IMPROVISE (not decided here),
IMPROVISE-THEN-DOCUMENT (this file).

## D-C0-1 — baseline counts come from the last green CI run, not from a local run (C0)

- Task: C0.
- Point: which numbers later counts are compared against.
- Options: (a) the counts printed by a local run; (b) the counts the task supplies from the last
  green CI run 39516753943 at head `a41d46e`.
- Choice: (b). A local run at the same commit reproduced vitest 128 files / 1428 tests exactly, so
  the two agree; the task's numbers stay authoritative.
- Reason: CI is the recorded truth; the local run is a cross-check.
- Reverse: none needed; the numbers are historical facts.

## D-C0-2 — the four completion docs are created in C0 and committed alone (C0)

- Task: C0.
- Point: the task says "no commit except the empty docs files".
- Choice: one commit `docs: completion run start (C0)` containing only
  `docs/COMPLETION-PROGRESS.md`, `docs/COMPLETION-DECISIONS.md`, `docs/COMPLETION-BLOCKERS.md` and
  `docs/COMPLETION-REPORT.md`.
- Reason: the instruction is explicit; the docs are the running record the rest of the run appends to.
- Reverse: delete the four files.

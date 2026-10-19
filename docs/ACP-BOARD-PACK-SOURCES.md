# Board Pack sources (F10, S7)

Every figure in a Board Pack is an object `{ value, refs: [{ type, id }] }`. This document states, for
each input, exactly which records feed the figure and which are excluded. The rule is enforced in the
database: `board_pack_figure_refs(snapshot)` returns the path of every non-zero figure whose `refs`
array is empty, `board_pack_generate` refuses to write a pack when that list is non-empty, and SQL test
71 fails on it. A zero figure is allowed to carry no refs: there is nothing to point at.

Only records in a sealed, approved, issued, published or ledgered state feed a figure. Anything else is
counted in `excluded` and shown as a footnote ("n items not yet sealed are not included").

## Section 1 — Cover and assurance statement

- Figures: none. The section carries the pack title, the generation timestamp and the `data_hash`.
- Sources: the `board_pack_history` row itself and its ledger entry (`board_pack_generated`, F20).

## Section 2 — What changed since the last pack

- Figures: the delta computed by `deltaAgainst(previousSnapshot, snapshot)` in `src/lib/boardPack.ts`.
- Sources: the previous `board_pack_history` row with the same `scope_key` (via `previous_pack_id`)
  and the current one. No business record feeds this section directly; it compares two snapshots.
- Excluded: nothing. When there is no previous pack the delta is empty and the screen says
  "No previous pack: this is the first."

## Section 3 — SIRA residual risk and heatmap

- Figure: `sira.bands[i].value`, one per residual-risk band.
- Sources: SIRA assessment rows in a sealed state for the scope, grouped by residual band.
  `refs` are `{ type: 'sira_score', id }` for each contributing assessment.
- Excluded: assessments that are draft or in review; their count is added to
  `excluded.unsealed_sira`.

## Section 4 — Audit plan progress and Gantt

- Figures: `plan.value` (total plan items) and `plan.by_status[i].value` (per status).
- Sources: plan-item rows belonging to engagements in the scope. `refs` are
  `{ type: 'plan_item', id }`. The Gantt data is read from the same rows (start and due dates).
- Excluded: plan items on an engagement that is not yet approved; counted in
  `excluded.unapproved_plan_items`.

## Section 5 — Open issues and CAP aging by severity

- Figures: `cap[<band>].value`, one per aging band (0-30, 31-60, 61-90, 90+, not_due, no_due_date).
- Sources: open CAP rows in the scope, banded by `orgDate`-aware aging. `refs` are
  `{ type: 'cap', id }`.
- Excluded: CAP rows that are closed or superseded; counted in `excluded.closed_caps`.
- Note: the band boundaries are configurable; the snapshot records the bands it used.

## Section 6 — Sealed work and integrity

- Figures: `sealed_work.value` (sealed workpaper count) and `sealed_work.sealed_engagements.value`.
- Sources: sealed workpapers and sealed engagements. `refs` are `{ type: 'workpaper', id }` and
  `{ type: 'engagement', id }`. `sealed_work.root_hashes` carries the engagement root hash(es) read
  from the ledger, never recomputed.
- Excluded: unsealed workpapers and unsealed engagements; counted in
  `excluded.unsealed_workpapers` and `excluded.unsealed_engagements`.

## Section 7 — Management responses

- Figure: `management_responses.value`.
- Sources: published management-response blocks on issued reports. `refs` are
  `{ type: 'report_block', id }`.
- Excluded: response drafts; counted in `excluded.draft_responses`.

## Section 8 — Sources index

- Figures: none. It lists every figure above with its `refs` count and the `excluded` footnote.
- Sources: the snapshot itself.

## Determinism and hashing

- `board_pack_snapshot` is deterministic: object keys are built in a fixed order and arrays are sorted
  by a stable key, so the same underlying records always produce the same canonical JSON.
- `data_hash` = `encode(digest(canonical_json, 'sha256'), 'hex')`, computed in the database inside
  `board_pack_generate` and stored on the history row. The ledger entry and the public verification
  page (F11) use this same value.
- `file_hashes` (per output format) are computed in the browser after rendering, because the file
  bytes exist only there.
- No AI contributes to any figure, ref, hash or delta (L1).

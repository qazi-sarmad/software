# WP-IMPORT — the migration path for real client IA history

**Status:** plan, implementation-ready. Not yet built.
**Why it is near the front of the queue:** it unblocks real-client testing. Every other queue item is
easier to verify once a real dataset is in the system instead of a fixture.
**Relation to the queue:** this expands §3.1 of `docs/SCALE-HARDEN-CONTINUOUS-BUILD.md` (blocking item
8) into something a builder can execute without further design work.

---

## 1. The gap, precisely

`supabase/migrations/0042_imports.sql` fixes the import type with a CHECK constraint:

```sql
import_type text not null check (import_type in ('rcm', 'entities', 'users', 'populations'))
```

and `commit_import(p_job_id, p_mapped_rows)` writes exactly three tables: `entities`,
`risks_library`, `org_members`. A `populations` import stages rows and writes no data (the §6
population gate still requires a verified sha256 and row count).

So a client can bring **a risk-control matrix, an entity list, a user list and populations** — and
nothing else. There is no way in for engagements, observations, findings, CAPs, workpapers, SIRA
cycles, conclusions or reports.

`supabase/migrations/0044_prior_year_import.sql` is **not** an answer: it copies four item types from
an **engagement that already exists in the same org**. It cannot help a client with no data here.

**The `import_type` CHECK is the hard gate.** Nothing else can be built until it is widened.

---

## 2. Corrections to the queue's sketch — read before building

I checked §3.1's step list against the actual schema. Three of its assumptions are wrong, and each
would cost a builder a day if taken literally.

**(a) There is no `conclusions` table and no `reports` table.** The real targets are:

| Queue says | Actually exists | Migration |
|---|---|---|
| `conclusions` | `conclusion_records` | `0034_conclusion.sql` |
| (implied) `reports` | `report_versions` **and** `report_blocks` | `0036_report_drafting.sql` |

A report is a versioned document with blocks, not one row. Importing a "report" means importing a
`report_versions` row plus its `report_blocks`.

**(b) The dependency graph is deeper than three levels.** The queue says "engagements before findings
before CAPs". The real chain is:

```
universes → entities → engagements → observations → findings → issues → caps
                                          ↘ workpapers → workpaper rows
engagements → sira_cycles
engagements → conclusion_records → report_versions → report_blocks
```

`findings` requires an `observation_id`; `caps` requires `finding_id`, `engagement_id` and may require
`issue_id` and `report_id`. An importer must resolve parents in this order or the foreign keys fail.

**(c) No table carries a client-facing natural key.** The queue's step 3 assumes `ENG-2024-001` can be
mapped to a new uuid. But `engagements`, `entities`, `findings` and `caps` have **no `code` or
`external_ref` column** (only `risks_library.code` exists, added in `0019_sira_model.sql`). So there is
nowhere to *store* the client's identifier, and no way to make a re-run idempotent by matching it.

**This is the one genuine design decision in WP-IMPORT.** Two options:

- **Option A (recommended): a `import_external_refs` side table** — `(org_id, import_type,
  external_ref, target_id, created_at)` with a unique index on `(org_id, import_type, external_ref)`.
  Idempotency becomes a lookup; no client-facing column is added to the domain tables; the tenant's
  schema stays clean. Re-running the same file matches the ref and skips or updates.
- **Option B: add `external_ref text` to each domain table.** Simpler to query, but it puts
  import-specific concerns into eight core tables and touches every RLS policy and every `select *`.

Take Option A unless there is a reason to query client codes directly from domain tables.

---

## 3. The append-only hazard — the item the queue does not mention

Several of these tables are **hash-chained by trigger**:

- `conclusion_records` → `conclusion_chain()`
- `report_versions` → `report_version_chain()`

and the ledger discipline (L3, config-as-ledger) applies to imports like everything else. So an
importer must **not** disable triggers, must **not** write chain columns directly, and must produce
rows that the triggers accept. Importing historical data must yield a *valid* chain, not a bypassed
one. Where a historical record's chain cannot be reconstructed (the original hashes are unknown),
the honest approach is to import it as a **new, dated chain entry** and record the provenance in
`activity_log` — never to fabricate a hash that claims to be the original.

This is the highest-risk part of WP-IMPORT and needs its own test.

---

## 4. Build order

Each step is independently testable. Do not reorder — 1 gates everything.

1. **Widen the `import_type` CHECK** to the full entity set: `rcm, entities, users, populations,
   engagements, observations, findings, issues, caps, workpapers, sira_cycles, conclusion_records,
   report_versions, report_blocks`, plus one **`history`** type (§5). One migration. This is the gate.
2. **`import_external_refs` table + unique index** (§2c, Option A). Idempotency depends on it.
3. **`start_import` / `validate_import` extended** to the new types. Keep the existing signature and
   return shape — `validate_import(job_id, mapped_rows)` already returns per-row errors, which is
   exactly the dry-run shape §4 of the queue asks for. **Extend, do not replace.**
4. **`commit_import` dispatch per type**, inserting in the dependency order of §2b, resolving parents
   through `import_external_refs`. Resolve-or-fail: a row whose parent is missing is an error row, not
   a silent skip.
5. **The `history` type** — one file, all entity types, ordered, cross-references resolved. A client's
   history is one dataset, not fourteen disjoint lists. This is the type the owner will actually use.
6. **Dry-run mode** — validate the whole file, report every error, write no **domain** data. Be exact
   about what already happens: `validate_import` **does write**, but only to its own `import_jobs` row
   (status and `error_rows`, line 57 of `0042_imports.sql`). It never inserts into a domain table —
   that is `commit_import`'s job. So the dry-run guarantee already holds for domain data and needs to
   be *stated and tested*, not built. Make the test assert **domain row counts are unchanged**, not
   "no writes at all".
7. **Idempotent re-run** — the same file twice must not duplicate. Matched by `import_external_refs`.
8. **Per-row `import_jobs` trail.** `import_jobs` already has `error_rows jsonb`; extend the trail to
   per-row status and provenance in `activity_log`.
9. **Template files** — one XLSX per entity type, headers plus a worked example. The owner is
   non-technical; this is not optional polish.
10. **A migration-status screen** — what landed, what failed, what was skipped, and why. Reuse the
    existing wizard shell (`src/components/admin/ImportWizardPanel.tsx`, lazy-mounted from
    `RecordContent.tsx`).

**Estimated ~1,500–2,500 LOC, ~4 migrations, ~2 screens.** Reuses the existing wizard, the
`validate_import` shape and `import_jobs`.

---

## 5. RLS and the refusal paths

An import is a **write path into tenant data**. It must obey the same discipline as every other write:

- `security definer set search_path = public`, as the existing RPCs do.
- Read `jwt_org_id()` at the top and refuse when it is null — copy the existing
  `raise exception 'not signed in' using errcode = 'P0001'` pattern from `commit_import`.
- Every insert carries `org_id := v_org`. Never trust an `org_id` from the file.
- `revoke execute ... from public, anon` and `grant execute ... to authenticated`, matching
  `0042_imports.sql` exactly.
- Cross-org parent references must be **refused**, not silently nulled.

**The caution that matters.** An import path is a classic place to smuggle in a cross-tenant read.
When resolving `ENG-2024-001` to a uuid, a careless lookup can match a row in another org. The
lookup must always be constrained by `org_id = v_org`. Test this explicitly — it is the single most
important test in WP-IMPORT.

**Required tests (testing rules demand both paths):**

- Happy path: each new import type lands its rows.
- RLS refusal: a row carrying another org's parent id is refused.
- RLS refusal: an unauthenticated / no-org caller is refused.
- Missing parent: an error row, and nothing half-lands.
- Malformed date: an error row, not a crash.
- Cross-org external-ref collision: the same `ENG-2024-001` in two orgs must resolve independently.
- Dry-run writes nothing (assert row counts unchanged).
- Idempotent re-run (assert row counts unchanged after the second commit).
- Chain validity: imported `conclusion_records` and `report_versions` satisfy their triggers.

**Playwright:** upload a template, map, dry-run, commit, see the data. Plus a negative case — a file
with a bad parent shows the error and commits nothing.

---

## 6. Numbering and constraints

- **New migrations take 0118+.** A and B both used 0110–0117 with different filenames; the rule is
  recorded in commit `404cd25` and `BRANCH-MAP.md`.
- **Time is an argument.** No `now()` inside pure helpers; pass the timestamp in, per L1.
- **Deterministic only.** Parsing and mapping are pure functions under `src/lib/`; no AI, no
  free-text generation, no embeddings. If a client's file has a free-text column, it is imported
  verbatim as data, never interpreted.
- **No blocking modals.** The wizard's status view follows the drawer pattern, `role="complementary"`.
- **Every interactive element carries `data-testid="<screenId>-<element>"`.**

---

## 7. Definition of done

WP-IMPORT is closed when a non-technical owner can take a client's existing IA history — partial or
complete, from a spreadsheet — and land it in the system for testing, with:

- a dry-run that reports every problem and writes nothing,
- a commit that either lands completely or reports why it did not,
- a re-run that does not duplicate,
- a status screen that says what happened,
- and SQL tests proving the refusal paths, including the cross-tenant one.

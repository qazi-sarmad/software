# Merge decision brief — Provio / Systeligon branch topology

**For:** the executive programmer. **From:** the build agent. **Date:** 2026-10-29.
**Decision needed:** which branches to merge, in what order, and what to do about the two that carry
real work outside the integration line.

This brief is a decision document, not a report. Every figure is reproduced against the repository
(`git rev-list --count`, `git merge-base --is-ancestor`, test merges run and aborted). Where a figure
comes from another document rather than the code, it is marked **reported**.

---

## 1. The decision, in one paragraph

One branch is the integration tip and should be the only thing merged to `main` after the build:
`feature/systeligon-builder-continuous`. It already contains every other feature branch except two.
Those two — `feature/security-harden-v1` and `feature/systeligon-build-v1` — carry real work and are
**not** in it. `feature/systeligon-build-v1` carries a functional gap the product needs (nothing in
production writes `population_rows`, so sampling is broken end to end) and merges cheaply. Decide on
it now. `feature/security-harden-v1` is a reconciliation, not a merge, and can wait for the build.
`main` itself carries a CVE fix and an analytics rewrite that must be brought into the builder branch.

---

## 2. Verified topology

Merge base of `main` with every feature branch is `ef62e51` (2026-10-26). `main` (`a697190`) is **not**
an ancestor of any feature branch; every feature branch is 7 commits behind `main`.

```
main (a697190) ──┐
                 │  merge-base ef62e51
                 ├─ feature/scale-harden-v1
                 │        └─► feature/systeligon-unified-v1 (ceb85fd)
                 │                 ├─► feature/systeligon-builder-continuous   ◄── INTEGRATION TIP
                 │                 └─► feature/systeligon-design-spec          (docs only)
                 ├─ feature/security-harden-v1 (35a0129)   ◄── real work, NOT in the tip
                 └─ feature/systeligon-build-v1 (e4b0f8c)  ◄── 5 commits, NOT in the tip
```

**Already contained in the integration tip** (verified ancestors — do not merge them again):
`scale-harden-v1`, `systeligon-unified-v1`, `systeligon-v1`, `writing-engine`, every `phase-*`,
`board-ai-control-plane`, `config-control-plane`, the `cap-*` branches, `audit-file-v1`,
`radial-hover-fix`.

**Unmerged, real work:**

| Branch | Ahead | Behind | What it carries | Merge cost |
|---|---|---|---|---|
| `feature/systeligon-build-v1` | 5 | 116 | `0119_population_rows` (the population-rows writer), `0120_self_diagnostic`, the SIRA write path, `0118` org_id indexes, 3 dead components deleted | **Low** — 4 conflicting files, 1 is code |
| `feature/security-harden-v1` | 23 | 116 | MFA gate, SSO enforcement, erasure/DR/residency, owner console, `public/_headers`, the provenance guard | **High** — migration filename collisions + 11 conflicting files |

**Unmerged, docs/media only (low value, safe to ignore):** `docs/builder-prompt-2026-10-29`,
`fix/tutorial-recorder-fixtures`, `docs/systelligence-and-fonts`, `merge/coderabbit-pilot`,
`feature/cap-due-date-change`, `audit/full-codebase-2026-10-27`.

---

## 3. What `main` carries that the tip lacks (verified)

`main` has 7 commits the feature tree does not:

- Three `.github/workflows/ci.yml` edits, including a **change of step 7's strategy** (see §5).
- `financial-statements-checker.html` and the standalone checker page.
- A **jspdf `^4.2.1` override** — the dompurify CVE fix. **The tip does not have it.**
- A month-named analytics rewrite: `src/lib/analytics.ts` is 496 lines on `main`, 313 on the tip.

Merging `main` into the tip conflicts in **exactly one file**: `.github/workflows/ci.yml`.

---

## 4. The one thing that is not a "merge" — `feature/security-harden-v1`

Do not treat this as a normal merge. Three verified obstacles:

1. **Migration filename collisions.** The security branch has `0100_platform_security.sql`,
   `0101_data_lifecycle_crypto.sql`, `0102_group_joint_audit_sharing.sql`,
   `0103_owner_only_console_and_tenant_mfa.sql`. The tip has `0100_phase1_write_paths.sql`,
   `0101_phase2_lifecycle.sql`, `0102_phase2_preflight_gate.sql`, `0103_phase2_report_graph.sql`.
   **Different files, identical paths.** A careless merge silently keeps one set and drops the other —
   and a dropped migration is a schema the app reads and the database does not have. This alone makes
   it a reconciliation.
2. **11 conflicting files**, including `src/components/admin/OrgControlPanel.tsx`,
   `src/components/superadmin/SuperAdminPortal.tsx`, `supabase/migrations/0033_platform_read_apis.sql`
   and `supabase/tests/00_lib.sql` — all files the builder also touches.
3. The security branch is **116 commits behind** the tip, so its UI files predate the builder's changes
   to the same files.

**Recommendation:** do not merge it now. For a **testing** deployment it is not required. For a
**production** deployment it is required (MFA, SSO, erasure, security headers). Do it as its own
session, after the build lands, renumbering the four migrations above to the next free numbers.

---

## 5. The `.github/workflows/ci.yml` conflict, precisely

This is **not** a comment-only conflict. `main` and the tip chose **opposite strategies for step 7**:

- **`main`**: step 7 is *"runner-local PostgreSQL"* — it installs PostgreSQL on the runner and runs
  `bash scripts/local-sql-harness.sh`. The comment says this was to stop exhausting the hosted test
  project's Disk IO budget.
- **The tip**: step 7 is *"test project only"* — it applies migrations to the **hosted test project**,
  and adds a step *6d. Anti-theatre gates (G2–G6, R0)*. The comment says the runner-local variant
  "meant no CI step ever brought the hosted schema forward", so step 8 (Playwright) failed on a missing
  column.

**Both arguments are real and they pull opposite ways.** The tip's reasoning is that Playwright drives
the app against the hosted project, so the hosted schema must be current. `main`'s reasoning is that
the hosted replay exhausts the Disk IO budget. **The executive programmer must decide which wins** —
this is a genuine trade-off, not a mechanical merge. The other two edits `main` made are the branch
trigger list and the workflow-level changes; the tip additionally runs the anti-theatre gates, which
`main` never ran.

---

## 6. Recommended order of operations

**Now — before the build starts:**

1. `main` → `feature/systeligon-builder-continuous`. Resolve the single `ci.yml` conflict with the §5
   decision. Brings the **jspdf CVE fix** and the analytics rewrite. *Take `main`'s side on
   `analytics.ts`, `package.json` and `financial-statements-checker.html`* — the tip never touched
   those, so they merge cleanly and the newer versions win. Verify: `npx tsc --noEmit` and the gate set.
2. `feature/systeligon-build-v1` → the tip. **4 conflicting files** (`docs/ACP-UI-CONTRACT.md`,
   `docs/FEATURE-REGISTER.md`, `docs/UI-INVENTORY.md`, `src/components/audit/PopulationPanel.tsx`).
   **Renumber** its three migrations to `0129_org_id_indexes.sql`, `0130_population_rows.sql`,
   `0131_self_diagnostic.sql`, and its three SQL test files to the next free numbers (the tip's tests
   already run to `134`). Regenerate `docs/UI-INVENTORY.md`. This brings the population-rows writer the
   product needs and the self-diagnostic surface. Verify the gates.
3. **Start the build** on that tree.

**After the build lands:**

4. Reconcile `feature/security-harden-v1` (renumber its four colliding migrations), then merge.
5. `feature/systeligon-builder-continuous` → `main`. Take `main`'s side on the `ci.yml` step-7 block if
   the §5 decision was to keep the runner-local strategy.

**Never:** rebase the tip onto a feature branch; force-push; merge `feature/systeligon-design-spec`
(docs only — it can be merged any time, it conflicts with nothing); re-open the migration collision the
unified branch already resolved.

---

## 7. Why `feature/systeligon-build-v1` should not wait

Verified, not assumed: on the tip, **nothing in production writes `population_rows`**. The only
`insert into population_rows` statements are in test files. `registerPopulation()` writes the
`populations` metadata row (filename, sha256, row count, status `verified`); `compute_sample` then
reads `population_rows`, finds nothing, and raises `population_gate`. **Sampling cannot produce a
sample.** B's `0119_population_rows.sql` and the paste grid are the writer. The builder prompt does not
ask for it, so if this merge is skipped the build will not fix it.

---

## 8. Verification after each merge

```
npx tsc --noEmit
npx vitest run
node scripts/check-feature-register.mjs     # expect: 138 features, 94 Wired / 27 Inert / 17 Absent
node scripts/check-wiring.mjs
node scripts/check-dead-code.mjs
node scripts/check-ui-contract.mjs
node scripts/check-rpc-parity.mjs
node scripts/check-two-sources.mjs
node scripts/check-config-effect.mjs
node scripts/check-tokens.mjs
node scripts/check-shrink.mjs
npx tsx scripts/gen-ui-inventory.mjs        # then confirm no drift
npx vite build
bash scripts/local-sql-harness-docker.sh    # migrations twice, tests twice
```

If `check-rpc-parity` fails, an RPC the app calls is missing from the final schema — almost always a
migration that a filename collision dropped. If `check-feature-register` fails after a merge, a row
and the code disagree; fix the row in the same commit.

---

## 9. Deployability (for the testing deployment)

- The app is a **pure static SPA**; `vercel.json` with a catch-all rewrite to `/index.html` is committed
  on the tip (without it every deep link 404s).
- Needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time, or the production shell
  renders empty. Never expose `SUPABASE_SECRET_KEY` to the build.
- Vercel does **not** deploy the Supabase side: 128 migrations, the storage buckets from
  `0120_evidence_storage.sql`, and the Edge Functions (`doc-extract`, `invite-user`, `email-dispatch`,
  `graph-oauth`, `archive-upload`, `secrets-put`, `hosting-test`) must be applied/deployed separately.
- `npm ci` works on a clean clone with no flags (314 packages, 0 vulnerabilities); `vite build` succeeds.

---

## 10. Open decisions for the executive programmer

1. **Step 7 CI strategy** — hosted test project (tip) or runner-local PostgreSQL (`main`)? Pick one;
   the merge conflict forces the choice.
2. **`systeligon-build-v1`** — merge now (recommended: yes, for the population-rows writer) or defer?
3. **`security-harden-v1`** — reconcile before the build, or after? (Recommendation: after; it is not
   needed for a testing deploy and it is a large reconciliation.)
4. **Production branch on Vercel** — point at the tip for testing, or at `main`? (Recommendation: the
   tip until the build lands and the merge to `main` is done.)
5. **`feature/systeligon-design-spec`** — merge now (harmless, docs only) or hold with the design work?

# Functionality audit — code-verified, docs disregarded

Audit of `feature/scale-harden-v1` @ `c898269`. Every claim below was verified against the code, not
against `PARITY.md` / `NOT-DONE.md`. The docs were read only as a statement of intent. Method:
migrations applied to a WASM Postgres (PGlite) to get the *final* schema, then every function, table,
RPC caller, panel and data module cross-referenced by script.

## 0. The headline

The repository contains a large, well-tested, **backend** and a large, well-tested **frontend**, and
the two are wired together for only a fraction of the product. Concretely:

| Layer | Scale | Wired to the other layer? |
|---|---|---|
| Database (migrations) | 99 migrations, 463 live functions, 176 tables | Partly |
| Backend tests | 103 SQL test files | Yes — but often testing functions the app never calls |
| Frontend | 123 components, 202 vitest files | Partly |
| RPCs called from the app | 114 call sites, 220 distinct functions | — |
| RPCs the app never calls | 15 functions, none reachable from any screen | No |

The pattern is not "no functionality". It is **two half-products**: a database that enforces rules
nobody triggers, and screens that render from an in-memory seed rather than the database.

---

## 1. CRITICAL — the app is not database-backed in production

`src/App.tsx:204`:

```ts
const loadDemoSeed = import.meta.env.DEV ? () => import('./data/demoSeed').then((m) => m.demoSeed) : null;
```

`src/App.tsx:215`:

```ts
const [seed, setSeed] = useState<TenantSeed | null>(loadDemoSeed ? null : EMPTY_SEED);
```

- In **development** the whole shell loads `demoSeed` — 1,387 lines of fixture data in
  `src/data/initialData.ts` (users, universes, entities, engagements, workpapers, issues, CAPs).
- In a **production build** `loadDemoSeed` is `null`, so `seed = EMPTY_SEED` — every array empty
  (`src/data/emptySeed.ts`).
- Verified: `vite build` produces a bundle with **no** `tenant-demo` and **no** `CANARY-CARDS`
  markers, i.e. no tenant data ships. Correct for security; catastrophic for function.

`AppContext` (727 lines) holds all tenant state in `useState` and contains **zero** calls to the
Supabase client (`grep -c "callRpc|getClient|supabase" src/context/AppContext.tsx` → `0`). Nothing
ever hydrates it from the database. `useScopedData()` — used by 69 components — filters that
in-memory seed.

**Consequence.** In production, `AuditFileModal` finds no engagement in `scopedEngagements` and
renders `data-testid="audit-file-unavailable"` ("Audit file not available."). Every screen shows its
empty state. The product has no way to display real tenant data, because no code path loads it.

**Why tests don't catch it.** Playwright runs `npm run dev` (`playwright.config.ts:39`), so E2E always
exercises the **demo seed**, never the production path. Vitest is the same. The test suite cannot
detect this by construction.

---

## 2. CRITICAL — the audit lifecycle cannot be driven end to end

### 2.1 Engagement stage is never persisted

`engagements.stage` exists with a CHECK constraint (`0004_testing.sql:46`) and triggers guard the
`testing` transition (`0022`, `0025`, `0095`). In the **database**, the only `update engagements`
statements set `sealed`:

```
0007_functions.sql:158   update engagements set sealed = false ...
0034_conclusion.sql:223  update engagements set sealed = true  ...
```

There is **no** RPC, no edge function and no direct client query that writes `stage`. No
`advance_stage` / `set_engagement_stage` function exists.

The one place `stage` changes is `AppContext.signOffEngagement` (`src/context/AppContext.tsx:263`),
which does `setRawEngagements(... stage: 'conclusion' ...)`. That is **React state only** — it is
lost on reload and never reaches the database. So planning → testing → conclusion has no durable
path: the transition exists as a UI illusion and nowhere else. In production it cannot even be
reached, because §1 means no engagement is ever loaded to sign off.

Worse, `signOffEngagement` is a *second* sign-off path that bypasses the database's own gates. The
database enforces four-eyes, ethics acknowledgement, prior-year import confirmation and reconciliation
in `sign_planning` / `sign_conclusion`; the in-memory `signOffEngagement` re-implements a weaker
subset in TypeScript and is what `AuditFileModal.tsx:224` actually calls.

The WP6 spec that claims to test this (`e2e/wp6-system.spec.ts:95`) clicks three **UI tabs**
(`audit-file-view-workspace` / `-findings` / `-conclusion`) and asserts the tab body is visible. That
is a rendering test wearing a lifecycle test's name. It would pass with stage never changing.

### 2.1a LAW-1 violation: the clock is read inside state mutations

`AppContext` reads the wall clock directly in at least nine places (`new Date()`, `Date.now()`):
lines 246, 267, 295, 324, 406, 444, 482, 503, 542-543. The law "time is always an argument; never
read the clock inside pure functions" is honoured in `src/lib/` but violated in the context that
drives the UI. `Date.now()` at line 542 is used to mint an observation id, so two observations created
in the same millisecond collide.

### 2.2 The report graph root is never written

`report_graphs` is append-only (`0088_claim_graph.sql`) and `verify_report_root` (`0094`) reads it to
prove tamper-evidence. `grep -rn "report_graphs" src/ supabase/functions/` → **empty**. Nothing in
the product inserts a graph row. The writing engine computes roots in `src/lib/writing/` and tests
them, but the result is never persisted, so the verification chain has no data to verify.

### 2.3 Pre-flight is dead code

`runPreflight()` (`src/lib/preflight.ts:77`) runs the eight checks and returns a structured report.
Its only caller is its own test. `ReportEditorPanel.tsx` instead computes two checks inline
(open comments, CAP reconciliation) and `freeze_report` (`0040_freeze_issuance.sql`) gates on exactly
those two — never consulting `preflight_acks`. A report can be frozen and issued with the eight-check
pre-flight never executed.

### 2.4 Sign-off role and testing mode are stored but not enforced

`org_lifecycle_settings.signoff_role_planning / _testing / _conclusion` and `testing_mode`
(`0082`, `0095`) are validated and persisted by `admin_save_lifecycle_settings`, and surfaced in
`src/data/governance.ts`. But `sign_planning`, `sign_off_workpaper` and `sign_conclusion` never read
them — they check only `review_and_approve` / `approve_plan`. The one-stage vs two-stage setting has
no behavioural effect.

### 2.5 Sampling is not connected to row testing

- `compute_sample` (`0027`) hardcodes `method = 'random'` and selects by `md5(seed || row_ref)`.
  The schema accepts seven methods (`random, systematic, mus, stratified, high_value, low_value,
  haphazard`) but the engine implements one. No value ordering, no MUS, no strata, no
  Clopper-Pearson / precision bound.
- `lock_sample` does not seed `workpaper_rows`. The only writer is `record_workpaper_row`
  (`0028:112`), one row at a time. `sign_off_workpaper` requires rows to exist, so every sampled row
  must be re-keyed by hand. Nothing links the drawn sample to the tested rows.
- `control_total_cents` is written on upload (`0026:178`) and never used for reconciliation; row
  count is client-asserted.
- There is no value-coverage check (no "you excluded items above the top-N / value band").
- `SamplingPanel.tsx:46` calls `getSampleSize('', …)` with an **empty** orgId; the rule lookup keys
  on `org_id = p_org_id`, so it raises and the size floor never renders.
- Two sampling UIs exist: `SamplingPanel` (DB-backed, correct) and `SamplingTab`, which builds a
  **synthetic population** (`dummyPopulation`, `SamplingTab.tsx:19`) from a formula and draws from it.
  The workbench path shows invented transactions.

---

## 3. HIGH — 15 functions the product never calls

Final schema: 463 live public functions. Cross-referencing app string literals, edge functions, SQL
callers and triggers leaves 15 with no reachable caller:

| Function | Production refs | Tested? | What it should do |
|---|---|---|---|
| `verify_ledger` | 0 | yes | Verify the hash-chained ledger — the tamper check |
| `rule_engine_process` | 0 | yes | Run the deterministic monitor rules |
| `staged_record_ingest` | 0 | yes | Ingest connector records into staging |
| `connector_run_start` | 0 | yes | Record a connector run start |
| `connector_run_finish` | 0 | yes | Record a connector run finish |
| `alert_record` | 0 | yes | Persist a fired monitor alert |
| `escalation_evaluate` | 1 (feature map only) | yes | Evaluate escalation rules |
| `reopen_engagement` | 0 | yes | Reopen a sealed engagement |
| `phrase_create` | 0 | yes | Create a wording phrase |
| `admin_set_org_setting` | 0 | yes | Set an org setting |
| `email_dispatch_set_token` | 0 | yes | Tokenise an email dispatch |
| `grant_support_access` | 1 (legacy name) | yes | Support access |
| `revoke_support_access` | 1 (legacy name) | yes | Revoke support access |
| `has_org` | 0 | **no** | Helper |
| `org_id_from_header` | 0 | **no** | Helper |

22 further functions are referenced by no *production* path but appear in a test, i.e. built, tested,
unused. The most damaging is `verify_ledger`: the ledger hash chain is written
(`appendLedgerEntry` in `AppContext` → `src/lib/ledger.ts`, in-memory) and never verified against the
database.

Also dead: the whole monitor runtime. `evaluateMonitor`, `runMonitors`, `verifyAlertChain`
(`src/lib/writing/monitors.ts`) are called by nothing outside their tests, and
`connector_run_start/finish` are never invoked, so the connector/monitor pipeline (WP5) has no entry
point. The 22-adapter catalogue (`connectorCatalogue.ts`) is data with no runner.

---

## 4. MEDIUM — the two-UIs problem

Several behaviours have a correct implementation and a parallel fake one, with the fake reachable:

| Behaviour | Real | Fake | Which renders |
|---|---|---|---|
| Sampling | `SamplingPanel` (RPC) | `SamplingTab` (`dummyPopulation`) | both are wired |
| Universe/entities | `listEntities()` DB read | `useScopedData()` seed filter | both, merged |
| Sign-off | `sign_planning` RPC | `AppContext.signOffEngagement` (in-memory) | both exist |
| CAP transition | `update_cap` RPC | `transitionCapStatus` in `AppContext` | both exist |
| Ledger | DB `append_ledger_entry` | `appendLedgerEntry` in-memory | in-memory is what runs |

`AuditUniverseTab` shows this plainly: it reads `dbEntities` from the database *and* renders
`scopedEntities` from the seed, merging two sources that in production disagree (one empty).

---

## 5. What is genuinely built and reachable

To be fair and precise — these are real, wired and tested:

- **Cross-universe sharing (WP2)**: `universe_shares` table, `share_grant` / `share_revoke` /
  `share_covers` RPCs with Head-level checks, `src/data/shares.ts`, `SharePanel.tsx` wired into
  `OrgControlPanel` tab `sharing`. This one is actually connected.
- **Testing hard lock + grace period (§10.1)**: real — `testing_grace_hours`, `testing_lock_active`,
  enforced by trigger (`0095:56`).
- **Population gate**: `lock_population`, sha256, `population_gate` refusal in `compute_sample`.
- **Pre-flight acknowledgement storage**: `preflight_acks` table + `acknowledgePreflight` wired into
  `ReportEditorPanel` (the storage works; the engine that would consume it is dead).
- **Freeze / issue**: `freeze_report` and `issue_report` RPCs, correctly gated on rights and open
  comments; called from the report panel.
- **Row testing**: `record_workpaper_row`, `sign_off_workpaper` with four-eyes and coverage checks;
  `RowTestingPanel` calls them.
- **RLS**: enabled on all 176 tables, 0 with RLS disabled. (5 have RLS on and zero policies —
  `oauth_state_nonces`, `reopen_grants`, `secret_store`, `team_role_rights`, `verify_attempts` —
  reachable only through `security definer` functions, which is defensible.)

---

## 6. Test-suite credibility

- 202 vitest files / 2,378 tests, 103 SQL files, 29 Playwright specs, 21 guards — all green.
- But: Playwright runs the dev server, so it tests the demo seed, not production behaviour.
- SQL tests pass because they test the database in isolation and often call functions the app never
  calls (`verify_ledger`, `rule_engine_process`, …).
- The suite is broad and honest at the unit level; it is structurally incapable of catching the
  integration gaps in §1–§3, because the integration is exactly what it stubs out.

---

## 7. Verdict

The question "what have we built apart from code with no functionality" has a precise answer:

- A **genuine, deep backend** — 463 functions, real RLS, real gates, real append-only ledgers. Mostly
  correct. Much of it unreachable.
- A **genuine, broad frontend** — 123 screens, real design system, real pure engines in
  `src/lib/writing/`. Mostly correct. Fed by fixtures in dev and by nothing in prod.
- A **missing middle**: the integration layer that loads tenant data into the UI, advances
  engagements, persists report graphs, runs the pre-flight, runs monitors, and links sampling to row
  testing.

The docs' "all Present" is true of *modules* and false of *behaviour*. Roughly 15 functions and five
core flows are built, tested, documented as done, and not connected to the product.

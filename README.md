# Provio

Enterprise internal-audit and forensic assurance platform for banks and corporates.

Cryptographically sealed workpapers, deterministic testing, verifiable populations, and an immutable
hash-chained ledger. **Every piece of audit logic is deterministic.** There is no model, no embedding
and no free-text generation anywhere in the product; the forensic engine (Systeligon) is a rule engine
whose every finding names the rule that produced it and the records behind it.

## Run locally

**Prerequisite:** Node.js 20+

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000 (or the port Vite prints)
```

The front end is the product surface. It reads data through the data layer (`src/data/*`), which talks
to Supabase; a component never imports the database client directly.

## Checks

The gates are the definition of done. Run them all before you claim anything:

```bash
npm run lint                     # tsc --noEmit
npm run test                     # vitest (unit + guard tests)
npm run build                    # vite build
npm run check-ui-contract        # every contract testid exists in src
npm run check-feature-register   # every Wired row names a real call site
npm run check-wiring             # every src/data export is reachable from a screen
npm run check-dead-code          # every public function is reachable or allow-listed
npm run check-rpc-parity         # migrations and the RPC surface agree
npm run check-two-sources        # no screen reads one table from both seed and database
npm run check-config-effect      # a config change actually changes behaviour
npm run check-tutorials          # every tutorial key has a recording
npx playwright test              # e2e (needs a running app)
```

`npm run ci` runs lint + test + the shrink/token guards + build in one pass.

### Database tests

The SQL suite (migrations applied **twice**, every test run **twice**) needs a real PostgreSQL 17:

```bash
bash scripts/local-sql-harness-docker.sh    # Docker path (uses sudo -n docker)
bash scripts/local-sql-harness.sh           # host-Postgres path
```

Green output reads `migrations applied twice` / `all SQL tests passed twice`.

### Generated documents

Two documents are generated and must not be hand-edited. Regenerate them after any screen, testid or
RPC change, or the guard will fail:

```bash
npx tsx scripts/gen-ui-inventory.mjs   # docs/UI-INVENTORY.md
npm run gen:design                     # docs/DESIGN-SPEC.md
```

## Laws of the codebase

These are not style preferences; the guards enforce them.

- **L1 Deterministic only.** No AI, no model, no embedding, no learned threshold. Time is always an
  argument: a pure function never reads the clock or `Math.random()`. `src/guards/noAi.test.ts` fails
  the build if an AI identifier reappears.
- **L2 Data never leaves the tenant.** RLS plus `jwt_org_id()` is the only read path; every tenant
  table is org-scoped and carries an index whose leading column is `org_id`.
- **L3 Config-as-ledger.** Configuration is versioned and append-only; the population gate is
  inviolable — a population without a hash and a row count cannot be verified, and an unverified
  population cannot be sampled.
- **L4 Pure functions live under `src/lib/` or `src/data/`.** A component never imports the Supabase
  client, and no pure function reads the clock.
- **L5 The ledger is append-only.** An audit file always has an owner; a sealed file is immutable.

## Rules of the codebase

- Three lifecycle stages only: planning, testing, conclusion.
- Colours come only from `src/styles/tokens.css`; icons only from `src/components/common/Icons.tsx`.
  The colour law: verdigris = pass, cinnabar = exception, brass = money and financial figures only.
  Nothing else is chromatic.
- Components read data only through the data layer; a screen never imports the database client.
- No `Math.random` in audit logic; no blocking modals; no screen lets anyone type raw JSON.
- Every screen covers its happy path and its bad path (refusal, empty, loading, error).

## The concurrent build

Several agents build this repository at once, each on its own branch. The rule that makes that safe is
**two branches never write the same file**.

| Branch | Stream | Scope |
|---|---|---|
| `feature/systeligon-builder-continuous` | TRUNK / integrator | mount points, ledgers, the merge |
| `feature/systeligon-design-spec` | DESIGN | the design language (tokens, contract) |
| `feature/build-core-engine` | S1 | rule engine, scopes, rule packs, standards |
| `feature/build-assurance-caps` | S2 | D5 / D7 / D8 / D9 |
| `feature/build-risk-planning` | S3 | D10 / D14 / D15 |
| `feature/build-monitor-runtime` | S5 | monitor + connector runtime |
| `feature/build-config-honesty` | S6 | the R3 configuration-honesty rows |
| `feature/build-extraction` | S7 | extraction tiers, document rule surfaces |

Read `docs/build/OWNERSHIP.md` before editing anything: it assigns every file, migration number and
`data-testid` prefix to exactly one stream. Read `docs/build/README.md` for the index of the build
documents, and `docs/BRANCH-MAP.md` for the older long-lived branches and why none of them merges
wholesale.

**The design work is separate.** The designer authors the design language — the token *values* in
`src/styles/tokens.css` and the documents under `docs/design/**` — and writes no product UI code. The
builder owns `src/lib/theme/**`, the implementation that reads the frozen tokens. To work on design in
isolation, cut a branch from the trunk and touch only those paths:

```bash
git fetch origin feature/systeligon-builder-continuous
git checkout -b design/<topic> origin/feature/systeligon-builder-continuous
# edit only: docs/design/**, src/styles/tokens.css
```

The design branch carries no product UI code, so it never conflicts with a build stream.

Spec: `docs/` and the project instruction guide (v7).

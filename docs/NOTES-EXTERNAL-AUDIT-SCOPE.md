# Notes — external-audit product, scoping estimate

**Status: NOT STARTED, NOT SCHEDULED.** These are measurements and a recommendation, recorded so the
analysis is not lost. The decision is to finish and prove Provio first. Nothing here is a plan of
record and nothing here should be built until the current build is green.

Measured 2026-10-29 against `feature/systeligon-build-v1` (`51c4156`) and `feature/scale-harden-v1`
(`fc0ccda`).

## Headline

Roughly **25–35% of Provio's size as new code**. The hard engineering is already done; the domain logic
is not, and the risk concentrates in about 500 lines.

The reason it is small: the expensive part of Provio is not the audit logic, it is the **spine** —
determinism, hash-chained ledger, merkle attestation, RLS tenancy, the report-as-graph engine, and the
anti-theatre gates. That spine is domain-neutral.

## The split

| Layer | LOC | Reuse |
|---|---|---|
| `src/lib/writing` (report graph, merkle, phrases, compose) | 8,795 | Direct |
| `src/lib/render` (PDF/DOCX/XLSX) | 2,908 | Direct |
| `src/lib/capabilities` (20 pure evaluators) | 1,686 | Pattern reuse, new rules |
| `src/lib/explain` (popout/drilldown/standards) | 1,596 | Direct — swap IIA data for ISA |
| `src/lib/recognition` (magic bytes, archives) | 812 | Direct |
| `src/lib/fonts` | 451 | Direct |
| RLS / auth / ledger / platform-admin / tenant mgmt | ~25,000 | Direct |
| CI + gates G2–G10 + local SQL harness | ~3,000 | Direct |
| Internal-audit domain (`siraEngine`, `cap`, `preflight`, `population`, `rights`) | ~2,000 | Discard |
| 208 components, of which ~110 are domain screens | ~25,000 | ~70% discard |
| **Total `src`** | **100,204** | |

## Transfers for free

1. **The Writing Engine.** A report is a directed graph of typed claims, with a graph root over the
   facts and a render hash over the words. An external audit's opinion, KAM section and financial
   statements are the same shape: a graph of assertions. Rewording "unmodified" to "qualified" changes
   words, not facts, and the root must not move. Already proved by exhaustion over 1,200 compositions.
2. **`analyticsEngine.ts`'s 14 checks are already external-audit procedures.** Benford first digit,
   round numbers, weekend postings, near-duplicates, same-user-create-approve, sequence gaps,
   `gl_to_tb` — that is **journal entry testing**, the core fraud procedure of a statutory audit. It
   needs near-zero change; it is currently mislabelled as an internal-audit module.
3. **`createDeterministicPrng` + `verifyPopulationGate`.** ISA 530 requires sampling you can re-derive
   and defend. A seeded Mulberry32 PRNG and a population hash already exist; statutory sampling is
   mostly new methods on an existing primitive.

## Genuinely new

| Module | Est. LOC | Why |
|---|---|---|
| Materiality (ISA 320) | ~400 | Benchmark, overall / performance / clearly-trivial. Pure, small. |
| Trial balance / lead schedules | ~1,200 | Chart of accounts, mapping, groupings. New core data model. |
| Assertions + risk-to-procedure linkage (ISA 315/330) | ~1,000 | Existence, completeness, valuation, cutoff, rights, presentation. |
| Sampling methods (ISA 530) | ~600 | MUS/PPS, stratified, interval. |
| Analytical procedures (ISA 520) | ~600 | Expectation vs actual, threshold variance. |
| Confirmations (ISA 505) | ~700 | External confirmation control and response handling. |
| Group audits (ISA 600) | ~800 | Component allocation, scoping. |
| **Opinion engine (ISA 700/705/706, KAM 701)** | ~500 | Small, and the highest-stakes logic in the product. |
| Financial statement model | ~1,500 | BS, P&L, CF, SOCIE, notes. |
| ISA / IFRS standards as data | ~3,000 lines data | Mechanical; `src/lib/explain/iia.ts` is the pattern. |
| ~30 domain screens | ~8,000 | TB, materiality, risk, programme, JET, sampling, opinion. |
| ~30 migrations + SQL tests | — | New tables, RLS, refusal paths. |

**New total ≈ 19,000 LOC of code, ~3,000 lines of data, ~30 migrations.**

## The three build shapes

- **A. New repo, kernel extracted as a package.** Cleanest. `@provio/kernel` holds writing, render,
  recognition, fonts, attestation, ledger, tenancy; both products depend on it. Cost: a real extraction
  effort, because `writing` was built assuming internal-audit claim types, plus ongoing version
  discipline across two products.
- **B. Monorepo, two apps.** `apps/internal-audit`, `apps/external-audit`, `packages/kernel`. Same as A
  without the version-skew problem. **Probably right.**
- **C. Fork and rename.** Fastest to start, worst option. Duplicates the 8,795-line writing engine and
  the gates, and the second product inherits the first one's bugs with nobody fixing both. This repo's
  entire problem for months was documents and code drifting apart; a fork guarantees the drift.

## Difficulty is not size

Three things make it harder than "30% of the work":

1. **The domain is regulated and the stakes are inverted.** A wrong internal-audit finding is a bad
   finding. A wrong external audit **opinion** is a professional-negligence event for a licensed firm.
   The opinion engine is ~500 lines and would be the most scrutinised code in the product.
2. **Evidence standards are higher.** Evidence must survive a regulator, not just a client. Recognition
   and attestation help, but confirmations and third-party evidence add an integrity path Provio never
   needed.
3. **The market is crowded and mature** — CaseWare, TeamMate, Inflo, MindBridge, DataSnipper. But
   Provio's differentiator — determinism you can *prove*, rather than AI you have to trust — is
   **stronger** in external audit, where "the model suggested it" is not a defensible answer.

## Recommendation, if it is ever started

**Extract `src/lib/writing` and the gates into a package and make Provio depend on it, before writing
any external-audit domain code.** If the kernel extracts cleanly, the second product is
straightforward. If it does not, that is better learned while there is one product to fix rather than
two.

## The caveat the estimate rests on

The measurements above are file sizes and module structure. It is **not verified** that `writing`'s
claim types are as domain-neutral in practice as their names suggest. That single assumption carries
the whole estimate, and it is the first thing a spike should test.

## Prior art already in the repo

`financial-statements-checker.html` on `main` — a standalone browser-only multi-period financial
statements checker. Small, but someone already started down this road.

# WRITE-1 decisions

Numbered, one entry per decision. Each records: task, point, options, choice, reason, and how to
reverse it. Classes are FIXED (written in the brief, implemented as written), NEVER IMPROVISE (not
decided here), and IMPROVISE-THEN-DOCUMENT (this file).

---

## D-W-F12 — continuous monitoring and connectors are in scope (2026-10-26)

- Task: W0.1 (owner instruction recorded at the start of the run).
- Point: continuous monitoring and connectors were parked by an earlier decision (F12).
- Options: (a) leave F12 parked; (b) bring both into this run.
- Choice: (b). The owner asked for them during the run. Alert rules stay deterministic (thresholds,
  rates over a window, sequences, set membership, missing-expected-event, cross-source
  reconciliation). No learning, no scoring by a model.
- Reason: the owner's instruction supersedes the parked decision; the deterministic constraint keeps
  Law L1 intact.
- Reverse: revert `docs/PARITY.md` and `docs/NOT-DONE.md` to show F12 parked, and drop migration
  `0092` onward that build the connector and monitor tables.

## D-W-VOICE — grammatical voice is a fourth register axis (2026-10-26)

- Task: W2.
- Point: the brief fixed formality (1..5), tone (1..5) and locale (en-GB, en-US). The owner asked,
  during the run, for active and passive voice as well.
- Options: (a) treat voice as a value inside each formality phrase variant; (b) add voice as a
  separate register axis with its own human-authored phrase variants.
- Choice: (b). `Register = { formality 1..5, tone 1..5, voice: 'active' | 'passive' }`, plus
  `locale`. The full variant matrix becomes 5 x 5 x 2 x 2 = 100 renderings of the same facts.
- Reason: (b) keeps voice orthogonal to formality and tone, so a reviewer can read the whole matrix,
  and it matches how the brief already treats tone ("tone may change emphasis and word choice only").
  The invariant is unchanged: the graph root is identical across every variant; only the render hash
  changes.
- Reverse: remove `voice` from `Register`, from `phrases`, and from the realisation rules; the
  matrix-completeness test then runs 5 x 5 x 2.

## D-W-MIGRATIONS — the schema lands with each module, not in one W1.4 migration

- Task: W1.4.
- Point: the brief places all new tables at W1.4, but W2–W4 each need their table to be testable.
- Options: (a) one large migration at W1.4 covering phrases, claims, figures and templates;
  (b) a migration per module, each M1-checked and M6-tested, numbered from the live `ls`.
- Choice: (b). W1.4 creates the claim and template core; W2 adds the phrase library; W4 adds the
  figure registry. Each is safe to apply repeatedly (M2).
- Reason: (b) keeps each commit's SQL gate meaningful and a failure local to its module. The brief's
  own rule "new migration and test numbers always come from `ls`" already anticipates this.
- Reverse: squash the three migrations into one; the harness applies either.

## D-W-CRYPTO — hashing uses the platform crypto already in the repo

- Task: W1.2.
- Point: the engine needs SHA-256 over canonical bytes, in the browser and in Node.
- Options: (a) add a dependency; (b) use WebCrypto `crypto.subtle` in the app and `node:crypto` in
  Node-only scripts, exactly as `src/lib/ledger.ts` and `src/lib/certificate.ts` already do.
- Choice: (b). No new dependency. The browser path fails closed with `HashUnavailableError` when
  WebCrypto is absent, matching `ledger.ts`.
- Reason: the dependency rule forbids a new dependency without a recorded reason, and the repo
  already has the primitive and a fail-closed test.
- Reverse: swap the hash helper for a library; nothing else changes.

## D-W-TIMESTAMP — time is an argument, never a clock read

- Task: W1.2, W7.1.
- Point: the brief bans clock reads inside the engine ("time is an argument").
- Options: (a) read `Date.now()` inside the composer; (b) pass a `fixed_timestamp` argument through
  every pure function, defaulting only at the UI boundary.
- Choice: (b). The composer and renderer take a `fixed_timestamp`; the UI supplies the real time
  once. A guard test scans the engine directory for `Date.now()`/`new Date()` without an argument.
- Reason: reproducible bytes and reproducible hashes need a fixed time.
- Reverse: none needed; removing the argument would break the render-twice test.

## D-W-PUBLIC-ROOT — the anonymous surface grows by exactly one function

- Task: W10.3.
- Point: the brief permits W10's public report check to add one anon function, deliberately, with a
  recorded decision, the allow-list guard updated, and a test that nothing else became anonymous.
- Options: (a) extend `verify_certificate`; (b) add one sibling function `verify_report_root`.
- Choice: (b). A separate function keeps the certificate contract untouched and returns no tenant
  content: given a graph root it returns only existence, issuance time and the version identifiers.
- Reason: (b) is the smaller change to an existing, tested contract, and the brief names the sibling
  option explicitly.
- Reverse: drop the function, revert `src/guards/anonGrantAllowList.test.ts` to the two names, and
  remove the public page route.

# Owner actions (WRITE-1)

Actions only the owner can take. The engine is built and green; these are the things the build
cannot do for you.

1. **Make the repository private now.** `gh api repos/qazi-sarmad/software --jq .private` returns
   `false`. The repository is public, so every commit is a public disclosure of the engine. Making it
   private is the first step to protect the invention. Do this before publishing any further engine
   detail.
2. **Engage a patent attorney before any further public disclosure.** The patent record (invention
   disclosure, draft claim families, prior-art map, embodiments, development log, public-disclosure
   review) is in the scratchpad directory `/workspace/project/patent-record/`. It was deliberately
   not committed, because the repository is public. Move it out of the sandbox and give it to
   counsel.
3. **Have a qualified internal auditor review and release the first-wave phrases, monitor rules and
   tests.** No phrase or monitor rule is released by this build. Use the review workbook export (one
   row per phrase variant with a rendered sample) to read the whole matrix, then release.
4. **Supply sandbox credentials for each connector you want live-verified.** Enter them in the
   platform wizard's connector setup, never in chat and never in the repository. Every adapter is
   marked "live-verified: NO" until then. See `docs/CONNECTORS.md`.
5. **Review and merge the draft pull request.** Do not merge without reading it.
6. **Deploy and set credentials as described in `docs/DEPLOY-RUNBOOK.md`**, where that document
   exists.

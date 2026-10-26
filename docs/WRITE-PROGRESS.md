# WRITE-1 progress

One line per task: task, commit, CI run id or "local", result.

| Task | Commit | Verification | Result |
|---|---|---|---|
| W0 preflight and plan | dfc0495 | local: vitest 144/1577, SQL harness green | done |
| W1 claim graph, canonical form, Merkle | 9820aa6 | CI CP1 | green |
| W2 phrases, registers, locales, matrix | 9820aa6, c6a6a0c | CI CP1/CP2 | green |
| W3 models, planner, approved-observation gate | a0b7acc, 686e8c6 | CI CP1 | green |
| W4 figure functions and lineage | 664e342 | CI CP2 | green |
| W5 claim verification and coverage | 73d45ab | CI CP2 | green |
| W6 provenance and counterfactuals | 73b09c1 | CI CP3 | green |
| W7 byte-reproducible PDF and DOCX | b405067 | CI CP3 | green |
| W8 version comparison | 4c352dd | CI CP3 | green |
| W10 offline third-party verification | 4c352dd | CI CP3 | green |
| W11 connectors and monitoring | badfe9e | local: vitest, SQL harness green | green |
| W2.9 review workbook, W11.4 monitor schema | c6a6a0c | local: vitest, SQL harness green | green |
| W9 style lint, readability, guided intake | 83bf1a0 | local: vitest 1844/160 files green | green |
| Report format editor (owner instruction) | deb95e1 | CI run 40291572648 (steps 7 SQL, 8 Playwright green) | green |
| W12 registry-gap fix, engine tests, docs | a53876a | local: vitest 1901/165 files, SQL harness twice green | green |
| W12 report-builder screen mounted in the Audit File window | 5e8bfc9 | local: tsc, vitest 1901, guards 618, SQL harness twice, build, all check scripts, e2e full-flow 4 passed | green |
| W10.3 verify_report_root (migration 0094, guard, tests 72/99, client, /root route) | b50b156 | CI run 40314836257: every step green, 1 to 16 | green |
| W15.3 close-out docs (counts, CI run, blocker) | 51c3e3a | CI run 40320552310: every step green, 1 to 16 | green |

## CI dispatches

Budget 14. Used: 3 (run 40291572648 at head deb95e1: steps 1-8 green; run 40314836257 at head b50b156:
every step green, 1 to 16; run 40320552310 at head 51c3e3a: every step green, 1 to 16).

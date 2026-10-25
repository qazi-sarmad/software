# Provio build progress

One line per task. A task is green only when its own CI run for its own commit has passed.
Resume from the last green task; never repeat a green task.

Format: task id | status | commit | CI run id | result

T0  | green | 95e9892 | n/a (docs only) | progress log created
T1  | committed | 8c85521 | pending | tutorial target audit; oa.tutorials retargeted to org-tutorials; oa.templates reported
T2  | committed | fce7cc8 | pending | SetupWizard render loop fixed; load effect 382 -> 1
CI-1 | committed | 6382125 | 40125698154 (cancelled while queued) | CI trigger enabled; push starts a run again
CI-2 | committed | 5c0c196 | 40125826186 | DECISIONS, BLOCKERS, tutorial skeletons; steps 1-14 green, step 9 hung and the job limit cancelled the run
CI-3 | green | 8ba805c | 40183729304 | step 9 given the VITE_ vars + its own 15 min limit; job limit stays 45. All 15 steps green, including step 9 (the first time it has ever completed)
CI-4 | green | 206aba4 | 40183729304 | C2.4 invitation spec given a load-proof per-test budget (test.setTimeout 90s); step 8 Playwright green (D-C2.4-timeout)
T3  | not started | | |
T4  | not started | | |
T5  | not started | | |
T6  | not started | | |
T7  | not started | | |
T8  | not started | | |
T9  | not started | | |
T10 | not started | | |
T11 | not started | | |
T12 | not started | | |
T13 | not started | | |
T14 | not started | | |
T15 | not started | | |
T16 | not started | | |
T17 | not started | | |
T18 | not started | | |
T19 | not started | | |
T20 | not started | | |
T21 | not started | | |
T22 | not started | | |
T23 | not started | | |
T24 | not started | | |
T25 | not started | | |
T26 | not started | | |
T27 | not started | | |
T28 | not started | | |
T29 | not started | | |
T30 | not started | | |
T31 | not started | | |

# Not done (one current list)

Rebuilt for the completion build (C5.3). Resolved items from earlier phases are removed; the phase
"scope" entries that are now built are gone. What remains is: real gaps (with a decision asked of the
owner), owner actions, and parked items. Cross-references: `docs/PARITY.md` (status by section),
`docs/COMPLETION-BLOCKERS.md` (full text of each blocker), `docs/COMPLETION-SPEC-AUDIT.md` (evidence).

## Real gaps — all closed by SCALE-1

Closed on `feature/scale-harden-v1` (WP2). Each former Partial/Missing item is now Present in
`docs/PARITY.md` with working code and tests. No item below is parked or awaiting a decision.

1. **§2 group / joint-audit sharing** — Present. `engagement_joint_shares` table, `joint_share_grant` /
   `joint_share_revoke` RPCs (the `manage_engagements` right and a recorded group association),
   `joint_share_active` projection giving both parties edit rights to the shared engagement and its
   working papers only, in-app + email notification on grant, group configuration distribution,
   `src/components/admin/SharePanel.tsx`, sql `103`, `e2e/wp6-system.spec.ts`. The former view-only
   `universe_shares` path is removed; the RLS shape is documented in `docs/SCALE-DECISIONS.md`.
2. **§10.1 configurable grace period before the Testing hard lock** — Present.
   `org_lifecycle_settings.testing_grace_hours`, `testing_lock_active` grace window, `src/lib/lifecycle.ts`,
   `src/data/governance.ts`, sql `100`.
3. **§11.4 central pre-flight** — Present. `src/lib/preflight.ts` (eight checks, structured report),
   `src/data/preflight.ts` (append-only `preflight_acknowledgements` + logged acknowledge RPC, `0095`),
   unit + sql `100`.
4. **§17.1 pop-out Realtime sync test** — Present. `e2e/s14-popout-sync.spec.ts`.
5. **§22 Realtime in-app notification delivery test** — Present. `e2e/s15-notifications.spec.ts`; the
   per-subscriber Realtime channel fix is `0098`; sql `104`.
6. **§3 / §25.7 mobile viewport smoke** — Present. `e2e/s16-mobile.spec.ts` (phone viewport: ethics
   sign-off, simple approval, report viewing).

## Owner actions

- **Deploy the Edge Functions.** `supabase functions deploy email-dispatch graph-oauth
  hosting-test invite-user secrets-put archive-upload doc-extract`. Three of these (archive-upload,
  doc-extract, hosting-test) are new in this build.
- **Confirm platform services.** Vault, pg_cron and pg_net must be enabled on the project. Set
  `SECRETS_MASTER_KEY` if Vault is absent (the graph-oauth `state` HMAC and the AES-GCM secret store
  both derive from it). The scheduled jobs (C2.2) need pg_cron, and email dispatch needs pg_net.
- **Enter Resend and Microsoft credentials in the platform wizard.** Never paste them into chat.
  Revoke the Resend key that was pasted on 2026-10-19.
- **Re-run the tutorial recording.** `npm run tutorials:record` with `TUTORIALS_BASE_URL` set, against
  the live app after the UI is final. The committed GIFs are placeholders (the recorder's output with
  no base URL). `npm run check-tutorials -- --strict` then passes on real recordings.
- **Set `TEST_SUPABASE_DB_URL` without the trailing newline** in the hosted test project's secret.
- **Verify §25.4 free-tier limits** on Supabase's pricing page before production use (§32 item 1).
- **Confirm Microsoft guidance** on basic-auth SMTP retirement and the Graph consent process before
  Gate 5 (§32 item 2).
- **Superadmin UI is Phase 8.1, owner-designed.** The Phase 8 *database* and logic are in place
  (migrations 0031/0032/0033/0045, tests 40–42/57, `src/data/platform.ts`); the `/superadmin` screen
  layout is the owner's to finalise.
- **Re-dispatch CI** if a GitHub-runner outage recurs (see `COMPLETION-BLOCKERS.md`, runs
  39604710289 / 39604815983 executed zero steps).

## Parked (by an earlier decision)

- **Continuous-auditing watchers.** PARKED by F12, then BUILT in the WRITE-1 run (owner instruction
  2026-10-26, decision `D-W-F12`). The connector framework, the deterministic monitor rules and the
  alert triage queue are present; the `watcher.signal` catalogue key now has a real emitter. See
  `docs/CONNECTORS.md` for the adapter table and the per-adapter live-verification status (every
  adapter is fixture-verified and `live-verified: NO` until the owner supplies credentials).
- **Migration runner against two live databases.** `tools/migration-runner/` ships its 11
  driver-injected steps with unit tests against `fakeDriver.mjs`. CI cannot provide two reachable
  Postgres databases, so the end-to-end run is left to the owner's runner machine; the step logic,
  checkpointing and ledger-copy guard are tested in isolation.
- **TeamMate / AuditBoard migration** is not committed in this version (§19, §28). Export is complete;
  import of prior-year material, RCM, entities, users and populations is built.

## Known limitations (stated plainly, not gaps)

- **Time-Travel coverage.** `engagement_as_of` reconstructs workpapers, findings, seals and statuses
  from append-only history. Entities that keep only current state are reported as "Not recorded before
  <date>" rather than guessed. Activity archived out of the live window is outside the as-of range;
  the UI states the earliest available date.
- **External auditor account creation.** The portal assumes the account exists. The owner's Supabase
  Auth signup/email-confirmation settings decide how the invitee creates one; the acceptance page says
  so plainly when signups are off. The invitation email queues through the F6 queue and, with the stub
  provider, stays queued until an adapter is configured (D-S9-invite-not-sent, by design).
- **Test button against a real target.** OA-15's connectivity Test calls `hosting-test`; with no
  reachable target configured it reports the error the provider returns. The owner supplies a real
  connection (F23).
- **Legacy binary evidence** (.doc, .ppt, .xls) is stored and linked but not extracted and not used
  for population sampling (§13.1, §20), with `extraction_status='legacy_not_extracted'`.

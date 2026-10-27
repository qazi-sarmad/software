# Provio backup, PITR and disaster-recovery runbook (WP14, SECURITY-PLAN item F)

The recovery posture is a configuration record, not a promise in a wiki: `platform_dr_settings` holds
the RPO, RTO, backup frequency, retention, PITR flag and the restore-test cadence, each versioned in
`platform_dr_versions` with a reason and an actor. `platform_record_restore_test(note, at)` stamps the
last restore test. Time is always an argument; nothing reads a clock.

## Baseline (what the free tier actually gives you)

| Property | Free tier | Implication |
|---|---|---|
| Backups | Daily logical backup, 7-day retention | RPO ≈ 24h, RTO depends on restore size |
| PITR | Not available | Recovery is to the last daily snapshot |
| Region | Single region | No cross-region failover |

The defaults in `platform_dr_settings` match this baseline: `backup_frequency = 'daily'`,
`retention_days = 7`, `pitr_enabled = false`, `rpo_minutes = 1440`, `rto_minutes = 240`,
`restore_test_interval_days = 90`.

## Upgrade path (each step is one ledger write)

1. **Raise retention.** `platform_set_dr_setting('retention_days', '30', reason)`.
2. **Enable PITR** (paid). `platform_set_dr_setting('pitr_enabled', 'true', reason)`, then set
   `rpo_minutes` to the achieved interval (e.g. `5`).
3. **Tighten RTO.** After measuring a restore, `platform_set_dr_setting('rto_minutes', '60', reason)`.
4. **Record the restore test.** `platform_record_restore_test('restored 2026-10-20 snapshot into a
   scratch project, all seals verified', p_at)`.

## Restore procedure

1. Provision a scratch project in the same region.
2. Restore the newest snapshot into it (`supabase db restore` or the dashboard).
3. Apply every migration forward from the snapshot to the current head:
   `for f in supabase/migrations/*.sql; do psql "$SCRATCH_DB_URL" -f "$f"; done`.
4. Verify seals: run `verify_report_root` for a sample of sealed reports and confirm each root
   resolves. Run the local SQL harness (`scripts/local-sql-harness.sh`) against the scratch project.
5. Re-point the app environment (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) and confirm
   sign-in and one sealed-report read.
6. Record the test with `platform_record_restore_test`.

## What is deliberately NOT stored

No credential, no key material and no tenant content is in this runbook or in the DR tables. The DR
tables hold policy (numbers and booleans) and the actor/time/reason of each change. Signing keys and
secrets live in Vault (see `docs/DR-RUNBOOK.md` companion note in `0101_data_lifecycle_crypto.sql`).

## Signals

- `platform_dr_settings.last_restore_test_at` older than `restore_test_interval_days` at `p_now`
  means the DR test is overdue.
- `platform_signing_keys_due(p_now)` lists signing keys past `rotate_after`; rotation is
  `platform_rotate_signing_key` (see item I).

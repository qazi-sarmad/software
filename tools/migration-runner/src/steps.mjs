/**
 * Migration step logic (F16, S11). Pure and driver-injected so it can be unit-tested without two live
 * databases: the caller passes a `driver` object with the operations a real pg driver implements.
 *
 * The eleven steps, all resumable and idempotent:
 *   1  preflight                      2  apply every migration   3  seed tenant rows
 *   4  copy tenant rows               5  copy auth users         6  copy ledger and history
 *   7  verify                         8  freeze the source       9  delta sync
 *   10 deployment kit + cutover       11 retire the old connection
 *
 * Step 8 is reached ONLY after step 7 passes, so a failure always leaves the source writable.
 */

export const STEP_KEYS = [
  'preflight', 'apply_migrations', 'seed_tenant', 'copy_tables', 'copy_auth',
  'copy_ledger', 'verify', 'freeze_source', 'delta_sync', 'cutover', 'retire',
];

export const TOTAL_STEPS = STEP_KEYS.length;

/** A small ordered list used where a deterministic order is needed (foreign-key order, step order). */
export function stepIndexFor(key) {
  return STEP_KEYS.indexOf(key);
}

/**
 * The resume point: the first step that is not `done`. A job that failed mid-way resumes from the
 * first unfinished step. Steps before it that are already done are never re-run.
 */
export function nextStep(steps) {
  const done = new Set(steps.filter((s) => s.status === 'done').map((s) => s.stepNo));
  for (let i = 1; i <= TOTAL_STEPS; i += 1) {
    if (!done.has(i)) return i;
  }
  return null;
}

function stepResult(stepNo, status, rowsDone = 0, detail = null) {
  return { stepNo, stepKey: STEP_KEYS[stepNo - 1], status, rowsDone, detail };
}

/**
 * Run one step against the driver. `ctx` carries the resolved job, the source and target drivers, and
 * the checkpoint store. Returns a step result. Each branch is idempotent: re-running a done step is a
 * no-op the driver makes safe (IF NOT EXISTS, upsert, keyset resume from the checkpoint).
 */
export async function runStep(stepNo, ctx) {
  const key = STEP_KEYS[stepNo - 1];
  const { source, target, checkpoint } = ctx;

  switch (key) {
    case 'preflight': {
      const engine = await target.serverVersion();
      if (!/postgres/i.test(engine)) {
        return stepResult(stepNo, 'failed', 0, `Target is not PostgreSQL: ${engine}`);
      }
      await target.assertExtensions(ctx.requiredExtensions ?? []);
      await target.assertRoles(ctx.requiredRoles ?? []);
      return stepResult(stepNo, 'done', 0, `Target speaks ${engine}`);
    }

    case 'apply_migrations': {
      const applied = await target.applyMigrations(ctx.migrations ?? []);
      return stepResult(stepNo, 'done', applied, `${applied} migrations applied`);
    }

    case 'seed_tenant': {
      const seeded = await target.seedTenant(ctx.orgId, ctx.seedRows ?? []);
      return stepResult(stepNo, 'done', seeded, `${seeded} seed rows`);
    }

    case 'copy_tables': {
      let copied = 0;
      for (const table of ctx.tables ?? []) {
        const from = checkpoint[`copy:${table}`] ?? 0;
        const res = await copyTable(target, source, table, from, ctx.batchSize ?? 1000);
        copied += res.rows;
        checkpoint[`copy:${table}`] = res.lastKey ?? from;
      }
      return stepResult(stepNo, 'done', copied, `${copied} rows across ${(ctx.tables ?? []).length} tables`);
    }

    case 'copy_auth': {
      const res = await target.copyAuthUsers(source, ctx.orgId, checkpoint);
      return stepResult(stepNo, 'done', res.rows, `${res.rows} auth users with password hashes`);
    }

    case 'copy_ledger': {
      const res = await target.copyLedger(source, ctx.orgId, checkpoint);
      return stepResult(stepNo, 'done', res.rows, `${res.rows} ledger and history rows copied verbatim`);
    }

    case 'verify': {
      const verdict = await target.verifyCopy(source, ctx.orgId, ctx.tables ?? []);
      if (!verdict.ok) {
        return stepResult(stepNo, 'failed', 0, `Verification failed: ${verdict.reason}`);
      }
      return stepResult(stepNo, 'done', 0, 'row counts, checksums and the ledger chain all match');
    }

    case 'freeze_source': {
      // Reached only after verify passed, so a failure here never leaves the source frozen.
      const previous = ctx.steps?.find((s) => s.stepNo === stepIndexFor('verify') + 1);
      if (!previous || previous.status !== 'done') {
        return stepResult(stepNo, 'failed', 0, 'Refused: verification has not passed');
      }
      await source.setMigrating(ctx.orgId, true);
      return stepResult(stepNo, 'done', 0, 'source is now read-only for this organisation');
    }

    case 'delta_sync': {
      const res = await target.deltaSync(source, ctx.orgId, ctx.tables ?? [], checkpoint);
      return stepResult(stepNo, 'done', res.rows, `${res.rows} changed rows re-copied`);
    }

    case 'cutover': {
      await target.buildDeploymentKit(ctx.orgId, ctx.kitPath ?? './deployment-kit');
      return stepResult(stepNo, 'done', 0, 'Deployment Kit written; waiting for the Org Admin to confirm cutover');
    }

    case 'retire': {
      const exportHash = await source.exportHash(ctx.orgId);
      if (!exportHash) {
        return stepResult(stepNo, 'failed', 0, 'Refused: the export hash could not be recorded');
      }
      await source.setMigrating(ctx.orgId, false);
      await source.retireConnection(ctx.orgId);
      return stepResult(stepNo, 'done', 0, `old connection retired; export hash ${exportHash.slice(0, 12)}…`);
    }

    default:
      return stepResult(stepNo, 'failed', 0, `Unknown step ${stepNo}`);
  }
}

/** Copy one table in keyset batches of `batchSize`, resuming from `fromKey`. */
export async function copyTable(target, source, table, fromKey, batchSize) {
  let cursor = fromKey;
  let rows = 0;
  for (;;) {
    const batch = await source.readBatch(table, cursor, batchSize);
    if (batch.rows.length === 0) break;
    await target.writeBatch(table, batch.rows);
    rows += batch.rows.length;
    cursor = batch.lastKey;
    if (batch.rows.length < batchSize) break;
  }
  return { rows, lastKey: cursor };
}

/**
 * The whole run: walk the steps in order from the resume point, stopping at the first failure. A
 * failure leaves every earlier step `done` and the source writable (unless step 8 completed).
 */
export async function runJob(ctx) {
  const results = [];
  const steps = [...(ctx.steps ?? [])];
  let from = nextStep(steps);
  if (from === null) return { status: 'complete', steps: results };

  for (let n = from; n <= TOTAL_STEPS; n += 1) {
    const res = await runStep(n, { ...ctx, steps: [...steps, ...results] });
    results.push(res);
    if (res.status === 'failed') {
      return { status: 'failed', stepNo: n, error: res.detail, steps: results };
    }
  }
  return { status: 'awaiting_cutover', steps: results };
}

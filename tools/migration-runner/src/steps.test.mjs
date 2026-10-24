import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL_STEPS, STEP_KEYS, copyTable, nextStep, runJob, runStep, stepIndexFor,
} from './steps.mjs';
import { makeFakeDriver } from './fakeDriver.mjs';

test('there are eleven named steps in the documented order', () => {
  assert.equal(TOTAL_STEPS, 11);
  assert.equal(STEP_KEYS[0], 'preflight');
  assert.equal(STEP_KEYS[10], 'retire');
  assert.equal(stepIndexFor('verify'), 6);
});

test('nextStep resumes from the first unfinished step', () => {
  assert.equal(nextStep([]), 1);
  assert.equal(nextStep([{ stepNo: 1, status: 'done' }, { stepNo: 2, status: 'done' }]), 3);
  assert.equal(nextStep([{ stepNo: 1, status: 'done' }, { stepNo: 2, status: 'failed' }]), 2);
  assert.equal(nextStep(STEP_KEYS.map((_, i) => ({ stepNo: i + 1, status: 'done' }))), null);
});

test('copyTable keyset-batches and resumes from a key', async () => {
  const { target, source } = makeFakeDriver();
  const res = await copyTable(target, source, 'findings', 0, 3);
  assert.equal(res.rows, 4);
  assert.equal(res.lastKey, 4);
});

test('preflight refuses a non-PostgreSQL target', async () => {
  const { target, source } = makeFakeDriver({ target: { serverVersion: async () => 'MySQL 8.0' } });
  const res = await runStep(1, { target, source, checkpoint: {} });
  assert.equal(res.status, 'failed');
  assert.match(res.detail, /not PostgreSQL/i);
});

test('the full run reaches awaiting_cutover and touches every step', async () => {
  const { target, source } = makeFakeDriver();
  const result = await runJob({
    target, source, checkpoint: {}, orgId: 'a', tables: ['findings'], migrations: ['0001', '0002'],
    requiredExtensions: ['pg_cron'], requiredRoles: ['anon'],
  });
  assert.equal(result.status, 'awaiting_cutover');
  assert.equal(result.steps.length, 11);
  assert.ok(result.steps.every((s) => s.status === 'done'));
  // The verify call happened BEFORE the freeze call (step ordering, F16).
  const names = result.steps.map((s) => s.stepKey);
  assert.ok(names.indexOf('verify') < names.indexOf('freeze_source'));
});

test('freeze_source refuses when verify has not passed', async () => {
  const { target, source } = makeFakeDriver();
  const res = await runStep(stepIndexFor('freeze_source') + 1, {
    target, source, checkpoint: {}, steps: [{ stepNo: 7, status: 'failed' }],
  });
  assert.equal(res.status, 'failed');
  assert.match(res.detail, /verification has not passed/i);
});

test('a failing verify stops the run and leaves the source writable', async () => {
  const driver = makeFakeDriver({
    target: { verifyCopy: async () => ({ ok: false, reason: 'checksum mismatch on ledger_entries' }) },
  });
  const result = await runJob({ target: driver.target, source: driver.source, checkpoint: {}, orgId: 'a', tables: ['findings'] });
  assert.equal(result.status, 'failed');
  assert.equal(result.stepNo, 7);
  // freeze_source (step 8) was never reached, so setMigrating was never called.
  assert.ok(!driver.calls.some((c) => c.name === 'setMigrating'));
  assert.ok(!result.steps.some((s) => s.stepKey === 'freeze_source'));
});

test('a resumable job skips the steps already done', async () => {
  const { target, source } = makeFakeDriver();
  const steps = [1, 2, 3].map((n) => ({ stepNo: n, status: 'done' }));
  const result = await runJob({ target, source, checkpoint: {}, orgId: 'a', tables: [], migrations: [], steps });
  assert.equal(result.steps.length, 8);
  assert.equal(result.steps[0].stepKey, 'copy_tables');
});

test('retire refuses when the export hash cannot be recorded', async () => {
  const { target, source } = makeFakeDriver({ source: { exportHash: async () => null } });
  const res = await runStep(11, { target, source, checkpoint: {}, orgId: 'a' });
  assert.equal(res.status, 'failed');
  assert.match(res.detail, /export hash/i);
});

test('runStep is deterministic for the same inputs', async () => {
  const a = makeFakeDriver();
  const b = makeFakeDriver();
  const ctxA = { target: a.target, source: a.source, checkpoint: {}, orgId: 'x', tables: ['t'], migrations: [] };
  const ctxB = { target: b.target, source: b.source, checkpoint: {}, orgId: 'x', tables: ['t'], migrations: [] };
  assert.deepEqual(await runStep(4, ctxA), await runStep(4, ctxB));
});

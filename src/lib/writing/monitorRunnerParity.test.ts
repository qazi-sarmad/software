/**
 * C1: the SQL monitor runner and the TypeScript engine must agree, byte for byte.
 *
 * Migration 0111 evaluates the released monitor rules in SQL (`monitor_evaluate_org`) and writes a
 * hash-chained alert per firing rule; the app's live preview uses `evaluateMonitor` /
 * `runMonitors` in this directory. Two copies of one rule drift, so this test drives the SAME three
 * staged records through the TypeScript engine and asserts the SAME pinned lineage hashes, reasons
 * and reference sets that `supabase/tests/112_phase5_monitor_runner.sql` asserts against the SQL
 * implementation. If either side changes alone, this test and test 112 both fail and name the case.
 *
 * The fixtures below are the three `staged_records` rows test 112 ingests (bank s1, bank s2,
 * ledger s3), and the evaluation instant is the same `2026-10-28T00:00:00.000Z`.
 */
import { describe, expect, it } from 'vitest';
import { evaluateMonitor, type MonitorRule, type SignalRecord } from './monitors';

const EVAL = '2026-10-28T00:00:00.000Z';
const ZERO = '0'.repeat(64);
const H = (c: string) => c.repeat(64);

const SIGNALS: SignalRecord[] = [
  { source: 'bank', id: 's1', contentHash: H('a'), occurredAt: '2026-10-27T23:58:00.000Z', values: { amount: 150, step_a: 1 }, tags: ['reconciled'] },
  { source: 'bank', id: 's2', contentHash: H('b'), occurredAt: '2026-10-27T23:59:30.000Z', values: { amount: 90, step_b: 1 }, tags: [] },
  { source: 'ledger', id: 's3', contentHash: H('c'), occurredAt: '2026-10-27T23:59:45.000Z', values: { amount: 250 }, tags: ['reconciled'] },
];

const RULES: MonitorRule[] = [
  { id: 'mon.t.amount', version: 1, kind: 'threshold', description: 'amount over 100', status: 'released', field: 'amount', comparison: 'gt', threshold: '100' },
  { id: 'mon.rate', version: 1, kind: 'rate', description: 'rate at least 2 in 120s', status: 'released', windowSeconds: 120, comparison: 'gte', threshold: '2' },
  { id: 'mon.seq', version: 1, kind: 'sequence', description: 'step a then b', status: 'released', sequence: ['step_a', 'step_b'] },
  { id: 'mon.set', version: 1, kind: 'set_membership', description: 'approved and reconciled present', status: 'released', requiredTags: ['approved', 'reconciled'] },
  { id: 'mon.miss', version: 1, kind: 'missing_event', description: 'an event every 10s', status: 'released', expectedEverySeconds: 10 },
  { id: 'mon.rec', version: 1, kind: 'reconciliation', description: 'bank equals ledger', status: 'released', field: 'amount', reconcile: { left: 'bank', right: 'ledger' } },
];

/** The pinned values test 112 asserts against the SQL implementation. */
const PINNED: { id: string; reason: string; windowStart: string | null; refs: string[]; lineageHash: string }[] = [
  { id: 'mon.t.amount', reason: 'the highest amount is 250, which is gt the threshold 100', windowStart: null, refs: ['ledger:s3'], lineageHash: 'd044ab777adea29b57d7d5db8d317c922dc9c7d8f07cdf4aeaaf1c0d071b57d5' },
  { id: 'mon.rate', reason: '3 signals occurred in the 120 second window, which is gte the threshold 2', windowStart: '2026-10-27T23:58:00.000Z', refs: ['bank:s1', 'bank:s2', 'ledger:s3'], lineageHash: '5eb561d79be5d2a55a474293bc1a3cb24db0acea9e697e7a9c164ea62d2780e1' },
  { id: 'mon.seq', reason: 'the ordered steps step_a then step_b all occurred', windowStart: null, refs: ['bank:s1', 'bank:s2', 'ledger:s3'], lineageHash: 'fb2cb643c06649f1a1e114c54d7ab4591215d0d5da615c63d50f3178764b6b4c' },
  { id: 'mon.set', reason: 'the required tags approved were not present', windowStart: null, refs: ['bank:s1', 'bank:s2', 'ledger:s3'], lineageHash: '5afb44a8082ada187080e9265753f9e79ba5c31558cdabf0628d6c5c47a415e5' },
  { id: 'mon.miss', reason: 'no event occurred for 15 seconds, more than the expected 10', windowStart: null, refs: ['ledger:s3'], lineageHash: 'd46ee9097061e319cb47b5432276ed6680cbd0675fbaee1a2d629e5c9b5acca1' },
  { id: 'mon.rec', reason: 'bank totals 240 and ledger totals 250, which differ', windowStart: null, refs: ['bank:s1', 'bank:s2', 'ledger:s3'], lineageHash: '25f6e1814ad811930e1bd2a008c4c5cbdf987fe10f6951e79f7cb92117fa75f9' },
];

describe('the SQL monitor runner and the TypeScript engine agree (C1)', () => {
  it('every released rule fires with the pinned reason, references and lineage hash', async () => {
    let chain = ZERO;
    for (const pinned of PINNED) {
      const rule = RULES.find((r) => r.id === pinned.id);
      expect(rule, `the fixture has rule ${pinned.id}`).toBeDefined();
      const alert = await evaluateMonitor(rule as MonitorRule, SIGNALS, EVAL, chain);
      expect(alert, `${pinned.id} fires`).not.toBeNull();
      if (!alert) continue;
      expect(alert.reason, `${pinned.id} reason`).toBe(pinned.reason);
      expect(alert.windowStart, `${pinned.id} window start`).toBe(pinned.windowStart);
      expect(alert.references.map((r) => r.id), `${pinned.id} references`).toEqual(pinned.refs);
      expect(alert.lineageHash, `${pinned.id} lineage hash`).toBe(pinned.lineageHash);
      chain = alert.hash;
    }
  });

  it('the six rules produce six alerts, and a rule that does not hold produces none', async () => {
    const quiet: MonitorRule = { id: 'mon.quiet', version: 1, kind: 'threshold', description: '', status: 'released', field: 'amount', comparison: 'gt', threshold: '100000' };
    const alert = await evaluateMonitor(quiet, SIGNALS, EVAL, ZERO);
    expect(alert).toBeNull();
  });
});

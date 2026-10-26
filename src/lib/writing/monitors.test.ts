import { describe, expect, it } from 'vitest';
import {
  evaluateMonitor, runMonitors, verifyAlertChain, MONITOR_KINDS,
  type MonitorRule, type SignalRecord,
} from './monitors';

/**
 * WP5 deterministic monitor rules.
 *
 * The rule engine is pure: every rule is versioned, reads only the signals it is given, and takes
 * the evaluation time as an argument. These tests pin the parts the connector suite did not:
 * the sequence kind, the cross-source scoping, determinism and purity (no clock read), and the
 * version travelling with the alert.
 */
const AT = '2026-10-25T09:00:00Z';

const SIGNALS: SignalRecord[] = [
  { source: 'syslog-cef', id: 's1', contentHash: 'a'.repeat(64), occurredAt: '2026-10-25T08:00:00Z', values: { severity: 9 }, tags: ['auth'] },
  { source: 'syslog-cef', id: 's2', contentHash: 'b'.repeat(64), occurredAt: '2026-10-25T08:30:00Z', values: { severity: 3 }, tags: ['auth', 'network'] },
  { source: 'datadog-events', id: 'd1', contentHash: 'c'.repeat(64), occurredAt: '2026-10-25T08:45:00Z', values: { amount: 5 } },
];

function rule(partial: Partial<MonitorRule> & Pick<MonitorRule, 'kind'>): MonitorRule {
  return {
    id: 'm.test', version: 1, description: 'test rule', status: 'released', ...partial,
  };
}

describe('WP5 monitor kinds are the documented closed set', () => {
  it('exposes exactly the six deterministic kinds', () => {
    expect(MONITOR_KINDS).toEqual([
      'threshold', 'rate', 'sequence', 'set_membership', 'missing_event', 'reconciliation',
    ]);
  });
});

describe('WP5 the sequence kind', () => {
  const signals: SignalRecord[] = [
    { source: 'app', id: 'a', contentHash: '1'.repeat(64), occurredAt: '2026-10-25T08:00:00Z', values: { login: 1, escalate: 0, exfiltrate: 0 } },
    { source: 'app', id: 'b', contentHash: '2'.repeat(64), occurredAt: '2026-10-25T08:10:00Z', values: { login: 0, escalate: 1, exfiltrate: 0 } },
    { source: 'app', id: 'c', contentHash: '3'.repeat(64), occurredAt: '2026-10-25T08:20:00Z', values: { login: 0, escalate: 0, exfiltrate: 1 } },
  ];

  it('fires when the ordered steps all occur', async () => {
    const alert = await evaluateMonitor(
      rule({ kind: 'sequence', sequence: ['login', 'escalate', 'exfiltrate'], source: 'app' }), signals, AT);
    expect(alert?.kind).toBe('sequence');
    expect(alert?.reason).toContain('login then escalate then exfiltrate');
  });

  it('does not fire when the order is wrong', async () => {
    const reversed = [signals[2], signals[1], signals[0]];
    const alert = await evaluateMonitor(
      rule({ kind: 'sequence', sequence: ['login', 'escalate', 'exfiltrate'], source: 'app' }), reversed, AT);
    // Sorted by occurredAt internally, so the correct order still fires regardless of input order.
    expect(alert).not.toBeNull();
    const wrongOrder = await evaluateMonitor(
      rule({ kind: 'sequence', sequence: ['exfiltrate', 'login'], source: 'app' }), signals, AT);
    expect(wrongOrder).toBeNull();
  });

  it('does not fire when a step never happens', async () => {
    const alert = await evaluateMonitor(
      rule({ kind: 'sequence', sequence: ['login', 'escalate', 'exfiltrate', 'persist'], source: 'app' }), signals, AT);
    expect(alert).toBeNull();
  });
});

describe('WP5 cross-source scoping', () => {
  it('a source-scoped threshold reads only its own source', async () => {
    // datadog-events holds the largest amount (5); a syslog-scoped rule must not see it.
    const alert = await evaluateMonitor(
      rule({ kind: 'threshold', field: 'amount', threshold: '1', comparison: 'gt', source: 'syslog-cef' }), SIGNALS, AT);
    expect(alert).toBeNull();
    const unscoped = await evaluateMonitor(
      rule({ kind: 'threshold', field: 'amount', threshold: '1', comparison: 'gt' }), SIGNALS, AT);
    expect(unscoped).not.toBeNull();
  });

  it('a rate rule counts only the scoped source inside the window', async () => {
    const alert = await evaluateMonitor(
      rule({ kind: 'rate', windowSeconds: 7200, threshold: '1', comparison: 'gt', source: 'datadog-events' }), SIGNALS, AT);
    expect(alert).toBeNull();
    const both = await evaluateMonitor(
      rule({ kind: 'rate', windowSeconds: 7200, threshold: '2', comparison: 'gt' }), SIGNALS, AT);
    expect(both).not.toBeNull();
  });

  it('a missing-event rule scoped to an absent source fires', async () => {
    const alert = await evaluateMonitor(
      rule({ kind: 'missing_event', source: 'never-connected', expectedEverySeconds: 60 }), SIGNALS, AT);
    expect(alert?.kind).toBe('missing_event');
    expect(alert?.reason).toContain('no event');
  });
});

describe('WP5 determinism and purity', () => {
  it('the same rule and signals produce the same hash every time', async () => {
    const r = rule({ kind: 'threshold', field: 'severity', threshold: '8', comparison: 'gt' });
    const a = await evaluateMonitor(r, SIGNALS, AT);
    const b = await evaluateMonitor(r, SIGNALS, AT);
    expect(a?.hash).toBe(b?.hash);
    expect(a?.lineageHash).toBe(b?.lineageHash);
  });

  it('reordering the input signals does not change the alert hash', async () => {
    const r = rule({ kind: 'rate', windowSeconds: 7200, threshold: '2', comparison: 'gt' });
    const forward = await evaluateMonitor(r, SIGNALS, AT);
    const shuffled = await evaluateMonitor(r, [...SIGNALS].reverse(), AT);
    expect(forward?.hash).toBe(shuffled?.hash);
  });

  it('reads no wall clock: the window is computed from the injected time', async () => {
    // A rate rule over a 2-hour window. At the injected evaluation time the three signals are inside
    // it; a day later they are outside, so the rule does not fire. If the function read the clock
    // instead of the argument, the two calls would agree.
    const r = rule({ kind: 'rate', windowSeconds: 7200, threshold: '1', comparison: 'gt' });
    const early = await evaluateMonitor(r, SIGNALS, AT);
    const late = await evaluateMonitor(r, SIGNALS, '2026-10-26T09:00:00Z');
    expect(early).not.toBeNull();
    expect(early?.evaluatedAt).toBe(AT);
    expect(late).toBeNull();
  });

  it('carries the rule version onto the alert', async () => {
    const alert = await evaluateMonitor(
      rule({ kind: 'threshold', field: 'severity', threshold: '8', comparison: 'gt', version: 7 }), SIGNALS, AT);
    expect(alert?.ruleVersion).toBe(7);
  });
});

describe('WP5 the alert chain', () => {
  it('chains released rules and detects a tampered leaf', async () => {
    const rules: MonitorRule[] = [
      rule({ id: 'm.a', kind: 'threshold', field: 'severity', threshold: '1', comparison: 'gt' }),
      rule({ id: 'm.b', kind: 'set_membership', requiredTags: ['database'] }),
    ];
    const alerts = await runMonitors(rules, SIGNALS, AT);
    expect(alerts).toHaveLength(2);
    expect(await verifyAlertChain(alerts)).toBe(true);
    const tampered = alerts.map((a, i) => (i === 1 ? { ...a, hash: 'f'.repeat(64) } : a));
    expect(await verifyAlertChain(tampered)).toBe(false);
  });

  it('skips draft rules entirely', async () => {
    const rules: MonitorRule[] = [
      rule({ id: 'm.draft', kind: 'threshold', field: 'severity', threshold: '1', comparison: 'gt', status: 'draft' }),
    ];
    expect(await runMonitors(rules, SIGNALS, AT)).toHaveLength(0);
  });
});

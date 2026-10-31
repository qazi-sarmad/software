import { describe, expect, it } from 'vitest';
import {
  applyMapping, catalogue, connectorById, CONNECTORS, LIVE_NOT_VERIFIED,
} from './connectorCatalogue';
import {
  ConnectorInstance, readOnlyTransport, stageRecords, Transport, verifyWebhook,
} from './connectors';
import { SignalRecord, MonitorRule, evaluateMonitor, runMonitors, verifyAlertChain, validateTriage } from './monitors';
import { sha256Hex } from './canonical';

/** A mock transport that serves a recorded fixture. No network is used. */
function fixtureTransport(fixtures: Record<string, string>, record: { method: string; url: string }[] = []): Transport {
  return {
    async request(input) {
      record.push({ method: input.method, url: input.url });
      for (const path of Object.keys(fixtures)) {
        if (input.url.includes(path)) {
          return { status: 200, headers: {}, body: fixtures[path] };
        }
      }
      return { status: 404, headers: {}, body: '{"error":"not found"}' };
    },
  };
}

const INSTANCE: ConnectorInstance = {
  id: 'inst-1', orgId: 'org-a', connectorId: 'http-rest',
  config: { base_url: 'https://mock.local' }, cursor: { value: null }, enabled: true,
};

const FIXTURE = JSON.stringify({
  rows: [
    { id: 'r1', value: 10 },
    { id: 'r2', value: 20 },
  ],
  next_cursor: 'abc',
});

describe('W11.1 connector framework', () => {
  it('offers at least 20 adapters, every one marked live-verified NO', () => {
    expect(CONNECTORS.length).toBeGreaterThanOrEqual(20);
    for (const c of catalogue()) {
      expect(c.liveVerified).toBe(false);
      expect(c.ownerSteps && c.ownerSteps.length).toBeTruthy();
      expect(c.capabilities).toContain('read_only');
      expect(c.readOnlyScopes.length).toBeGreaterThan(0);
    }
    expect(LIVE_NOT_VERIFIED).toContain('live-verified: NO');
  });

  it('fetches rows through the transport and returns a cursor', async () => {
    const c = connectorById('http-rest')!;
    const result = await c.fetch(INSTANCE, fixtureTransport({ '/fixture/rows.json': FIXTURE }));
    expect(result.records).toHaveLength(2);
    expect(result.nextCursor.value).toBe('abc');
  });

  it('maps a source row to a staged, content-hashed record deterministically', async () => {
    const c = connectorById('http-rest')!;
    const a = await c.map({ id: 'r1', value: 10 }, INSTANCE, '2026-10-25T09:00:00Z', 'run-1');
    const b = await c.map({ id: 'r1', value: 10 }, INSTANCE, '2026-10-25T09:00:00Z', 'run-1');
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.sourceId).toBe('r1');
    expect(a.values.value).toBe(10);
  });

  it('stages idempotently: the same record fetched twice stages once', async () => {
    const c = connectorById('http-rest')!;
    const records = await Promise.all([
      c.map({ id: 'r1', value: 10 }, INSTANCE, '2026-10-25T09:00:00Z', 'run-1'),
      c.map({ id: 'r1', value: 10 }, INSTANCE, '2026-10-25T09:00:00Z', 'run-2'),
    ]);
    const { staged, skipped } = await stageRecords(records, new Set());
    expect(staged).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('refuses a write method through the read-only transport', async () => {
    const inner = fixtureTransport({ '/fixture/rows.json': FIXTURE });
    const transport = readOnlyTransport(inner);
    await expect(transport.request({ method: 'DELETE' as 'GET', url: 'https://mock.local/x' }))
      .rejects.toThrow(/read-only/);
  });

  it('applies a field mapping through declared kinds, never raw JSON', () => {
    const mapped = applyMapping(
      { id: 'r1', amount: '12.50', flag: 'true' },
      [
        { from: 'id', to: 'source_id', kind: 'text' },
        { from: 'amount', to: 'amount', kind: 'number' },
        { from: 'flag', to: 'flag', kind: 'boolean' },
      ],
    );
    expect(mapped).toEqual({ source_id: 'r1', amount: 12.5, flag: true });
  });

  it('checks health through the transport without a network', async () => {
    const c = connectorById('http-rest')!;
    const health = await c.healthCheck(INSTANCE, fixtureTransport({ '/fixture/rows.json': FIXTURE }));
    expect(health.ok).toBe(true);
  });
});

describe('W11.3 signed webhook receiver', () => {
  const hmac = async (secret: string, message: string) => sha256Hex(`${secret}|${message}`);

  it('accepts a fresh, correctly signed request', async () => {
    const ts = '1770000000000';
    const sig = await hmac('s3cret', `${ts}.{"event":"x"}`);
    const err = await verifyWebhook({ body: '{"event":"x"}', signature: sig, timestamp: ts, secret: 's3cret', now: 1770000000000 }, hmac);
    expect(err).toBeNull();
  });

  it('refuses a replay outside the window', async () => {
    const ts = '1770000000000';
    const sig = await hmac('s3cret', `${ts}.{"event":"x"}`);
    const err = await verifyWebhook({ body: '{"event":"x"}', signature: sig, timestamp: ts, secret: 's3cret', now: 1770009999999 }, hmac);
    expect(err).toMatch(/replay window/);
  });

  it('refuses a bad signature', async () => {
    const ts = '1770000000000';
    const err = await verifyWebhook({ body: '{"event":"x"}', signature: 'deadbeef', timestamp: ts, secret: 's3cret', now: 1770000000000 }, hmac);
    expect(err).toMatch(/signature/);
  });
});

const SIGNALS: SignalRecord[] = [
  { source: 'syslog-cef', id: 's1', contentHash: 'a'.repeat(64), occurredAt: '2026-10-25T08:00:00Z', values: { severity: 9 }, tags: ['auth'] },
  { source: 'syslog-cef', id: 's2', contentHash: 'b'.repeat(64), occurredAt: '2026-10-25T08:30:00Z', values: { severity: 3 }, tags: ['auth', 'network'] },
  { source: 'datadog-events', id: 'd1', contentHash: 'c'.repeat(64), occurredAt: '2026-10-25T08:45:00Z', values: { amount: 5 } },
];

describe('W11.4 deterministic monitors', () => {
  const at = '2026-10-25T09:00:00Z';

  it('fires a threshold rule', async () => {
    const rule: MonitorRule = { id: 'm.threshold', version: 1, kind: 'threshold', description: 'severity above 8', status: 'released', field: 'severity', threshold: '8', comparison: 'gt' };
    const alert = await evaluateMonitor(rule, SIGNALS, at);
    expect(alert?.ruleId).toBe('m.threshold');
    expect(alert?.reason).toContain('threshold 8');
  });

  it('does not fire a threshold rule that does not hold', async () => {
    const rule: MonitorRule = { id: 'm.threshold', version: 1, kind: 'threshold', description: 'severity above 99', status: 'released', field: 'severity', threshold: '99', comparison: 'gt' };
    expect(await evaluateMonitor(rule, SIGNALS, at)).toBeNull();
  });

  it('fires a rate rule over a window', async () => {
    const rule: MonitorRule = { id: 'm.rate', version: 1, kind: 'rate', description: 'more than 2 signals in 2 hours', status: 'released', windowSeconds: 7200, threshold: '2', comparison: 'gt' };
    const alert = await evaluateMonitor(rule, SIGNALS, at);
    expect(alert?.kind).toBe('rate');
    expect(alert?.windowStart).toBeTruthy();
  });

  it('fires a set-membership rule when a required tag is missing', async () => {
    const rule: MonitorRule = { id: 'm.set', version: 1, kind: 'set_membership', description: 'must see a database tag', status: 'released', requiredTags: ['database'] };
    const alert = await evaluateMonitor(rule, SIGNALS, at);
    expect(alert?.reason).toContain('database');
  });

  it('fires a missing-event rule when the gap is too long', async () => {
    const rule: MonitorRule = { id: 'm.missing', version: 1, kind: 'missing_event', description: 'expect a syslog event each hour', status: 'released', source: 'syslog-cef', expectedEverySeconds: 1200 };
    const alert = await evaluateMonitor(rule, SIGNALS, at);
    expect(alert?.kind).toBe('missing_event');
  });

  it('fires a reconciliation rule when two sources disagree', async () => {
    const signals: SignalRecord[] = [
      { source: 'left', id: 'l1', contentHash: 'a'.repeat(64), occurredAt: at, values: { amount: 10 } },
      { source: 'right', id: 'r1', contentHash: 'b'.repeat(64), occurredAt: at, values: { amount: 12 } },
    ];
    const rule: MonitorRule = { id: 'm.recon', version: 1, kind: 'reconciliation', description: 'left and right agree', status: 'released', field: 'amount', reconcile: { left: 'left', right: 'right' } };
    const alert = await evaluateMonitor(rule, signals, at);
    expect(alert?.reason).toContain('differ');
  });

  it('chains alerts and verifies the chain', async () => {
    const rules: MonitorRule[] = [
      { id: 'm.one', version: 1, kind: 'threshold', description: 'x', status: 'released', field: 'severity', threshold: '1', comparison: 'gt' },
      { id: 'm.two', version: 1, kind: 'rate', description: 'y', status: 'released', windowSeconds: 7200, threshold: '1', comparison: 'gt' },
      { id: 'm.three', version: 1, kind: 'set_membership', description: 'z', status: 'released', requiredTags: ['database'] },
    ];
    const alerts = await runMonitors(rules, SIGNALS, at);
    expect(alerts.length).toBe(3);
    expect(await verifyAlertChain(alerts)).toBe(true);
    const tampered = alerts.map((a, i) => i === 0 ? { ...a, hash: 'f'.repeat(64) } : a);
    expect(await verifyAlertChain(tampered)).toBe(false);
  });

  it('ignores a draft rule: a rule must be released before it can fire', async () => {
    const rule: MonitorRule = { id: 'm.draft', version: 1, kind: 'threshold', description: 'x', status: 'draft', field: 'severity', threshold: '1', comparison: 'gt' };
    expect(await runMonitors([rule], SIGNALS, at)).toHaveLength(0);
  });

  it('requires a reason to dismiss and an expiry to snooze', () => {
    expect(validateTriage({ alertHash: 'h', disposition: 'dismissed', triagedBy: 'u', triagedAt: 't' })).toMatch(/reason/);
    expect(validateTriage({ alertHash: 'h', disposition: 'snoozed', triagedBy: 'u', triagedAt: 't' })).toMatch(/expiry/);
    expect(validateTriage({ alertHash: 'h', disposition: 'dismissed', reason: 'duplicate', triagedBy: 'u', triagedAt: 't' })).toBeNull();
  });
});

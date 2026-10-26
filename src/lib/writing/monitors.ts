/**
 * W11.4: continuous monitoring, deterministic.
 *
 * A monitor is a rule as data: a threshold, a rate over a window, a sequence, a set membership, a
 * missing expected event, or a cross-source reconciliation. Rules are evaluated on staged signals by
 * a pure function that takes the window and the time as arguments. There is no learning and no
 * scoring by a model: a rule either holds or does not.
 *
 * An alert is a hash-chained record carrying its rule id and version, its source records and their
 * hashes, and a lineage. An alert becomes report content only through an observation that passed
 * final approval (W3), and the digest model (M12) summarises only dispositioned alerts.
 */

import { hashParts } from './canonical';
import type { Reference } from './types';

export type MonitorKind =
  | 'threshold'
  | 'rate'
  | 'sequence'
  | 'set_membership'
  | 'missing_event'
  | 'reconciliation';

export type MonitorStatus = 'draft' | 'released';

export interface SignalRecord {
  /** The staged source: a connector id, or 'internal'. */
  source: string;
  id: string;
  contentHash: string;
  /** The time the signal describes, as a UTC instant string. */
  occurredAt: string;
  /** The typed values the rule reads. A number is an integer or a fixed-scale decimal string. */
  values: Record<string, string | number | boolean>;
  /** The set memberships this signal declares, for a set-membership rule. */
  tags?: string[];
}

export interface MonitorRule {
  id: string;
  version: number;
  kind: MonitorKind;
  description: string;
  status: MonitorStatus;
  /** The window in seconds, for a rate rule; ignored otherwise. */
  windowSeconds?: number;
  /** The field the rule reads, for threshold, rate, sequence and reconciliation rules. */
  field?: string;
  /** Restrict the rule to one staged source, so an unrelated signal cannot mask a real one. */
  source?: string;
  /** The numeric threshold, for a threshold or rate rule, as a fixed-scale decimal string. */
  threshold?: string;
  /** The comparison for a threshold or rate rule. */
  comparison?: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  /** The required set, for a set-membership rule. */
  requiredTags?: string[];
  /** The ordered fields, for a sequence rule. */
  sequence?: string[];
  /** For a missing-event rule: the event field and the expected interval in seconds. */
  expectedEverySeconds?: number;
  /** For a reconciliation rule: the two sources that must agree on the total of `field`. */
  reconcile?: { left: string; right: string };
}

export interface MonitorAlert {
  ruleId: string;
  ruleVersion: number;
  kind: MonitorKind;
  /** The plain-words reason the rule fired, composed from the rule, never generated. */
  reason: string;
  /** The staged records the alert derives from, with their content hashes. */
  references: Reference[];
  /** The evaluation time, an argument. */
  evaluatedAt: string;
  /** The window start, when the rule has one. */
  windowStart: string | null;
  /** The hash chain link. */
  prevHash: string;
  hash: string;
  /** The deterministic lineage hash over the rule and the source records. */
  lineageHash: string;
}

const ZERO = '0'.repeat(64);

function cmp(value: number, threshold: number, comparison: MonitorRule['comparison']): boolean {
  switch (comparison) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

function toNumber(v: string | number | boolean | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function secondsBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 1000;
}

/**
 * Evaluate one rule over the staged signals. Pure: the signals, the window and the evaluation time
 * are all arguments. Returns the firing alert, or null when the rule does not hold.
 */
export async function evaluateMonitor(
  rule: MonitorRule,
  signals: SignalRecord[],
  evaluatedAt: string,
  prevHash = ZERO,
): Promise<MonitorAlert | null> {
  const scoped = rule.source ? signals.filter((s) => s.source === rule.source) : signals;
  const ordered = [...scoped].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id < b.id ? -1 : 1));
  let fired = false;
  let reason = '';
  let used: SignalRecord[] = [];
  let windowStart: string | null = null;

  switch (rule.kind) {
    case 'threshold': {
      // The maximum of the field across the scoped signals, so the rule reads a deterministic
      // aggregate and cannot be masked by a later, unrelated record.
      let value = 0;
      let peak: SignalRecord | undefined;
      for (const s of ordered) {
        const v = toNumber(s.values[rule.field ?? '']);
        if (!peak || v > value) { value = v; peak = s; }
      }
      const threshold = Number(rule.threshold ?? '0');
      fired = cmp(value, threshold, rule.comparison);
      used = peak ? [peak] : [];
      reason = fired
        ? `the highest ${rule.field} is ${value}, which is ${rule.comparison} the threshold ${threshold}`
        : '';
      break;
    }
    case 'rate': {
      const windowSeconds = rule.windowSeconds ?? 0;
      const windowEnd = evaluatedAt;
      const start = new Date(Date.parse(evaluatedAt) - windowSeconds * 1000).toISOString();
      windowStart = start;
      const inWindow = ordered.filter((s) => s.occurredAt >= start && s.occurredAt <= windowEnd);
      const value = inWindow.length;
      const threshold = Number(rule.threshold ?? '0');
      fired = cmp(value, threshold, rule.comparison);
      used = inWindow;
      reason = fired
        ? `${value} signals occurred in the ${windowSeconds} second window, which is ${rule.comparison} the threshold ${threshold}`
        : '';
      break;
    }
    case 'sequence': {
      const fields = rule.sequence ?? [];
      const seen: string[] = [];
      for (const s of ordered) {
        const next = fields[seen.length];
        if (next && toNumber(s.values[next]) !== 0) seen.push(next);
        if (seen.length === fields.length) break;
      }
      fired = seen.length === fields.length;
      used = fired ? ordered : [];
      reason = fired ? `the ordered steps ${fields.join(' then ')} all occurred` : '';
      break;
    }
    case 'set_membership': {
      const required = new Set(rule.requiredTags ?? []);
      const present = new Set(ordered.flatMap((s) => s.tags ?? []));
      const missing = [...required].filter((t) => !present.has(t));
      fired = missing.length > 0;
      used = ordered;
      reason = fired ? `the required tags ${missing.join(', ')} were not present` : '';
      break;
    }
    case 'missing_event': {
      const interval = rule.expectedEverySeconds ?? 0;
      const last = ordered.at(-1);
      if (!last) {
        fired = true;
        reason = 'no event of the expected kind was seen';
      } else {
        const gap = secondsBetween(last.occurredAt, evaluatedAt);
        fired = gap > interval;
        used = [last];
        reason = fired ? `no event occurred for ${Math.round(gap)} seconds, more than the expected ${interval}` : '';
      }
      break;
    }
    case 'reconciliation': {
      const spec = rule.reconcile ?? { left: '', right: '' };
      const total = (source: string) => ordered.filter((s) => s.source === source)
        .reduce((sum, s) => sum + toNumber(s.values[rule.field ?? '']), 0);
      const left = total(spec.left);
      const right = total(spec.right);
      fired = left !== right;
      used = ordered.filter((s) => s.source === spec.left || s.source === spec.right);
      reason = fired ? `${spec.left} totals ${left} and ${spec.right} totals ${right}, which differ` : '';
      break;
    }
  }

  if (!fired) return null;
  const references: Reference[] = used.map((s) => ({ type: 'signal', id: `${s.source}:${s.id}`, contentHash: s.contentHash }));
  const lineageHash = await hashParts([
    'alert', rule.id, String(rule.version), rule.kind, evaluatedAt, windowStart ?? '',
    ...references.map((r) => `${r.type}:${r.id}:${r.contentHash}`),
  ]);
  const hash = await hashParts([prevHash, lineageHash]);
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    kind: rule.kind,
    reason,
    references,
    evaluatedAt,
    windowStart,
    prevHash,
    hash,
    lineageHash,
  };
}

/** Evaluate every released rule over the signals, chaining the alerts. */
export async function runMonitors(
  rules: MonitorRule[], signals: SignalRecord[], evaluatedAt: string, prevHash = ZERO,
): Promise<MonitorAlert[]> {
  const alerts: MonitorAlert[] = [];
  let chain = prevHash;
  for (const rule of rules) {
    if (rule.status !== 'released') continue;
    const alert = await evaluateMonitor(rule, signals, evaluatedAt, chain);
    if (alert) {
      alerts.push(alert);
      chain = alert.hash;
    }
  }
  return alerts;
}

/** Verify an alert chain: each alert's hash must follow from its predecessor. */
export async function verifyAlertChain(alerts: MonitorAlert[], genesis = ZERO): Promise<boolean> {
  let prev = genesis;
  for (const alert of alerts) {
    if (alert.prevHash !== prev) return false;
    const expected = await hashParts([prev, alert.lineageHash]);
    if (alert.hash !== expected) return false;
    prev = alert.hash;
  }
  return true;
}

/** The disposition of an alert, for triage (W11.6) and the digest (M12). */
export type AlertDisposition = 'open' | 'dismissed' | 'snoozed' | 'escalated';

export interface AlertTriage {
  alertHash: string;
  disposition: AlertDisposition;
  /** A dismissal requires a reason. */
  reason?: string;
  /** A snooze requires an expiry. */
  snoozeUntil?: string;
  triagedBy: string;
  triagedAt: string;
}

/** Dismissing an alert requires a reason; snoozing requires an expiry. Deterministic validation. */
export function validateTriage(triage: AlertTriage): string | null {
  if (triage.disposition === 'dismissed' && !triage.reason?.trim()) return 'a dismissal requires a reason';
  if (triage.disposition === 'snoozed' && !triage.snoozeUntil) return 'a snooze requires an expiry';
  return null;
}

/** An alert with a dismissed disposition can never become report content (W5.3 contradiction rule). */
export function isReportable(alert: MonitorAlert, triage: AlertTriage | undefined): boolean {
  if (!triage) return false;
  return triage.disposition === 'escalated';
}

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLL_INTERVAL_MS,
  changeBelongsToOrg,
  chooseTransport,
  nextRecordRevision,
  orgChangeFilter,
  pollDue,
  pollInterval,
  readRecordRevision,
  recordRevisionKey,
  transportLabel,
} from './liveSync';

describe('live-sync transport policy (§17.1, §22)', () => {
  it('uses Realtime when it is available and the poll fallback otherwise', () => {
    expect(chooseTransport({ realtimeAvailable: true })).toBe('realtime');
    expect(chooseTransport({ realtimeAvailable: false })).toBe('poll');
  });

  it('defaults the poll interval and never lets it fall below one second', () => {
    expect(pollInterval({ realtimeAvailable: false })).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(pollInterval({ realtimeAvailable: false, pollIntervalMs: 200 })).toBe(1000);
    expect(pollInterval({ realtimeAvailable: false, pollIntervalMs: 8000 })).toBe(8000);
  });

  it('a poll is due only once the interval has elapsed, and never for a backwards clock', () => {
    expect(pollDue(4999, { realtimeAvailable: false, pollIntervalMs: 5000 })).toBe(false);
    expect(pollDue(5000, { realtimeAvailable: false, pollIntervalMs: 5000 })).toBe(true);
    expect(pollDue(-1, { realtimeAvailable: false, pollIntervalMs: 5000 })).toBe(false);
  });

  it('filters a subscription to the caller org', () => {
    expect(orgChangeFilter('org-1')).toBe('org_id=eq.org-1');
  });

  it('re-checks org membership on a change, ignoring a foreign row', () => {
    expect(changeBelongsToOrg({ new: { org_id: 'a' } }, 'a')).toBe(true);
    expect(changeBelongsToOrg({ new: { org_id: 'b' } }, 'a')).toBe(false);
    // A DELETE carries `old`.
    expect(changeBelongsToOrg({ old: { org_id: 'a' } }, 'a')).toBe(true);
    // An empty payload belongs to nobody.
    expect(changeBelongsToOrg({}, 'a')).toBe(false);
  });

  it('namespaces the revision key per record', () => {
    expect(recordRevisionKey('engagement', 'e1')).toBe('provio.live.engagement.e1');
  });

  it('reads a revision, treating missing and unparseable values as zero', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(readRecordRevision(store(null), 'k')).toBe(0);
    expect(readRecordRevision(store('nonsense'), 'k')).toBe(0);
    expect(readRecordRevision(store('3'), 'k')).toBe(3);
  });

  it('increments a revision monotonically, from zero when unset', () => {
    expect(nextRecordRevision(0, 1)).toBe(1);
    expect(nextRecordRevision(4, 2)).toBe(5);
    expect(nextRecordRevision(Number.NaN, 2)).toBe(1);
  });

  it('labels the transport in person-facing words, never the internal name', () => {
    expect(transportLabel('realtime')).toBe('Live');
    expect(transportLabel('poll')).toBe('Near-live');
    // The internal name for the fallback must not leak into the label.
    expect(transportLabel('poll')).not.toBe('poll');
  });
});
